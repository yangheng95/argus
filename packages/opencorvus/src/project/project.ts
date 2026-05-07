import z from "zod"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { createHash } from "crypto"
import { Database, eq } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { fn } from "@opencorvus-ai/util/fn"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { existsSync } from "fs"
import { git } from "../util/git"
import { Glob } from "../util/glob"
import { which } from "@/util/which"

export namespace Project {
  const log = Log.create({ service: "project" })

  function gitpath(cwd: string, name: string) {
    if (!name) return cwd
    // git output includes trailing newlines; keep path whitespace intact.
    name = name.replace(/[\r\n]+$/, "")
    if (!name) return cwd

    name = Filesystem.windowsPath(name)
    return Filesystem.resolve(path.isAbsolute(name) ? name : path.join(cwd, name))
  }

  function marker(dir: string) {
    return path.join(dir, "opencorvus")
  }

  function generated(seed: string) {
    return createHash("sha1").update(Filesystem.windowsPath(seed)).digest("hex")
  }

  async function text(args: string[], cwd: string) {
    const result = await git(args, { cwd }).catch(() => undefined)
    if (!result || result.exitCode !== 0) return
    const value = result.text().trim()
    if (!value) return
    return value
  }

  async function roots(cwd: string) {
    const result = await git(["rev-list", "--max-parents=0", "--all"], { cwd }).catch(() => undefined)
    if (!result || result.exitCode !== 0) return []
    return result
      .text()
      .split("\n")
      .map((x) => x.trim())
      .filter(Boolean)
      .toSorted()
  }

  async function initRepo(directory: string) {
    const result = await git(["init"], { cwd: directory }).catch(() => undefined)
    if (!result || result.exitCode !== 0) return false
    return Filesystem.exists(path.join(directory, ".git"))
  }

  async function identify(cwd: string, common: string) {
    const cached = await Filesystem.readText(marker(common))
      .then((x) => x.trim())
      .catch(() => undefined)
    if (cached) return cached

    const next = (await roots(cwd))[0] || generated(common)
    await Filesystem.write(marker(common), next).catch(() => undefined)
    return next
  }

  /**
   * The single source of truth for "is this directory a git repository."
   * Sync `.git` probe (file or directory — `.git` is a file in linked
   * worktrees). No DB cache, no Instance cache: rule 22 forbids double-source,
   * and the prior cached `Info.vcs` column silently lied whenever `.git` was
   * deleted between Instance initializations, making auto-init never run and
   * `Worktree.create` throw WorktreeCreateFailedError forever.
   */
  export function isGitRepo(directory: string): boolean {
    return Filesystem.stat(path.join(directory, ".git")) !== undefined
  }

  export const Info = z
    .object({
      id: z.string(),
      worktree: z.string(),
      name: z.string().optional(),
      icon: z
        .object({
          url: z.string().optional(),
          override: z.string().optional(),
          color: z.string().optional(),
        })
        .optional(),
      commands: z
        .object({
          start: z.string().optional().describe("Startup script to run when creating a new workspace (worktree)"),
        })
        .optional(),
      time: z.object({
        created: z.number(),
        updated: z.number(),
        initialized: z.number().optional(),
      }),
      sandboxes: z.array(z.string()),
    })
    .meta({
      ref: "Project",
    })
  export type Info = z.infer<typeof Info>
  export const InitGitResult = z
    .object({
      created: z.boolean(),
      project: Info,
    })
    .meta({
      ref: "ProjectInitGitResult",
    })

  export const Event = {
    Updated: BusEvent.define("project.updated", Info),
  }

  type Row = typeof ProjectTable.$inferSelect

  export function fromRow(row: Row): Info {
    const icon =
      row.icon_url || row.icon_color
        ? { url: row.icon_url ?? undefined, color: row.icon_color ?? undefined }
        : undefined
    return {
      id: row.id,
      worktree: row.worktree,
      name: row.name ?? undefined,
      icon,
      time: {
        created: row.time_created,
        updated: row.time_updated,
        initialized: row.time_initialized ?? undefined,
      },
      sandboxes: row.sandboxes,
      commands: row.commands ?? undefined,
    }
  }

  export async function fromDirectory(directory: string) {
    log.info("fromDirectory", { directory })

    const data = await iife(async () => {
      const gitBinary = which("git")
      const dotgit = path.join(directory, ".git")
      const local = await Filesystem.exists(dotgit)

      if (!gitBinary) {
        if (!local) {
          return {
            id: "global",
            worktree: "/",
            sandbox: "/",
          }
        }

        const id =
          (await Filesystem.readText(marker(dotgit))
            .then((x) => x.trim())
            .catch(() => undefined)) || generated(dotgit)

        return {
          id,
          sandbox: directory,
          worktree: directory,
        }
      }

      // Note (W2-V32): a previous version auto-ran `git init` here when the
      // directory was a non-git subfolder of an existing parent repo (the old
      // `(await initRepo(directory))` branch). That silently materialized a
      // sub-repo as a side effect of *any* request reaching Project.fromDirectory
      // — which violated rule 7 (no fallback) and made the darwin 500-storm
      // possible (cwd-fallback sites would init repos in unintended locations).
      // We now leave non-git subfolders as non-git: callers that need a
      // working tree throw WorktreeNotGitError and the overlay drives an
      // explicit user-confirmed init via POST /project/current/init-git.
      const hasLocalGit = local

      if (hasLocalGit) {
        let sandbox = directory
        const top = await text(["rev-parse", "--show-toplevel"], sandbox)
        if (top) {
          sandbox = gitpath(sandbox, top)
        }

        const commonText = await text(["rev-parse", "--git-common-dir"], sandbox)
        const common = commonText ? gitpath(sandbox, commonText) : undefined
        const id = await identify(sandbox, common || path.join(sandbox, ".git"))
        const worktree = !common || common === sandbox ? sandbox : path.dirname(common)

        return {
          id,
          sandbox,
          worktree,
        }
      }

      return {
        id: "global",
        worktree: "/",
        sandbox: "/",
      }
    })

    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
    const existing = await iife(async () => {
      if (row) return fromRow(row)
      const fresh: Info = {
        id: data.id,
        worktree: data.worktree,
        sandboxes: [],
        time: {
          created: Date.now(),
          updated: Date.now(),
        },
      }
      return fresh
    })

    if (Flag.OPENCORVUS_EXPERIMENTAL_ICON_DISCOVERY) discover(existing)

    const result: Info = {
      ...existing,
      worktree: data.worktree,
      time: {
        ...existing.time,
        updated: Date.now(),
      },
    }
    if (data.sandbox !== result.worktree && !result.sandboxes.includes(data.sandbox))
      result.sandboxes.push(data.sandbox)
    result.sandboxes = result.sandboxes.filter((x) => existsSync(x))
    const insert = {
      id: result.id,
      worktree: result.worktree,
      name: result.name,
      icon_url: result.icon?.url,
      icon_color: result.icon?.color,
      time_created: result.time.created,
      time_updated: result.time.updated,
      time_initialized: result.time.initialized,
      sandboxes: result.sandboxes,
      commands: result.commands,
    }
    const updateSet = {
      worktree: result.worktree,
      name: result.name,
      icon_url: result.icon?.url,
      icon_color: result.icon?.color,
      time_updated: result.time.updated,
      time_initialized: result.time.initialized,
      sandboxes: result.sandboxes,
      commands: result.commands,
    }
    Database.use((db) =>
      db.insert(ProjectTable).values(insert).onConflictDoUpdate({ target: ProjectTable.id, set: updateSet }).run(),
    )
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: result,
      },
    })
    return { project: result, sandbox: data.sandbox }
  }

  export async function discover(input: Info) {
    if (!isGitRepo(input.worktree)) return
    if (input.icon?.override) return
    if (input.icon?.url) return
    const matches = await Glob.scan("**/favicon.{ico,png,svg,jpg,jpeg,webp}", {
      cwd: input.worktree,
      absolute: true,
      include: "file",
    })
    const shortest = matches.sort((a, b) => a.length - b.length)[0]
    if (!shortest) return
    const buffer = await Filesystem.readBytes(shortest)
    const base64 = buffer.toString("base64")
    const mime = Filesystem.mimeType(shortest) || "image/png"
    const url = `data:${mime};base64,${base64}`
    await update({
      projectID: input.id,
      icon: {
        url,
      },
    })
    return
  }

  export function setInitialized(id: string) {
    Database.use((db) =>
      db
        .update(ProjectTable)
        .set({
          time_initialized: Date.now(),
        })
        .where(eq(ProjectTable.id, id))
        .run(),
    )
  }

  export function list() {
    return Database.use((db) =>
      db
        .select()
        .from(ProjectTable)
        .all()
        .map((row) => fromRow(row)),
    )
  }

  export function get(id: string): Info | undefined {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return undefined
    return fromRow(row)
  }

  export async function initGit(directory: string) {
    if (isGitRepo(directory)) {
      const current = await fromDirectory(directory)
      return InitGitResult.parse({
        created: false,
        project: current.project,
      })
    }
    if (!which("git")) {
      throw new Error("git is not installed")
    }
    const result = await git(["init"], { cwd: directory })
    if (result.exitCode !== 0) {
      const detail = result.stderr.toString().trim() || result.text().trim() || "git init failed"
      throw new Error(detail)
    }
    if (!(await Filesystem.exists(path.join(directory, ".git")))) {
      throw new Error("git init completed without creating .git")
    }
    const next = await fromDirectory(directory)
    // Cache refresh is the caller's responsibility. Doing it here would
    // dual-source with task-api/prepareProject and server/routes/project,
    // and — critically — when this path runs INSIDE Instance.provide's
    // bootstrap iife (instance.ts:51), Instance.refresh() awaits the very
    // same in-flight iife it was called from → self-deadlock. The
    // bootstrap path re-reads via Project.fromDirectory at instance.ts:52
    // immediately after this returns; both other callers already invoke
    // Instance.refresh() right after this returns. Rule 8: single source.
    return InitGitResult.parse({
      created: true,
      project: next.project,
    })
  }

  export const update = fn(
    z.object({
      projectID: z.string(),
      name: z.string().optional(),
      icon: Info.shape.icon.optional(),
      commands: Info.shape.commands.optional(),
    }),
    async (input) => {
      const result = Database.use((db) =>
        db
          .update(ProjectTable)
          .set({
            name: input.name,
            icon_url: input.icon?.url,
            icon_color: input.icon?.color,
            commands: input.commands,
            time_updated: Date.now(),
          })
          .where(eq(ProjectTable.id, input.projectID))
          .returning()
          .get(),
      )
      if (!result) throw new Error(`Project not found: ${input.projectID}`)
      const data = fromRow(result)
      GlobalBus.emit("event", {
        payload: {
          type: Event.Updated.type,
          properties: data,
        },
      })
      return data
    },
  )

  export async function sandboxes(id: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) return []
    const data = fromRow(row)
    const valid: string[] = []
    for (const dir of data.sandboxes) {
      const s = Filesystem.stat(dir)
      if (s?.isDirectory()) valid.push(dir)
    }
    return valid
  }

  export async function addSandbox(id: string, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = [...row.sandboxes]
    if (!sandboxes.includes(directory)) sandboxes.push(directory)
    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)
    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }

  export async function removeSandbox(id: string, directory: string) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, id)).get())
    if (!row) throw new Error(`Project not found: ${id}`)
    const sandboxes = row.sandboxes.filter((s) => s !== directory)
    const result = Database.use((db) =>
      db
        .update(ProjectTable)
        .set({ sandboxes, time_updated: Date.now() })
        .where(eq(ProjectTable.id, id))
        .returning()
        .get(),
    )
    if (!result) throw new Error(`Project not found: ${id}`)
    const data = fromRow(result)
    GlobalBus.emit("event", {
      payload: {
        type: Event.Updated.type,
        properties: data,
      },
    })
    return data
  }
}
