import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { Message } from "../../src/session/message"
import { SessionWake } from "../../src/session/wake"
import { SessionPrompt } from "../../src/session/prompt"
import { Agent } from "../../src/agent/agent"

async function seed(sessionID: string) {
  const msg: Message.User = {
    id: Identifier.ascending("message"),
    sessionID,
    role: "user",
    time: { created: Date.now() },
    agent: "build",
    model: { providerID: "openai", modelID: "gpt-5.2" },
  }
  await Session.updateMessage(msg)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID: msg.id,
    sessionID,
    type: "text",
    text: "seed",
  } satisfies Message.TextPart)
}

afterEach(() => {
  mock.restore()
})

test("wake injects the configured default model instead of inheriting the last session model", async () => {
  await using tmp = await tmpdir({
    config: {
      model: "anthropic/claude-sonnet-4-20250514",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const loop = spyOn(SessionPrompt, "loop").mockResolvedValue(undefined as never)
      const session = await Session.create({ kind: "assistant", title: "wake" })
      await seed(session.id)

      await SessionWake.wake({
        sessionID: session.id,
        prompt: "resume scheduled work",
      })

      expect(loop).toHaveBeenCalled()
      const defaultAgent = await Agent.defaultAgent()
      const msgs = await Session.messages({ sessionID: session.id })
      const last = msgs.at(-1)
      expect(last?.info.role).toBe("user")
      if (last?.info.role !== "user") throw new Error("expected user message")
      expect(last.info.model).toEqual({
        providerID: "anthropic",
        modelID: "claude-sonnet-4-20250514",
      })
      expect(last.info.agent).toBe(defaultAgent)
      const text = last.parts.find((part) => part.type === "text")
      expect(text?.type).toBe("text")
      if (text?.type !== "text") throw new Error("expected text part")
      expect(text.text).toBe("resume scheduled work")
    },
  })
})
