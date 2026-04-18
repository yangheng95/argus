import { describe, expect, test, beforeEach } from "bun:test"
import { PerRunState } from "../../src/engine/per-run-state"

function freshState() {
  // There is no reset API by design — terminal transitions own finalize.
  // Tests use unique run IDs so prior suites cannot leak into the assertions.
  return `test-run-${Math.random().toString(36).slice(2)}-${Date.now()}`
}

describe("PerRunState", () => {
  test("claimAgentNotification is idempotent (first=true, subsequent=false)", () => {
    const runID = freshState()
    expect(PerRunState.claimAgentNotification(runID)).toBe(true)
    expect(PerRunState.claimAgentNotification(runID)).toBe(false)
    expect(PerRunState.claimAgentNotification(runID)).toBe(false)
    PerRunState.finalize(runID)
  })

  test("finalize releases the claim so a re-dispatched run can notify again", () => {
    const runID = freshState()
    expect(PerRunState.claimAgentNotification(runID)).toBe(true)
    PerRunState.finalize(runID)
    // Different semantic: same runID is never reused in production, but the
    // invariant we test is that finalize really clears the set so there is
    // no ghost state.
    expect(PerRunState.claimAgentNotification(runID)).toBe(true)
    PerRunState.finalize(runID)
  })

  test("finalize is idempotent", () => {
    const runID = freshState()
    PerRunState.claimAgentNotification(runID)
    PerRunState.finalize(runID)
    PerRunState.finalize(runID) // must not throw
    PerRunState.finalize(runID) // still fine
  })

  test("serializedMerge chains concurrent calls per runID", async () => {
    const runID = freshState()
    const order: string[] = []
    const slow = async (label: string, ms: number) => {
      await new Promise((r) => setTimeout(r, ms))
      order.push(label)
    }
    // If serialization is broken, "B" would finish before "A" because B
    // sleeps less. With serialization, B waits for A.
    const a = PerRunState.serializedMerge(runID, () => slow("A", 30))
    const b = PerRunState.serializedMerge(runID, () => slow("B", 5))
    await Promise.all([a, b])
    expect(order).toEqual(["A", "B"])
    PerRunState.finalize(runID)
  })

  test("serializedMerge does not poison the chain when a call rejects", async () => {
    const runID = freshState()
    let bRan = false
    const a = PerRunState.serializedMerge(runID, async () => {
      throw new Error("boom")
    }).catch(() => void 0)
    const b = PerRunState.serializedMerge(runID, async () => {
      bRan = true
    })
    await Promise.all([a, b])
    expect(bRan).toBe(true)
    PerRunState.finalize(runID)
  })

  test("finalize releases the merge-lock map entry", async () => {
    const runID = freshState()
    await PerRunState.serializedMerge(runID, async () => { /* noop */ })
    const before = PerRunState.snapshot().mergeLocks
    PerRunState.finalize(runID)
    expect(PerRunState.snapshot().mergeLocks).toBe(before - 1)
  })

  test("snapshot exposes counts for leak detection", () => {
    const baseline = PerRunState.snapshot()
    const runID = freshState()
    PerRunState.claimAgentNotification(runID)
    expect(PerRunState.snapshot().agentNotified).toBe(baseline.agentNotified + 1)
    PerRunState.finalize(runID)
    expect(PerRunState.snapshot().agentNotified).toBe(baseline.agentNotified)
  })
})
