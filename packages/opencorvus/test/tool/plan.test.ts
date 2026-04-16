import { expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"
import { Message } from "../../src/session/message"
import { Question } from "../../src/question"
import { PlanEnterTool, PlanExitTool } from "../../src/tool/plan"

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

test("plan_enter creates a plan-mode user message and ensures plan directory exists", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "plan enter" })
      await seed(session.id)
      const tool = await PlanEnterTool.init()
      const run = tool.execute({}, ctx({
        sessionID: session.id,
        messageID: Identifier.ascending("message"),
      }))
      const req = await nextQuestion()
      expect(req.questions[0]?.header).toBe("Plan Mode")
      await Question.reply({
        requestID: req.id,
        answers: [["Yes"]],
      })
      const result = await run
      expect(result.title).toBe("Switching to plan mode")
      expect(result.metadata.plan).toContain(".opencorvus")

      const plan = Session.plan(session)
      const stat = await fs.stat(path.dirname(plan))
      expect(stat.isDirectory()).toBe(true)

      const msgs = await Session.messages({ sessionID: session.id })
      const last = msgs.at(-1)
      expect(last?.info.role).toBe("user")
      if (last?.info.role !== "user") throw new Error("expected user message")
      expect(last.info.agent).toBe("plan")
      const text = last.parts.find((part) => part.type === "text")
      expect(text?.type).toBe("text")
      if (text?.type !== "text") throw new Error("expected text part")
      expect(text.text).toContain("read-only planning")
    },
  })
})

test("plan_exit creates a build-mode user message after approval", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const session = await Session.create({ kind: "assistant", title: "plan exit" })
      await seed(session.id)
      await Bun.write(Session.plan(session), "# plan\n")
      const tool = await PlanExitTool.init()
      const run = tool.execute({}, {
        ...ctx({
          sessionID: session.id,
          messageID: Identifier.ascending("message"),
        }),
        agent: "plan",
      })
      const req = await nextQuestion()
      expect(req.questions[0]?.header).toBe("Build Mode")
      await Question.reply({
        requestID: req.id,
        answers: [["Yes"]],
      })
      const result = await run
      expect(result.title).toBe("Switching to build mode")

      const msgs = await Session.messages({ sessionID: session.id })
      const last = msgs.at(-1)
      expect(last?.info.role).toBe("user")
      if (last?.info.role !== "user") throw new Error("expected user message")
      expect(last.info.agent).toBe("build")
      const text = last.parts.find((part) => part.type === "text")
      expect(text?.type).toBe("text")
      if (text?.type !== "text") throw new Error("expected text part")
      expect(text.text).toContain("approved")
    },
  })
})
