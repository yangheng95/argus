import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { Message } from "../../src/session/message"
import { Question } from "../../src/question"
import { SpecEnterTool, SpecExitTool } from "../../src/tool/spec"

function ctx(input: { sessionID: string; messageID: string }) {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID,
    agent: "build",
    abort: new AbortController().signal,
    messages: [],
    metadata: async () => {},
    ask: async () => {},
  }
}

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

async function nextQuestion() {
  for (let i = 0; i < 20; i++) {
    const req = (await Question.list())[0]
    if (req) return req
    await Bun.sleep(10)
  }
  throw new Error("expected pending question")
}

test("spec_enter creates a spec-mode user message and ensures spec directory exists", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      model: "anthropic/claude-sonnet-4-20250514",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "spec enter" })
      await seed(session.id)
      const tool = await SpecEnterTool.init()
      const run = tool.execute({}, ctx({
        sessionID: session.id,
        messageID: Identifier.ascending("message"),
      }))
      const req = await nextQuestion()
      expect(req.questions[0]?.header).toBe("Spec Mode")
      await Question.reply({
        requestID: req.id,
        answers: [["Yes"]],
      })
      const result = await run
      expect(result.title).toBe("Switching to spec mode")
      expect(result.metadata.spec).toContain(".opencorvus")

      const spec = Session.spec(session)
      const stat = await fs.stat(path.dirname(spec))
      expect(stat.isDirectory()).toBe(true)

      const msgs = await Session.messages({ sessionID: session.id })
      const last = msgs.at(-1)
      expect(last?.info.role).toBe("user")
      if (last?.info.role !== "user") throw new Error("expected user message")
      expect(last.info.agent).toBe("spec")
      expect(last.info.model).toEqual({
        providerID: "anthropic",
        modelID: "claude-sonnet-4-20250514",
      })
      const text = last.parts.find((part) => part.type === "text")
      expect(text?.type).toBe("text")
      if (text?.type !== "text") throw new Error("expected text part")
      expect(text.text).toContain("read-only specification")
    },
  })
})

test("spec_exit creates a plan-mode user message after approval", async () => {
  await using tmp = await tmpdir({
    git: true,
    config: {
      model: "anthropic/claude-sonnet-4-20250514",
    },
  })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "spec exit" })
      await seed(session.id)
      await Bun.write(Session.spec(session), "# spec\n")
      const tool = await SpecExitTool.init()
      const run = tool.execute({}, {
        ...ctx({
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
        }),
        agent: "spec",
      })
      const req = await nextQuestion()
      expect(req.questions[0]?.header).toBe("Plan Mode")
      await Question.reply({
        requestID: req.id,
        answers: [["Yes"]],
      })
      const result = await run
      expect(result.title).toBe("Switching to plan mode")

      const msgs = await Session.messages({ sessionID: session.id })
      const last = msgs.at(-1)
      expect(last?.info.role).toBe("user")
      if (last?.info.role !== "user") throw new Error("expected user message")
      expect(last.info.agent).toBe("plan")
      expect(last.info.model).toEqual({
        providerID: "anthropic",
        modelID: "claude-sonnet-4-20250514",
      })
      const text = last.parts.find((part) => part.type === "text")
      expect(text?.type).toBe("text")
      if (text?.type !== "text") throw new Error("expected text part")
      expect(text.text).toContain("approved")
    },
  })
})
