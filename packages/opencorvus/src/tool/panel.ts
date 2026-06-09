import z from "zod"
import { Tool } from "./tool"
import { EngineService } from "@/task-api"
import { findChildrenOfTask } from "@/engine"
import { Session } from "@/session"
import { Question } from "@/question"
import { captureWindowScreenshot } from "@/gui/screenshot"
import { PanelActionSchema, derivePanelActor, panelCapabilityActionSet } from "@/panel/capability"
import { RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE, isRightSidebarCodingAssistantSession } from "@/coding-assistant/session"

// Action whitelist by actor. `mission` is a coordinator that drives
// squad/team work through a bounded set of panel actions; `explore` is a
// read-only investigator. control_agent and panel_ui retain their full existing surface.
// The coordination set covers dispatch (create_task), reconciliation
// (query_task / view_*), follow-up (send_task_message), interaction
// answering (reply/reject_interaction), and stopping work (cancel_task). It
// deliberately EXCLUDES replan_task / retry_task / update_goal / delete_goal
// / update_checks / set_executor / select_* / *_session — those belong to
// the orchestrator and the desktop panel_ui (rule 11: Mission coordinates,
// it does not replace the orchestrator). The host enforces here so even a
// future mis-grant of `panel` to a different identity holds.
const MISSION_ALLOWED_ACTIONS = new Set([
  "create_task",
  "query_task",
  "view_board",
  "view_plan",
  "view_tasks",
  "send_task_message",
  "cancel_task",
  "reply_interaction",
  "reject_interaction",
])
const EXPLORE_ALLOWED_ACTIONS = new Set(["query_task", "view_board", "view_plan", "view_tasks"])
import { isDecodableText, decodeDataUrlText, decodeDataUrlBase64 } from "@/session/text-mime"

const localOnly = (ctx: Tool.Context) => ctx.extra?.surface === "panel" || ctx.extra?.surface === "right-sidebar"

const PanelTaskStatus = z.enum(["queued", "active", "completed", "failed", "cancelled"])
const PanelTaskResultStatus = PanelTaskStatus
const PanelTaskEvaluationResult = z.object({
  status: z.string().optional(),
  verdict: z.string().optional(),
  summary: z.string(),
})
const PanelTaskAcceptanceArtifact = z.object({
  kind: z.string(),
  label: z.string(),
  payload: z.record(z.string(), z.unknown()).optional(),
})
const PanelTaskAcceptanceResult = z.object({
  status: z.string().optional(),
  verdict: z.string().optional(),
  summary: z.string(),
  changedFiles: z.array(z.string()).optional(),
  artifacts: z.array(PanelTaskAcceptanceArtifact).optional(),
})
const PanelTaskFailureResult = z.object({
  source: z.string().optional(),
  title: z.string().optional(),
  summary: z.string(),
})
const PanelTaskResult = z.object({
  status: PanelTaskResultStatus,
  summary: z.string(),
  acceptance: PanelTaskAcceptanceResult.optional(),
  evaluation: PanelTaskEvaluationResult.optional(),
  failure: PanelTaskFailureResult.optional(),
})
const PanelQueryTaskErrorRow = z.object({
  taskID: z.string(),
  error: z.string(),
})
const PanelQueryTaskSummaryRow = z.object({
  taskID: z.string(),
  title: z.string(),
  status: PanelTaskStatus,
  created: z.number().optional(),
  started: z.number().optional(),
  completed: z.number().optional(),
  error: z.string().optional(),
  result: PanelTaskResult,
  pendingInteractions: z.number().int().nonnegative().optional(),
})
const PanelQueryTaskChildRow = z.union([PanelQueryTaskSummaryRow, PanelQueryTaskErrorRow])
const PanelQueryTaskRow = z.union([
  PanelQueryTaskSummaryRow.extend({
    children: z.array(PanelQueryTaskChildRow).optional(),
  }),
  PanelQueryTaskErrorRow,
])
const PanelQueryTaskOutput = z.object({
  tasks: z.array(PanelQueryTaskRow),
})

type PanelTaskBoard = Awaited<ReturnType<typeof EngineService.getBoard>>

function nonEmptyString(input: unknown) {
  return typeof input === "string" && input.trim().length > 0 ? input.trim() : undefined
}

function panelTaskAcceptance(board: PanelTaskBoard): z.infer<typeof PanelTaskAcceptanceResult> | undefined {
  const acceptance = board.acceptance
  if (!acceptance) return undefined
  const result = acceptance.result as
    | {
        summary?: unknown
        changedFiles?: unknown
        artifacts?: unknown
      }
    | undefined
  const changedFiles = Array.isArray(result?.changedFiles)
    ? result.changedFiles.filter((item): item is string => typeof item === "string")
    : undefined
  const artifacts = Array.isArray(result?.artifacts)
    ? result.artifacts.flatMap((item) => {
        if (!item || typeof item !== "object") return []
        const raw = item as Record<string, unknown>
        const kind = nonEmptyString(raw.kind)
        const label = nonEmptyString(raw.label)
        if (!kind || !label) return []
        const payload =
          raw.payload && typeof raw.payload === "object" && !Array.isArray(raw.payload)
            ? (raw.payload as Record<string, unknown>)
            : undefined
        return [{ kind, label, ...(payload ? { payload } : {}) }]
      })
    : undefined
  return {
    status: nonEmptyString((acceptance as Record<string, unknown>).status),
    verdict: nonEmptyString((acceptance as Record<string, unknown>).verdict),
    summary: nonEmptyString(result?.summary) ?? acceptance.summary,
    ...(changedFiles && changedFiles.length > 0 ? { changedFiles } : {}),
    ...(artifacts && artifacts.length > 0 ? { artifacts } : {}),
  }
}

function panelTaskEvaluation(board: PanelTaskBoard): z.infer<typeof PanelTaskEvaluationResult> | undefined {
  const evaluation = board.evaluation
  if (!evaluation) return undefined
  return {
    status: nonEmptyString(evaluation.status),
    verdict: nonEmptyString(evaluation.verdict),
    summary: evaluation.summary,
  }
}

function panelTaskFailure(board: PanelTaskBoard): z.infer<typeof PanelTaskFailureResult> | undefined {
  const failure = board.overview?.currentFailure
  const taskError = nonEmptyString(board.task.error)
  if (taskError) {
    return {
      source: "task",
      title: "Task failed",
      summary: taskError,
    }
  }
  if (failure) {
    return {
      source: failure.source,
      title: failure.title,
      summary: failure.summary,
    }
  }
  const evaluation = board.evaluation
  if (evaluation?.verdict === "rejected" || evaluation?.status === "failed") {
    return {
      source: "evaluation",
      title: "Evaluation rejected",
      summary: evaluation.summary,
    }
  }
  return undefined
}

function panelTaskResult(board: PanelTaskBoard): z.infer<typeof PanelTaskResult> {
  const acceptance = panelTaskAcceptance(board)
  const evaluation = panelTaskEvaluation(board)
  const failure = panelTaskFailure(board)
  const summary =
    failure?.summary ??
    acceptance?.summary ??
    evaluation?.summary ??
    nonEmptyString(board.overview?.summary) ??
    `${board.task.title} is ${board.task.status}.`
  return {
    status: board.task.status,
    summary,
    ...(acceptance ? { acceptance } : {}),
    ...(evaluation ? { evaluation } : {}),
    ...(failure ? { failure } : {}),
  }
}

function panelTaskSummaryRow(board: PanelTaskBoard): z.infer<typeof PanelQueryTaskSummaryRow> {
  return PanelQueryTaskSummaryRow.parse({
    taskID: board.task.id,
    title: board.task.title,
    status: board.task.status,
    created: board.task.time?.created,
    started: board.task.time?.started,
    completed: board.task.time?.completed,
    error: board.task.error,
    result: panelTaskResult(board),
  })
}

async function panelQueryTaskRow(
  taskID: string,
  input: { includeChildren?: boolean; includeInteractions?: boolean },
): Promise<z.infer<typeof PanelQueryTaskRow>> {
  try {
    const board = await EngineService.getBoard(taskID)
    const item: z.infer<typeof PanelQueryTaskRow> = {
      ...panelTaskSummaryRow(board),
      ...(input.includeInteractions
        ? {
            pendingInteractions: (board.interactions ?? []).filter((req) => req.status === "pending").length,
          }
        : {}),
    }
    if (input.includeChildren) {
      item.children = await Promise.all(
        findChildrenOfTask(taskID).map(async (childTaskID) => {
          try {
            return panelTaskSummaryRow(await EngineService.getBoard(childTaskID))
          } catch (err) {
            return { taskID: childTaskID, error: err instanceof Error ? err.message : String(err) }
          }
        }),
      )
    }
    return PanelQueryTaskRow.parse(item)
  } catch (err) {
    return PanelQueryTaskErrorRow.parse({ taskID, error: err instanceof Error ? err.message : String(err) })
  }
}

async function resolvePanelActor(ctx: Tool.Context) {
  const session = await Session.get(ctx.sessionID).catch(() => undefined)
  if (session && isRightSidebarCodingAssistantSession(session)) return "right_sidebar_assistant"
  return derivePanelActor(ctx.agent)
}

async function resolveCreateTaskQueueDecision(input: { queue?: boolean; ctx: Tool.Context }) {
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
  description:
    "Operate the OpenCorvus control plane: inspect plans/boards, manage task state, reply to interactions, and manage sessions.",
  parameters: PanelActionSchema,
  async execute(params, ctx) {
    // Actor-based action filter. Mission is a coordinator, not an executor —
    // it drives squad/team work through a bounded panel surface and must not
    // replan/retry/edit goals or manage sessions here (rule 11). The host
    // enforces so even a future mis-grant of `panel` to another identity holds.
    const actor = await resolvePanelActor(ctx)
    if (actor === "mission" && !MISSION_ALLOWED_ACTIONS.has(params.action)) {
      throw new Error(
        `panel action "${params.action}" is not permitted for the mission agent. ` +
          `Mission may call: ${[...MISSION_ALLOWED_ACTIONS].join(", ")}. ` +
          `It coordinates squad/team work but does not replace the orchestrator — ` +
          `replan/retry/goal/session operations belong to the orchestrator and the desktop panel.`,
      )
    }
    if (actor === "explore" && !EXPLORE_ALLOWED_ACTIONS.has(params.action)) {
      throw new Error(
        `panel action "${params.action}" is not permitted for the explore agent. ` +
          `Explore may call: ${[...EXPLORE_ALLOWED_ACTIONS].join(", ")}.`,
      )
    }
    const rightSidebarActions =
      actor === "right_sidebar_assistant" ? panelCapabilityActionSet("right-sidebar") : undefined
    if (rightSidebarActions && !rightSidebarActions.has(params.action)) {
      throw new Error(
        `panel action "${params.action}" is not permitted for the right sidebar assistant. ` +
          `Allowed actions: ${[...rightSidebarActions].join(", ")}.`,
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
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: {},
        }
      }
      case "view_board": {
        if (!params.taskID) {
          const project = await EngineService.getProjectBoard({ limit: 8 })
          return {
            title: "Tasks",
            output:
              project.tasks.length === 0
                ? "No tasks found."
                : project.tasks
                    .map((item, index) => `${index + 1}. ${item.task.title} [${item.task.status}] (${item.task.id})`)
                    .join("\n"),
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
            board.acceptance ? `Acceptance: ${board.acceptance.summary}` : undefined,
            board.evaluation ? `Evaluation: ${board.evaluation.verdict} — ${board.evaluation.summary}` : undefined,
          ]
            .filter(Boolean)
            .join("\n"),
          metadata: {},
        }
      }
      case "view_tasks": {
        const board = await EngineService.getProjectBoard({ limit: 8 })
        return {
          title: "Tasks",
          output:
            board.tasks.length === 0
              ? "No tasks found."
              : board.tasks
                  .map((item, index) => `${index + 1}. ${item.task.title} [${item.task.status}] (${item.task.id})`)
                  .join("\n"),
          metadata: {},
        }
      }
      case "query_task": {
        // Structured batch reconciliation for agents (mission, etc.).
        // view_board is the prose surface; this is the stable JSON surface.
        // Each input ID maps to one output entry — failures (not found,
        // cross-project, etc.) surface as { taskID, error } so the caller
        // gets a deterministic 1:1 row count back.
        const results = await Promise.all(
          params.taskIDs.map((taskID) =>
            panelQueryTaskRow(taskID, {
              includeChildren: params.includeChildren,
              includeInteractions: params.includeInteractions,
            }),
          ),
        )
        return {
          title: "Tasks",
          output: JSON.stringify(PanelQueryTaskOutput.parse({ tasks: results })),
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
        //   1. Text attachments (template .txt / .md / .json) → inlined into the
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
            data: decodeDataUrlBase64(a.url, `panel.create_task attachment "${a.filename ?? a.mime}"`),
            ...(a.filename ? { filename: a.filename } : {}),
          }))
        const baseRequest = originalText || params.request
        const request = attachmentTexts ? baseRequest + attachmentTexts : baseRequest
        const queue = await resolveCreateTaskQueueDecision({ queue: params.queue, ctx })
        // Mission provenance (server-derived, not client-supplied). When the
        // Mission agent dispatches squad/team work, the task must carry
        // `source: "mission"` + `metadata.mission.{id,session_id}` so the UI
        // and downstream queries can show Mission → Squad lineage instead of a
        // bare panel workflow. missionID is read from the mission session's own
        // metadata (written at wake) so the agent cannot forge it.
        let missionProvenance: { id: string; session_id: string } | undefined
        if (actor === "mission") {
          const session = await Session.get(ctx.sessionID)
          const missionMeta = (session.metadata as Record<string, unknown> | undefined)?.mission as
            | { id?: unknown }
            | undefined
          const missionID = typeof missionMeta?.id === "string" ? missionMeta.id : undefined
          if (!missionID) {
            throw new Error(
              `panel.create_task by actor "mission" requires a mission session ` +
                `(metadata.mission.id). Session ${ctx.sessionID} is not a mission session.`,
            )
          }
          missionProvenance = { id: missionID, session_id: ctx.sessionID }
        }
        // Server owns provenance — strip any client-supplied actor/mission so a
        // caller cannot forge the audit trail or fake Mission → Squad lineage.
        const baseMetadata: Record<string, unknown> = { ...(params.metadata ?? {}) }
        delete baseMetadata.actor
        delete baseMetadata.mission
        const taskMetadata: Record<string, unknown> = {
          ...baseMetadata,
          actor,
          ...(missionProvenance ? { mission: missionProvenance } : {}),
        }
        const source =
          actor === "mission"
            ? "mission"
            : actor === "right_sidebar_assistant"
              ? RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE
              : (params.source ?? ctx.extra?.source ?? (params.platform ? `channel:${params.platform}` : "panel"))
        const taskID = await EngineService.createTask({
          requestID: params.request_id ?? ctx.extra?.requestID,
          request,
          executor: params.executor,
          queue,
          checks: params.checks,
          routing: params.routing,
          source,
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
          // Server-derived `actor` + `mission` are the authoritative provenance
          // fields (computed above as taskMetadata). See PanelActor in
          // panel/capability.ts.
          metadata: taskMetadata,
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
            data: decodeDataUrlBase64(a.url, `panel.send_task_message attachment "${a.filename ?? a.mime}"`),
            ...(a.filename ? { filename: a.filename } : {}),
          }))
        const result = await EngineService.handleTaskMessage(params.taskID, {
          text: followText ? params.text + followText : params.text,
          source:
            actor === "right_sidebar_assistant"
              ? RIGHT_SIDEBAR_CODING_ASSISTANT_SOURCE
              : (params.source ?? ctx.extra?.source ?? "panel"),
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
            output: JSON.stringify({
              kind: "interaction",
              task_id: result.taskID,
              interaction_id: result.id,
              message: "Interaction answered.",
            }),
            metadata: {},
          }
        } catch (error) {
          return {
            title: "Reply failed",
            output: JSON.stringify({
              kind: "panel_response",
              message: `Failed to reply: ${error instanceof Error ? error.message : String(error)}`,
            }),
            metadata: {},
          }
        }
      }
      case "reject_interaction": {
        const result = await EngineService.rejectInteraction(params.interactionID, {
          message: params.message,
          autoReply: false,
        })
        return {
          title: "Interaction rejected",
          output: JSON.stringify({
            kind: "interaction",
            task_id: result.taskID,
            interaction_id: result.id,
            message: "Interaction rejected.",
          }),
          metadata: {},
        }
      }
      case "retry_task":
        await EngineService.retryTask(params.taskID)
        return {
          title: "Retry queued",
          output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Retry queued." }),
          metadata: {},
        }
      case "replan_task":
        await EngineService.retryTask(params.taskID)
        return {
          title: "Replan queued",
          output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Replan queued." }),
          metadata: {},
        }
      case "cancel_task":
        await EngineService.cancelTask(params.taskID)
        return {
          title: "Task cancelled",
          output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Task cancelled." }),
          metadata: {},
        }
      case "update_checks":
        if (params.checks) {
          await EngineService.updateTaskChecks(params.taskID, { checks: params.checks })
        } else {
          await EngineService.selectTaskChecks(params.taskID, params.selection ?? {})
        }
        return {
          title: "Checks updated",
          output: JSON.stringify({ kind: "message", task_id: params.taskID, message: "Task checks updated." }),
          metadata: {},
        }
      case "capture_overlay_screenshot":
        try {
          const shot = await captureWindowScreenshot(params.match)
          return {
            title: "Screenshot captured",
            output: JSON.stringify({
              kind: "panel_response",
              message: `Captured OpenCorvus GUI: ${shot.title} (${shot.width}x${shot.height}).`,
              attachments: [
                {
                  mime: shot.mime,
                  url: shot.url,
                  filename: shot.filename,
                },
              ],
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
        return {
          title: "Goal updated",
          output: JSON.stringify({ kind: "panel_response", message: "Goal updated." }),
          metadata: {},
        }
      case "delete_goal":
        await EngineService.deleteGoal(params.goalID)
        return {
          title: "Goal deleted",
          output: JSON.stringify({ kind: "panel_response", message: "Goal deleted." }),
          metadata: {},
        }
    }
  },
})
