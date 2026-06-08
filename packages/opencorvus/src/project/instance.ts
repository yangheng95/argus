import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"
import path from "node:path"
import { ProjectRuntimePaths } from "./runtime-paths"

interface Context {
  directory: string
  worktree: string
  project: Project.Info
}

type StateFactory = <S>(
  init: () => S,
  dispose?: (state: Awaited<S>) => Promise<void>,
) => (() => S) & {
  reset(): Promise<void>
  resetAll(): Promise<void>
}

type InstanceApi = {
  provide<R>(input: { directory: string; init?: () => Promise<unknown>; fn: () => R }): Promise<R>
  readonly directory: string
  readonly worktree: string
  readonly project: Project.Info
  current(): Context | undefined
  refresh(directory?: string): Promise<Context>
  containsPath(filepath: string): boolean
  state: StateFactory
  dispose(): Promise<void>
  disposeAll(): Promise<void>
}

const context = Context.create<Context>("instance")
const cache = new Map<string, Promise<Context>>()

const disposal = {
  all: undefined as Promise<void> | undefined,
}

export const Instance: InstanceApi = {
  async provide<R>(input: { directory: string; init?: () => Promise<unknown>; fn: () => R }): Promise<R> {
    // Normalize project directories once so cache keys and boundary checks stay stable.
    const directory = Filesystem.resolve(input.directory)
    let existing = cache.get(directory)
    if (!existing) {
      Log.Default.info("creating instance", { directory })
      existing = iife(async () => {
        const { project, sandbox } = await Project.fromDirectory(directory)
        if (project.id !== "global") {
          const legacy = (
            await Promise.all(
              ProjectRuntimePaths.legacyRuntimeRelativePaths.map(async (relative) => ({
                relative,
                exists: await Filesystem.exists(path.join(project.worktree, ...relative.split("/"))),
              })),
            )
          )
            .filter((entry) => entry.exists)
            .map((entry) => entry.relative)
          if (legacy.length > 0) {
            throw new Error(
              `Legacy OpenCorvus runtime paths exist under ${project.worktree}: ${legacy.join(", ")}. ` +
                `Move or delete these runtime directories before starting; new task/session state lives under ${ProjectRuntimePaths.relativeRuntimeRoot()}.`,
            )
          }
        }
        // Note (W2-V32): the previous bootstrap auto-ran `Project.initGit` for
        // any non-git directory. That violated rule 7 (silent fallback) and
        // was the root cause of the darwin 500-storm: when `process.cwd()`
        // ended up as the directory (Tauri sidecar launched from Finder has
        // cwd="/"), the auto-init tried `git init /`, hit permission denied,
        // and turned every project-scoped HTTP request into a 500. Worktree
        // operations that *require* a `.git` now throw `WorktreeNotGitError`
        // explicitly (mapped to 412), which the overlay surfaces as an
        // explicit "init this directory?" prompt — gated by a real user
        // gesture, not a side effect of any GET request.
        const ctx = {
          directory,
          worktree: sandbox,
          project,
        }
        await context.provide(ctx, async () => {
          // .gitignore upkeep runs INSIDE context.provide because
          // ensureGitignore() reads `Instance.directory` from the active
          // context. Lazy import breaks the engine/git ↔ instance cycle.
          const { ensureGitignore } = await import("@/engine/git")
          await ensureGitignore()
          // Sweep orphan attachments on first bootstrap per project
          // (specs/acceptance-attachment-store-single-source-2026-05-11.md).
          // `AttachmentStore.write` is content-addressed and write-only —
          // without this hook, removed parts / archived sessions leave
          // bytes on disk forever. Skipped for the "global" pseudo-
          // project (worktree="/") because reading C:\.opencorvus\ would
          // fail and the global project never holds real attachments.
          // Errors degrade to a log line — sweep failure must not turn
          // into a 500-storm (rule 1 / W2-V32 lesson).
          if (project.id !== "global") {
            try {
              const { AttachmentStore } = await import("@/storage/attachment-store")
              await AttachmentStore.sweep(project.id)
            } catch (err) {
              Log.Default.warn("AttachmentStore.sweep failed during bootstrap", {
                projectID: project.id,
                error: err instanceof Error ? err.message : String(err),
              })
            }
          }
          await input.init?.()
        })
        return ctx
      })
      // Remove rejected promises from cache so they can be retried on the next call.
      existing.catch(() => {
        if (cache.get(directory) === existing) cache.delete(directory)
      })
      cache.set(directory, existing)
    }
    const ctx = await existing
    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  get directory() {
    return context.use().directory
  },
  get worktree() {
    return context.use().worktree
  },
  get project() {
    return context.use().project
  },
  current() {
    return context.tryUse()
  },
  async refresh(directory = Instance.directory) {
    const key = Filesystem.resolve(directory)
    const next = await Project.fromDirectory(key)
    const existing = cache.get(key)
    if (!existing) {
      const ctx = {
        directory: key,
        worktree: next.sandbox,
        project: next.project,
      }
      cache.set(key, Promise.resolve(ctx))
      return ctx
    }
    const ctx = await existing
    ctx.directory = key
    ctx.worktree = next.sandbox
    ctx.project = next.project
    cache.set(key, Promise.resolve(ctx))
    return ctx
  },
  /**
   * Check if a path is within the project boundary.
   * Returns true if path is inside Instance.directory OR Instance.worktree.
   * Paths within the worktree but outside the working directory should not trigger external_directory permission.
   */
  containsPath(filepath: string) {
    if (Filesystem.contains(Instance.directory, filepath)) return true
    // Non-git projects set worktree to "/" which would match ANY absolute path.
    // Skip worktree check in this case to preserve external_directory permissions.
    if (Instance.worktree === "/") return false
    return Filesystem.contains(Instance.worktree, filepath)
  },
  state<S>(
    init: () => S,
    dispose?: (state: Awaited<S>) => Promise<void>,
  ): (() => S) & {
    reset(): Promise<void>
    resetAll(): Promise<void>
  } {
    return State.create(() => Instance.directory, init, dispose)
  },
  async dispose() {
    Log.Default.info("disposing instance", { directory: Instance.directory })
    await State.dispose(Instance.directory)
    cache.delete(Instance.directory)
    GlobalBus.emit("event", {
      directory: Instance.directory,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory: Instance.directory,
        },
      },
    })
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
      const entries = [...cache.entries()]
      for (const [key, value] of entries) {
        if (cache.get(key) !== value) continue

        const ctx = await value.catch((error) => {
          Log.Default.warn("instance dispose failed", { key, error })
          return undefined
        })

        if (!ctx) {
          if (cache.get(key) === value) cache.delete(key)
          continue
        }

        if (cache.get(key) !== value) continue

        await context.provide(ctx, async () => {
          await Instance.dispose()
        })
      }
    }).finally(() => {
      disposal.all = undefined
    })

    return disposal.all
  },
}

/**
 * Defer the underlying `Instance.state(...)` call until the returned getter
 * is first invoked.
 *
 * Why a top-level `function` declaration (instead of a method on `Instance`):
 * function declarations are hoisted to the top of the module body, so their
 * binding is available to consumers from the very start of module evaluation —
 * unlike `Instance` itself, which is `export const` and therefore in TDZ
 * until its assignment line runs.
 *
 * When a module needs to declare instance-scoped state at top level
 * (`const state = lazyInstanceState(initFn, disposeFn)`) but is loaded
 * BEFORE Instance's own module body has finished — typically via cycles
 * introduced by barrel re-exports such as engine/index.ts's
 * `export * from "./helpers"` — the original `Instance.state(...)` form
 * throws TDZ on the `Instance` binding at the call site. Wrapping via
 * `lazyInstanceState` defers that access until first runtime call, by
 * which point all module bodies have settled.
 */
export function lazyInstanceState<S>(
  init: () => S,
  dispose?: (state: Awaited<S>) => Promise<void>,
): (() => S) & { reset(): Promise<void>; resetAll(): Promise<void> } {
  let cached: ((() => S) & { reset(): Promise<void>; resetAll(): Promise<void> }) | undefined
  const get = ((): S => {
    if (!cached) cached = Instance.state(init, dispose)
    return cached()
  }) as (() => S) & { reset(): Promise<void>; resetAll(): Promise<void> }
  get.reset = () => {
    return cached?.reset() ?? Promise.resolve()
  }
  get.resetAll = () => {
    if (!cached) cached = Instance.state(init, dispose)
    return cached.resetAll()
  }
  return get
}
