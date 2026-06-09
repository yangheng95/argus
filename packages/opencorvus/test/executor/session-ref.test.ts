import { describe, expect, test } from "bun:test"
import { extractExecutorSessionRef } from "../../src/executor/session-ref"

describe("executor session refs", () => {
  test("extracts codex thread and turn ids as a native session id", () => {
    expect(
      extractExecutorSessionRef({
        type: "progress",
        phase: "init",
        meta: {
          thread_id: "thr_1",
          turn_id: "turn_1",
        },
      }),
    ).toEqual({
      nativeSessionID: "thr_1:turn_1",
      threadID: "thr_1",
      turnID: "turn_1",
    })
  })

  test("extracts provider session id from done events", () => {
    expect(
      extractExecutorSessionRef({
        type: "done",
        sessionID: "claude_session_1",
      }),
    ).toEqual({
      nativeSessionID: "claude_session_1",
    })
  })

  test("returns undefined when no provider ref is present", () => {
    expect(
      extractExecutorSessionRef({
        type: "text_delta",
        text: "hello",
      }),
    ).toBeUndefined()
  })
})
