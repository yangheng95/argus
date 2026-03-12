import { Tool } from "./tool"
import { OrchestratorService } from "@/orchestrator/service"
import { Session } from "@/session"
import { Filesystem } from "@/util/filesystem"
import { Global } from "@/global"
import { LLMTrace } from "@/session/llm-trace"
import { buildSessionTraceHtml } from "@/cli/cmd/export-html"
import { captureWindowScreenshot } from "@/gui/screenshot"
import { PanelActionSchema } from "@/panel/capability"

const localOnly = (ctx: Tool.Context) => ctx.extra?.surface === "panel"

export const PanelTool = Tool.define("panel", {
  description: "Operate the OpenCorvus control plane: inspect specs, plans, and task boards, manage task state, reply to interactions, and manage sessions.",
  parameters: PanelActionSchema,
  async execute(params, ctx) {
    switch (params.action) {
      case "view_spec": {
        const board = await OrchestratorService.getBoard(params.taskID)
        return {
          title: "Spec",
          output: [
            `Task: ${board.task.title}`,
            board.spec ? `Spec v${board.spec.version}: ${board.spec.summary}` : "Spec unavailable",
            board.spec?.scope ? `Scope: ${board.spec.scope}` : undefined,
            board.spec?.outOfScope ? `Out of scope: ${board.spec.outOfScope}` : undefined,
            board.specItems.length > 0 ? "Acceptance items:" : undefined,
            ...board.specItems.slice(0, 12).map((item, index) =>
              `${index + 1}. ${item.title}${item.description ? ` - ${item.description}` : ""} [${item.status}]${item.checkSelector?.length ? ` {${item.checkSelector.join(", ")}}` : ""}`),
            board.specItems.length > 12 ? `... ${board.specItems.length - 12} more items` : undefined,
          ].filter(Boolean).join("\n"),
          metadata: {},
        }
      }
      case "view_plan": {
        const board = await OrchestratorService.getBoard(params.taskID)
        return {
          title: "Plan",
          output: [
            `Task: ${board.task.title}`,
            board.plan ? `Plan v${board.plan.version}: ${board.plan.summary}` : "Plan unavailable",
            board.plan && board.spec && board.plan.specSnapshotID !== board.spec.id
              ? `Plan spec: ${board.plan.specSnapshotID} (active spec: ${board.spec.id})`
              : undefined,
            board.milestones.length > 0 ? "Milestones:" : undefined,
            ...board.milestones.slice(0, 8).map((item, index) => `${index + 1}. ${item.title}${item.description ? ` - ${item.description}` : ""} [${item.status}]`),
            board.planNodes.length > 0 ? "Plan nodes:" : undefined,
            ...board.planNodes.slice(0, 12).map((item, index) => `${index + 1}. ${item.title}${item.brief ? ` - ${item.brief}` : ""} [${item.kind}]`),
            board.planNodes.length > 12 ? `... ${board.planNodes.length - 12} more nodes` : undefined,
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
            board.spec ? `Spec: ${board.spec.summary}` : undefined,
            board.plan ? `Plan: ${board.plan.summary}` : undefined,
            `Goals: ${board.goals.length}, acceptance items: ${board.specItems.length}`,
            pendingCount(board) > 0 ? `Pending blockers: ${pendingCount(board)}` : undefined,
            board.evaluation ? `Evaluation: ${board.evaluation.verdict} - ${board.evaluation.summary}` : undefined,
            board.delivery ? `Delivery: ${board.delivery.summary}` : undefined,
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
          requestID: params.request_id ?? ctx.extra?.requestID,
          request: params.request,
          executor: params.executor,
          checks: params.checks,
          routing: params.routing,
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
        if (params.checks) {
          await OrchestratorService.updateTaskChecks(params.taskID, { checks: params.checks })
        } else {
          await OrchestratorService.selectTaskChecks(params.taskID, params.selection ?? {})
        }
        return { title: "Checks updated", output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Task checks updated. spec_check remains required." }), metadata: {} }
      case "capture_overlay_screenshot":
        try {
          const shot = await captureWindowScreenshot(params.match)
          return {
            title: "Screenshot captured",
            output: JSON.stringify({
              kind: "panel_response",
              message: `Captured OpenCorvus GUI: ${shot.title} (${shot.width}x${shot.height}).`,
              attachments: [{
                mime: shot.mime,
                url: shot.url,
                filename: shot.filename,
              }],
            }),
            metadata: {},
          }
        } catch (error) {
          return {
            title: "Screenshot unavailable",
            output: JSON.stringify({
              kind: "panel_response",
              message: `Failed to capture OpenCorvus GUI: ${error instanceof Error ? error.message : String(error)}`,
            }),
            metadata: {},
          }
        }
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
      default:
        throw new Error(`Unknown panel action: ${String((params as { action: string }).action)}`)
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

function pendingCount(board: Awaited<ReturnType<typeof OrchestratorService.getBoard>>) {
  return board.interactions.filter((item) => item.status === "pending").length
}
