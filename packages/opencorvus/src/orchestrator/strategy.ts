import { Log } from "@/util/log"

/**
 * Transient-failure retry wrapper for LLM API calls.
 *
 * This is INFRASTRUCTURE, not a decision-making retry policy.
 * It handles transient failures (network timeout, rate limit, API 5xx)
 * by retrying the same call. It does NOT retry based on agent output
 * quality or eval verdicts — that's the Task Agent's job.
 *
 * If signal is provided and already aborted, throws immediately.
 * Between retries, checks signal to avoid wasting time on aborted calls.
 */

/** Maximum transient retries for LLM API calls. Not user-configurable. */
const LLM_TRANSIENT_RETRIES = 2

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
      }
    }
  }
  throw lastError!
}
