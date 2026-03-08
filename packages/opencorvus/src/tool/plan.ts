import fs from "fs/promises"
import path from "path"
import z from "zod"
import { Tool } from "./tool"
import { Question } from "../question"
import { Session } from "../session"
import { MessageV2 } from "../session/message"
import { Identifier } from "../id/id"
import { Provider } from "../provider/provider"
import { Instance } from "../project/instance"

async function lastModel(sessionID: string) {
  const msgs = await Session.messages({ sessionID, limit: 50 })
  const user = msgs.findLast((msg) => msg.info.role === "user")?.info
  if (user?.role === "user") return user.model
  return Provider.defaultModel()
}

export const PlanExitTool = Tool.define("plan_exit", {
  description: "Use this tool when planning is complete and you want to switch back to build mode.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = Session.plan(session)
    const rel = path.relative(Instance.worktree, plan)
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Plan at ${rel} is complete. Switch to build mode and start implementing it?`,
          header: "Build Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to build mode and execute the plan" },
            { label: "No", description: "Stay in plan mode and keep refining the plan" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })
    if (answers[0]?.[0] === "No") throw new Question.RejectedError()

    const model = await lastModel(ctx.sessionID)
    const userMsg: MessageV2.User = {
      id: Identifier.ascending("message"),
      sessionID: ctx.sessionID,
      role: "user",
      time: { created: Date.now() },
      agent: "build",
      model,
    }
    await Session.updateMessage(userMsg)
    await Session.updatePart({
      id: Identifier.ascending("part"),
      messageID: userMsg.id,
      sessionID: ctx.sessionID,
      type: "text",
      text: `The implementation plan at ${rel} has been approved. You may now edit files and execute it.`,
      synthetic: true,
      kind: "control",
      source: "system",
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to build mode",
      output: "User approved switching to build mode. The next turn should implement the saved plan.",
      metadata: { plan: rel },
    }
  },
})

export const PlanEnterTool = Tool.define("plan_enter", {
  description: "Use this tool when the task should switch into read-only plan mode before implementation.",
  parameters: z.object({}),
  async execute(_params, ctx) {
    const session = await Session.get(ctx.sessionID)
    const plan = Session.plan(session)
    const rel = path.relative(Instance.worktree, plan)
    const answers = await Question.ask({
      sessionID: ctx.sessionID,
      questions: [
        {
          question: `Switch to plan mode and save the plan to ${rel}?`,
          header: "Plan Mode",
          custom: false,
          options: [
            { label: "Yes", description: "Switch to read-only planning mode" },
            { label: "No", description: "Stay in build mode and continue editing" },
          ],
        },
      ],
      tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
    })
    if (answers[0]?.[0] === "No") throw new Question.RejectedError()

    await fs.mkdir(path.dirname(plan), { recursive: true })
    const model = await lastModel(ctx.sessionID)
    const userMsg: MessageV2.User = {
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
      text: `The user requested plan mode. Switch to read-only planning and save the plan to ${rel}.`,
      synthetic: true,
      kind: "control",
      source: "system",
    } satisfies MessageV2.TextPart)

    return {
      title: "Switching to plan mode",
      output: `User confirmed switching to plan mode. The plan file will be at ${rel}.`,
      metadata: { plan: rel },
    }
  },
})
