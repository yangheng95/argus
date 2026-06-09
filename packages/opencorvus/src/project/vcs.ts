import { BusEvent } from "@/bus/bus-event"
import { Bus } from "@/bus"
import z from "zod"
import path from "path"
import { Log } from "@/util/log"
import { git, type GitResult } from "@/util/git"
import { Instance, lazyInstanceState } from "./instance"
import { Project } from "./project"
import { Filesystem } from "@/util/filesystem"
import { FileWatcher } from "@/file/watcher"
import { formatPatch, structuredPatch } from "diff"

const log = Log.create({ service: "vcs" })
const PATCH_CONTEXT_LINES = 2_147_483_647
const MAX_PATCH_BYTES = 10_000_000
const MAX_TOTAL_PATCH_BYTES = 10_000_000

type DiffOptions = {
  readonly context?: number
}

type DiffItem = {
  readonly file: string
  readonly status: "added" | "deleted" | "modified"
  readonly code: string
}

type DiffStat = {
  readonly additions: number
  readonly deletions: number
  readonly binary: boolean
}

const emptyPatch = (file: string) => formatPatch(structuredPatch(file, file, "", "", "", "", { context: 0 }))

function patchContext(options?: DiffOptions) {
  return String(options?.context ?? PATCH_CONTEXT_LINES)
}

function normalizeGitPath(file: string) {
  return file.replaceAll("\\", "/")
}

function parseStatusCode(code: string): DiffItem["status"] {
  if (code.startsWith("A")) return "added"
  if (code.startsWith("D")) return "deleted"
  return "modified"
}

function parseNameStatus(text: string): DiffItem[] {
  return text
    .trim()
    .split(/\r?\n/)
    .flatMap((line) => {
      if (!line) return []
      const [code, file] = line.split("\t")
      if (!code || !file) return []
      return [{ file: normalizeGitPath(file), code, status: parseStatusCode(code) }]
    })
}

function parseNumstat(text: string) {
  const stats = new Map<string, DiffStat>()
  for (const line of text.trim().split(/\r?\n/)) {
    if (!line) continue
    const [rawAdditions, rawDeletions, rawFile] = line.split("\t")
    const file = rawFile?.includes(" => ") ? rawFile.split(" => ").at(-1) : rawFile
    if (!rawAdditions || !rawDeletions || !file) continue
    const binary = rawAdditions === "-" && rawDeletions === "-"
    const additions = Number.parseInt(rawAdditions, 10)
    const deletions = Number.parseInt(rawDeletions, 10)
    stats.set(normalizeGitPath(file), {
      additions: Number.isFinite(additions) ? additions : 0,
      deletions: Number.isFinite(deletions) ? deletions : 0,
      binary,
    })
  }
  return stats
}

function parseZeroSeparatedFiles(text: string) {
  return text
    .split("\0")
    .map((file) => normalizeGitPath(file.trim()))
    .filter(Boolean)
}

function mergeDiffItems(...lists: DiffItem[][]) {
  const out = new Map<string, DiffItem>()
  for (const item of lists.flat()) {
    if (!out.has(item.file)) out.set(item.file, item)
  }
  return [...out.values()].toSorted((a, b) => a.file.localeCompare(b.file))
}

function parseQuotedPath(value: string) {
  let out = ""
  for (let idx = 1; idx < value.length; idx++) {
    const char = value[idx]
    if (char === '"') return { value: out, end: idx + 1 }
    if (char !== "\\") {
      out += char
      continue
    }

    const next = value[++idx]
    if (next === "t") out += "\t"
    else if (next === "n") out += "\n"
    else if (next === "r") out += "\r"
    else if (next === '"' || next === "\\") out += next
    else out += next ?? ""
  }
}

function parsePathToken(value: string) {
  if (!value.startsWith('"')) return value.split("\t")[0]
  return parseQuotedPath(value)?.value ?? value
}

function fileFromDiffPath(value: string | undefined) {
  if (!value || value === "/dev/null") return
  const file = parsePathToken(value)
  if (file.startsWith("a/") || file.startsWith("b/")) return file.slice(2)
  return file
}

function fileFromGitHeader(header: string) {
  if (header.startsWith('"')) {
    const first = parseQuotedPath(header)
    const second = first ? header.slice(first.end).trimStart() : undefined
    if (!second) return
    if (!second.startsWith('"')) return fileFromDiffPath(second)
    return fileFromDiffPath(parseQuotedPath(second)?.value)
  }

  const separator = header.indexOf(" b/")
  if (separator === -1) return
  return fileFromDiffPath(header.slice(separator + 1))
}

function fileFromPatchChunk(chunk: string) {
  const next = /^\+\+\+ (.+)$/m.exec(chunk)?.[1]
  const before = /^--- (.+)$/m.exec(chunk)?.[1]
  const file = fileFromDiffPath(next) ?? fileFromDiffPath(before)
  if (file) return file

  const header = /^diff --git (.+)$/m.exec(chunk)?.[1]
  return fileFromGitHeader(header ?? "")
}

function splitGitPatch(text: string) {
  const starts = [...text.matchAll(/(?:^|\n)diff --git /g)].map((match) =>
    match[0].startsWith("\n") ? match.index + 1 : match.index,
  )
  return starts.map((start, index) => text.slice(start, starts[index + 1] ?? text.length))
}

function patchMap(text: string) {
  return splitGitPatch(text).reduce((acc, patch) => {
    const file = fileFromPatchChunk(patch)
    if (!file) return acc
    acc.set(normalizeGitPath(file), (acc.get(file) ?? "") + patch)
    return acc
  }, new Map<string, string>())
}

async function gitText(command: Promise<GitResult>, label: string) {
  const result = await command
  if (result.exitCode === 0) return result.text()
  const stderr = result.stderr.toString().trim()
  throw new Error(`${label} failed${stderr ? `: ${stderr}` : ""}`)
}

async function gitDiffText(command: Promise<GitResult>, label: string) {
  const result = await command
  if (result.exitCode === 0 || result.exitCode === 1) return result.text()
  const stderr = result.stderr.toString().trim()
  throw new Error(`${label} failed${stderr ? `: ${stderr}` : ""}`)
}

async function optionalGitText(command: Promise<GitResult>) {
  const result = await command
  if (result.exitCode !== 0) return undefined
  const out = result.text().trim()
  return out || undefined
}

async function hasHead(cwd: string) {
  const result = await git(["rev-parse", "--verify", "HEAD"], { cwd, timeoutProfile: "fast" })
  return result.exitCode === 0
}

async function untrackedFiles(cwd: string) {
  return parseZeroSeparatedFiles(
    await gitText(
      git(["ls-files", "--others", "--exclude-standard", "-z", "--", "."], {
        cwd,
        timeoutProfile: "default",
      }),
      "vcs untracked files",
    ),
  )
}

async function statUntracked(cwd: string, file: string): Promise<DiffStat> {
  const stats = parseNumstat(
    await gitDiffText(
      git(["diff", "--no-ext-diff", "--no-renames", "--numstat", "--no-index", "--", "/dev/null", file], {
        cwd,
        timeoutProfile: "default",
      }),
      "vcs diff untracked numstat",
    ),
  )
  return stats.get(file) ?? { additions: 0, deletions: 0, binary: true }
}

async function patchUntracked(cwd: string, file: string, options?: DiffOptions) {
  const patch = await gitDiffText(
    git(
      [
        "diff",
        "--no-ext-diff",
        "--no-renames",
        `--unified=${patchContext(options)}`,
        "--no-index",
        "--",
        "/dev/null",
        file,
      ],
      {
        cwd,
        timeoutProfile: "default",
      },
    ),
    "vcs diff untracked patch",
  )
  return Buffer.byteLength(patch) > MAX_PATCH_BYTES ? emptyPatch(file) : patch
}

async function defaultBranchRef(cwd: string) {
  const symbolic = await optionalGitText(
    git(["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], {
      cwd,
      timeoutProfile: "fast",
    }),
  )
  if (symbolic) return symbolic

  const remote = await optionalGitText(
    git(["remote", "show", "origin"], {
      cwd,
      timeoutProfile: "network",
    }),
  )
  const branch = remote?.match(/HEAD branch:\s*(\S+)/)?.[1]
  return branch ? `origin/${branch}` : undefined
}

async function mergeBase(cwd: string, ref: string) {
  return optionalGitText(git(["merge-base", "HEAD", ref], { cwd, timeoutProfile: "fast" }))
}

async function diffAgainstRef(cwd: string, ref: string, options?: DiffOptions): Promise<Vcs.FileDiff[]> {
  const [nameStatus, numstat, patchAll, untracked] = await Promise.all([
    gitText(
      git(["diff", "--no-ext-diff", "--no-renames", "--name-status", ref, "--", "."], {
        cwd,
        timeoutProfile: "default",
      }),
      "vcs diff name-status",
    ),
    gitText(
      git(["diff", "--no-ext-diff", "--no-renames", "--numstat", ref, "--", "."], {
        cwd,
        timeoutProfile: "default",
      }),
      "vcs diff numstat",
    ),
    gitText(
      git(["diff", "--no-ext-diff", "--no-renames", `--unified=${patchContext(options)}`, ref, "--", "."], {
        cwd,
        timeoutProfile: "default",
      }),
      "vcs diff patch",
    ),
    untrackedFiles(cwd),
  ])

  return diffFiles(
    cwd,
    mergeDiffItems(
      parseNameStatus(nameStatus),
      untracked.map((file) => ({ file, code: "??", status: "added" as const })),
    ),
    parseNumstat(numstat),
    patchMap(patchAll),
    options,
  )
}

async function diffWithoutHead(cwd: string, options?: DiffOptions): Promise<Vcs.FileDiff[]> {
  const untracked = await untrackedFiles(cwd)
  return diffFiles(
    cwd,
    untracked.map((file) => ({ file, code: "??", status: "added" as const })),
    new Map(),
    new Map(),
    options,
  )
}

async function diffFiles(
  cwd: string,
  items: DiffItem[],
  stats: Map<string, DiffStat>,
  patches: Map<string, string>,
  options?: DiffOptions,
): Promise<Vcs.FileDiff[]> {
  const result: Vcs.FileDiff[] = []
  let total = 0
  let capped = false

  for (const item of items) {
    const stat = stats.get(item.file) ?? (item.code === "??" ? await statUntracked(cwd, item.file) : undefined)
    const rawPatch = stat?.binary
      ? undefined
      : item.code === "??"
        ? await patchUntracked(cwd, item.file, options)
        : patches.get(item.file)
    const patch = stat?.binary ? undefined : capped ? emptyPatch(item.file) : (rawPatch ?? emptyPatch(item.file))
    const nextTotal = total + Buffer.byteLength(patch ?? "")
    capped = capped || nextTotal > MAX_TOTAL_PATCH_BYTES
    if (!capped) total = nextTotal
    result.push({
      file: item.file,
      ...(patch !== undefined ? { patch: capped ? emptyPatch(item.file) : patch } : {}),
      additions: stat?.additions ?? 0,
      deletions: stat?.deletions ?? 0,
      status: item.status,
    })
  }

  return result
}

export namespace Vcs {
  export const Event = {
    BranchUpdated: BusEvent.define(
      "vcs.branch.updated",
      z.object({
        branch: z.string().optional(),
      }),
    ),
  }

  export const Info = z
    .object({
      /** True when a git repository exists at the working directory. False means no .git is present. */
      initialized: z.boolean(),
      /** Current branch name. Undefined when no commits exist (unborn HEAD). */
      branch: z.string().optional(),
      /** Current HEAD commit short hash. Undefined when no commits exist (unborn HEAD). */
      commit: z.string().optional(),
      clean: z.boolean(),
      dirty: z.boolean(),
      staged: z.number().int().nonnegative(),
      modified: z.number().int().nonnegative(),
      untracked: z.number().int().nonnegative(),
      conflicts: z.number().int().nonnegative(),
      ahead: z.number().int().nonnegative(),
      behind: z.number().int().nonnegative(),
    })
    .meta({
      ref: "VcsInfo",
    })
  export type Info = z.infer<typeof Info>

  export const Mode = z.enum(["git", "branch"])
  export type Mode = z.infer<typeof Mode>

  export const FileDiff = z
    .object({
      file: z.string(),
      patch: z.string().optional(),
      additions: z.number(),
      deletions: z.number(),
      status: z.enum(["added", "deleted", "modified"]).optional(),
    })
    .meta({
      ref: "VcsFileDiff",
    })
  export type FileDiff = z.infer<typeof FileDiff>

  function parse(text: string, input: { initialized: boolean; branch?: string; commit?: string }): Info {
    let ahead = 0
    let behind = 0
    let staged = 0
    let modified = 0
    let untracked = 0
    let conflicts = 0

    for (const line of text.split(/\r?\n/).filter(Boolean)) {
      if (line.startsWith("## ")) {
        const status = line.match(/\[(.*?)\]/)?.[1]
        if (!status) continue
        for (const item of status
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)) {
          const nextAhead = item.match(/^ahead (\d+)$/)
          if (nextAhead) {
            ahead = Number(nextAhead[1])
            continue
          }
          const nextBehind = item.match(/^behind (\d+)$/)
          if (nextBehind) behind = Number(nextBehind[1])
        }
        continue
      }

      const x = line[0] ?? " "
      const y = line[1] ?? " "
      if (x === "?" && y === "?") {
        untracked += 1
        continue
      }
      if (x === "U" || y === "U" || (x === "A" && y === "A") || (x === "D" && y === "D")) {
        conflicts += 1
      }
      if (x !== " " && x !== "?") staged += 1
      if (y !== " " && y !== "?") modified += 1
    }

    const dirty = staged > 0 || modified > 0 || untracked > 0 || conflicts > 0
    return {
      initialized: input.initialized,
      branch: input.branch,
      commit: input.commit,
      clean: !dirty,
      dirty,
      staged,
      modified,
      untracked,
      conflicts,
      ahead,
      behind,
    }
  }

  async function currentCommit(cwd: string): Promise<string | undefined> {
    const result = await git(["rev-parse", "--short", "HEAD"], { cwd, timeoutProfile: "fast" })
    if (result.exitCode !== 0) return undefined
    const out = result.text().trim()
    return out || undefined
  }

  async function currentBranch() {
    const result = await git(["rev-parse", "--abbrev-ref", "HEAD"], {
      cwd: Instance.worktree,
      timeoutProfile: "fast",
    })
    if (result.exitCode !== 0) return undefined
    const out = result.text().trim()
    return out || undefined
  }

  const state = lazyInstanceState(
    async () => {
      if (!Project.isGitRepo(Instance.directory)) {
        return { branch: async () => undefined, unsubscribe: undefined }
      }
      let current = await currentBranch()
      log.info("initialized", { branch: current })

      const unsubscribe = Bus.subscribe(FileWatcher.Event.Updated, async (evt) => {
        if (!evt.properties.file.endsWith("HEAD")) return
        const next = await currentBranch()
        if (next !== current) {
          log.info("branch changed", { from: current, to: next })
          current = next
          Bus.publish(Event.BranchUpdated, { branch: next })
        }
      })

      return {
        branch: async () => current,
        unsubscribe,
      }
    },
    async (state) => {
      state.unsubscribe?.()
    },
  )

  export async function init() {
    return state()
  }

  /**
   * Discard the cached VCS state for the current instance directory.
   * The next call to `info()` or `branch()` will re-initialize from scratch,
   * re-probing `.git` on disk and re-attaching the `.git/HEAD` file watcher.
   * Call this after `git init` completes while active sessions prevent a full
   * `Instance.dispose()`.
   */
  export function resetState() {
    state.reset()
  }

  export async function branch() {
    return await state().then((s) => s.branch())
  }

  export async function info() {
    // Single source of truth for "is this a git repo": disk probe via
    // Project.isGitRepo. Never consult a cached column/field — rule 22.
    const initialized = Project.isGitRepo(Instance.directory)
    if (!initialized) {
      return parse("", { initialized: false })
    }
    // Suppress branch when no commits exist (unborn HEAD). git rev-parse
    // --abbrev-ref HEAD returns the configured default (e.g. "main") even
    // before any commit; we only report it once a commit exists.
    const commit = await currentCommit(Instance.directory)
    const rawBranch = await state().then((s) => s.branch())
    const branch = commit ? rawBranch : undefined
    const result = await git(["status", "--porcelain=v1", "--branch"], {
      cwd: Instance.directory,
      timeoutProfile: "default",
    })
    const text = result.exitCode === 0 ? result.text() : ""
    return parse(text, { initialized: true, branch, commit })
  }

  export async function diff(mode: Mode, options?: DiffOptions): Promise<FileDiff[]> {
    if (!Project.isGitRepo(Instance.directory)) return []
    if (mode === "git") {
      if (!(await hasHead(Instance.directory))) return diffWithoutHead(Instance.directory, options)
      return diffAgainstRef(Instance.directory, "HEAD", options)
    }

    const target = await defaultBranchRef(Instance.directory)
    if (!target) return []
    const ref = await mergeBase(Instance.directory, target)
    if (!ref) return []
    return diffAgainstRef(Instance.directory, ref, options)
  }
}
