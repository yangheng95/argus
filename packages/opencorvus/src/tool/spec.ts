import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { Message } from "../session/message"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"

async function lastModel(_sessionID: string) {
  return Provider.defaultModel()
}

export const SpecExitTool = Tool.define("spec_exit", {
  description: "Use this tool when the specification is complete and you want to switch to plan mode.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const spec = Session.spec(session)
    const rel = path.relative(Instance.worktree, spec)
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Spec at ${rel} is complete. Switch to plan mode and create an implementation plan?`,
          header: "Plan Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to plan mode and start planning based on the spec" },
            { label: "No", description: "Stay in spec mode and keep refining the specification" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })
    if (answers[0]?.[0] === "No") throw new Question.RejectedError()

    const model = await lastModel(ctx.sessionID)
    const userMsg: Message.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "plan",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `The specification at ${rel} has been approved. You may now create an implementation plan based on it.`,
      synthetic: true,
      kind: "control",
      source: "system",
    } satisfies Message.TextPart)

    return {
      title: "Switching to plan mode",
      output: "User approved switching to plan mode. The next turn should create an implementation plan based on the spec.",
      metadata: { spec: rel },
    }
  },
})

export const SpecEnterTool = Tool.define("spec_enter", {
  description: "Use this tool when the task should switch into read-only spec mode to write a specification before planning.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const spec = Session.spec(session)
    const rel = path.relative(Instance.worktree, spec)
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Switch to spec mode and save the specification to ${rel}?`,
          header: "Spec Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to read-only specification mode" },
            { label: "No", description: "Stay in build mode and continue editing" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })
    if (answers[0]?.[0] === "No") throw new Question.RejectedError()

    await fs.mkdir(path.dirname(spec), { recursive: true })
    const model = await lastModel(ctx.sessionID)
    const userMsg: Message.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "spec",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `The user requested spec mode. Switch to read-only specification writing and save the spec to ${rel}.`,
      synthetic: true,
      kind: "control",
      source: "system",
    } satisfies Message.TextPart)

    return {
      title: "Switching to spec mode",
      output: `User confirmed switching to spec mode. The spec file will be at ${rel}.`,
      metadata: { spec: rel },
    }
  },
})
