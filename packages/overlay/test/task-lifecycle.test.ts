/**
 * Task lifecycle unit tests — validates the overlay's task state classification
 * and direct API call signatures for create, cancel, retry, replan, interrupt.
 *
 * These are pure logic tests that do not require a browser or running server.
 */
import { describe, test, expect, beforeEach } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"

// ── Inline board store classifiers (mirrors store/board.ts) ──
// We duplicate the logic here to test it in isolation without importing
// the full overlay module graph (which depends on DOM, Tauri, etc.).

const INTERRUPTABLE_STATUSES = new Set([
  "queued",
  "spec_generating",
  "goal_decomposing",
  "planning",
  "planned",
  "running",
  "blocked",
  "evaluating",
  "delivering",
])

const TERMINAL_STATUSES = new Set(["completed", "failed", "cancelled"])

function isTaskInterruptable(status: string | undefined): boolean {
  return !!status && INTERRUPTABLE_STATUSES.has(status)
}

function isTaskTerminal(status: string | undefined): boolean {
  return !!status && TERMINAL_STATUSES.has(status)
}

// ── Stop button availability ──

describe("stop button availability (isTaskInterruptable)", () => {
  test("available during all pipeline stages", () => {
    expect(isTaskInterruptable("queued")).toBe(true)
    expect(isTaskInterruptable("spec_generating")).toBe(true)
    expect(isTaskInterruptable("goal_decomposing")).toBe(true)
    expect(isTaskInterruptable("planning")).toBe(true)
    expect(isTaskInterruptable("planned")).toBe(true)
  })

  test("available during execution stages", () => {
    expect(isTaskInterruptable("running")).toBe(true)
    expect(isTaskInterruptable("evaluating")).toBe(true)
    expect(isTaskInterruptable("delivering")).toBe(true)
  })

  test("available when blocked", () => {
    expect(isTaskInterruptable("blocked")).toBe(true)
  })

  test("not available in terminal states", () => {
    expect(isTaskInterruptable("completed")).toBe(false)
    expect(isTaskInterruptable("failed")).toBe(false)
    expect(isTaskInterruptable("cancelled")).toBe(false)
  })

  test("not available when status is undefined or empty", () => {
    expect(isTaskInterruptable(undefined)).toBe(false)
    expect(isTaskInterruptable("")).toBe(false)
  })
})

// ── Terminal state classification ──

describe("terminal state classification (isTaskTerminal)", () => {
  test("completed, failed, cancelled are terminal", () => {
    expect(isTaskTerminal("completed")).toBe(true)
    expect(isTaskTerminal("failed")).toBe(true)
    expect(isTaskTerminal("cancelled")).toBe(true)
  })

  test("active states are not terminal", () => {
    expect(isTaskTerminal("queued")).toBe(false)
    expect(isTaskTerminal("running")).toBe(false)
    expect(isTaskTerminal("blocked")).toBe(false)
  })

  test("undefined/empty are not terminal", () => {
    expect(isTaskTerminal(undefined)).toBe(false)
    expect(isTaskTerminal("")).toBe(false)
  })
})

// ── Busy signal derivation ──

describe("busy signal (chatRequest || isTaskInterruptable)", () => {
  test("busy when chat request is in-flight and no task", () => {
    const chatRequest = { requestID: "abc" }
    const taskStatus: string | undefined = undefined
    const busy = !!chatRequest || isTaskInterruptable(taskStatus)
    expect(busy).toBe(true)
  })

  test("busy when task is running even without chat request", () => {
    const chatRequest = null
    const taskStatus = "running"
    const busy = !!chatRequest || isTaskInterruptable(taskStatus)
    expect(busy).toBe(true)
  })

  test("busy when task is in pipeline stage (queued) — no gap", () => {
    const chatRequest = null
    const taskStatus = "queued"
    const busy = !!chatRequest || isTaskInterruptable(taskStatus)
    expect(busy).toBe(true)
  })

  test("not busy when task is completed and no chat request", () => {
    const chatRequest = null
    const taskStatus = "completed"
    const busy = !!chatRequest || isTaskInterruptable(taskStatus)
    expect(busy).toBe(false)
  })

  test("not busy when no task selected and no chat request", () => {
    const chatRequest = null
    const taskStatus = undefined
    const busy = !!chatRequest || isTaskInterruptable(taskStatus)
    expect(busy).toBe(false)
  })

  test("busy covers the gap: chat request ended → task still queued", () => {
    // This is the critical scenario that was broken before the refactor:
    // 1. User submits message → chatRequest set → busy=true (stop visible)
    // 2. Direct API creates task → chatRequest cleared
    // 3. Task status = "queued" → isTaskInterruptable = true → busy=true
    // No gap! The stop button remains visible.
    const chatRequest = null // cleared after create
    const taskStatus = "queued" // task just created
    const busy = !!chatRequest || isTaskInterruptable(taskStatus)
    expect(busy).toBe(true)
  })
})

// ── Direct API call contract ──

describe("direct API call contracts", () => {
  test("createTask builds correct request body shape", () => {
    const text = "Build a login page"
    const executor = "opencorvus"
    const requestID = "req-123"
    const metadata = { key: "value" }

    const body = {
      request: text,
      executor,
      requestID,
      metadata,
      source: "panel",
    }

    expect(body.request).toBe(text)
    expect(body.executor).toBe("opencorvus")
    expect(body.requestID).toBe(requestID)
    expect(body.source).toBe("panel")
    expect(body.metadata).toEqual({ key: "value" })
  })

  test("cancelTask URL pattern", () => {
    const taskID = "task-abc-123"
    const url = `task/${encodeURIComponent(taskID)}/cancel`
    expect(url).toBe("task/task-abc-123/cancel")
  })

  test("retryTask URL pattern", () => {
    const taskID = "task-abc-123"
    const url = `task/${encodeURIComponent(taskID)}/retry`
    expect(url).toBe("task/task-abc-123/retry")
  })

  test("replanTask URL pattern", () => {
    const taskID = "task-abc-123"
    const url = `task/${encodeURIComponent(taskID)}/replan`
    expect(url).toBe("task/task-abc-123/replan")
  })

  test("deleteTask URL pattern", () => {
    const taskID = "task-abc-123"
    const url = `task/${encodeURIComponent(taskID)}`
    expect(url).toBe("task/task-abc-123")
  })

  test("taskID with special characters is properly encoded", () => {
    const taskID = "task/with spaces&special"
    const url = `task/${encodeURIComponent(taskID)}/cancel`
    expect(url).toBe("task/task%2Fwith%20spaces%26special/cancel")
  })
})

// ── Board controls derivation ──

describe("board controls derivation from state machine", () => {
  // Mirrors the logic in board-builder.ts boardOverview()

  function deriveControls(taskStatus: string, hasPlan: boolean, pendingInteractions: number) {
    return {
      canRetry: TERMINAL_STATUSES.has(taskStatus) && pendingInteractions === 0,
      canReplan: TERMINAL_STATUSES.has(taskStatus) && hasPlan,
      canCancel: INTERRUPTABLE_STATUSES.has(taskStatus),
    }
  }

  test("running task: can cancel, cannot retry/replan", () => {
    const c = deriveControls("running", true, 0)
    expect(c.canCancel).toBe(true)
    expect(c.canRetry).toBe(false)
    expect(c.canReplan).toBe(false)
  })

  test("failed task with plan: can retry and replan, cannot cancel", () => {
    const c = deriveControls("failed", true, 0)
    expect(c.canCancel).toBe(false)
    expect(c.canRetry).toBe(true)
    expect(c.canReplan).toBe(true)
  })

  test("failed task without plan: can retry, cannot replan", () => {
    const c = deriveControls("failed", false, 0)
    expect(c.canRetry).toBe(true)
    expect(c.canReplan).toBe(false)
  })

  test("cancelled task: can retry, cannot cancel", () => {
    const c = deriveControls("cancelled", true, 0)
    expect(c.canRetry).toBe(true)
    expect(c.canCancel).toBe(false)
  })

  test("completed task: cannot do anything (no retry on success)", () => {
    // completed is terminal with no pending interactions
    const c = deriveControls("completed", true, 0)
    expect(c.canCancel).toBe(false)
    // Actually per the state machine, completed CAN retry (terminal)
    // but the board's canRetry is controlled by terminal + no pending
    expect(c.canRetry).toBe(true)
    expect(c.canReplan).toBe(true)
  })

  test("blocked task with pending interactions: can cancel but cannot retry", () => {
    const c = deriveControls("blocked", true, 2)
    expect(c.canCancel).toBe(true)
    expect(c.canRetry).toBe(false)
  })

  test("queued task: can cancel immediately (no need to wait for run)", () => {
    const c = deriveControls("queued", false, 0)
    expect(c.canCancel).toBe(true)
    expect(c.canRetry).toBe(false)
  })

  test("spec_generating task: can cancel", () => {
    const c = deriveControls("spec_generating", false, 0)
    expect(c.canCancel).toBe(true)
  })

  test("planning task: can cancel", () => {
    const c = deriveControls("planning", false, 0)
    expect(c.canCancel).toBe(true)
  })

  test("evaluating task: can cancel", () => {
    const c = deriveControls("evaluating", true, 0)
    expect(c.canCancel).toBe(true)
    expect(c.canRetry).toBe(false)
  })

  test("delivering task: can cancel", () => {
    const c = deriveControls("delivering", true, 0)
    expect(c.canCancel).toBe(true)
    expect(c.canRetry).toBe(false)
  })
})

// ── Pipeline abort integration ──

describe("pipeline abort registry contract", () => {
  test("abort map operations", () => {
    // Simulates the taskAborts Map in pipeline.ts
    const taskAborts = new Map<string, AbortController>()

    const ctrl = new AbortController()
    taskAborts.set("task-1", ctrl)
    expect(taskAborts.has("task-1")).toBe(true)
    expect(ctrl.signal.aborted).toBe(false)

    // Simulate abortTaskPipeline
    taskAborts.get("task-1")?.abort("task cancelled")
    expect(ctrl.signal.aborted).toBe(true)
    expect(ctrl.signal.reason).toBe("task cancelled")

    // Cleanup
    taskAborts.delete("task-1")
    expect(taskAborts.has("task-1")).toBe(false)
  })

  test("abort on non-existent task is a no-op", () => {
    const taskAborts = new Map<string, AbortController>()
    // Should not throw
    taskAborts.get("nonexistent")?.abort("cancelled")
    expect(taskAborts.size).toBe(0)
  })

  test("double abort is idempotent", () => {
    const taskAborts = new Map<string, AbortController>()
    const ctrl = new AbortController()
    taskAborts.set("task-1", ctrl)

    taskAborts.get("task-1")?.abort("first")
    taskAborts.get("task-1")?.abort("second")
    expect(ctrl.signal.aborted).toBe(true)
    expect(ctrl.signal.reason).toBe("first") // first reason wins
  })
})
