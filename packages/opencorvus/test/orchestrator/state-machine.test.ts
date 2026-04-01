import { describe, test, expect } from "bun:test"
import {
  canTransition,
  assertTransition,
  isTerminal,
  isActive,
  isInterruptable,
  type TaskStatus,
} from "../../src/orchestrator/state-machine"

// ── canTransition ──

describe("canTransition", () => {
  test("identity transitions are always valid", () => {
    const statuses: TaskStatus[] = [
      "queued", "spec_generating", "goal_decomposing", "planning",
      "planned", "running", "blocked", "evaluating", "delivering",
      "completed", "failed", "cancelled",
    ]
    for (const s of statuses) {
      expect(canTransition(s, s)).toBe(true)
    }
  })

  test("normal forward pipeline transitions", () => {
    expect(canTransition("queued", "spec_generating")).toBe(true)
    expect(canTransition("spec_generating", "goal_decomposing")).toBe(true)
    expect(canTransition("goal_decomposing", "planning")).toBe(true)
    expect(canTransition("planning", "planned")).toBe(true)
    expect(canTransition("planned", "running")).toBe(true)
    expect(canTransition("running", "evaluating")).toBe(true)
    expect(canTransition("evaluating", "delivering")).toBe(true)
    expect(canTransition("delivering", "completed")).toBe(true)
  })

  test("any non-terminal state can transition to cancelled", () => {
    const interruptable: TaskStatus[] = [
      "queued", "spec_generating", "goal_decomposing", "planning",
      "planned", "running", "blocked", "evaluating", "delivering",
    ]
    for (const s of interruptable) {
      expect(canTransition(s, "cancelled")).toBe(true)
    }
  })

  test("any non-terminal state can transition to failed", () => {
    const interruptable: TaskStatus[] = [
      "queued", "spec_generating", "goal_decomposing", "planning",
      "planned", "running", "blocked", "evaluating", "delivering",
    ]
    for (const s of interruptable) {
      expect(canTransition(s, "failed")).toBe(true)
    }
  })

  test("completed is a terminal state — no outgoing transitions", () => {
    const all: TaskStatus[] = [
      "queued", "spec_generating", "goal_decomposing", "planning",
      "planned", "running", "blocked", "evaluating", "delivering",
      "failed", "cancelled",
    ]
    for (const s of all) {
      expect(canTransition("completed", s)).toBe(false)
    }
  })

  test("failed can transition to queued (retry) or running (replan)", () => {
    expect(canTransition("failed", "queued")).toBe(true)
    expect(canTransition("failed", "running")).toBe(true)
    expect(canTransition("failed", "completed")).toBe(false)
    expect(canTransition("failed", "delivering")).toBe(false)
  })

  test("cancelled can transition to queued or running (retry)", () => {
    expect(canTransition("cancelled", "queued")).toBe(true)
    expect(canTransition("cancelled", "running")).toBe(true)
    expect(canTransition("cancelled", "completed")).toBe(false)
  })

  test("invalid backward transitions are rejected", () => {
    expect(canTransition("running", "queued")).toBe(false)
    expect(canTransition("evaluating", "queued")).toBe(false)
    expect(canTransition("planned", "spec_generating")).toBe(false)
  })

  test("delivering → running is valid (delivery rejection triggers fix run)", () => {
    expect(canTransition("delivering", "running")).toBe(true)
  })

  test("running → blocked and blocked → running are valid", () => {
    expect(canTransition("running", "blocked")).toBe(true)
    expect(canTransition("blocked", "running")).toBe(true)
  })

  test("evaluating → running is valid (retry after eval failure)", () => {
    expect(canTransition("evaluating", "running")).toBe(true)
  })
})

// ── assertTransition ──

describe("assertTransition", () => {
  test("valid transitions do not throw", () => {
    expect(() => assertTransition("queued", "spec_generating")).not.toThrow()
    expect(() => assertTransition("running", "cancelled")).not.toThrow()
    expect(() => assertTransition("failed", "queued")).not.toThrow()
  })

  test("invalid transitions throw with descriptive message", () => {
    expect(() => assertTransition("completed", "running")).toThrow(
      "Invalid task transition: completed → running"
    )
    expect(() => assertTransition("running", "queued")).toThrow(
      "Invalid task transition: running → queued"
    )
  })

  test("identity transition does not throw", () => {
    expect(() => assertTransition("running", "running")).not.toThrow()
    expect(() => assertTransition("completed", "completed")).not.toThrow()
  })
})

// ── isTerminal ──

describe("isTerminal", () => {
  test("completed, failed, cancelled are terminal", () => {
    expect(isTerminal("completed")).toBe(true)
    expect(isTerminal("failed")).toBe(true)
    expect(isTerminal("cancelled")).toBe(true)
  })

  test("all other states are not terminal", () => {
    const nonTerminal: TaskStatus[] = [
      "queued", "spec_generating", "goal_decomposing", "planning",
      "planned", "running", "blocked", "evaluating", "delivering",
    ]
    for (const s of nonTerminal) {
      expect(isTerminal(s)).toBe(false)
    }
  })
})

// ── isActive ──

describe("isActive", () => {
  test("pipeline and execution states are active", () => {
    const active: TaskStatus[] = [
      "queued", "spec_generating", "goal_decomposing", "planning",
      "planned", "running", "evaluating", "delivering",
    ]
    for (const s of active) {
      expect(isActive(s)).toBe(true)
    }
  })

  test("blocked is not active (it is waiting, not progressing)", () => {
    expect(isActive("blocked")).toBe(false)
  })

  test("terminal states are not active", () => {
    expect(isActive("completed")).toBe(false)
    expect(isActive("failed")).toBe(false)
    expect(isActive("cancelled")).toBe(false)
  })
})

// ── isInterruptable ──

describe("isInterruptable", () => {
  test("all non-terminal states (including blocked) are interruptable", () => {
    const interruptable: TaskStatus[] = [
      "queued", "spec_generating", "goal_decomposing", "planning",
      "planned", "running", "blocked", "evaluating", "delivering",
    ]
    for (const s of interruptable) {
      expect(isInterruptable(s)).toBe(true)
    }
  })

  test("terminal states are not interruptable", () => {
    expect(isInterruptable("completed")).toBe(false)
    expect(isInterruptable("failed")).toBe(false)
    expect(isInterruptable("cancelled")).toBe(false)
  })
})

// ── Cancel-from-any-state scenario ──

describe("cancel from any active state", () => {
  test("every interruptable state can transition to cancelled", () => {
    const interruptable: TaskStatus[] = [
      "queued", "spec_generating", "goal_decomposing", "planning",
      "planned", "running", "blocked", "evaluating", "delivering",
    ]
    for (const s of interruptable) {
      expect(isInterruptable(s)).toBe(true)
      expect(canTransition(s, "cancelled")).toBe(true)
      expect(() => assertTransition(s, "cancelled")).not.toThrow()
    }
  })
})

// ── Resume/retry scenarios ──

describe("resume and retry transitions", () => {
  test("failed task can be retried (failed → queued)", () => {
    expect(canTransition("failed", "queued")).toBe(true)
  })

  test("failed task can be replanned (failed → running)", () => {
    expect(canTransition("failed", "running")).toBe(true)
  })

  test("cancelled task can be retried (cancelled → queued)", () => {
    expect(canTransition("cancelled", "queued")).toBe(true)
  })

  test("completed task cannot be retried or resumed", () => {
    expect(canTransition("completed", "queued")).toBe(false)
    expect(canTransition("completed", "running")).toBe(false)
  })

  test("running task cannot go back to queued", () => {
    expect(canTransition("running", "queued")).toBe(false)
  })
})
