import z from "zod"
import { Tool } from "./tool"
import { EngineService } from "@/task-api"
import { findChildrenOfTask } from "@/engine"
import { Session } from "@/session"
import { Question } from "@/question"
import { captureWindowScreenshot } from "@/gui/screenshot"
import { PanelActionSchema, derivePanelActor } from "@/panel/capability"

// Action whitelist by actor. Only `gateway_master` is restricted today —
// it is a supervisor that may only create new tasks and query task
// status. control_agent and panel_ui retain their existing surface.
// Keep this set tight: anything the supervisor needs beyond these two
// belongs in a dispatched engine_task, not in the supervisor itself.
const GATEWAY_MASTER_ALLOWED_ACTIONS = new Set(["create_task", "query_task"])
import { isDecodableText, decodeDataUrlText, decodeDataUrlBase64 } from "@/session/text-mime"

const localOnly = (ctx: Tool.Context) => ctx.extra?.surface === "panel"

async function resolveCreateTaskQueueDecision(input: {
  queue?: boolean
  ctx: Tool.Context
}) {
  if (typeof input.queue === "boolean") return input.queue
  if (input.ctx.extra?.surface !== "panel") {
    return false
  }
  const { answers } = await Question.askAndFormat({
    sessionID: input.ctx.sessionID,
    tool: input.ctx.callID ? { messageID: input.ctx.messageID, callID: input.ctx.callID } : undefined,
    questions: [
      {
        header: "任务排队",
        question: "这个新任务要立即启动，还是进入目录队列等待？",
        options: [
          {
            label: "立即启动",
            description: "绕过目录队列马上运行；同目录已有任务在运行时会并发使用同一工作目录。",
          },
          {
            label: "排队等待",
            description: "新任务进入目录队列，等同目录中当前任务结束后再运行。",
          },
        ],
        multiple: false,
        custom: false,
      },
    ],
  })
  const selected = answers?.[0]?.[0]
  if (selected === "立即启动") return false
  if (selected === "排队等待") return true
  throw new Error("Task creation cancelled before selecting a start mode.")
}

export const PanelTool = Tool.define("panel", {
  description: "Operate the OpenCorvus control plane: inspect plans/boards, manage task state, reply to interactions, and manage sessions.",
  parameters: PanelActionSchema,
  async execute(params, ctx) {
    // Actor-based action filter. Master is a scheduler, not an executor —
    // it must not be able to retry/cancel/replan tasks or manage sessions
    // through this surface. The host enforces here so even if a future
    // config mis-grants `panel` to a different agent identity, the
    // boundary holds.
    const actor = derivePanelActor(ctx.agent)
    if (actor === "gateway_master" && !GATEWAY_MASTER_ALLOWED_ACTIONS.has(params.action)) {
      throw new Error(
        `panel action "${params.action}" is not permitted for gateway_master. ` +
          `Master may only call create_task and query_task. ` +
          `For any other panel operation, dispatch an engine_task whose executor can perform it.`,
      )
    }
    switch (params.action) {
      case "view_plan": {
        const board = await EngineService.getBoard(params.taskID)
        const goals = board.goalWorkflows ?? []
        return {
          title: "Plan",
          output: [
            `Task: ${board.task.title}`,
            board.plan ? `Plan: ${board.plan.summary}` : "Plan unavailable",
            goals.length > 0 ? "Goals:" : undefined,
            ...goals.map((goal, index) => `${index + 1}. ${goal.goalTitle} [${goal.goalStatus || "pending"}]`),
          ].filter(Boolean).join("\n"),
          metadata: {},
        }
      }
      case "view_board": {
        if (!params.taskID) {
          const project = await EngineService.getProjectBoard({ limit: 8 })
          return {
            title: "Tasks",
            output: project.tasks.length === 0
              ? "No tasks found."
              : project.tasks.map((item, index) => `${index + 1}. ${item.task.title} [${item.task.status}] (${item.task.id})`).join("\n"),
            metadata: {},
          }
        }
        const board = await EngineService.getBoard(params.taskID)
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
        const board = await EngineService.getProjectBoard({ limit: 8 })
        return {
          title: "Tasks",
          output: board.tasks.length === 0
            ? "No tasks found."
            : board.tasks.map((item, index) => `${index + 1}. ${item.task.title} [${item.task.status}] (${item.task.id})`).join("\n"),
          metadata: {},
        }
      }
      case "query_task": {
        // Structured batch reconciliation for agents (gateway-master, etc.).
        // view_board is the prose surface; this is the stable JSON surface.
        // Each input ID maps to one output entry — failures (not found,
        // cross-project, etc.) surface as { taskID, error } so the caller
        // gets a deterministic 1:1 row count back.
        const results = await Promise.all(
          params.taskIDs.map(async (taskID) => {
            try {
              const board = await EngineService.getBoard(taskID)
              const item: Record<string, unknown> = {
                taskID: board.task.id,
                title: board.task.title,
                status: board.task.status,
                created: board.task.time?.created,
              }
              if (board.task.error) item.error = board.task.error
              if (board.task.time?.started) item.started = board.task.time.started
              if (board.task.time?.completed) item.completed = board.task.time.completed
              if (board.evaluation) {
                item.evaluation = { verdict: board.evaluation.verdict, summary: board.evaluation.summary }
              }
              if (board.delivery) {
                item.delivery = { summary: board.delivery.summary }
              }
              if (params.includeChildren) {
                item.children = findChildrenOfTask(taskID)
              }
              if (params.includeInteractions) {
                item.pendingInteractions = (board.interactions ?? []).filter(
                  (req) => req.status === "pending",
                ).length
              }
              return item
            } catch (err) {
              return { taskID, error: err instanceof Error ? err.message : String(err) }
            }
          }),
        )
        return {
          title: "Tasks",
          output: JSON.stringify({ tasks: results }),
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
        // Use original user text when available to prevent the control-plane
        // LLM from silently summarising or truncating the user's request.
        const originalText = typeof ctx.extra?.originalText === "string" ? ctx.extra.originalText : undefined
        // Two semantically different attachment outlets — both must run, this
        // is NOT a double-source situation:
        //   1. Text attachments (PRD .txt / .md / .json) → inlined into the
        //      request prose so the executor session reads them as user
        //      intent without needing a separate `read` round-trip.
        //   2. Binary attachments (images, PDF, audio, …) → forwarded as
        //      TaskAttachmentInput so EngineService.createTask runs the same
        //      AttachmentStore.write + persistQueuedTask path that the direct
        //      POST /task ingress uses. Without this, every image dropped
        //      through control-plane LLM (overlay panel.message.stream + 14
        //      IM channels) silently disappeared before reaching task.attachments,
        //      causing build-agent visual fidelity 0.
        const rawAttachments = Array.isArray(ctx.extra?.attachments)
          ? (ctx.extra.attachments as Array<{ mime: string; url: string; filename?: string }>)
          : []
        const attachmentTexts = rawAttachments
          .filter((a) => isDecodableText(a.mime, a.filename))
          .map((a) => {
            const content = decodeDataUrlText(a.url)
            if (!content) return ""
            return `\n\n--- ${a.filename ?? "attachment"} ---\n${content}`
          })
          .filter(Boolean)
          .join("")
        const binaryAttachments = rawAttachments
          .filter((a) => !isDecodableText(a.mime, a.filename))
          .map((a) => ({
            mime: a.mime,
            // Strict: the upstream control-plane LLM session received a
            // ControlAttachment.url (declared shape: data URL). If a caller
            // sends a server-relative URL (e.g. /attachment/<sha>...), this
            // throws — silently treating an HTTP path as base64 would persist
            // garbage bytes as "the user's reference image" and trigger the
            // exact fidelity-0 surface this fix is closing. Rule 7.
            data: decodeDataUrlBase64(
              a.url,
              `panel.create_task attachment "${a.filename ?? a.mime}"`,
            ),
            ...(a.filename ? { filename: a.filename } : {}),
          }))
        const baseRequest = originalText || params.request
        const request = attachmentTexts ? baseRequest + attachmentTexts : baseRequest
        const queue = await resolveCreateTaskQueueDecision({ queue: params.queue, ctx })
        const taskID = await EngineService.createTask({
          requestID: params.request_id ?? ctx.extra?.requestID,
          request,
          executor: params.executor,
          queue,
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
          ...(binaryAttachments.length > 0 ? { attachments: binaryAttachments } : {}),
          // Server-derived `actor` is the authoritative provenance field;
          // any client-supplied `actor` in params.metadata is overridden so
          // callers cannot forge the audit trail. See PanelActor in
          // panel/capability.ts.
          metadata: { ...(params.metadata ?? {}), actor: derivePanelActor(ctx.agent) },
        })
        return {
          title: "Task created",
          output: JSON.stringify({ kind: "created", task_id: taskID, message: `Task accepted: \`${taskID}\`` }),
          metadata: {},
        }
      }
      case "send_task_message": {
        // Forward control-plane LLM attachments to the task message ingress
        // exactly the same way create_task does — text MIMEs are inlined into
        // the message prose, binary MIMEs are decoded once and passed as
        // TaskMessageInput.attachments so handleTaskMessage's
        // appendTaskAttachment loop surfaces them on task.attachments.
        // Without this, follow-up screenshots on a bound task vanish at the
        // control-plane edge, mirroring the original create_task bug.
        const followAttachments = Array.isArray(ctx.extra?.attachments)
          ? (ctx.extra.attachments as Array<{ mime: string; url: string; filename?: string }>)
          : []
        const followText = followAttachments
          .filter((a) => isDecodableText(a.mime, a.filename))
          .map((a) => {
            const content = decodeDataUrlText(a.url)
            if (!content) return ""
            return `\n\n--- ${a.filename ?? "attachment"} ---\n${content}`
          })
          .filter(Boolean)
          .join("")
        const followBinaries = followAttachments
          .filter((a) => !isDecodableText(a.mime, a.filename))
          .map((a) => ({
            mime: a.mime,
            data: decodeDataUrlBase64(
              a.url,
              `panel.send_task_message attachment "${a.filename ?? a.mime}"`,
            ),
            ...(a.filename ? { filename: a.filename } : {}),
          }))
        const result = await EngineService.handleTaskMessage(params.taskID, {
          text: followText ? params.text + followText : params.text,
          source: params.source ?? ctx.extra?.source ?? "panel",
          user_id: params.user_id,
          ...(followBinaries.length > 0 ? { attachments: followBinaries } : {}),
        })
        return {
          title: "Task message",
          output: JSON.stringify({ kind: "message", task_id: params.taskID, message: result.message }),
          metadata: {},
        }
      }
      case "reply_interaction": {
        try {
          const result = await EngineService.replyInteraction(
            params.interactionID,
            params.reply
              ? { reply: params.reply, autoReply: false }
              : params.message
                ? { message: params.message, autoReply: false }
                : { reply: "once", autoReply: false },
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
        const result = await EngineService.rejectInteraction(params.interactionID, { message: params.message, autoReply: false })
        return {
          title: "Interaction rejected",
          output: JSON.stringify({ kind: "interaction", task_id: result.taskID, interaction_id: result.id, message: "Interaction rejected." }),
          metadata: {},
        }
      }
      case "retry_task":
        await EngineService.retryTask(params.taskID)
        return { title: "Retry queued", output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Retry queued." }), metadata: {} }
      case "replan_task":
        await EngineService.retryTask(params.taskID)
        return { title: "Replan queued", output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Replan queued." }), metadata: {} }
      case "cancel_task":
        await EngineService.cancelTask(params.taskID)
        return { title: "Task cancelled", output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Task cancelled." }), metadata: {} }
      case "update_checks":
        if (params.checks) {
          await EngineService.updateTaskChecks(params.taskID, { checks: params.checks })
        } else {
          await EngineService.selectTaskChecks(params.taskID, params.selection ?? {})
        }
        return { title: "Checks updated", output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Task checks updated." }), metadata: {} }
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
        const session = await Session.create({ kind: "assistant" })
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
        await EngineService.deleteSession(params.sessionID, { deleteTasks: true })
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
      case "update_goal":
        await EngineService.updateGoal(params.goalID, {
          description: params.description,
          acceptance_specs: params.acceptance_specs as import("@/acceptance/types").AcceptanceSpec[],
        })
        return { title: "Goal updated", output: JSON.stringify({ kind: "panel_response", message: "Goal updated." }), metadata: {} }
      case "delete_goal":
        await EngineService.deleteGoal(params.goalID)
        return { title: "Goal deleted", output: JSON.stringify({ kind: "panel_response", message: "Goal deleted." }), metadata: {} }
    }
  },
})
