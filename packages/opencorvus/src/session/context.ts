import { Context } from "../util/context"
import { Config } from "@/config/config"
import { SessionObservability } from "@/util/session-observability"
// Type-only import: erased at runtime, so config-layer consumers can read the
// ambient session without creating a session<->config import cycle.
import type { Session } from "./index"

// Ambient per-session execution context. Established once at every session
// execution entry point (see SessionContext.provide call sites) so that
// session-overridable config (model / prompt / temperature) and per-session
// observability (trace / log bucketing) resolve against the running session
// WITHOUT threading sessionID through ~70 Config.get() call sites.
//
// Single abstraction, multiple uses (config overlay resolution AND trace/log
// tagging) — do NOT introduce a parallel session-propagation mechanism.
export namespace SessionContext {
  const ctx = Context.create<Session.Info>("session")
  SessionObservability.bindSessionContext(() => ctx.tryUse())

  // Wrap a session execution. Must cover EVERY entry that runs a session
  // (prompt loop, summarize, task-api reply, wake, shell resume).
  export function provide<R>(session: Session.Info, fn: () => R): R {
    return ctx.provide(session, fn)
  }

  // Returns the active session, or undefined when running outside any session
  // (CLI / control plane). Callers that need session scope but tolerate its
  // absence (config base fallback, non-session trace domain) use this.
  export function tryUse(): Session.Info | undefined {
    return ctx.tryUse()
  }

  // Returns the active session or throws — for callers that are only ever
  // reachable from within a session execution.
  export function use(): Session.Info {
    return ctx.use()
  }

  // THE single accessor for the active session's config overlay. Returns the
  // parsed, schema-validated overlay (pinned-invariant keys already rejected
  // by Config.Overlay) or undefined when there is no session / no overlay.
  // Consumers (model resolution, resolveSessionAgent) apply it via
  // Config.mergeOverlay onto the immutable project base — they never read
  // session metadata directly, so the overlay surface stays single-source.
  export function overlay(): Config.Overlay | undefined {
    const raw = ctx.tryUse()?.metadata?.configOverlay
    if (!raw) return undefined
    return Config.Overlay.parse(raw)
  }
}
