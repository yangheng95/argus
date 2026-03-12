import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { type InteractionRow } from "../../src/orchestrator/store"
import { autoRejectInteraction } from "../../src/orchestrator/interaction-actions"
import { PermissionNext } from "../../src/permission/next"
import { Question } from "../../src/question"

function row(input: Partial<InteractionRow>): InteractionRow {
  const now = Date.now()
  return {
    id: "interaction",
    task_id: "task",
    run_id: "run",
    session_id: null,
    external_id: "request",
    request_type: "question",
    status: "pending",
    title: "question",
    body: "question",
    payload: {},
    response: null,
    time_created: now,
    time_updated: now,
    time_resolved: null,
    ...input,
  }
}

describe("orchestrator.interaction actions", () => {
  afterEach(() => {
    mock.restore()
  })

  test("autoRejectInteraction rejects ordinary questions through Question.reject", async () => {
    const reject = spyOn(Question, "reject").mockResolvedValue()

    await autoRejectInteraction(row({
      external_id: "question_1",
      request_type: "question",
    }), "Timed out waiting for operator response")

    expect(reject).toHaveBeenCalledWith("question_1")
  })

  test("autoRejectInteraction rejects ordinary permissions through PermissionNext.reply", async () => {
    const reply = spyOn(PermissionNext, "reply").mockResolvedValue()

    await autoRejectInteraction(row({
      external_id: "permission_1",
      request_type: "permission",
    }), "Timed out waiting for operator response")

    expect(reply).toHaveBeenCalledWith({
      requestID: "permission_1",
      reply: "reject",
      message: "Timed out waiting for operator response",
    })
  })
})
