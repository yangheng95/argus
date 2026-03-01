import { Log } from "./log"

const log = Log.create({ service: "retry" })

/**
 * Retry an async function with exponential backoff.
 * Retries on rate-limit (429) and server errors (503, 502), not on client errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const { maxAttempts = 3, baseDelayMs = 1000, label = "operation" } = opts
  let lastError: unknown
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn()
    } catch (err: any) {
      lastError = err
      const isRetryable =
        err?.status === 429 ||
        err?.status === 503 ||
        err?.status === 502 ||
        err?.code === "ECONNRESET"
      if (!isRetryable || attempt === maxAttempts) throw err
      const delay =
        baseDelayMs * Math.pow(2, attempt - 1) * (0.5 + Math.random() * 0.5)
      log.warn("retrying after failure", {
        label,
        attempt,
        maxAttempts,
        delayMs: Math.round(delay),
        error: err?.message,
      })
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastError
}
