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

  test("snapshot exposes counts for leak detection", () => {
    const baseline = PerRunState.snapshot()
    const runID = freshState()
    PerRunState.claimAgentNotification(runID)
    expect(PerRunState.snapshot().agentNotified).toBe(baseline.agentNotified + 1)
    PerRunState.finalize(runID)
    expect(PerRunState.snapshot().agentNotified).toBe(baseline.agentNotified)
  })
})
