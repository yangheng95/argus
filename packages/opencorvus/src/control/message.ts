import z from "zod"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message"
import { SessionPrompt } from "@/session/prompt"
import { Skill } from "@/skill"
import { ToolRegistry } from "@/tool/registry"
import { Database, eq, inArray } from "@/storage/db"
import {
  OrchestratorEvaluationTable,
  OrchestratorGoalTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "@/orchestrator/orchestrator.sql"
import { OrchestratorService } from "@/orchestrator/service"
import { Instance } from "@/project/instance"
import { ControlMessageInput, ControlMessageResult } from "./message-schema"
import { ControlTimeline } from "./timeline"
import { Log } from "@/util/log"

const log = Log.create({ service: "control-message" })

const ResultSchema = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["panel_response", "created", "message", "interaction", "progress", "task_list", "cancelled"],
    },
    message: {
      type: "string",
    },
    task_id: {
      type: "string",
    },
    interaction_id: {
      type: "string",
    },
    session_id: {
      type: "string",
    },
    local_action: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["set_executor", "select_task", "select_session", "invalidate_session"],
        },
        executor: {
          type: "string",
          enum: ["opencode", "codex", "claude-code"],
        },
        taskID: { type: "string" },
        sessionID: { type: "string" },
      },
      required: ["type"],
    },
  },
  required: ["kind", "message"],
} as const

export namespace ControlMessage {
  export async function handle(raw: z.input<typeof ControlMessageInput>) {
    const input = ControlMessageInput.parse(raw)
    const result = await run(input)
    ControlTimeline.append({
      ...scope(input, result),
      surface: input.surface,
      source: input.source ?? defaultSource(input.surface),
      channel: input.channel,
      thread: input.thread,
      userID: input.user_id,
      requestID: input.request_id,
      entries: [
        {
          role: "user",
          text: input.text,
          metadata: {
            allow_create: input.allow_create,
            ...(input.metadata ?? {}),
          },
        },
        {
          role: "assistant",
          text: result.message,
          metadata: {
            kind: result.kind,
            ...(result.task_id ? { task_id: result.task_id } : {}),
            ...(result.session_id ? { session_id: result.session_id } : {}),
            ...(result.interaction_id ? { interaction_id: result.interaction_id } : {}),
            ...(result.local_action ? { local_action: result.local_action } : {}),
          },
        },
      ],
    })
    return result
  }
}

async function run(input: z.infer<typeof ControlMessageInput>) {
  // Try deterministic handlers first (status, list, cancel, executor, greetings)
  const directResult = tryDirectQuery(input)
  if (directResult) return directResult

  // No task bound → create a new task only if it looks like a real request
  if (!input.taskID && input.allow_create && !shouldUseControlPlane(input)) {
    if (!looksLikeTaskRequest(input.text)) {
      return ControlMessageResult.parse({
        kind: "panel_response",
        message: "This message is not a concrete task request. Describe a specific implementation task, or use status/list/cancel/executor controls.",
      })
    }
    return createTaskDirect(input)
  }

  const model = await resolveModel()
  if (!model) {
    return ControlMessageResult.parse({
      kind: "panel_response",
      message: "No model configured. Please set up a provider in settings first.",
    })
  }

  const session = await Session.create({
    title: `Panel control (${input.surface})`,
  })
  try {
    const result = await SessionPrompt.prompt({
      sessionID: session.id,
      agent: await Agent.defaultAgent(),
      system: await systemPrompt(input),
      parts: [
        {
          type: "text",
          text: buildUserPrompt(input),
        },
      ],
      tools: await panelTools(),
      format: {
        type: "json_schema",
        schema: ResultSchema as unknown as Record<string, any>,
        retryCount: 1,
      },
      extra: {
        surface: input.surface,
        source: input.source ?? defaultSource(input.surface),
      },
    })

    if (result.info.role === "assistant" && result.info.structured) {
      return ControlMessageResult.parse(result.info.structured)
    }

    return ControlMessageResult.parse({
      kind: "panel_response",
      message: textFromMessage(result),
    })
  } catch (error) {
    return ControlMessageResult.parse({
      kind: "panel_response",
      message: `Control message processing failed: ${error instanceof Error ? error.message : String(error)}`,
    })
  } finally {
    await Session.remove(session.id).catch(() => undefined)
  }
}

async function resolveModel() {
  const agentName = await Agent.defaultAgent().catch(() => undefined)
  if (!agentName) return undefined
  const agent = await Agent.get(agentName)
  const target = agent?.model
  if (target) return target
  return Provider.defaultModel().catch(() => undefined)
}

async function systemPrompt(input: z.infer<typeof ControlMessageInput>) {
  const skill = await Skill.get("panel-control")
  const lines = [
    "You are the core OpenCorvus agent operating in control-plane mode.",
    "You must use the panel tool to inspect or mutate the control plane.",
    "Do not perform coding work.",
    "Respond only through the required structured output schema.",
    "Never bypass the panel tool or rely on local UI shortcuts.",
    "Treat metadata as explicit UI context. When metadata provides concrete IDs or target values, prefer those targets over guessing from the text.",
    "",
    `Surface: ${input.surface}`,
    input.surface === "panel"
      ? "Local panel actions are allowed."
      : "Local panel focus actions are NOT allowed on this surface.",
  ]
  if (skill) {
    lines.push("", skill.content.trim())
  }
  return lines.join("\n")
}

function buildUserPrompt(input: z.infer<typeof ControlMessageInput>) {
  return JSON.stringify({
    surface: input.surface,
    text: input.text,
    taskID: input.taskID,
    sessionID: input.sessionID,
    executor: input.executor,
    channel: input.channel,
    thread: input.thread,
    source: input.source,
    allow_create: input.allow_create,
    metadata: input.metadata,
    request_id: input.request_id,
  })
}

async function panelTools() {
  const ids = await ToolRegistry.ids()
  return Object.fromEntries(ids.map((id) => [id, id === "panel"]))
}

function textFromMessage(message: MessageV2.WithParts) {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function defaultSource(surface: z.infer<typeof ControlMessageInput>["surface"]) {
  if (surface === "panel") return "panel"
  return `channel:${surface}`
}

function shouldUseControlPlane(input: z.infer<typeof ControlMessageInput>) {
  if (input.surface !== "panel") return false
  const ui = input.metadata?.ui_context
  return typeof ui === "string" && ["session_manager", "task_toolbar", "engine_bar"].includes(ui)
}

function scope(input: z.infer<typeof ControlMessageInput>, result: z.infer<typeof ControlMessageResult>) {
  const taskID = result.task_id ?? input.taskID
  const sessionID = result.session_id ?? input.sessionID ?? taskSession(taskID)
  return {
    ...(taskID ? { taskID } : {}),
    ...(sessionID ? { sessionID } : {}),
  }
}

function taskSession(taskID?: string) {
  if (!taskID) return
  const row = Database.use((db) =>
    db
      .select({ sessionID: OrchestratorTaskTable.session_id })
      .from(OrchestratorTaskTable)
      .where(eq(OrchestratorTaskTable.id, taskID))
      .get(),
  )
  return row?.sessionID ?? undefined
}

// ---------------------------------------------------------------------------
// Deterministic handlers — bypass LLM for status/list/cancel/executor/greetings
// ---------------------------------------------------------------------------

const STATUS_PATTERN = /^(?:status|progress|进度|状态)\s*(?:of\s+)?(.+)?$/i
const LIST_PATTERN = /^(?:list\s*tasks?|任务列表|tasks?|show\s*tasks?)$/i
const CANCEL_PATTERN = /^(?:cancel|取消|abort|stop)\s+(.+)$/i
const EXECUTOR_PATTERN = /^(?:use|switch\s*(?:to)?|切换(?:到)?|用)\s*(?:executor\s+)?(opencode|codex|claude[- ]code)\b/i
const EXECUTOR_FULL_PATTERN = /^Use executor (opencode|codex|claude-code) for /i
const GREETING_PATTERN = /^(?:你好|hi|hello|hey|嗨|哈喽|good\s*(?:morning|afternoon|evening)|早上好|下午好|晚上好|what'?s?\s*up|yo|sup)[\s!！.。?？]*$/i

function tryDirectQuery(
  input: z.infer<typeof ControlMessageInput>,
): z.infer<typeof ControlMessageResult> | undefined {
  const text = input.text.trim()

  if (input.executor && /(switch|use|executor|切换|用)/i.test(text)) {
    return ControlMessageResult.parse({
      kind: "panel_response",
      message: `Executor set to ${input.executor}.`,
      local_action: { type: "set_executor", executor: input.executor },
    })
  }

  // Executor selection: "Use executor codex..." / "切换到 claude-code" / "用 opencode"
  const executorFullMatch = text.match(EXECUTOR_FULL_PATTERN)
  const executorLooseMatch =
    EXECUTOR_PATTERN.test(text)
      ? text.match(/\b(opencode|codex|claude[- ]code)\b/i)
      : undefined
  const executorMatch = executorFullMatch ?? executorLooseMatch
  if (executorMatch) {
    const raw = executorMatch[1].toLowerCase().replace(/\s+/g, "-")
    const executor = raw === "claude-code" || raw === "claude code" ? "claude-code" : raw as "opencode" | "codex" | "claude-code"
    if (["opencode", "codex", "claude-code"].includes(executor)) {
      return ControlMessageResult.parse({
        kind: "panel_response",
        message: `Executor set to ${executor}.`,
        local_action: { type: "set_executor", executor },
      })
    }
  }

  // Greetings: "你好" / "hello" / "hi"
  if (GREETING_PATTERN.test(text)) {
    return ControlMessageResult.parse({
      kind: "panel_response",
      message: "你好！有什么可以帮你的？可以直接描述你的需求，我会创建任务来处理。",
    })
  }

  // "status <taskID>" or "进度 <taskID>"
  const statusMatch = text.match(STATUS_PATTERN)
  if (statusMatch) {
    const taskID = statusMatch[1]?.trim() || input.taskID
    if (taskID) return queryTaskProgress(taskID)
  }

  // "list tasks" or "任务列表"
  if (LIST_PATTERN.test(text)) {
    return listActiveTasks()
  }

  // "cancel <taskID>" or "取消 <taskID>"
  const cancelMatch = text.match(CANCEL_PATTERN)
  if (cancelMatch) {
    const taskID = cancelMatch[1]?.trim() || input.taskID
    if (taskID) return cancelTaskDirect(taskID)
  }

  // Status query with bound taskID
  if (input.taskID && /^(?:status|progress|进度|状态|怎么样了|how.?s it going)$/i.test(text)) {
    return queryTaskProgress(input.taskID)
  }

  return undefined
}

// ---------------------------------------------------------------------------
// Task request heuristic — avoid creating tasks for non-request messages
// ---------------------------------------------------------------------------

function looksLikeTaskRequest(text: string) {
  const trimmed = text.trim()
  // Too short to be a meaningful task request
  if (trimmed.length < 8) return false
  // Single word is almost never a task
  if (!/\s/.test(trimmed)) return false
  // Known non-task patterns
  if (GREETING_PATTERN.test(trimmed)) return false
  if (EXECUTOR_PATTERN.test(trimmed) || EXECUTOR_FULL_PATTERN.test(trimmed)) return false
  if (STATUS_PATTERN.test(trimmed)) return false
  if (LIST_PATTERN.test(trimmed)) return false
  if (CANCEL_PATTERN.test(trimmed)) return false
  // Help / meta questions
  if (/^(?:help|帮助|how\s+(?:do|does|to)|what\s+(?:is|are|can)|怎么用|能做什么|支持什么)[\s?？]*$/i.test(trimmed)) return false
  return true
}

function queryTaskProgress(taskID: string): z.infer<typeof ControlMessageResult> {
  try {
    const task = Database.use((db) =>
      db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
    )
    if (!task) {
      return ControlMessageResult.parse({
        kind: "panel_response",
        message: `Task not found: \`${taskID}\``,
      })
    }
    const run = task.active_run_id
      ? Database.use((db) => db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.id, task.active_run_id!)).get())
      : undefined
    const evaluation = Database.use((db) =>
      db
        .select()
        .from(OrchestratorEvaluationTable)
        .where(eq(OrchestratorEvaluationTable.task_id, task.id))
        .orderBy(OrchestratorEvaluationTable.time_created)
        .all()
        .filter((item) => !run || item.run_id === run.id)
        .at(-1),
    )
    const goals = task.active_plan_version_id
      ? Database.use((db) =>
          db
            .select({
              description: OrchestratorGoalTable.description,
              status: OrchestratorGoalTable.status,
            })
            .from(OrchestratorGoalTable)
            .where(eq(OrchestratorGoalTable.plan_version_id, task.active_plan_version_id!))
            .orderBy(OrchestratorGoalTable.order_index)
            .all(),
        )
      : []
    const lines = [
      `**Task**: ${task.title}`,
      `**Status**: ${task.status}`,
    ]
    if (run) {
      lines.push(`**Run**: ${run.status} (phase: ${run.phase ?? "—"}, retries: ${run.retry_count ?? 0})`)
    }
    if (evaluation) {
      lines.push(`**Evaluation**: ${evaluation.verdict ?? evaluation.status}`)
    }
    if (goals.length > 0) {
      lines.push("**Goals**:", ...goals.map((goal) => `- [${goal.status}] ${goal.description}`))
    }
    if (task.error) lines.push(`**Error**: ${task.error}`)
    return ControlMessageResult.parse({ kind: "progress", message: lines.join("\n"), task_id: taskID })
  } catch {
    return ControlMessageResult.parse({ kind: "panel_response", message: `Task not found: \`${taskID}\`` })
  }
}

function listActiveTasks(): z.infer<typeof ControlMessageResult> {
  try {
    const rows = Database.use((db) =>
      db
        .select({
          id: OrchestratorTaskTable.id,
          title: OrchestratorTaskTable.title,
          status: OrchestratorTaskTable.status,
          time_created: OrchestratorTaskTable.time_created,
        })
        .from(OrchestratorTaskTable)
        .where(eq(OrchestratorTaskTable.project_id, Instance.project.id))
        .all(),
    )
    if (rows.length === 0) {
      return ControlMessageResult.parse({
        kind: "task_list",
        message: "No tasks found.",
      })
    }
    const active = rows.filter((t) => !["completed", "failed", "cancelled"].includes(t.status))
    const lines = [
      `**Total**: ${rows.length} tasks (${active.length} active)`,
      "",
    ]
    // Show active first, then recent completed/failed (up to 10 total)
    const sorted = [...active, ...rows.filter((t) => !active.includes(t))].slice(0, 10)
    for (const t of sorted) {
      lines.push(`- \`${t.id}\` [${t.status}] ${t.title}`)
    }
    return ControlMessageResult.parse({
      kind: "task_list",
      message: lines.join("\n"),
    })
  } catch (err) {
    return ControlMessageResult.parse({
      kind: "panel_response",
      message: `Failed to list tasks: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

function cancelTaskDirect(taskID: string): z.infer<typeof ControlMessageResult> {
  try {
    // Synchronous check first
    const task = Database.use((db) =>
      db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
    )
    if (!task) {
      return ControlMessageResult.parse({
        kind: "panel_response",
        message: `Task not found: \`${taskID}\``,
      })
    }
    if (["completed", "failed", "cancelled"].includes(task.status)) {
      return ControlMessageResult.parse({
        kind: "panel_response",
        message: `Task \`${taskID}\` is already ${task.status}.`,
      })
    }
    // Fire-and-forget the async cancel
    OrchestratorService.cancelTask(taskID).catch((err) =>
      log.error("cancel task failed", { taskID, error: String(err) }),
    )
    return ControlMessageResult.parse({
      kind: "cancelled",
      message: `Task \`${taskID}\` cancel requested.`,
      task_id: taskID,
    })
  } catch (err) {
    return ControlMessageResult.parse({
      kind: "panel_response",
      message: `Failed to cancel task: ${err instanceof Error ? err.message : String(err)}`,
    })
  }
}

// ---------------------------------------------------------------------------
// Deterministic task creation — bypass LLM for new task requests
// ---------------------------------------------------------------------------

async function createTaskDirect(
  input: z.infer<typeof ControlMessageInput>,
): Promise<z.infer<typeof ControlMessageResult>> {
  try {
    const channelBinding =
      input.surface !== "panel" && input.channel && input.thread
        ? {
            platform: input.surface as "slack" | "telegram" | "discord",
            channel: input.channel,
            thread: input.thread,
            payload: input.metadata ?? {},
          }
        : undefined
    const taskID = await OrchestratorService.createTask({
      requestID: input.request_id,
      request: input.text,
      executor: input.executor,
      source: input.source ?? defaultSource(input.surface),
      ...(channelBinding ? { channelBinding } : {}),
      metadata: input.metadata,
    })
    log.info("task created directly", { taskID, surface: input.surface })
    return ControlMessageResult.parse({
      kind: "created",
      message: `Task accepted: \`${taskID}\``,
      task_id: taskID,
    })
  } catch (error) {
    log.error("direct task creation failed", { error })
    return ControlMessageResult.parse({
      kind: "panel_response",
      message: `Failed to create task: ${error instanceof Error ? error.message : String(error)}`,
    })
  }
}
