import { describe, test, expect } from "bun:test"
import {
  canTransition,
  assertTransition,
  isTerminal,
  isActive,
  isInterruptable,
  type TaskStatus,
} from "../../src/orchestrator/state-machine"

// 5-state model: queued | active | completed | failed | cancelled
// Agent-driven: "active" is the single working state — the agent decides progress.

const ALL_STATES: TaskStatus[] = ["queued", "active", "completed", "failed", "cancelled"]

// ── canTransition ──

describe("canTransition", () => {
  test("identity transitions are always valid", () => {
    for (const s of ALL_STATES) {
      expect(canTransition(s, s)).toBe(true)
    }
  })

  // -- queued --

  test("queued → active (task starts)", () => {
    expect(canTransition("queued", "active")).toBe(true)
  })

  test("queued → cancelled / failed (interrupted before start)", () => {
    expect(canTransition("queued", "cancelled")).toBe(true)
    expect(canTransition("queued", "failed")).toBe(true)
  })

  test("queued cannot jump to completed", () => {
    expect(canTransition("queued", "completed")).toBe(false)
  })

  // -- active --

  test("active → completed / failed / cancelled (terminal outcomes)", () => {
    expect(canTransition("active", "completed")).toBe(true)
    expect(canTransition("active", "failed")).toBe(true)
    expect(canTransition("active", "cancelled")).toBe(true)
  })

  test("active → queued (re-queued by loop)", () => {
    expect(canTransition("active", "queued")).toBe(true)
  })

  // -- completed (terminal, no outgoing) --

  test("completed has no outgoing transitions", () => {
    for (const s of ALL_STATES) {
      if (s === "completed") continue
      expect(canTransition("completed", s)).toBe(false)
    }
  })

  // -- failed (recovery) --

  test("failed → queued (retry) and failed → active (direct restart)", () => {
    expect(canTransition("failed", "queued")).toBe(true)
    expect(canTransition("failed", "active")).toBe(true)
  })

  test("failed cannot reach completed or cancelled directly", () => {
    expect(canTransition("failed", "completed")).toBe(false)
    expect(canTransition("failed", "cancelled")).toBe(false)
  })

  // -- cancelled (recovery) --

  test("cancelled → queued (retry) and cancelled → active (direct restart)", () => {
    expect(canTransition("cancelled", "queued")).toBe(true)
    expect(canTransition("cancelled", "active")).toBe(true)
  })

  test("cancelled cannot reach completed or failed directly", () => {
    expect(canTransition("cancelled", "completed")).toBe(false)
    expect(canTransition("cancelled", "failed")).toBe(false)
  })

  // -- exhaustive invalid pairs --

  test("all invalid pairs are rejected", () => {
    const valid: Record<string, string[]> = {
      queued:    ["active", "cancelled", "failed"],
      active:    ["completed", "failed", "cancelled", "queued"],
      completed: [],
      failed:    ["queued", "active"],
      cancelled: ["queued", "active"],
    }
    for (const from of ALL_STATES) {
      for (const to of ALL_STATES) {
        if (from === to) continue
        const expected = valid[from].includes(to)
        expect(canTransition(from, to)).toBe(expected)
      }
    }
  })
})

// ── assertTransition ──

describe("assertTransition", () => {
  test("valid transitions do not throw", () => {
    expect(() => assertTransition("queued", "active")).not.toThrow()
    expect(() => assertTransition("active", "cancelled")).not.toThrow()
    expect(() => assertTransition("failed", "queued")).not.toThrow()
    expect(() => assertTransition("cancelled", "active")).not.toThrow()
  })

  test("invalid transitions throw with descriptive message", () => {
    expect(() => assertTransition("completed", "active")).toThrow(
      "Invalid task transition: completed → active"
    )
    expect(() => assertTransition("cancelled", "completed")).toThrow(
      "Invalid task transition: cancelled → completed"
    )
  })

  test("identity transitions do not throw", () => {
    expect(() => assertTransition("active", "active")).not.toThrow()
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

  test("queued and active are not terminal", () => {
    expect(isTerminal("queued")).toBe(false)
    expect(isTerminal("active")).toBe(false)
  })
})

// ── isActive ──

describe("isActive", () => {
  test("queued and active are active states", () => {
    expect(isActive("queued")).toBe(true)
    expect(isActive("active")).toBe(true)
  })

  test("terminal states are not active", () => {
    expect(isActive("completed")).toBe(false)
    expect(isActive("failed")).toBe(false)
    expect(isActive("cancelled")).toBe(false)
  })
})

// ── isInterruptable ──

describe("isInterruptable", () => {
  test("queued and active are interruptable", () => {
    expect(isInterruptable("queued")).toBe(true)
    expect(isInterruptable("active")).toBe(true)
  })

  test("terminal states are not interruptable", () => {
    expect(isInterruptable("completed")).toBe(false)
    expect(isInterruptable("failed")).toBe(false)
    expect(isInterruptable("cancelled")).toBe(false)
  })
})

// ── Cancel from any active state ──

describe("cancel from any active state", () => {
  test("every interruptable state can transition to cancelled", () => {
    const interruptable: TaskStatus[] = ["queued", "active"]
    for (const s of interruptable) {
      expect(isInterruptable(s)).toBe(true)
      expect(canTransition(s, "cancelled")).toBe(true)
      expect(() => assertTransition(s, "cancelled")).not.toThrow()
    }
  })
})

// ── Resume/retry scenarios ──

describe("resume and retry transitions", () => {
  test("failed task can be retried or directly restarted", () => {
    expect(canTransition("failed", "queued")).toBe(true)
    expect(canTransition("failed", "active")).toBe(true)
  })

  test("cancelled task can be retried or directly restarted", () => {
    expect(canTransition("cancelled", "queued")).toBe(true)
    expect(canTransition("cancelled", "active")).toBe(true)
  })

  test("completed task cannot be retried or resumed", () => {
    expect(canTransition("completed", "queued")).toBe(false)
    expect(canTransition("completed", "active")).toBe(false)
  })

  test("active task can be re-queued (loop handoff)", () => {
    expect(canTransition("active", "queued")).toBe(true)
  })
})
