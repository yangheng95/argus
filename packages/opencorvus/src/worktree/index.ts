import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import z from "zod"
import { NamedError } from "@opencorvus-ai/util/error"
import { Global } from "../global"
import { Instance } from "../project/instance"
import { Project } from "../project/project"
import { Database, eq } from "../storage/db"
import { ProjectTable } from "../project/project.sql"
import { fn } from "../util/fn"
import { Log } from "../util/log"
import { BusEvent } from "@/bus/bus-event"
import { GlobalBus } from "@/bus/global"
import { Shell } from "@/shell/shell"

export namespace Worktree {
  const log = Log.create({ service: "worktree" })
  const caseInsensitiveCache = new Map<string, boolean>()

  // Per-project git mutex: serializes worktree add/remove/reset operations
  // to prevent concurrent git commands from corrupting the repository.
  const gitLocks = new Map<string, Promise<void>>()
  async function withGitLock<T>(fn: () => Promise<T>): Promise<T> {
    const key = Instance.project.id
    const prev = gitLocks.get(key) ?? Promise.resolve()
    let resolve!: () => void
    const next = new Promise<void>((r) => (resolve = r))
    gitLocks.set(key, next)
    await prev
    try {
      return await fn()
    } finally {
      resolve()
    }
  }

  export const Event = {
    Ready: BusEvent.define(
      "worktree.ready",
      z.object({
        name: z.string(),
        branch: z.string(),
      }),
    ),
    Failed: BusEvent.define(
      "worktree.failed",
      z.object({
        message: z.string(),
      }),
    ),
  }

  export const Info = z
    .object({
      name: z.string(),
      branch: z.string(),
      directory: z.string(),
    })
    .meta({
      ref: "Worktree",
    })

  export type Info = z.infer<typeof Info>

  export const CreateInput = z
    .object({
      name: z.string().optional(),
      startCommand: z
        .string()
        .optional()
        .describe("Additional startup script to run after the project's start command"),
      checkout: z
        .enum(["sync", "async"])
        .optional()
        .describe("Deprecated. Worktree.create always waits until checkout, bootstrap, and startup scripts complete before returning."),
    })
    .meta({
      ref: "WorktreeCreateInput",
    })

  export type CreateInput = z.infer<typeof CreateInput>

  export const RemoveInput = z
    .object({
      directory: z.string(),
    })
    .meta({
      ref: "WorktreeRemoveInput",
    })

  export type RemoveInput = z.infer<typeof RemoveInput>

  export const ResetInput = z
    .object({
      directory: z.string(),
    })
    .meta({
      ref: "WorktreeResetInput",
    })

  export type ResetInput = z.infer<typeof ResetInput>

  export const NotGitError = NamedError.create(
    "WorktreeNotGitError",
    z.object({
      message: z.string(),
    }),
  )

  export const NameGenerationFailedError = NamedError.create(
    "WorktreeNameGenerationFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const CreateFailedError = NamedError.create(
    "WorktreeCreateFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const StartCommandFailedError = NamedError.create(
    "WorktreeStartCommandFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const RemoveFailedError = NamedError.create(
    "WorktreeRemoveFailedError",
    z.object({
      message: z.string(),
    }),
  )

  export const ResetFailedError = NamedError.create(
    "WorktreeResetFailedError",
    z.object({
      message: z.string(),
    }),
  )

  const ADJECTIVES = [
    "brave",
    "calm",
    "clever",
    "cosmic",
    "crisp",
    "curious",
    "eager",
    "gentle",
    "glowing",
    "happy",
    "hidden",
    "jolly",
    "kind",
    "lucky",
    "mighty",
    "misty",
    "neon",
    "nimble",
    "playful",
    "proud",
    "quick",
    "quiet",
    "shiny",
    "silent",
    "stellar",
    "sunny",
    "swift",
    "tidy",
    "witty",
  ] as const

  const NOUNS = [
    "cabin",
    "cactus",
    "canyon",
    "circuit",
    "comet",
    "eagle",
    "engine",
    "falcon",
    "forest",
    "garden",
    "harbor",
    "island",
    "knight",
    "lagoon",
    "meadow",
    "moon",
    "mountain",
    "nebula",
    "orchid",
    "otter",
    "panda",
    "pixel",
    "planet",
    "river",
    "rocket",
    "sailor",
    "squid",
    "star",
    "tiger",
    "wizard",
    "wolf",
  ] as const

  function pick<const T extends readonly string[]>(list: T) {
    return list[Math.floor(Math.random() * list.length)]
  }

  function slug(input: string) {
    return input
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+/, "")
      .replace(/-+$/, "")
  }

  function randomName() {
    return `${pick(ADJECTIVES)}-${pick(NOUNS)}`
  }

  async function exists(target: string) {
    return fs
      .stat(target)
      .then(() => true)
      .catch(() => false)
  }

  function outputText(input: Uint8Array | undefined) {
    if (!input?.length) return ""
    return new TextDecoder().decode(input).trim()
  }

  function errorText(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [outputText(result.stderr), outputText(result.stdout)].filter(Boolean).join("\n")
  }

  function failed(result: { stdout?: Uint8Array; stderr?: Uint8Array }) {
    return [outputText(result.stderr), outputText(result.stdout)].filter(Boolean).flatMap((chunk) =>
      chunk
        .split("\n")
        .map((line) => line.trim())
        .flatMap((line) => {
          const match = line.match(/^warning:\s+failed to remove\s+(.+):\s+/i)
          if (!match) return []
          const value = match[1]?.trim().replace(/^['"]|['"]$/g, "")
          if (!value) return []
          return [value]
        }),
    )
  }

  async function prune(root: string, entries: string[]) {
    const base = await canonical(root)
    await Promise.all(
      entries.map(async (entry) => {
        const target = await canonical(path.resolve(root, entry))
        if (target === base) return
        if (!target.startsWith(`${base}${path.sep}`)) return
        await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
      }),
    )
  }

  async function sweep(root: string) {
    const first = await $`git clean -ffdx`.quiet().nothrow().cwd(root)
    if (first.exitCode === 0) return first

    const entries = failed(first)
    if (!entries.length) return first

    await prune(root, entries)
    return $`git clean -ffdx`.quiet().nothrow().cwd(root)
  }

  async function canonical(input: string) {
    const abs = path.resolve(input)
    const real = await fs.realpath(abs).catch(() => abs)
    const normalized = path.normalize(real)
    const insensitive = await isCaseInsensitiveFilesystem(normalized)
    return insensitive ? normalized.toLowerCase() : normalized
  }

  /**
   * Resolve the primary (main) worktree directory.
   * `git worktree list` always returns the main worktree as the first entry.
   * This avoids creating worktrees inside child worktrees.
   */
  async function primaryWorktreeDir(): Promise<string> {
    const list = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
    if (list.exitCode === 0) {
      const first = outputText(list.stdout).split("\n").find((l) => l.startsWith("worktree "))
      if (first) return first.slice("worktree ".length).trim()
    }
    // Fallback: use Instance.worktree directly
    return Instance.worktree
  }

  async function isCaseInsensitiveFilesystem(target: string) {
    if (process.platform === "win32") return true
    if (process.platform !== "darwin") return false

    const absolute = path.resolve(target)
    const root = path.parse(absolute).root || "/"
    const cached = caseInsensitiveCache.get(root)
    if (cached !== undefined) return cached

    const dir = await fs.realpath(path.dirname(absolute)).catch(() => path.dirname(absolute))
    const parent = path.dirname(dir)
    const base = path.basename(dir)
    const index = base.search(/[a-zA-Z]/)
    if (index < 0 || parent === dir) {
      caseInsensitiveCache.set(root, false)
      return false
    }

    const toggled =
      base.slice(0, index) +
      (base[index] === base[index].toLowerCase() ? base[index].toUpperCase() : base[index].toLowerCase()) +
      base.slice(index + 1)
    const probe = path.join(parent, toggled)

    const insensitive = await Promise.all([
      fs.stat(dir).catch(() => undefined),
      fs.stat(probe).catch(() => undefined),
    ]).then(([original, variant]) =>
      Boolean(original && variant && original.dev === variant.dev && original.ino === variant.ino),
    )

    caseInsensitiveCache.set(root, insensitive)
    return insensitive
  }

  /** Remove a leftover worktree directory and its branch ref so the same
   *  `name` can be reused. Called only when the caller explicitly passed a
   *  `base` name — i.e. asked for a deterministic path (goal retries). Any
   *  failure throws; we do NOT silently fall back to a randomized suffix
   *  because that rotation is exactly what silently breaks prompt-cache
   *  continuity across retries (new path → new system-prompt bytes → new
   *  1h system cache). Surfacing a hard error here is the contract: the
   *  operator sees that reclaim failed and can intervene. */
  async function reclaimBase(root: string, base: string): Promise<Info> {
    const name = base
    const branch = `opencorvus/${name}`
    const directory = path.join(root, name)
    const ref = `refs/heads/${branch}`

    const dirExists = await exists(directory)
    const branchCheck = await $`git show-ref --verify --quiet ${ref}`
      .quiet()
      .nothrow()
      .cwd(Instance.worktree)
    const branchExists = branchCheck.exitCode === 0

    if (dirExists || branchExists) {
      log.info("worktree reclaim: stale artifacts present, cleaning before reuse", {
        name,
        directory,
        dirExists,
        branchExists,
      })
      // Delegate directory teardown to remove() — it unregisters the git
      // worktree, stops fsmonitor, rm -rf's the directory, AND deletes the
      // associated branch if the worktree is still registered. If it throws,
      // let it propagate: the caller must see the reclaim failure, not get
      // a silently renamed workspace.
      if (dirExists) {
        await remove({ directory })
      }
      // Branch may still be there if: (a) dir didn't exist but a dangling
      // branch ref was left over from a prior crash, or (b) the worktree was
      // never registered against this branch (so remove() didn't touch it).
      // Re-probe and clean up independently.
      const stillExists = await $`git show-ref --verify --quiet ${ref}`
        .quiet()
        .nothrow()
        .cwd(Instance.worktree)
      if (stillExists.exitCode === 0) {
        const del = await $`git branch -D ${branch}`
          .quiet()
          .nothrow()
          .cwd(Instance.worktree)
        if (del.exitCode !== 0) {
          throw new CreateFailedError({
            message:
              `worktree reclaim: failed to delete stale branch ${branch}: ` +
              (errorText(del) || "unknown error"),
          })
        }
      }
      // Sanity check — if anything is still there after reclaim, fail loud.
      if (await exists(directory)) {
        throw new CreateFailedError({
          message: `worktree reclaim: directory still present after remove: ${directory}`,
        })
      }
    }

    return Info.parse({ name, branch, directory })
  }

  async function candidate(root: string, base?: string) {
    // Deterministic path: caller asked for a specific base name (goal retries
    // do this — worktree name is derived from goalID). Reclaim any stale
    // artifacts under that name and reuse the path. No randomized fallback.
    if (base) return reclaimBase(root, base)

    // Non-deterministic path: caller didn't name the workspace. Try a random
    // name; retry on conflict (collisions here are rare and non-deterministic,
    // so iterating is a genuine retry, not a fallback that masks a lifecycle
    // bug the way the old base-name-plus-suffix branch did).
    for (let attempt = 0; attempt < 26; attempt++) {
      const name = randomName()
      const branch = `opencorvus/${name}`
      const directory = path.join(root, name)

      if (await exists(directory)) continue

      const ref = `refs/heads/${branch}`
      const branchCheck = await $`git show-ref --verify --quiet ${ref}`.quiet().nothrow().cwd(Instance.worktree)
      if (branchCheck.exitCode === 0) continue

      return Info.parse({ name, branch, directory })
    }

    throw new NameGenerationFailedError({ message: "Failed to generate a unique worktree name" })
  }

  async function runStartCommand(directory: string, cmd: string) {
    if (process.platform === "win32") {
      return $`cmd /c ${cmd}`.nothrow().cwd(directory)
    }
    const shell = Shell.acceptable()
    return $`${shell} -c ${cmd}`.nothrow().cwd(directory)
  }

  type StartKind = "project" | "worktree"

  async function runStartScript(directory: string, cmd: string, kind: StartKind) {
    const text = cmd.trim()
    if (!text) return true

    const ran = await runStartCommand(directory, text)
    if (ran.exitCode === 0) return true

    log.error("worktree start command failed", {
      kind,
      directory,
      message: errorText(ran),
    })
    return false
  }

  async function runStartScripts(directory: string, input: { projectID: string; extra?: string }) {
    const row = Database.use((db) => db.select().from(ProjectTable).where(eq(ProjectTable.id, input.projectID)).get())
    const project = row ? Project.fromRow(row) : undefined
    const startup = project?.commands?.start?.trim() ?? ""
    const ok = await runStartScript(directory, startup, "project")
    if (!ok) return false

    const extra = input.extra ?? ""
    await runStartScript(directory, extra, "worktree")
    return true
  }

  export const create = fn(CreateInput.optional(), async (input) => {
    if (!Project.isGitRepo(Instance.directory)) {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    // Resolve the PRIMARY worktree (main repo root) first so a dispatched
    // goal session (whose Instance.directory IS itself a child worktree)
    // doesn't cause nested `.opencorvus/worktrees/.opencorvus/worktrees/...`
    // recursion. `primaryWorktreeDir()` always returns the main repo root.
    //
    // Worktrees live UNDER `<primary>/.opencorvus/worktrees/` — co-located
    // with other runtime scratch (attachments, visual-diff output). Previous
    // design placed them in the PARENT of the project root, which leaked
    // scratch dirs into the user's workspace for real projects and piled
    // hundreds of zombie dirs into %TEMP% for benchmarks. One `.gitignore`
    // entry (`/.opencorvus/`) covers the entire tree now.
    const primaryDir = await primaryWorktreeDir()
    const root = path.join(primaryDir, ".opencorvus", "worktrees")
    await fs.mkdir(root, { recursive: true })

    const base = input?.name ? slug(input.name) : ""
    const info = await candidate(root, base || undefined)

    // All git operations serialized to prevent concurrent corruption
    await withGitLock(async () => {
      // Ensure the main repo has at least one commit — git worktree requires it.
      // Without a commit, `git reset --hard` in the worktree does nothing (orphaned branch),
      // leaving the worktree empty and causing delivery extraction to find 0 files.
      const hasCommits = (await $`git rev-parse --verify HEAD`.quiet().cwd(Instance.worktree).nothrow()).exitCode === 0
      if (!hasCommits) {
        log.info("creating initial commit for worktree support", { directory: Instance.worktree })
        await $`git add -A`.quiet().cwd(Instance.worktree).nothrow()
        await $`git -c user.email=opencorvus@local -c user.name=OpenCorvus commit -m "initial scaffold" --allow-empty`.quiet().cwd(Instance.worktree).nothrow()
      }

      const created = await $`git worktree add --no-checkout -b ${info.branch} ${info.directory}`
        .quiet()
        .nothrow()
        .cwd(Instance.worktree)
      if (created.exitCode !== 0) {
        throw new CreateFailedError({ message: errorText(created) || "Failed to create git worktree" })
      }
    })

    await Project.addSandbox(Instance.project.id, info.directory).catch(() => undefined)

    const projectID = Instance.project.id
    const extra = input?.startCommand?.trim()
    const populate = async () => {
      const populated = await $`git reset --hard`.quiet().nothrow().cwd(info.directory)
      if (populated.exitCode !== 0) {
        const message = errorText(populated) || "Failed to populate worktree"
        log.error("worktree checkout failed", { directory: info.directory, message })
        GlobalBus.emit("event", {
          directory: info.directory,
          payload: {
            type: Event.Failed.type,
            properties: {
              message,
            },
          },
        })
        throw new CreateFailedError({ message })
      }

      const started = await runStartScripts(info.directory, { projectID, extra })
      if (!started) {
        GlobalBus.emit("event", {
          directory: info.directory,
          payload: {
            type: Event.Failed.type,
            properties: {
              message: "Worktree startup scripts failed",
            },
          },
        })
        throw new StartCommandFailedError({ message: `Worktree startup scripts failed: ${info.directory}` })
      }

      GlobalBus.emit("event", {
        directory: info.directory,
        payload: {
          type: Event.Ready.type,
          properties: {
            name: info.name,
            branch: info.branch,
          },
        },
      })
    }

    try {
      await populate()
    } catch (error) {
      await remove({ directory: info.directory }).catch((cleanupError) => {
        log.error("worktree create cleanup failed", {
          directory: info.directory,
          error: String(cleanupError),
        })
      })
      await Project.removeSandbox(Instance.project.id, info.directory).catch(() => undefined)
      throw error
    }

    return info
  })

  /**
   * Acquire the per-project git mutex. Exported so that callers performing
   * git operations on the shared .git (e.g., mergeGoalDelivery) can serialize
   * against worktree create/remove operations.
   */
  export async function lock<T>(fn: () => Promise<T>): Promise<T> {
    return withGitLock(fn)
  }

  export const remove = fn(RemoveInput, async (input) => {
    if (!Project.isGitRepo(Instance.directory)) {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const directory = await canonical(input.directory)
    const locate = async (stdout: Uint8Array | undefined) => {
      const lines = outputText(stdout)
        .split("\n")
        .map((line) => line.trim())
      const entries = lines.reduce<{ path?: string; branch?: string }[]>((acc, line) => {
        if (!line) return acc
        if (line.startsWith("worktree ")) {
          acc.push({ path: line.slice("worktree ".length).trim() })
          return acc
        }
        const current = acc[acc.length - 1]
        if (!current) return acc
        if (line.startsWith("branch ")) {
          current.branch = line.slice("branch ".length).trim()
        }
        return acc
      }, [])

      return (async () => {
        for (const item of entries) {
          if (!item.path) continue
          const key = await canonical(item.path)
          if (key === directory) return item
        }
      })()
    }

    const clean = (target: string) =>
      fs
        .rm(target, {
          recursive: true,
          force: true,
          maxRetries: 5,
          retryDelay: 100,
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error)
          throw new RemoveFailedError({ message: message || "Failed to remove git worktree directory" })
        })

    const stop = async (target: string) => {
      if (!(await exists(target))) return
      await $`git fsmonitor--daemon stop`.quiet().nothrow().cwd(target)
    }

    // All git operations serialized to prevent concurrent corruption with create/merge
    return withGitLock(async () => {
      const list = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
      if (list.exitCode !== 0) {
        throw new RemoveFailedError({ message: errorText(list) || "Failed to read git worktrees" })
      }

      const entry = await locate(list.stdout)

      if (!entry?.path) {
        const directoryExists = await exists(directory)
        if (directoryExists) {
          await stop(directory)
          await clean(directory)
        }
        return true
      }

      await stop(entry.path)
      const removed = await $`git worktree remove --force ${entry.path}`.quiet().nothrow().cwd(Instance.worktree)
      if (removed.exitCode !== 0) {
        const next = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
        if (next.exitCode !== 0) {
          throw new RemoveFailedError({
            message: errorText(removed) || errorText(next) || "Failed to remove git worktree",
          })
        }

        const stale = await locate(next.stdout)
        if (stale?.path) {
          throw new RemoveFailedError({ message: errorText(removed) || "Failed to remove git worktree" })
        }
      }

      await clean(entry.path)

      const branch = entry.branch?.replace(/^refs\/heads\//, "")
      if (branch) {
        const deleted = await $`git branch -D ${branch}`.quiet().nothrow().cwd(Instance.worktree)
        if (deleted.exitCode !== 0) {
          throw new RemoveFailedError({ message: errorText(deleted) || "Failed to delete worktree branch" })
        }
      }

      return true
    })
  })

  export const reset = fn(ResetInput, async (input) => {
    if (!Project.isGitRepo(Instance.directory)) {
      throw new NotGitError({ message: "Worktrees are only supported for git projects" })
    }

    const directory = await canonical(input.directory)
    const primary = await canonical(Instance.worktree)
    if (directory === primary) {
      throw new ResetFailedError({ message: "Cannot reset the primary workspace" })
    }

    const worktreePath = await withGitLock(async () => {
      const list = await $`git worktree list --porcelain`.quiet().nothrow().cwd(Instance.worktree)
      if (list.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(list) || "Failed to read git worktrees" })
      }

      const lines = outputText(list.stdout)
        .split("\n")
        .map((line) => line.trim())
      const entries = lines.reduce<{ path?: string; branch?: string }[]>((acc, line) => {
        if (!line) return acc
        if (line.startsWith("worktree ")) {
          acc.push({ path: line.slice("worktree ".length).trim() })
          return acc
        }
        const current = acc[acc.length - 1]
        if (!current) return acc
        if (line.startsWith("branch ")) {
          current.branch = line.slice("branch ".length).trim()
        }
        return acc
      }, [])

      const entry = await (async () => {
        for (const item of entries) {
          if (!item.path) continue
          const key = await canonical(item.path)
          if (key === directory) return item
        }
      })()
      if (!entry?.path) {
        throw new ResetFailedError({ message: "Worktree not found" })
      }

      const remoteList = await $`git remote`.quiet().nothrow().cwd(Instance.worktree)
      if (remoteList.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(remoteList) || "Failed to list git remotes" })
      }

      const remotes = outputText(remoteList.stdout)
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)

      const remote = remotes.includes("origin")
        ? "origin"
        : remotes.length === 1
          ? remotes[0]
          : remotes.includes("upstream")
            ? "upstream"
            : ""

      const remoteHead = remote
        ? await $`git symbolic-ref refs/remotes/${remote}/HEAD`.quiet().nothrow().cwd(Instance.worktree)
        : { exitCode: 1, stdout: undefined, stderr: undefined }

      const remoteRef = remoteHead.exitCode === 0 ? outputText(remoteHead.stdout) : ""
      const remoteTarget = remoteRef ? remoteRef.replace(/^refs\/remotes\//, "") : ""
      const remoteBranch = remote && remoteTarget.startsWith(`${remote}/`) ? remoteTarget.slice(`${remote}/`.length) : ""

      const mainCheck = await $`git show-ref --verify --quiet refs/heads/main`.quiet().nothrow().cwd(Instance.worktree)
      const masterCheck = await $`git show-ref --verify --quiet refs/heads/master`
        .quiet()
        .nothrow()
        .cwd(Instance.worktree)
      const localBranch = mainCheck.exitCode === 0 ? "main" : masterCheck.exitCode === 0 ? "master" : ""

      const target = remoteBranch ? `${remote}/${remoteBranch}` : localBranch
      if (!target) {
        throw new ResetFailedError({ message: "Default branch not found" })
      }

      if (remoteBranch) {
        const fetch = await $`git fetch ${remote} ${remoteBranch}`.quiet().nothrow().cwd(Instance.worktree)
        if (fetch.exitCode !== 0) {
          throw new ResetFailedError({ message: errorText(fetch) || `Failed to fetch ${target}` })
        }
      }

      const worktreePath = entry.path
      const resetToTarget = await $`git reset --hard ${target}`.quiet().nothrow().cwd(worktreePath)
      if (resetToTarget.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(resetToTarget) || "Failed to reset worktree to target" })
      }

      const clean = await sweep(worktreePath)
      if (clean.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(clean) || "Failed to clean worktree" })
      }

      const update = await $`git submodule update --init --recursive --force`.quiet().nothrow().cwd(worktreePath)
      if (update.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(update) || "Failed to update submodules" })
      }

      const subReset = await $`git submodule foreach --recursive git reset --hard`.quiet().nothrow().cwd(worktreePath)
      if (subReset.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(subReset) || "Failed to reset submodules" })
      }

      const subClean = await $`git submodule foreach --recursive git clean -fdx`.quiet().nothrow().cwd(worktreePath)
      if (subClean.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(subClean) || "Failed to clean submodules" })
      }

      const status = await $`git status --porcelain=v1`.quiet().nothrow().cwd(worktreePath)
      if (status.exitCode !== 0) {
        throw new ResetFailedError({ message: errorText(status) || "Failed to read git status" })
      }

      const dirty = outputText(status.stdout)
      if (dirty) {
        throw new ResetFailedError({ message: `Worktree reset left local changes:\n${dirty}` })
      }

      return worktreePath
    })

    const projectID = Instance.project.id
    const started = await runStartScripts(worktreePath, { projectID })
    if (!started) {
      throw new StartCommandFailedError({ message: `Worktree startup scripts failed: ${worktreePath}` })
    }

    return true
  })
}
