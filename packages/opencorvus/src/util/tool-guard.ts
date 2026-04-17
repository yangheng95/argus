/**
 * Tool Guard — circuit breaker + stall detector for sub-agent tool execution.
 *
 * Circuit breaker: after N consecutive thrown errors from the same tool,
 * subsequent calls throw immediately without executing. This prevents
 * the LLM from burning step quota on a tool that's down (e.g. web_search
 * with network issues). The counter resets on any successful execution.
 *
 * Stall detector: tracks consecutive "barren" steps where every tool call
 * in the step errored. After N such steps, the agent is considered stalled
 * and the provided AbortController is signalled. This catches patterns the
 * circuit breaker alone can't — e.g. the LLM cycling through multiple
 * broken tools, or calling a circuit-broken tool despite the error message.
 */

import { Log } from "./log"

const log = Log.create({ service: "tool-guard" })

// ── Circuit Breaker ──

/**
 * Wrap each tool's execute function with a per-tool failure counter.
 * After `maxFailures` consecutive thrown errors, the tool short-circuits.
 *
 * @param tools - AI SDK tool map (`Record<string, { execute, ... }>`)
 * @param maxFailures - consecutive error threshold (default 3)
 * @returns wrapped tool map (same shape, safe to pass to streamText)
 */
export function withCircuitBreaker<T extends Record<string, any>>(
  tools: T,
  maxFailures = 3,
): T {
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
          throw new Error(
            `Tool "${name}" circuit-open after ${count} consecutive failures. Use a different approach.`,
          )
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

// ── Stall Detector ──

/**
 * Create an `onStepFinish` callback that aborts the agent when it
 * detects N consecutive steps where every tool call errored (barren steps).
 *
 * A step is "barren" when:
 *   - It has tool results AND all of them are errors
 *   - It produced no text output
 *
 * Steps with text output (even partial) or at least one successful tool
 * result reset the counter.
 *
 * @returns `{ onStepFinish, signal }` — pass signal to streamText's abortSignal
 */
export function createStallDetector(opts: {
  /** consecutive barren steps before abort (default 5) */
  maxBarrenSteps?: number
}) {
  const maxBarren = opts.maxBarrenSteps ?? 5
  const ctrl = new AbortController()
  let barren = 0

  function onStepFinish(step: unknown) {
    const s = step as { text?: string; toolResults?: Array<{ isError?: boolean }> }
    const hasText = typeof s.text === "string" && s.text.trim().length > 0
    const results = Array.isArray(s.toolResults) ? s.toolResults : []
    const hasTools = results.length > 0
    const allErrored = hasTools && results.every((r) => r.isError === true)

    if (hasText || !allErrored) {
      barren = 0
      return
    }

    barren++
    if (barren >= maxBarren) {
      log.warn("stall detected", { barrenSteps: barren })
      ctrl.abort(`stall: ${barren} consecutive steps with only failed tool calls`)
    }
  }

  return { onStepFinish, signal: ctrl.signal }
}

/**
 * Convenience: apply both circuit breaker and stall detector.
 *
 * @returns `{ tools, onStepFinish, signal }` — spread into streamText args:
 * ```ts
 * const guard = toolGuard(rawTools)
 * streamText({
 *   tools: guard.tools,
 *   abortSignal: AbortSignal.any([existingSignal, guard.signal]),
 *   onStepFinish: guard.onStepFinish,
 *   ...
 * })
 * ```
 */
export function toolGuard<T extends Record<string, any>>(
  tools: T,
  opts?: {
    maxFailures?: number
    maxBarrenSteps?: number
  },
) {
  const guarded = withCircuitBreaker(tools, opts?.maxFailures ?? 3)
  const stall = createStallDetector({ maxBarrenSteps: opts?.maxBarrenSteps ?? 5 })
  return {
    tools: guarded,
    onStepFinish: stall.onStepFinish,
    signal: stall.signal,
  }
}
