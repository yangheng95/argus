/**
 * Agent activity guard with three independent timeout tiers.
 *
 * The previous single-timer stall guard treated every chunk (including
 * token-level text deltas) as "activity", which meant a model stuck in a
 * tool-call retry loop — still emitting deltas — never tripped the stall
 * timeout. See CLAUDE.md rule #3: "timeouts must be real activity
 * timeouts", where "activity" should mean task progress, not bytes on
 * the wire.
 *
 * Three tiers, whichever fires first wins:
 *
 *   Tier 1 — alive:    nothing at all received from the provider. Reset by
 *                      `.alive()` on every chunk. Catches TCP/provider hangs.
 *
 *   Tier 2 — progress: no semantic progress. Reset by `.progress()` only on
 *                      signals that mean the agent actually advanced —
 *                      tool-call completion, tool-result, step-finish.
 *                      Catches "model is talking but going nowhere" loops.
 *
 *   Tier 3 — absolute: wall-clock cap since the guard was created. Never
 *                      reset. Catches any runaway that somehow keeps both
 *                      other tiers happy.
 */
export type ProgressTimeoutTier = "alive" | "progress" | "absolute"

export interface ProgressGuardOptions {
  /** Tier 1 reset: `.alive()`. Suggest 120_000ms. */
  aliveTimeoutMs: number
  /** Tier 2 reset: `.progress()`. Caller-determined based on agent workload. */
  progressTimeoutMs: number
  /** Tier 3: wall-clock. Defaults to 2× progressTimeoutMs. */
  absoluteTimeoutMs?: number
  /** How often to evaluate timers. Defaults to 1000ms. */
  checkIntervalMs?: number
  /** Invoked at most once with the tier + human-readable reason. */
  onTimeout: (reason: string, tier: ProgressTimeoutTier) => void
}

export interface ProgressGuard {
  /** Reset the alive timer only. Call on every chunk/event. */
  alive(): void
  /** Reset both alive + progress timers. Call on step-finish / tool-call /
   *  tool-result — anything that proves the task advanced. */
  progress(): void
  /** Stop the internal ticker. Idempotent. Call in `finally`. */
  clear(): void
  /** True once a timeout has fired (onTimeout called). */
  readonly fired: boolean
}

export function createProgressGuard(options: ProgressGuardOptions): ProgressGuard {
  if (!(options.aliveTimeoutMs > 0)) {
    throw new Error(`createProgressGuard: aliveTimeoutMs must be > 0, got ${options.aliveTimeoutMs}`)
  }
  if (!(options.progressTimeoutMs > 0)) {
    throw new Error(`createProgressGuard: progressTimeoutMs must be > 0, got ${options.progressTimeoutMs}`)
  }
  const absoluteMs = options.absoluteTimeoutMs ?? options.progressTimeoutMs * 2
  if (!(absoluteMs > 0)) {
    throw new Error(`createProgressGuard: absoluteTimeoutMs must be > 0, got ${absoluteMs}`)
  }
  const interval = options.checkIntervalMs ?? 1000
  const startedAt = Date.now()
  let lastAlive = startedAt
  let lastProgress = startedAt
  let fired = false

  const fire = (tier: ProgressTimeoutTier, reason: string) => {
    if (fired) return
    fired = true
    clearInterval(ticker)
    options.onTimeout(reason, tier)
  }

  const ticker = setInterval(() => {
    if (fired) return
    const now = Date.now()
    if (now - startedAt > absoluteMs) {
      fire("absolute", `absolute timeout: ${now - startedAt}ms since start (cap ${absoluteMs}ms)`)
      return
    }
    if (now - lastAlive > options.aliveTimeoutMs) {
      fire("alive", `alive timeout: ${now - lastAlive}ms since last chunk (cap ${options.aliveTimeoutMs}ms)`)
      return
    }
    if (now - lastProgress > options.progressTimeoutMs) {
      fire(
        "progress",
        `progress timeout: ${now - lastProgress}ms since last progress signal (cap ${options.progressTimeoutMs}ms)`,
      )
    }
  }, interval)

  return {
    alive() {
      if (fired) return
      lastAlive = Date.now()
    },
    progress() {
      if (fired) return
      const now = Date.now()
      lastAlive = now
      lastProgress = now
    },
    clear() {
      fired = true
      clearInterval(ticker)
    },
    get fired() {
      return fired
    },
  }
}
