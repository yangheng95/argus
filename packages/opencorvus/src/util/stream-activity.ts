/**
 * Single-source chunk-driven activity gate.
 *
 * Purpose: detect "no byte moved in N ms" on any streaming surface
 * (LLM stream.fullStream, executor event queue, SSE bridge) without
 * each layer inventing its own setTimeout/reset dance.
 *
 * Semantics (physical-liveness probe, NOT a state machine):
 *   - Caller pulls `signal` and composes it into whatever `AbortSignal`
 *     its producer already honours.
 *   - Caller invokes `observe()` on every real chunk / event. Each call
 *     resets the inactivity timer.
 *   - If `idleMs` elapses with no `observe()` call AND the external
 *     `signal` has not fired, the gate aborts its own controller with
 *     an `AbortError` carrying a deterministic reason. The chain then
 *     unwinds naturally through the existing `throwIfAborted()` / abort
 *     listeners — no custom status codes, no separate error taxonomy.
 *   - Disposal is idempotent; after `dispose()` the gate stops all
 *     timers and stops observing.
 *
 * Rules: CLAUDE.md #1 (no fallback — we *abort*, the caller decides),
 * #22 (single source for activity-gating), #24 (pattern is extracted,
 * not copy-pasted into each consumer), #26 (no over-engineering —
 * observe() / dispose() / signal / lastActivityAt and that's it).
 */

export interface StreamActivityGate {
  /** Abort signal combined from external signal + internal idle controller. */
  readonly signal: AbortSignal
  /** Call on every chunk / event. Resets the inactivity timer. */
  observe(): void
  /** Millisecond timestamp of the most recent observe() (or construction). */
  lastActivityAt(): number
  /** True once the gate's own controller has aborted due to inactivity. */
  timedOut(): boolean
  /** Idempotent. Clears all timers and detaches listeners. */
  dispose(): void
}

export interface StreamActivityOptions {
  /** Maximum idle window before the gate aborts itself. Must be > 0. */
  idleMs: number
  /** Caller-owned signal that the gate propagates alongside its own. */
  signal?: AbortSignal
  /**
   * Human-readable tag appended to the AbortError reason (e.g.
   * "session-llm", "executor-events"). Helps triage in logs; does NOT
   * change control flow.
   */
  label?: string
}

export function withStreamActivity(options: StreamActivityOptions): StreamActivityGate {
  if (!Number.isFinite(options.idleMs) || options.idleMs <= 0) {
    throw new Error(`withStreamActivity: idleMs must be a positive finite number (got ${options.idleMs})`)
  }
  const label = options.label ?? "stream"
  const inactivity = new AbortController()
  const combined = options.signal
    ? AbortSignal.any([options.signal, inactivity.signal])
    : inactivity.signal

  let last = Date.now()
  let disposed = false
  let timer: ReturnType<typeof setTimeout> | null = null

  const trip = () => {
    if (disposed) return
    if (inactivity.signal.aborted) return
    inactivity.abort(
      new DOMException(`stream idle > ${options.idleMs}ms (${label})`, "AbortError"),
    )
  }

  const schedule = () => {
    if (disposed) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(trip, options.idleMs)
    // Don't keep the event loop alive just for this timer — the gate
    // is advisory, not a liveness proof.
    timer.unref?.()
  }

  schedule()

  return {
    signal: combined,
    observe() {
      if (disposed) return
      last = Date.now()
      schedule()
    },
    lastActivityAt() {
      return last
    },
    timedOut() {
      return inactivity.signal.aborted
    },
    dispose() {
      if (disposed) return
      disposed = true
      if (timer !== null) {
        clearTimeout(timer)
        timer = null
      }
    },
  }
}
