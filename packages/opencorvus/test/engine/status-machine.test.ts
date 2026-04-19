import { describe, expect, test } from "bun:test"
import { canGoalRunTransition } from "../../src/engine/goal-run-state-machine"
import { canRunTransition } from "../../src/engine/run-state-machine"

describe("run state machine", () => {
  test("allows only live-path and terminal transitions", () => {
    expect(canRunTransition("queued", "running")).toBe(true)
    expect(canRunTransition("queued", "accepted")).toBe(true)
    expect(canRunTransition("accepted", "blocked")).toBe(true)
    expect(canRunTransition("blocked", "accepted")).toBe(true)
    expect(canRunTransition("running", "completed")).toBe(true)
    expect(canRunTransition("running", "failed")).toBe(true)

    expect(canRunTransition("completed", "running")).toBe(false)
    expect(canRunTransition("failed", "running")).toBe(false)
    expect(canRunTransition("aborted", "running")).toBe(false)
    expect(canRunTransition("queued", "completed")).toBe(false)
  })
})

describe("goal_run state machine", () => {
  test("allows execution lifecycle and administrative abort", () => {
    expect(canGoalRunTransition("queued", "accepted")).toBe(true)
    expect(canGoalRunTransition("accepted", "running")).toBe(true)
    expect(canGoalRunTransition("running", "completed")).toBe(true)
    expect(canGoalRunTransition("running", "failed")).toBe(true)
    expect(canGoalRunTransition("blocked", "running")).toBe(true)

    // `completed` is fully terminal: no outgoing transitions. Retry under
    // a modified contract must create a NEW goal_run and supersede the
    // old one via metadata (engine/persist.ts supersedeGoalRun), never
    // mutate the success record into aborted.
    expect(canGoalRunTransition("completed", "aborted")).toBe(false)
    expect(canGoalRunTransition("completed", "running")).toBe(false)
    expect(canGoalRunTransition("failed", "running")).toBe(false)
    expect(canGoalRunTransition("aborted", "running")).toBe(false)
    expect(canGoalRunTransition("queued", "completed")).toBe(false)
  })
})
