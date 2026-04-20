import { Log } from "@/util/log"

/**
 * Transient-failure retry wrapper for LLM API calls.
 *
 * This is INFRASTRUCTURE, not a decision-making retry policy.
 * It handles transient failures (network timeout, rate limit, API 5xx)
 * by retrying the same call with exponential backoff. It does NOT retry
 * based on agent output quality or eval verdicts — that is the
 * Orchestrator's job.
 *
 * Backoff schedule: 1s → 2s → 4s between attempts (attempt-index * 2^n * 1000ms).
 * The backoff means a stage sees up to ~7s of wall-clock delay across 3
 * attempts total, small enough to tolerate transient provider blips without
 * masking genuinely-dead providers.
 *
 * If signal is provided and already aborted, throws immediately. Between
 * retries, checks signal to avoid wasting time on aborted calls and aborts
 * the pending backoff sleep.
 */

/** Maximum transient retries for LLM API calls. Not user-configurable. */
const LLM_TRANSIENT_RETRIES = 2

/** Initial backoff in ms. Doubles on each successive retry. */
const BACKOFF_BASE_MS = 1000

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("sleep aborted"))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve()
    }, ms)
    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error("sleep aborted"))
    }
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

export async function withStageRetry<T>(
  stage: string,
  fn: () => Promise<T>,
  options?: { onRetry?: (attempt: number, error: Error) => void; signal?: AbortSignal },
): Promise<T> {
  const retryLog = Log.create({ service: "stage-retry" })
  const maxRetries = LLM_TRANSIENT_RETRIES
  let lastError: Error | undefined
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // Check signal before each attempt to avoid retrying after abort
    if (options?.signal?.aborted) {
      throw lastError ?? new Error(`${stage} stage aborted before attempt ${attempt + 1}`)
    }
    try {
      return await fn()
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err))
      const cause = lastError.cause instanceof Error ? lastError.cause.message : undefined
      retryLog.warn(`${stage} attempt ${attempt + 1}/${maxRetries + 1} failed`, {
        stage,
        attempt: attempt + 1,
        error: lastError.message,
        cause,
      })
      if (attempt < maxRetries) {
        options?.onRetry?.(attempt + 1, lastError)
        const backoffMs = BACKOFF_BASE_MS * 2 ** attempt
        retryLog.info(`${stage} backing off before retry`, {
          stage,
          nextAttempt: attempt + 2,
          backoffMs,
        })
        try {
          await sleep(backoffMs, options?.signal)
        } catch {
          // signal aborted during backoff; surface the last run error below.
          throw lastError
        }
      }
    }
  }
  throw lastError!
}
