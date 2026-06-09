import { describe, expect, test } from "bun:test"
import { goalState } from "../src/utils/goal-state"

describe("goalState rollup", () => {
  test("goalStatus passed wins", () => {
    expect(goalState({ goalStatus: "passed", steps: [] })).toBe("passed")
  })
  test("goalStatus failed wins", () => {
    expect(goalState({ goalStatus: "failed", steps: [] })).toBe("failed")
  })
  test("goalStatus blocked wins", () => {
    expect(goalState({ goalStatus: "blocked", steps: [] })).toBe("blocked")
  })
  test("goalStatus running wins", () => {
    expect(goalState({ goalStatus: "running", steps: [] })).toBe("running")
  })

  test("pending goalStatus + running step → running (avoids stale pending)", () => {
    const goal = {
      goalStatus: "pending",
      steps: [{ status: "pending" }, { status: "running" }],
    }
    expect(goalState(goal)).toBe("running")
  })

  test("pending goalStatus + failed step → failed", () => {
    const goal = {
      goalStatus: "pending",
      steps: [{ status: "completed" }, { status: "failed" }],
    }
    expect(goalState(goal)).toBe("failed")
  })

  test("pending goalStatus + only pending steps → pending", () => {
    const goal = {
      goalStatus: "pending",
      steps: [{ status: "pending" }, { status: "pending" }],
    }
    expect(goalState(goal)).toBe("pending")
  })

  test("missing goalStatus + missing steps → pending (architect not done yet)", () => {
    expect(goalState({})).toBe("pending")
    expect(goalState({ steps: null })).toBe("pending")
  })

  test("case-insensitive matching on both fields", () => {
    expect(goalState({ goalStatus: "PASSED" })).toBe("passed")
    expect(goalState({ goalStatus: "pending", steps: [{ status: "RUNNING" }] })).toBe("running")
  })
})
