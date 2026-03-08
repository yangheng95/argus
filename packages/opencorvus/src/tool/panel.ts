import z from "zod"
import { Tool } from "./tool"
import { OrchestratorService } from "@/orchestrator/service"
import { Session } from "@/session"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import { LLMTrace } from "@/session/llm-trace"
import { buildSessionTraceHtml } from "@/cli/cmd/export-html"

const localOnly = (ctx: Tool.Context) => ctx.extra?.surface === "panel"
const CheckSelection = z.record(z.string(), z.boolean())

export const PanelTool = Tool.define("panel", {
  description: "Operate the OpenCorvus control plane: inspect plans/boards, manage task state, reply to interactions, and manage sessions.",
  parameters: z.discriminatedUnion("action", [
    z.object({
      action: z.literal("view_plan"),
      taskID: z.string(),
    }),
    z.object({
      action: z.literal("view_board"),
      taskID: z.string().optional(),
    }),
    z.object({
      action: z.literal("view_tasks"),
    }),
    z.object({
      action: z.literal("create_task"),
      request: z.string(),
      request_id: z.string().optional(),
      executor: z.enum(["opencode", "codex", "claude-code"]).optional(),
      channel: z.string().optional(),
      thread: z.string().optional(),
      platform: z.enum(["slack", "telegram", "discord"]).optional(),
      metadata: z.record(z.string(), z.any()).optional(),
      source: z.string().optional(),
      allow_create: z.boolean().optional(),
    }),
    z.object({
      action: z.literal("send_task_message"),
      taskID: z.string(),
      text: z.string(),
      source: z.string().optional(),
      user_id: z.string().optional(),
    }),
    z.object({
      action: z.literal("reply_interaction"),
      interactionID: z.string(),
      reply: z.enum(["once", "always"]).optional(),
      message: z.string().optional(),
    }),
    z.object({
      action: z.literal("reject_interaction"),
      interactionID: z.string(),
      message: z.string().optional(),
    }),
    z.object({
      action: z.literal("retry_task"),
      taskID: z.string(),
    }),
    z.object({
      action: z.literal("replan_task"),
      taskID: z.string(),
    }),
    z.object({
      action: z.literal("cancel_task"),
      taskID: z.string(),
    }),
    z.object({
      action: z.literal("update_checks"),
      taskID: z.string(),
      selection: CheckSelection.optional(),
    }),
    z.object({
      action: z.literal("set_executor"),
      executor: z.enum(["opencode", "codex", "claude-code"]),
    }),
    z.object({
      action: z.literal("select_task"),
      taskID: z.string(),
    }),
    z.object({
      action: z.literal("select_session"),
      sessionID: z.string(),
    }),
    z.object({
      action: z.literal("create_session"),
    }),
    z.object({
      action: z.literal("fork_session"),
      sessionID: z.string(),
    }),
    z.object({
      action: z.literal("delete_session"),
      sessionID: z.string(),
    }),
    z.object({
      action: z.literal("export_session_html"),
      sessionID: z.string(),
    }),
    z.object({
      action: z.literal("update_goal"),
      goalID: z.string(),
      description: z.string(),
      criteria: z.string(),
    }),
    z.object({
      action: z.literal("delete_goal"),
      goalID: z.string(),
    }),
  ]),
  async execute(params, ctx) {
    switch (params.action) {
      case "view_plan": {
        const board = await OrchestratorService.getBoard(params.taskID)
        const goals = board.lanes.find((item) => item.id === "goals")?.cards ?? []
        return {
          title: "Plan",
          output: [
            `Task: ${board.task.title}`,
            board.plan ? `Plan: ${board.plan.summary}` : "Plan unavailable",
            goals.length > 0 ? "Goals:" : undefined,
            ...goals.map((goal, index) => `${index + 1}. ${goal.title}${goal.detail ? ` — ${goal.detail}` : ""} [${goal.status || "pending"}]`),
          ].filter(Boolean).join("\n"),
          metadata: {},
        }
      }
      case "view_board": {
        if (!params.taskID) {
          const project = await OrchestratorService.getProjectBoard({ limit: 8 })
          return {
            title: "Tasks",
            output: project.tasks.length === 0
              ? "No tasks found."
              : project.tasks.map((item, index) => `${index + 1}. ${item.task.title} [${item.task.status}] (${item.task.id})`).join("\n"),
            metadata: {},
          }
        }
        const board = await OrchestratorService.getBoard(params.taskID)
        return {
          title: "Board",
          output: [
            `Task: ${board.task.title}`,
            `Status: ${board.task.status}`,
            board.overview?.headline,
            board.overview?.summary,
            board.delivery ? `Delivery: ${board.delivery.summary}` : undefined,
            board.evaluation ? `Evaluation: ${board.evaluation.verdict} — ${board.evaluation.summary}` : undefined,
          ].filter(Boolean).join("\n"),
          metadata: {},
        }
      }
      case "view_tasks": {
        const board = await OrchestratorService.getProjectBoard({ limit: 8 })
        return {
          title: "Tasks",
          output: board.tasks.length === 0
            ? "No tasks found."
            : board.tasks.map((item, index) => `${index + 1}. ${item.task.title} [${item.task.status}] (${item.task.id})`).join("\n"),
          metadata: {},
        }
      }
      case "create_task": {
        if (params.allow_create === false) {
          return {
            title: "Ignored",
            output: "No task is bound to this thread.",
            metadata: {},
          }
        }
        const taskID = await OrchestratorService.createTask({
          requestID: params.request_id,
          request: params.request,
          executor: params.executor,
          source: params.source ?? ctx.extra?.source ?? (params.platform ? `channel:${params.platform}` : "panel"),
          ...(params.platform && params.channel && params.thread
            ? {
                channelBinding: {
                  platform: params.platform,
                  channel: params.channel,
                  thread: params.thread,
                  payload: params.metadata ?? {},
                },
              }
            : {}),
          metadata: params.metadata,
        })
        return {
          title: "Task created",
          output: JSON.stringify({ kind: "created", task_id: taskID, message: `Task accepted: \`${taskID}\`` }),
          metadata: {},
        }
      }
      case "send_task_message": {
        const result = await OrchestratorService.handleTaskMessage(params.taskID, {
          text: params.text,
          source: params.source ?? ctx.extra?.source ?? "panel",
          user_id: params.user_id,
        })
        return {
          title: "Task message",
          output: JSON.stringify({ kind: "message", task_id: params.taskID, message: result.message }),
          metadata: {},
        }
      }
      case "reply_interaction": {
        try {
          const result = await OrchestratorService.replyInteraction(
            params.interactionID,
            params.reply ? { reply: params.reply } : params.message ? { message: params.message } : { reply: "once" },
          )
          return {
            title: "Interaction replied",
            output: JSON.stringify({ kind: "interaction", task_id: result.taskID, interaction_id: result.id, message: "Interaction answered." }),
            metadata: {},
          }
        } catch (error) {
          return {
            title: "Reply failed",
            output: JSON.stringify({ kind: "panel_response", message: `Failed to reply: ${error instanceof Error ? error.message : String(error)}` }),
            metadata: {},
          }
        }
      }
      case "reject_interaction": {
        const result = await OrchestratorService.rejectInteraction(params.interactionID, { message: params.message })
        return {
          title: "Interaction rejected",
          output: JSON.stringify({ kind: "interaction", task_id: result.taskID, interaction_id: result.id, message: "Interaction rejected." }),
          metadata: {},
        }
      }
      case "retry_task":
        await OrchestratorService.retryTask(params.taskID)
        return { title: "Retry queued", output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Retry queued." }), metadata: {} }
      case "replan_task":
        await OrchestratorService.replanTask(params.taskID)
        return { title: "Replan queued", output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Replan queued." }), metadata: {} }
      case "cancel_task":
        await OrchestratorService.cancelTask(params.taskID)
        return { title: "Task cancelled", output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Task cancelled." }), metadata: {} }
      case "update_checks":
        await OrchestratorService.selectTaskChecks(params.taskID, params.selection ?? {})
        return { title: "Checks updated", output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Task checks updated." }), metadata: {} }
      case "set_executor":
        if (!localOnly(ctx)) throw new Error("Executor selection is only available in the desktop panel.")
        return {
          title: "Executor selected",
          output: JSON.stringify({
            kind: "panel_response",
            message: `Executor set to ${params.executor}.`,
            local_action: { type: "set_executor", executor: params.executor },
          }),
          metadata: {},
        }
      case "select_task":
        if (!localOnly(ctx)) throw new Error("Task selection is only available in the desktop panel.")
        return {
          title: "Task selected",
          output: JSON.stringify({
            kind: "panel_response",
            task_id: params.taskID,
            message: `Selected task ${params.taskID}.`,
            local_action: { type: "select_task", taskID: params.taskID },
          }),
          metadata: {},
        }
      case "select_session":
        if (!localOnly(ctx)) throw new Error("Session selection is only available in the desktop panel.")
        return {
          title: "Session selected",
          output: JSON.stringify({
            kind: "panel_response",
            session_id: params.sessionID,
            message: `Selected session ${params.sessionID}.`,
            local_action: { type: "select_session", sessionID: params.sessionID },
          }),
          metadata: {},
        }
      case "create_session": {
        const session = await Session.create({})
        return {
          title: "Session created",
          output: JSON.stringify({
            kind: "panel_response",
            session_id: session.id,
            message: `Session created: ${session.id}`,
            ...(localOnly(ctx)
              ? {
                  local_action: {
                    type: "select_session",
                    sessionID: session.id,
                  },
                }
              : {}),
          }),
          metadata: {},
        }
      }
      case "fork_session": {
        const session = await Session.fork({ sessionID: params.sessionID })
        return {
          title: "Session forked",
          output: JSON.stringify({
            kind: "panel_response",
            session_id: session.id,
            message: `Session forked: ${session.id}`,
            ...(localOnly(ctx)
              ? {
                  local_action: {
                    type: "select_session",
                    sessionID: session.id,
                  },
                }
              : {}),
          }),
          metadata: {},
        }
      }
      case "delete_session": {
        await OrchestratorService.deleteSession(params.sessionID, { deleteTasks: true })
        return {
          title: "Session deleted",
          output: JSON.stringify({
            kind: "panel_response",
            session_id: params.sessionID,
            message: `Session deleted: ${params.sessionID}`,
            ...(localOnly(ctx)
              ? {
                  local_action: {
                    type: "invalidate_session",
                    sessionID: params.sessionID,
                  },
                }
              : {}),
          }),
          metadata: {},
        }
      }
      case "export_session_html": {
        const file = await exportSessionHtml(params.sessionID)
        return {
          title: "Session exported",
          output: JSON.stringify({
            kind: "panel_response",
            session_id: params.sessionID,
            message: `Session HTML exported to ${file}`,
          }),
          metadata: {},
        }
      }
      case "update_goal":
        await OrchestratorService.updateGoal(params.goalID, {
          description: params.description,
          criteria: params.criteria,
        })
        return { title: "Goal updated", output: JSON.stringify({ kind: "panel_response", message: "Goal updated." }), metadata: {} }
      case "delete_goal":
        await OrchestratorService.deleteGoal(params.goalID)
        return { title: "Goal deleted", output: JSON.stringify({ kind: "panel_response", message: "Goal deleted." }), metadata: {} }
    }
  },
})

async function exportSessionHtml(sessionID: string) {
  const session = await Session.get(sessionID)
  const messages = await Session.messages({ sessionID })
  const calls = await LLMTrace.read(sessionID)
  const report = await buildSessionTraceHtml({
    session: {
      id: session.id,
      title: session.title,
      time: session.time,
    },
    messages,
    calls,
  })
  const out = `${Global.Path.data}/panel-${sessionID}.html`
  await Filesystem.write(out, report)
  return out
}
