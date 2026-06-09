import { describe, expect, test } from "bun:test"

/**
 * audit-2026-04-29 W2-V16. messages.ts:loadConversation had a race
 * that silently dropped queued loads after a task switch.
 *
 * Pre-fix loop condition was:
 *   } while (_convQueued && requestTaskID === boardStore.selectedTaskID)
 * where `requestTaskID` was captured at the FIRST call's entry.
 * If the user task-switched A→B during the first fetch and a
 * second loadConversation call bumped `_convQueued = true`, the
 * inner iteration found taskID="A" !== selectedTaskID="B" and
 * `continue`d — but the outer stale `requestTaskID === "A"` check
 * tripped against selectedTaskID="B", so the loop exited and B's
 * queued load NEVER ran. Conversation panel showed empty / stale
 * A messages forever (until the next manual reload).
 *
 * Post-fix: drop the requestTaskID gate. The inner taskID re-read
 * + identity guard on every iteration handles the within-iteration
 * race already.
 *
 * Booting the real messages.ts in unit context drags in solid-store
 * + the entire transport chain. Instead, replicate the loop's
 * shape in a focused harness so the fix's contract is locked at
 * the algorithm level. The production loop's structural change
 * (drop `requestTaskID === selectedTaskID` from the condition) is
 * mirrored here exactly.
 */

interface LoopHarnessOpts {
  initialTaskID: string
  /** Mid-fetch task switches: keyed by iteration count, mapped to the new
   *  selectedTaskID at the start of that iteration's body. */
  switchAtIteration?: Record<number, string>
  /** Whether queued was true going into iteration N (set by an external
   *  caller in production; here a static map keyed by iter). */
  queuedAtEnd?: Record<number, boolean>
  /** Loop variant: pre-fix used the stale-taskID-gated condition;
   *  post-fix drops it. */
  variant: "pre-fix" | "post-fix"
}

function runLoop(opts: LoopHarnessOpts): { iterations: Array<{ taskID: string; applied: boolean }> } {
  const requestTaskID = opts.initialTaskID
  let selectedTaskID = opts.initialTaskID
  let convQueued = false
  const log: Array<{ taskID: string; applied: boolean }> = []

  let iter = 0
  while (true) {
    convQueued = false
    iter++
    if (opts.switchAtIteration?.[iter]) selectedTaskID = opts.switchAtIteration[iter]!
    const taskID = selectedTaskID
    // Simulated fetch — irrelevant to the race condition.
    // Identity guard inside the iteration body — production line 412.
    const applied = taskID === selectedTaskID
    log.push({ taskID, applied })
    if (opts.queuedAtEnd?.[iter]) convQueued = true
    const shouldContinue = opts.variant === "pre-fix" ? convQueued && requestTaskID === selectedTaskID : convQueued
    if (!shouldContinue) break
    if (iter >= 10) break // safety cap to prevent runaway loops
  }
  return { iterations: log }
}

describe("loadConversation loop condition (audit W2-V16)", () => {
  test("pre-fix: regression scenario — task switch A→B mid-fetch drops B's queued load", () => {
    // Iter 1 starts with selectedTaskID=A. Mid-iter the user
    // switches to B (simulated by `switchAtIteration[1] = "B"` —
    // the iteration body sees taskID=B but the inner identity
    // guard happens to still match because we read selectedTaskID
    // freshly inside the iter; in production the guard fires AFTER
    // the await so selectedTaskID may already be B by then). We
    // model the iteration finishing with `_convQueued = true`
    // (because a parallel loadConversation bumped it). The loop
    // condition's outer requestTaskID="A" === selectedTaskID="B"
    // check is now FALSE → loop exits, B never runs.
    const { iterations } = runLoop({
      initialTaskID: "A",
      switchAtIteration: { 1: "B" }, // user switches at start of iter 1
      queuedAtEnd: { 1: true }, // parallel call bumps queued
      variant: "pre-fix",
    })
    // Pre-fix: only one iteration ran. B never got a turn.
    expect(iterations.length).toBe(1)
  })

  test("post-fix: same scenario — B's queued load DOES re-enter the loop", () => {
    const { iterations } = runLoop({
      initialTaskID: "A",
      switchAtIteration: { 1: "B" },
      queuedAtEnd: { 1: true },
      variant: "post-fix",
    })
    // Post-fix: a second iteration runs because _convQueued is
    // true regardless of the stale requestTaskID. B's load gets
    // its turn.
    expect(iterations.length).toBeGreaterThanOrEqual(2)
    expect(iterations[1]!.taskID).toBe("B")
  })

  test("post-fix: empty queue is the natural exit (no infinite loop)", () => {
    const { iterations } = runLoop({
      initialTaskID: "A",
      queuedAtEnd: {}, // no parallel call ever fires
      variant: "post-fix",
    })
    expect(iterations.length).toBe(1)
    expect(iterations[0]!.taskID).toBe("A")
  })

  test("post-fix: same-task repeat is allowed (e.g. SSE event triggers refresh)", () => {
    // _convQueued bumped multiple times for the SAME task — the
    // loop must keep going until the queue drains.
    const { iterations } = runLoop({
      initialTaskID: "A",
      queuedAtEnd: { 1: true, 2: true, 3: false },
      variant: "post-fix",
    })
    expect(iterations.length).toBe(3)
    expect(iterations.every((it) => it.taskID === "A")).toBe(true)
  })
})
