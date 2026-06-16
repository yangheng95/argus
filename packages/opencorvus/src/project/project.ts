import z from "zod"
import { Filesystem } from "../util/filesystem"
import path from "path"
import { createHash, randomUUID } from "crypto"
import { Database, eq } from "../storage/db"
import { ProjectTable } from "./project.sql"
import { Log } from "../util/log"
import { Flag } from "@/flag/flag"
import { fn } from "@opencorvus-ai/util/fn"
import { BusEvent } from "@/bus/bus-event"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { existsSync } from "fs"
import { mkdir, readdir } from "fs/promises"
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

  export function directoryProjectID(directory: string) {
    return generated(path.join(directory, ".git"))
  }

  async function text(args: string[], cwd: string) {
    const result = await git(args, { cwd }).catch(() => undefined)
    if (!result || result.exitCode !== 0) return
    const value = result.text().trim()
    if (!value) return
    return value
  }

  function comparePath(value: string) {
    const normalized = path.normalize(Filesystem.windowsPath(value)).replace(/[\\/]+$/, "")
    return process.platform === "win32" ? normalized.toLowerCase() : normalized
  }

  function samePath(a: string, b: string) {
    return comparePath(a) === comparePath(b)
  }

  function standaloneCommon(worktree: string, common: string) {
    return samePath(common, path.join(worktree, ".git"))
  }

  async function identify(common: string, worktree: string) {
    const markerPath = marker(common)
    const localID = generated(common)
    const cached = await Filesystem.readText(marker(common))
      .then((x) => x.trim())
      .catch(() => undefined)
    if (!cached || cached === "global") {
      await Filesystem.write(markerPath, localID).catch(() => undefined)
      return localID
    }

    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, cached)).get())
    if (!row) return cached
    if (samePath(row.worktree, worktree)) return cached

    // A standalone repository must never reuse another local project's ID.
    // Copied starter repos can share both the root commit and a stale marker;
    // rewrite only this repo's marker to its local .git identity.
    if (standaloneCommon(worktree, common)) {
      await Filesystem.write(markerPath, localID).catch(() => undefined)
      return localID
    }

    return cached
  }

  export class WorktreeIdentityConflictError extends Error {
    constructor(input: { projectID: string; existingWorktree: string; nextWorktree: string }) {
      super(
        `Project identity conflict for ${input.projectID}: existing worktree ${input.existingWorktree}, next worktree ${input.nextWorktree}`,
      )
      this.name = "ProjectWorktreeIdentityConflictError"
    }
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
  export const DiscoveredProject = z
    .object({
      directory: z.string(),
      name: z.string(),
      marker: z.string(),
    })
    .meta({
      ref: "DiscoveredProject",
    })
  export type DiscoveredProject = z.infer<typeof DiscoveredProject>
  export const Discovery = z
    .object({
      root: z.string(),
      defaultDirectory: z.string(),
      projects: DiscoveredProject.array(),
    })
    .meta({
      ref: "ProjectDiscovery",
    })
  export type Discovery = z.infer<typeof Discovery>

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
        const localID = generated(dotgit)
        const markerPath = marker(dotgit)
        const cached = await Filesystem.readText(markerPath)
          .then((x) => x.trim())
          .catch(() => undefined)
        const id = cached && cached !== "global" ? cached : localID
        if (local && id === localID) await Filesystem.write(markerPath, localID).catch(() => undefined)

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
        const resolvedCommon = common || path.join(sandbox, ".git")
        const worktree = !common || common === sandbox ? sandbox : path.dirname(common)
        const id = await identify(resolvedCommon, worktree)

        return {
          id,
          sandbox,
          worktree,
        }
      }

      return {
        id: directoryProjectID(directory),
        worktree: directory,
        sandbox: directory,
      }
    })

    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, data.id)).get())
    if (row && !samePath(row.worktree, data.worktree)) {
      throw new WorktreeIdentityConflictError({
        projectID: data.id,
        existingWorktree: row.worktree,
        nextWorktree: data.worktree,
      })
    }
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

  const generatedDefaultDirectories = new Map<string, string>()

  function explicitLaunchProjectDirectory() {
    const value = process.env.OPENCORVUS_PROJECT_DIR
    return typeof value === "string" && value.trim() ? Filesystem.resolve(value) : ""
  }

  function launchDirectory() {
    return explicitLaunchProjectDirectory() || Filesystem.resolve(process.cwd())
  }

  async function generatedDefaultDirectory(root: string) {
    const cached = generatedDefaultDirectories.get(root)
    if (cached) return cached
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const name = randomUUID().slice(0, 8)
      const directory = path.join(root, name)
      if (await Filesystem.exists(directory)) continue
      try {
        await mkdir(directory, { recursive: false })
      } catch (error) {
        if ((error as { code?: string })?.code === "EEXIST") continue
        throw error
      }
      generatedDefaultDirectories.set(root, directory)
      return directory
    }
    throw new Error(`Unable to create generated default project directory under ${root}`)
  }

  function projectName(directory: string) {
    return path.basename(directory.replace(/[\\/]+$/, "")) || directory
  }

  async function hasOpenCorvusMarker(directory: string) {
    return (await Filesystem.isDir(path.join(directory, ".opencorvus"))) === true
  }

  async function immediateDirectories(root: string) {
    const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(root, entry.name))
      .sort((a, b) => a.localeCompare(b))
  }

  export async function discoverFromLaunchDirectory(): Promise<Discovery> {
    const root = launchDirectory()
    const candidates = [root, ...(await immediateDirectories(root))]
    const projects: DiscoveredProject[] = []
    const defaultDirectory = explicitLaunchProjectDirectory() || (await generatedDefaultDirectory(root))
    for (const directory of candidates) {
      if (!(await hasOpenCorvusMarker(directory))) continue
      projects.push({
        directory,
        name: projectName(directory),
        marker: path.join(directory, ".opencorvus"),
      })
    }
    return Discovery.parse({ root, defaultDirectory, projects })
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
