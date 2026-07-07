import { Log } from "@/util/log"
import { Context } from "../util/context"
import { Project } from "./project"
import { State } from "./state"
import { iife } from "@/util/iife"
import { GlobalBus } from "@/bus/global"
import { Filesystem } from "@/util/filesystem"
import path from "node:path"
import { ProjectRuntimePaths } from "./runtime-paths"

type InstanceInit = () => Promise<unknown>

interface Context {
  directory: string
  worktree: string
  project: Project.Info
  git: boolean
  initRuns: WeakMap<InstanceInit, Promise<void>>
}

type StateFactory = <S>(
  init: () => S,
  dispose?: (state: Awaited<S>) => Promise<void>,
) => (() => S) & {
  reset(): Promise<void>
  resetAll(): Promise<void>
}

type InstanceApi = {
  provide<R>(input: { directory: string; init?: InstanceInit; fn: () => R }): Promise<R>
  tryProvideActive<R>(input: { directory: string; fn: () => R }): Promise<R | undefined>
  forEachActive(input: { fn: () => void | Promise<void> }): Promise<void>
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

function instanceCacheKey(directory: string) {
  return process.platform === "win32" ? directory.toLowerCase() : directory
}

function needsProjectRefresh(ctx: Context) {
  const hasGit = Project.isGitRepo(ctx.directory)
  return hasGit !== ctx.git || ((ctx.project.id === "global" || ctx.worktree === "/") && hasGit)
}

async function bootstrapContext(ctx: Context, init?: InstanceInit) {
  // .gitignore upkeep runs INSIDE context.provide because ensureGitignore()
  // reads `Instance.directory` from the active context. Lazy import breaks the
  // engine/git <-> instance cycle.
  const { ensureGitignore } = await import("@/engine/git")
  await ensureGitignore()
  // Sweep orphan attachments on first bootstrap per project
  // (attachment-store single-source contract).
  // `AttachmentStore.write` is content-addressed and write-only — without
  // this hook, removed parts / archived sessions leave bytes on disk forever.
  // Errors degrade to a log line — sweep failure must not turn into a
  // 500-storm (rule 1 / W2-V32 lesson).
  try {
    const { AttachmentStore } = await import("@/storage/attachment-store")
    await AttachmentStore.sweep(ctx.project.id)
  } catch (err) {
    Log.Default.warn("AttachmentStore.sweep failed during bootstrap", {
      projectID: ctx.project.id,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await runContextInit(ctx, init)
}

async function runContextInit(ctx: Context, init?: InstanceInit) {
  if (!init) return
  const current = ctx.initRuns.get(init)
  if (current) return current
  const run = Promise.resolve()
    .then(init)
    .then(() => undefined)
    .catch((error) => {
      if (ctx.initRuns.get(init) === run) ctx.initRuns.delete(init)
      throw error
    })
  ctx.initRuns.set(init, run)
  await run
}

export const Instance: InstanceApi = {
  async provide<R>(input: { directory: string; init?: InstanceInit; fn: () => R }): Promise<R> {
    // Normalize project directories once so cache keys and boundary checks stay stable.
    const directory = Filesystem.resolve(input.directory)
    const key = instanceCacheKey(directory)
    let existing = cache.get(key)
    if (!existing) {
      Log.Default.info("creating instance", { directory })
      existing = iife(async () => {
        const { project, sandbox } = await Project.fromDirectory(directory)
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
          git: Project.isGitRepo(project.worktree),
          initRuns: new WeakMap(),
        }
        await context.provide(ctx, () => bootstrapContext(ctx, input.init))
        return ctx
      })
      // Remove rejected promises from cache so they can be retried on the next call.
      existing.catch(() => {
        if (cache.get(key) === existing) cache.delete(key)
      })
      cache.set(key, existing)
    }
    let ctx = await existing
    if (needsProjectRefresh(ctx)) {
      ctx = await Instance.refresh(directory)
      await context.provide(ctx, () => bootstrapContext(ctx, input.init))
    } else if (input.init) {
      await context.provide(ctx, () => runContextInit(ctx, input.init))
    }
    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  async tryProvideActive<R>(input: { directory: string; fn: () => R }): Promise<R | undefined> {
    const directory = Filesystem.resolve(input.directory)
    const key = instanceCacheKey(directory)
    const existing = cache.get(key)
    if (!existing) return undefined
    const ctx = await existing.catch(() => undefined)
    if (!ctx) return undefined
    if (cache.get(key) !== existing) return undefined
    return context.provide(ctx, async () => {
      return input.fn()
    })
  },
  async forEachActive(input: { fn: () => void | Promise<void> }) {
    const entries = [...cache.entries()]
    for (const [key, value] of entries) {
      if (cache.get(key) !== value) continue
      const ctx = await value
      if (cache.get(key) !== value) continue
      await context.provide(ctx, input.fn)
    }
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
    const resolved = Filesystem.resolve(directory)
    const key = instanceCacheKey(resolved)
    const next = await Project.fromDirectory(resolved)
    const existing = cache.get(key)
    if (!existing) {
      const ctx = {
        directory: resolved,
        worktree: next.sandbox,
        project: next.project,
        git: Project.isGitRepo(next.project.worktree),
        initRuns: new WeakMap(),
      }
      cache.set(key, Promise.resolve(ctx))
      return ctx
    }
    const ctx = await existing
    ctx.directory = resolved
    ctx.worktree = next.sandbox
    ctx.project = next.project
    ctx.git = Project.isGitRepo(next.project.worktree)
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
    const directory = Instance.directory
    Log.Default.info("disposing instance", { directory })
    await State.dispose(directory)
    cache.delete(instanceCacheKey(directory))
    GlobalBus.emit("event", {
      directory,
      payload: {
        type: "server.instance.disposed",
        properties: {
          directory,
        },
      },
    })
  },
  async disposeAll() {
    if (disposal.all) return disposal.all

    disposal.all = iife(async () => {
      Log.Default.info("disposing all instances")
      const { Scheduler } = await import("@/scheduler")
      await Scheduler.disposeGlobal()
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
