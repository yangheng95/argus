/**
 * Tool Guard — circuit breaker for sub-agent tool execution.
 *
 * After N consecutive thrown errors from the same tool, subsequent calls
 * throw immediately without executing. This prevents a broken tool from
 * burning step quota while leaving overall turn control to the LLM.
 */

import { Log } from "./log"

const log = Log.create({ service: "tool-guard" })

// ── Circuit Breaker ──

/**
 * Wrap each tool's execute function with a per-tool failure counter.
 * After `maxFailures` consecutive thrown errors, the tool short-circuits.
 *
 * @param tools - AI SDK tool map (`Record<string, { execute, ... }>`)
 * @param maxFailures - consecutive error threshold (default 30)
 * @returns wrapped tool map (same shape, safe to pass to streamText)
 */
export function withCircuitBreaker<T extends Record<string, any>>(tools: T, maxFailures = 30): T {
  const failures = new Map<string, number>()
  const result = { ...tools } as Record<string, any>

  for (const [name, t] of Object.entries(tools)) {
    if (typeof t?.execute !== "function") continue
    const original = t.execute
    result[name] = {
      ...t,
      execute: async (input: unknown, options: unknown) => {
        const count = failures.get(name) ?? 0
        if (count >= maxFailures) {
          throw new Error(`Tool "${name}" circuit-open after ${count} consecutive failures. Use a different approach.`)
        }
        try {
          const r = await original(input, options)
          failures.delete(name)
          return r
        } catch (err) {
          const next = count + 1
          failures.set(name, next)
          if (next >= maxFailures) {
            log.warn("circuit breaker tripped", { tool: name, failures: next })
          }
          throw err
        }
      },
    }
  }
  return result as T
}

/**
 * Convenience wrapper: apply the circuit breaker and preserve the original
 * tool-map shape for agent call sites.
 */
export function toolGuard<T extends Record<string, any>>(
  tools: T,
  opts?: {
    maxFailures?: number
  },
) {
  return {
    tools: withCircuitBreaker(tools, opts?.maxFailures ?? 30),
  }
}
