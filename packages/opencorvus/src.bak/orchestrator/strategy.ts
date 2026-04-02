import { OrchestratorConfig } from "./config"
import { Log } from "@/util/log"

/**
 * Unified stage retry wrapper. Attempts fn once, retries up to STAGE_MAX_RETRIES
 * times on failure. Agents are pure (attempt once, succeed or throw); this
 * wrapper applies the retry policy uniformly across all stages.
 *
 * If signal is provided and already aborted, throws immediately.
 * Between retries, checks signal to avoid wasting time on aborted stages.
 */
export async function withStageRetry<T>(
  stage: string,
  fn: () => Promise<T>,
  options?: { onRetry?: (attempt: number, error: Error) => void; signal?: AbortSignal },
): Promise<T> {
  const retryLog = Log.create({ service: "stage-retry" })
  const maxRetries = (await OrchestratorConfig.get()).stage_max_retries
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
