import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Agent } from "../../src/agent/agent"
import { Session } from "../../src/session"
import { LLM } from "../../src/session/llm"

describe("title agent resolution", () => {
  afterEach(() => {
    mock.restore()
  })

  test("ensureTitle resolves the title agent model through resolveAgentModel without small-model fallback", async () => {
    const resolveAgentModel = mock(async () => ({
      providerID: "anthropic",
      modelID: "claude-sonnet-4-20250514",
    }))
    mock.module("@/agent/model", () => ({
      resolveAgentModel,
    }))

    const { ensureTitle } = await import("../../src/session/prompt/title")

    const setTitle = spyOn(Session, "setTitle").mockResolvedValue({
      id: "ses_title",
      parentID: null,
      title: "Generated title",
    } as any)
    spyOn(Agent, "get").mockResolvedValue({
      name: "title",
      prompt: "Generate compact titles.",
    } as any)
    const stream = spyOn(LLM, "stream").mockResolvedValue({
      text: Promise.resolve("Generated title"),
    } as any)

    await ensureTitle({
      session: {
        id: "ses_title",
        parentID: null,
        title: "New session - 2026-05-12T00:00:00.000Z",
      } as any,
      history: [
        {
          info: {
            role: "user",
            id: "msg_user",
          },
          parts: [
            {
              type: "subtask",
              prompt: "Generate a task title for this request",
            },
          ],
        } as any,
      ],
    })

    expect(resolveAgentModel).toHaveBeenCalledWith("title", { sessionID: "ses_title" })
    expect(stream).toHaveBeenCalledWith(
      expect.objectContaining({
        model: {
          providerID: "anthropic",
          modelID: "claude-sonnet-4-20250514",
        },
      }),
    )
    expect(setTitle).toHaveBeenCalledWith({
      sessionID: "ses_title",
      title: "Generated title",
    })
  })
})
