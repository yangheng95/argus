import { Tool } from "./tool"
import { OrchestratorService } from "@/orchestrator/service"
import { Budget } from "@/orchestrator/model"
import { captureWindowScreenshot } from "@/gui/screenshot"
import { PanelActionSchema } from "@/panel/capability"
import { PanelApi } from "@/panel/api"
import { Server } from "@/server/server"
import { Instance } from "@/project/instance"
import { asRecord } from "@/util/object"

const localOnly = (ctx: Tool.Context) => ctx.extra?.surface === "panel"
const allowTaskCreate = (ctx: Tool.Context) => ctx.extra?.allowCreate !== false

function createTaskBudget(metadata: unknown, extra: unknown) {
  const raw = [
    asRecord(asRecord(metadata)?.create_task)?.budget,
    asRecord(extra)?.budget,
  ]
  for (const item of raw) {
    const parsed = Budget.safeParse(item)
    if (parsed.success) return parsed.data
  }
  return undefined
}

function createTaskMetadata(value: unknown) {
  const raw = asRecord(value)
  if (!raw) return undefined
  const next = { ...raw }
  delete next.create_task
  return Object.keys(next).length > 0 ? next : undefined
}

function ignored(message: string) {
  return {
    title: "Ignored",
    output: JSON.stringify({
      kind: "panel_response",
      message,
    }),
    metadata: {},
  }
}

export const PanelTool = Tool.define("panel", {
  description: "Operate the OpenCorvus control plane: inspect specs, plans, and task boards, manage task state, and reply to interactions.",
  parameters: PanelActionSchema,
  async execute(params, ctx) {
    switch (params.action) {
      case "view_spec": {
        // Control-plane read actions should return the current board snapshot
        // immediately instead of blocking on a full task sync.
        const board = await OrchestratorService.getBoard(params.taskID, { sync: false })
        return {
          title: "Spec",
          output: [
            `Task: ${board.task.title}`,
            board.spec ? `Spec v${board.spec.version}: ${board.spec.summary}` : "Spec unavailable",
            board.spec?.scope ? `Scope: ${board.spec.scope}` : undefined,
            board.spec?.outOfScope ? `Out of scope: ${board.spec.outOfScope}` : undefined,
            board.requirements.length > 0 ? "Requirements:" : undefined,
            ...board.requirements.slice(0, 12).map((item, index) =>
              `${index + 1}. ${item.title}${item.description ? ` - ${item.description}` : ""} [${item.status}]${item.acceptance.length > 0 ? ` {${item.acceptance.join("; ")}}` : ""}`),
            board.requirements.length > 12 ? `... ${board.requirements.length - 12} more requirements` : undefined,
          ].filter(Boolean).join("\n"),
          metadata: {},
        }
      }
      case "view_plan": {
        const board = await OrchestratorService.getBoard(params.taskID, { sync: false })
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
        const board = await OrchestratorService.getBoard(params.taskID, { sync: false })
        return {
          title: "Board",
          output: [
            `Task: ${board.task.title}`,
            `Status: ${board.task.status}`,
            board.overview?.headline,
            board.overview?.summary,
            board.spec ? `Spec: ${board.spec.summary}` : undefined,
            board.plan ? `Plan: ${board.plan.summary}` : undefined,
            board.task.budget
              ? `Budget: runs=${board.task.budget.maxRuns ?? "default"}, replans=${board.task.budget.maxReplans ?? "default"}, evaluations=${board.task.budget.maxEvaluations ?? "default"}, wall=${board.task.budget.maxWallTimeMs === undefined ? "default" : `${board.task.budget.maxWallTimeMs}ms`}`
              : "Budget: defaults",
            `Goals: ${board.goals.length}, requirements: ${board.requirements.length}`,
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
        if (params.allow_create === false || !allowTaskCreate(ctx)) {
          return ignored("Task creation requires an explicit user request.")
        }
        const metadata = createTaskMetadata(params.metadata)
        const taskID = await OrchestratorService.createTask({
          requestID: params.request_id ?? ctx.extra?.requestID,
          request: params.request,
          executor: params.executor,
          budget: params.budget ?? createTaskBudget(params.metadata, ctx.extra?.createTask),
          checks: params.checks,
          routing: params.routing,
          source: params.source ?? ctx.extra?.source ?? (params.platform ? `channel:${params.platform}` : "panel"),
          ...(params.platform && params.channel && params.thread
            ? {
                channelBinding: {
                  platform: params.platform,
                  channel: params.channel,
                  thread: params.thread,
                  payload: metadata ?? {},
                },
              }
            : {}),
          metadata,
        }, {
          background: true,
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
      case "update_budget":
        await OrchestratorService.updateTaskBudget(params.taskID, { budget: params.budget })
        return { title: "Budget updated", output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Task budget updated." }), metadata: {} }
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
      case "list_panel_api":
        return {
          title: "Panel API catalog",
          output: JSON.stringify({
            kind: "panel_response",
            message: "Allowlisted panel API routes.",
            routes: PanelApi.list(),
          }),
          metadata: {},
        }
      case "call_panel_api": {
        const query = new URLSearchParams(params.query ?? {}).toString()
        const target = params.path.replace(/^\/+/, "")
        if (!PanelApi.allow(params.method, target)) {
          return {
            title: "Panel API blocked",
            output: JSON.stringify({
              kind: "panel_response",
              message: `Panel API route is not allowlisted: ${params.method} ${target}`,
            }),
            metadata: {},
          }
        }
        const response = await Server.App().request(`/${target}${query ? `?${query}` : ""}`, {
          method: params.method,
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": Instance.directory,
          },
          ...(params.body ? { body: JSON.stringify(params.body) } : {}),
        })
        const type = response.headers.get("content-type") || ""
        const data = type.includes("application/json")
          ? await response.json().catch(() => null)
          : await response.text()
        return {
          title: "Panel API response",
          output: JSON.stringify({
            kind: "panel_response",
            message: `${params.method} /${target} -> ${response.status}`,
            response: {
              status: response.status,
              ok: response.ok,
              data,
            },
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
      default:
        throw new Error(`Unknown panel action: ${String((params as { action: string }).action)}`)
    }
  },
})

function pendingCount(board: Awaited<ReturnType<typeof OrchestratorService.getBoard>>) {
  return board.interactions.filter((item) => item.status === "pending").length
}
