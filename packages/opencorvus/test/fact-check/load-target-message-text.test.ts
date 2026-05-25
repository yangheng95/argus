/**
 * Direct unit test for loadTargetMessageText — closes the regression
 * hole codex impl review round 4 §findings-2 called out (the
 * orchestrator-tool test mocked FactCheckAgent.run with the same error
 * message instead of actually exercising the function).
 *
 * Failure semantics (rule 7 no silent fallback):
 *   - Message exists in stream but has no text/reasoning parts → "".
 *   - Stream completes without seeing requested messageID → throw
 *     "snapshot stale".
 *   - Underlying Message.stream errors → propagate (DB / session missing).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { loadTargetMessageText } from "../../src/fact-check"

async function createAssistantMessageWithText(text: string): Promise<{ sessionID: string; messageID: string }> {
  const session = await Session.create({ kind: "build" })
  const userID = Identifier.ascending("message")
  await Session.updateMessage({
    id: userID,
    sessionID: session.id,
    role: "user",
    time: { created: Date.now() },
    agent: "user",
    model: { providerID: "test", modelID: "test" },
  } as any)
  const assistantID = Identifier.ascending("message")
  await Session.updateMessage({
    id: assistantID,
    sessionID: session.id,
    role: "assistant",
    parentID: userID,
    modelID: "test",
    providerID: "test",
    agent: "build",
    path: { cwd: "/tmp/fc-load-test", root: "/tmp/fc-load-test" },
    time: { created: Date.now() },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as any)
  if (text.length > 0) {
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: assistantID,
      sessionID: session.id,
      type: "text",
      text,
    } as any)
  }
  return { sessionID: session.id, messageID: assistantID }
}

describe("loadTargetMessageText (codex impl review round 4 regression)", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("returns the concatenated text of the requested message", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const claim = "Library X uses API endpoint /v2/foo which returns JSON {a, b, c}."
        const { sessionID, messageID } = await createAssistantMessageWithText(claim)
        const text = await loadTargetMessageText(sessionID, messageID)
        expect(text).toBe(claim)
      },
    })
  })

  test("returns empty string when the message exists but has no text/reasoning parts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // createAssistantMessageWithText("") leaves the assistant message
        // in place but skips the updatePart call, so the message has zero
        // text parts. This is the legitimate "no text" case — return "".
        const { sessionID, messageID } = await createAssistantMessageWithText("")
        const text = await loadTargetMessageText(sessionID, messageID)
        expect(text).toBe("")
      },
    })
  })

  test("throws 'snapshot stale' when the requested messageID is not in the session", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { sessionID } = await createAssistantMessageWithText("Real claim.")
        const bogusID = "msg_DEFINITELY_NOT_PRESENT_xyz"
        await expect(loadTargetMessageText(sessionID, bogusID)).rejects.toThrow(/snapshot stale|not found/)
      },
    })
  })
})
