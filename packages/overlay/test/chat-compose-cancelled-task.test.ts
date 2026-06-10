import { beforeEach, describe, expect, test } from "bun:test"
import { canComposeChat } from "../src/services/chat"
import { setAppStore } from "../src/store/app"
import { setBoardStore } from "../src/store/board"

beforeEach(() => {
  setAppStore({ connected: true })
  setBoardStore("board", null as any)
  setBoardStore("tasks", [])
  setBoardStore("selectedSource", null)
})

describe("canComposeChat task terminal states", () => {
  test("cancelled tasks disable task-level compose because retry is the continuation path", () => {
    setBoardStore("selectedSource", { kind: "task", id: "tsk_cancelled" })
    setBoardStore("tasks", [{ task: { id: "tsk_cancelled", status: "cancelled" }, pending_interactions: 0 }])

    expect(canComposeChat()).toBe(false)
  })

  test("failed and completed tasks remain composeable for operator-message reopen", () => {
    setBoardStore("selectedSource", { kind: "task", id: "tsk_failed" })
    setBoardStore("tasks", [{ task: { id: "tsk_failed", status: "failed" }, pending_interactions: 0 }])
    expect(canComposeChat()).toBe(true)

    setBoardStore("selectedSource", { kind: "task", id: "tsk_completed" })
    setBoardStore("tasks", [{ task: { id: "tsk_completed", status: "completed" }, pending_interactions: 0 }])
    expect(canComposeChat()).toBe(true)
  })
})
