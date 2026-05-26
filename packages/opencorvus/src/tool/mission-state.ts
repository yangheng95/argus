import z from "zod"
import path from "node:path"
import fs from "node:fs/promises"
import { Tool } from "./tool"
import { Instance } from "@/project/instance"

/**
 * Mission state tool — path-confined worktree I/O for the gateway-master
 * supervisor agent. See specs/gateway-master-supervisor-2026-05-26.md §2.2.
 *
 * Why this tool exists instead of giving master generic read/write/glob:
 * the supervisor MUST NOT acquire general workspace I/O (rule 11 — the
 * orchestrator-core comment block has a literal history log of how a
 * scheduler-style agent with bash/edit/read tools bypassed worker
 * dispatch and tried to do work itself). mission_state restricts master
 * to a fixed directory tree and a fixed file-name vocabulary so it
 * cannot read/overwrite arbitrary repo files even by mistake.
 *
 * Directory layout (relative to the project directory at run time):
 *   .opencorvus/runtime/gateway-master/<missionID>/
 *     frontier.md   — outstanding work the master is tracking
 *     tasks.md      — engine_task IDs the master has dispatched + status
 *     handoff.md    — brief for the next wake of this same mission
 *     notes.md      — free-form scratchpad
 *
 * The four file names are an alphabet, not a schema — the LLM owns the
 * markdown contents, but the host owns where it lives. `.gitignore`
 * keeps the runtime tree out of the working copy.
 */

// Hard-coded file vocabulary. New file names are a deliberate schema
// change; do not add ad-hoc names from the LLM side.
const MISSION_FILES = ["frontier.md", "tasks.md", "handoff.md", "notes.md"] as const
type MissionFile = (typeof MISSION_FILES)[number]

// Mission identifier: lowercase alphanumerics + hyphens, 1..64 chars.
// Disallowing dots / slashes / backslashes is what protects the
// path-traversal boundary together with `path.resolve` checking below.
const MISSION_ID_RE = /^[a-z0-9-]{1,64}$/

// 256 KB cap on a single file write. Mission state is markdown notes,
// not artifact storage; anything past this size belongs in a real
// engine_artifact row.
const MAX_CONTENT_BYTES = 256 * 1024

function runtimeBase() {
  // Instance.directory is the project's active working directory; the
  // master session is always tied to a single project / cwd, so we
  // resolve relative to it. If the master ever needs to switch cwd
  // (multi-worktree mission), that decision is explicit at the wake
  // boundary, not silently here.
  return path.resolve(Instance.directory, ".opencorvus", "runtime", "gateway-master")
}

function missionDir(missionID: string) {
  if (!MISSION_ID_RE.test(missionID)) {
    throw new Error(
      `Invalid missionID "${missionID}". Must match /^[a-z0-9-]{1,64}$/ — lowercase letters, digits, and hyphens only.`,
    )
  }
  const base = runtimeBase()
  const resolved = path.resolve(base, missionID)
  // Defense in depth: even though the regex rejects ../ and slashes,
  // verify the resolved path actually stays under the base. Catches
  // future regex regressions and platform path quirks.
  if (resolved !== path.join(base, missionID) && !resolved.startsWith(base + path.sep)) {
    throw new Error(`missionID path traversal blocked: ${missionID}`)
  }
  return resolved
}

function missionFilePath(missionID: string, file: MissionFile) {
  return path.join(missionDir(missionID), file)
}

async function atomicWrite(target: string, content: string) {
  await fs.mkdir(path.dirname(target), { recursive: true })
  // temp + rename: avoids torn writes if the process crashes or another
  // wake reads mid-write. process.pid + Date.now() suffix is enough —
  // a single master session is the only writer per missionID (the route
  // and wake path enforce single-loop-per-mission), and even racing
  // writers would each get a distinct temp path.
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`
  try {
    await fs.writeFile(tmp, content, "utf8")
    await fs.rename(tmp, target)
  } catch (err) {
    // Best-effort cleanup if rename failed; ignore unlink errors so the
    // original write error surfaces unmasked.
    await fs.unlink(tmp).catch(() => {})
    throw err
  }
}

async function readIfExists(target: string): Promise<string | undefined> {
  try {
    return await fs.readFile(target, "utf8")
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw err
  }
}

async function statIfExists(target: string) {
  try {
    return await fs.stat(target)
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw err
  }
}

const ReadAction = z.object({
  action: z.literal("read"),
  missionID: z.string(),
  file: z.enum(MISSION_FILES),
})

const WriteAction = z.object({
  action: z.literal("write"),
  missionID: z.string(),
  file: z.enum(MISSION_FILES),
  content: z.string(),
})

const ListAction = z.object({
  action: z.literal("list"),
  missionID: z.string(),
})

const MissionStateAction = z.discriminatedUnion("action", [ReadAction, WriteAction, ListAction])

export const MissionStateTool = Tool.define("mission_state", {
  description: [
    "Read, write, or list mission supervisor state files for a single mission.",
    "All I/O is confined to the path `.opencorvus/runtime/gateway-master/<missionID>/`",
    "with a fixed file-name vocabulary: frontier.md, tasks.md, handoff.md, notes.md.",
    "Use this to carry mission progress across wake cycles — do NOT use read/write/glob.",
    "",
    "Actions:",
    "  read   { missionID, file } → returns the file content as a string (empty when not yet created).",
    "  write  { missionID, file, content } → atomically replaces the file (≤256 KB).",
    "  list   { missionID } → returns metadata for each of the four files that currently exist.",
  ].join("\n"),
  parameters: MissionStateAction,
  async execute(params) {
    switch (params.action) {
      case "read": {
        const target = missionFilePath(params.missionID, params.file)
        const content = (await readIfExists(target)) ?? ""
        return {
          title: `mission_state read ${params.missionID}/${params.file}`,
          output: content,
          metadata: { missionID: params.missionID, file: params.file, exists: content.length > 0 },
        }
      }
      case "write": {
        const bytes = Buffer.byteLength(params.content, "utf8")
        if (bytes > MAX_CONTENT_BYTES) {
          throw new Error(
            `mission_state.write content size ${bytes} bytes exceeds limit ${MAX_CONTENT_BYTES} bytes. ` +
              `Trim the file or move bulk data to an engine_artifact.`,
          )
        }
        const target = missionFilePath(params.missionID, params.file)
        await atomicWrite(target, params.content)
        return {
          title: `mission_state write ${params.missionID}/${params.file}`,
          output: `Wrote ${bytes} bytes to ${params.file}.`,
          metadata: { missionID: params.missionID, file: params.file, bytes },
        }
      }
      case "list": {
        const dir = missionDir(params.missionID)
        const entries = await Promise.all(
          MISSION_FILES.map(async (file) => {
            const stat = await statIfExists(path.join(dir, file))
            return stat
              ? { file, size: stat.size, mtime: stat.mtimeMs }
              : null
          }),
        )
        const present = entries.filter((entry): entry is { file: MissionFile; size: number; mtime: number } => !!entry)
        return {
          title: `mission_state list ${params.missionID}`,
          output: JSON.stringify({ missionID: params.missionID, files: present }),
          metadata: { missionID: params.missionID, count: present.length },
        }
      }
    }
  },
})

// Re-exported for tests and for callers that want to enumerate the
// supported file names without re-deriving them from the Zod enum.
export const MISSION_STATE_FILES = MISSION_FILES
export type MissionStateFile = MissionFile
