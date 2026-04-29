// ── Plugin hook isolation ──
//
// audit-2026-04-29 W2-V19. Lifted out of plugin/index.ts so the
// throw-isolation contract is unit-testable without standing up
// the full Plugin.state() graph (Config.get, Instance.provide,
// Bus, BunProc.install, npm hot-load, etc.).
//
// Plugins are external 3rd-party code. A single buggy hook must
// NOT crash the host: pre-V19 a plugin throwing in any hook
// propagated up through Plugin.trigger / Plugin.init and tore
// down whatever lifecycle path called it — chat.params before
// the LLM round-trip, config during session bootstrap, the Bus
// event broadcaster, etc. Wrap each call so the throw becomes
// a loud log line and the next hook gets its turn.

import { Log } from "../util/log"

const log = Log.create({ service: "plugin" })

/**
 * Run a plugin hook with throw isolation. If the hook throws or
 * returns a rejecting Promise, log it and resolve instead of
 * propagating. If the hook is undefined / null, return immediately
 * (the caller's optional-chain pattern is collapsed here).
 *
 * Test seam (`logHook`) lets the unit test capture the structured
 * fields without intercepting the real Log writer.
 */
export async function runHookIsolated<R>(
  hookName: string,
  fn: ((...args: any[]) => R | Promise<R>) | null | undefined,
  args: any[],
  logHook: typeof log.error = log.error,
): Promise<R | undefined> {
  if (!fn) return undefined
  try {
    return await fn(...args)
  } catch (err) {
    logHook("plugin hook threw, isolating to keep host alive", {
      hook: hookName,
      error: err instanceof Error ? err.message : String(err),
    })
    return undefined
  }
}
