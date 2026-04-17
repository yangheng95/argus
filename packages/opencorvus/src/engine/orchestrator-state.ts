import { lazyInstanceState } from "@/project/instance"

/**
 * Per-Instance orchestrator state — extracted from `engine/helpers.ts` so
 * that the engine barrel (`engine/index.ts`) does not transitively force
 * `Instance.state(...)` to run at module-init time on every consumer of the
 * barrel.
 *
 * Uses `lazyInstanceState` (a hoisted `function` declaration in
 * `project/instance.ts`) instead of `Instance.state(...)` so that even if
 * this module is loaded while Instance's own const-binding is still in TDZ,
 * the underlying `Instance.state` call is deferred to the first invocation
 * of the returned getter.
 *
 * Kept in its own file (and deliberately NOT re-exported from
 * `engine/index.ts`) so accessing `orchestratorState` never goes through
 * the barrel. Its two consumers (`engine/runtime.ts`, `task-api/index.ts`)
 * deep-import from here.
 */

export const orchestratorState = lazyInstanceState(() => ({
  booted: false,
  syncing: false,
}))
