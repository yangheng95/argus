import z from "zod"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message"
import { SessionPrompt } from "@/session/prompt"
import { Skill } from "@/skill"
import { ToolRegistry } from "@/tool/registry"
import { Database, eq } from "@/storage/db"
import { OrchestratorTaskTable } from "@/orchestrator/orchestrator.sql"
import { panelCapabilityPrompt } from "@/panel/capability"
import { ControlMessageInput, ControlMessageResult, PanelLocalAction } from "./message-schema"
import { ControlTimeline, TimelineStoredPart } from "./timeline"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { asRecord } from "@/util/object"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "control-message" })
const ResultSchema = z.toJSONSchema(ControlMessageResult)

type StreamCallback = (event: { type: string; [key: string]: unknown }) => void
type RunResult = {
  result: z.infer<typeof ControlMessageResult>
  timeline: boolean
  timelineMessage?: MessageV2.WithParts
}
type TimelinePartRecord = z.infer<typeof TimelineStoredPart>
type StreamState = {
  assistant: Set<string>
  raw: Map<string, string>
  text: Map<string, string>
  reasoning: Map<string, string>
}
type SessionInfo = Awaited<ReturnType<typeof Session.create>>
type ControlSession = {
  info: SessionInfo
  created: boolean
  persistent: boolean
  keep: boolean
}

export namespace ControlMessage {
  export async function handle(raw: z.input<typeof ControlMessageInput>) {
    const input = ControlMessageInput.parse(raw)
    const runResult = await run(input)
    if (runResult.timeline) appendTimeline(input, runResult.result, runResult.timelineMessage)
    return runResult.result
  }

  export async function handleStream(
    raw: z.input<typeof ControlMessageInput>,
    onEvent: StreamCallback,
  ) {
    const input = ControlMessageInput.parse(raw)
    const runResult = await run(input, onEvent)
    if (runResult.timeline) appendTimeline(input, runResult.result, runResult.timelineMessage)
    return runResult.result
  }
}

async function run(input: z.infer<typeof ControlMessageInput>, onEvent?: StreamCallback) {
  const payload = loggedInput(input)
  log.info("panel request received", {
    input: payload,
    stream: !!onEvent,
  })
  const model = await resolveModel()
  if (!model) {
    const result = ControlMessageResult.parse({
      kind: "panel_response",
      message: "尚未配置模型。请先在设置中配置提供方。",
    })
    log.warn("panel request skipped", {
      input: payload,
      reason: "model_unconfigured",
      result: loggedResult(result),
    })
    return {
      result,
      timeline: true,
    } satisfies RunResult
  }

  let control: ControlSession | undefined

  const unsubs: (() => void)[] = []

  try {
    control = await resolveSession(input)
    log.info(control.created ? "panel control session created" : "panel control session reused", {
      input: payload,
      panel_session: control.info,
      stream: !!onEvent,
    })

    if (onEvent) {
      const locale = streamLocale(input.text)
      const stream: StreamState = {
        assistant: new Set(),
        raw: new Map(),
        text: new Map(),
        reasoning: new Map(),
      }
      unsubs.push(
        Bus.subscribe(MessageV2.Event.Updated, (event) => {
          try {
            const info = event.properties.info
            if (info.sessionID !== control?.info.id) return
            if (info.role !== "assistant") return
            stream.assistant.add(info.id)
          } catch (err) {
            log.warn("control stream: MessageV2.Event.Updated handler error", { error: String(err) })
          }
        }),
      )
      unsubs.push(
        Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
          try {
            const part = event.properties.part
            if (part.sessionID !== control?.info.id) return
            if (!stream.assistant.has(part.messageID)) return
            if (part.type === "reasoning") {
              stream.reasoning.set(part.id, typeof part.text === "string" ? part.text : "")
              if (typeof part.text === "string") emitStreamReasoning(stream, part.id, part.text, onEvent)
              return
            }
            if (part.type !== "tool") return
            if (part.tool !== "StructuredOutput") {
              emitToolReasoning(stream, part, locale, onEvent)
              onEvent({ type: "tool", tool: part.tool })
              return
            }
            const text = structuredMessageText(part.state?.input)
            if (!text) return
            emitStreamText(stream, part.id, text, onEvent)
          } catch (err) {
            log.warn("control stream: MessageV2.Event.PartUpdated handler error", { error: String(err) })
          }
        }),
      )
      unsubs.push(
        Bus.subscribe(MessageV2.Event.PartDelta, (event) => {
          try {
            const part = event.properties
            if (part.sessionID !== control?.info.id) return
            if (!stream.assistant.has(part.messageID)) return
            if (part.field === "text" && stream.reasoning.has(part.partID)) {
              emitStreamReasoning(stream, part.partID, `${stream.reasoning.get(part.partID) ?? ""}${part.delta}`, onEvent)
              return
            }
            if (part.field !== "raw") return
            const raw = (stream.raw.get(part.partID) ?? "") + part.delta
            stream.raw.set(part.partID, raw)
            const text = structuredMessageText(raw)
            if (!text) return
            emitStreamText(stream, part.partID, text, onEvent)
          } catch (err) {
            log.warn("control stream: MessageV2.Event.PartDelta handler error", { error: String(err) })
          }
        }),
      )
      onEvent({ type: "start" })
      emitStreamReasoning(stream, "control:start", controlStreamIntro(locale), onEvent)
    }

    const agent = await Agent.defaultAgent()
    const system = await systemPrompt(input)
    const parts = buildUserParts(input)
    const tools = await panelTools()
    const extra = {
      surface: input.surface,
      source: input.source ?? defaultSource(input.surface),
      allowCreate: input.allow_create,
      allowSessionMutation: input.allow_session_mutation,
      ...(asRecord(input.metadata?.create_task) ? { createTask: input.metadata?.create_task } : {}),
      ...(input.request_id ? { requestID: input.request_id } : {}),
      ...(input.directory ? { directory: input.directory } : {}),
    }

    const result = await SessionPrompt.prompt({
      sessionID: control.info.id,
      agent,
      system,
      parts,
      tools,
      format: {
        type: "json_schema" as const,
        schema: ResultSchema as Record<string, unknown>,
        retryCount: 1,
      },
      extra,
    })

    if (result.info.role === "assistant" && result.info.structured) {
      const output = finalizeResult(ControlMessageResult.parse(result.info.structured), control, input)
      const removing = shouldRemoveSession(control)
      if (control?.keep && !removing) {
        await appendSummary(control.info.id, result, output.message)
      }
      log.info("panel request completed", {
        input: payload,
        panel_session_id: control.info.id,
        result: loggedResult(output),
      })
      return {
        result: output,
        timeline: shouldAppendTimeline(input, output, control),
        timelineMessage: result,
      } satisfies RunResult
    }

    const detail = messageError(result)
    throw new Error(detail || "Control model did not return structured output")
  } catch (error) {
    const output = finalizeResult(ControlMessageResult.parse({
      kind: "panel_response",
      message: `Control message processing failed: ${error instanceof Error ? error.message : String(error)}`,
    }), control, input)
    log.error("panel request failed", {
      input: payload,
      panel_session_id: control?.info.id,
      error: error instanceof Error ? error.message : String(error),
      result: loggedResult(output),
    })
    return {
      result: output,
      timeline: shouldAppendTimeline(input, output, control),
    } satisfies RunResult
  } finally {
    for (const unsub of unsubs) unsub()
    if (control && shouldRemoveSession(control)) {
      const sessionID = control.info.id
      await Session.remove(sessionID).catch((err) => {
        log.warn("failed to remove panel control session", { sessionID, error: String(err) })
      })
      log.info("panel control session removed", {
        input: payload,
        panel_session_id: sessionID,
      })
    }
  }
}

function appendTimeline(
  input: z.infer<typeof ControlMessageInput>,
  result: z.infer<typeof ControlMessageResult>,
  timelineMessage?: MessageV2.WithParts,
) {
  const now = Date.now()
  const userTime = typeof input.time_created === "number" ? input.time_created : now
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
        time_created: userTime,
        parts: timelineInputParts(input),
        metadata: {
          ...(input.metadata ?? {}),
          allow_create: input.allow_create,
          ...(input.attachments?.length ? { attachments: input.attachments } : {}),
        },
      },
      {
        role: "assistant",
        text: result.message,
        time_created: Math.max(now, userTime + 1),
        parts: timelineAssistantParts(timelineMessage, result.message),
        metadata: {
          kind: result.kind,
          ...(result.task_id ? { task_id: result.task_id } : {}),
          ...(result.session_id ? { session_id: result.session_id } : {}),
          ...(result.interaction_id ? { interaction_id: result.interaction_id } : {}),
          ...(result.local_action ? { local_action: result.local_action } : {}),
          ...(result.attachments ? { attachments: result.attachments } : {}),
        },
      },
    ],
  })
}

function timelineInputParts(input: z.infer<typeof ControlMessageInput>): TimelinePartRecord[] {
  return [
    {
      type: "text" as const,
      text: input.text,
      kind: "user_content" as const,
      source: "user" as const,
      audience: {
        model: false,
        ui: true,
        acp: false,
      },
    },
    ...(input.attachments ?? []).map((item) => ({
      type: "file" as const,
      mime: item.mime,
      url: item.url,
      ...(item.filename ? { filename: item.filename } : {}),
    })),
  ]
}

function timelineAssistantParts(message: MessageV2.WithParts | undefined, fallbackText: string): TimelinePartRecord[] {
  const parts = Array.isArray(message?.parts)
    ? message.parts.flatMap((part) => timelineMessagePart(part))
    : []
  const hasVisibleText = parts.some((part) =>
    part.type === "text" &&
    typeof part.text === "string" &&
    part.text.trim() &&
    !(part.audience && part.audience.ui === false) &&
    !(part.kind === "trace" && !part.audience?.ui),
  )
  if (hasVisibleText || !fallbackText.trim()) return parts
  return [
    ...parts,
    {
      type: "text" as const,
      text: fallbackText,
      synthetic: true,
      kind: "control" as const,
      source: "system" as const,
      audience: {
        model: false,
        ui: true,
        acp: false,
      },
    },
  ]
}

function timelineMessagePart(part: MessageV2.Part): TimelinePartRecord[] {
  if (part.type === "text") {
    return [{
      type: "text" as const,
      text: part.text,
      ...(part.synthetic !== undefined ? { synthetic: part.synthetic } : {}),
      ...(part.ignored !== undefined ? { ignored: part.ignored } : {}),
      ...(part.kind ? { kind: part.kind } : {}),
      ...(part.source ? { source: part.source } : {}),
      ...(part.audience ? { audience: part.audience } : {}),
      ...(part.time ? { time: part.time } : {}),
      ...(part.metadata ? { metadata: part.metadata } : {}),
    }]
  }
  if (part.type === "reasoning") {
    return [{
      type: "reasoning" as const,
      text: part.text,
      time: part.time,
      ...(part.metadata ? { metadata: part.metadata } : {}),
    }]
  }
  if (part.type === "file") {
    return [{
      type: "file" as const,
      mime: part.mime,
      url: part.url,
      ...(part.filename ? { filename: part.filename } : {}),
      ...(part.source ? { source: part.source } : {}),
    }]
  }
  if (part.type === "tool") {
    return [{
      type: "tool" as const,
      callID: part.callID,
      tool: part.tool,
      state: part.state,
      ...(part.metadata ? { metadata: part.metadata } : {}),
    }]
  }
  if (part.type === "patch") {
    return [{
      type: "patch" as const,
      hash: part.hash,
      files: part.files,
    }]
  }
  if (part.type === "subtask") {
    return [{
      type: "subtask" as const,
      prompt: part.prompt,
      description: part.description,
      agent: part.agent,
      ...(part.model ? { model: part.model } : {}),
      ...(part.command ? { command: part.command } : {}),
    }]
  }
  if (part.type === "compaction") {
    return [{
      type: "compaction" as const,
      auto: part.auto,
    }]
  }
  return []
}

function emitStreamText(state: StreamState, partID: string, text: string, onEvent: StreamCallback) {
  const prev = state.text.get(partID) ?? ""
  if (!text || text === prev) return
  state.text.set(partID, text)
  if (text.startsWith(prev)) {
    onEvent({ type: "message_delta", delta: text.slice(prev.length) })
    return
  }
  onEvent({ type: "message_replace", text })
}

function emitStreamReasoning(state: StreamState, partID: string, text: string, onEvent: StreamCallback) {
  const prev = state.reasoning.get(partID) ?? ""
  if (!text || text === prev) return
  state.reasoning.set(partID, text)
  if (text.startsWith(prev)) {
    onEvent({ type: "reasoning_delta", delta: text.slice(prev.length) })
    return
  }
  onEvent({ type: "reasoning_replace", text })
}

function emitToolReasoning(
  state: StreamState,
  part: MessageV2.ToolPart,
  locale: "zh" | "en",
  onEvent: StreamCallback,
) {
  const text = toolReasoning(part, locale)
  if (!text) return
  emitStreamReasoning(state, `tool:${part.id}`, text, onEvent)
}

function toolReasoning(part: MessageV2.ToolPart, locale: "zh" | "en") {
  const status = typeof part.state?.status === "string" ? part.state.status : ""
  const input = part.state?.input && typeof part.state.input === "object" && !Array.isArray(part.state.input)
    ? part.state.input
    : {}
  const action = typeof input.action === "string" ? input.action : ""
  const name = toolActionLabel(part.tool, action, locale)
  if (!name) return ""
  if (status === "completed") {
    return locale === "zh"
      ? `${name}已完成。`
      : `${name} completed.`
  }
  if (status === "error") {
    return locale === "zh"
      ? `${name}失败。`
      : `${name} failed.`
  }
  return locale === "zh"
    ? `正在${name}...`
    : `Running ${name}...`
}

function toolActionLabel(tool: string, action: string, locale: "zh" | "en") {
  if (tool !== "panel") {
    if (!tool) return ""
    return locale === "zh" ? `调用 ${tool}` : `tool ${tool}`
  }
  if (action === "create_task") {
    return locale === "zh" ? "创建任务并启动规划" : "task creation and planning"
  }
  if (action === "send_task_message") {
    return locale === "zh" ? "发送任务消息" : "task messaging"
  }
  if (action === "reply_interaction") {
    return locale === "zh" ? "回复待处理交互" : "replying to the pending interaction"
  }
  if (action === "reject_interaction") {
    return locale === "zh" ? "拒绝待处理交互" : "rejecting the pending interaction"
  }
  if (action === "update_checks") {
    return locale === "zh" ? "更新验收检查" : "updating acceptance checks"
  }
  if (action === "view_spec") {
    return locale === "zh" ? "读取规格" : "loading the specification"
  }
  if (action === "view_plan") {
    return locale === "zh" ? "读取计划" : "loading the plan"
  }
  if (action === "view_board" || action === "view_tasks") {
    return locale === "zh" ? "读取任务看板" : "loading the task board"
  }
  if (action === "retry_task") {
    return locale === "zh" ? "重新排队任务" : "queueing a retry"
  }
  if (action === "replan_task") {
    return locale === "zh" ? "重新生成计划" : "queueing a replan"
  }
  if (action === "cancel_task") {
    return locale === "zh" ? "取消任务" : "cancelling the task"
  }
  if (action === "update_budget") {
    return locale === "zh" ? "更新任务预算" : "updating the task budget"
  }
  if (action === "capture_overlay_screenshot") {
    return locale === "zh" ? "截取面板截图" : "capturing the panel screenshot"
  }
  if (action === "call_panel_api") {
    return locale === "zh" ? "调用控制面 API" : "calling the panel API"
  }
  if (action === "set_executor") {
    return locale === "zh" ? "切换执行器" : "switching the executor"
  }
  if (action === "select_task") {
    return locale === "zh" ? "切换任务" : "selecting the task"
  }
  return locale === "zh" ? "执行控制面操作" : "running the panel action"
}

function controlStreamIntro(text: "zh" | "en") {
  return text === "zh"
    ? "正在分析请求并规划下一步..."
    : "Analyzing the request and planning the next action..."
}

function streamLocale(text: string) {
  return /[\u3400-\u9fff]/.test(text) ? "zh" : "en"
}

function structuredMessageText(input: unknown) {
  if (!input) return undefined
  if (typeof input === "string") return structuredMessageFromRaw(input)
  if (typeof input !== "object" || Array.isArray(input)) return undefined
  if (!("message" in input)) return undefined
  return typeof input.message === "string" ? input.message : undefined
}

function structuredMessageFromRaw(raw: string) {
  const parsed = (() => {
    try {
      return JSON.parse(raw)
    } catch {
      return undefined
    }
  })()
  if (parsed) return structuredMessageText(parsed)
  const match = raw.match(/"message"\s*:\s*"/s)
  if (!match) return undefined
  if (typeof match.index !== "number") return undefined
  return decodeJsonStringPrefix(raw.slice(match.index + match[0].length))
}

function decodeJsonStringPrefix(input: string) {
  let result = ""
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]
    if (char === "\"") return result
    if (char !== "\\") {
      result += char
      continue
    }
    i += 1
    if (i >= input.length) return result
    const escape = input[i]
    if (escape === "u") {
      const code = input.slice(i + 1, i + 5)
      if (!/^[0-9a-fA-F]{4}$/.test(code)) return result
      result += String.fromCharCode(Number.parseInt(code, 16))
      i += 4
      continue
    }
    if (escape === "\"") {
      result += "\""
      continue
    }
    if (escape === "\\") {
      result += "\\"
      continue
    }
    if (escape === "/") {
      result += "/"
      continue
    }
    if (escape === "b") {
      result += "\b"
      continue
    }
    if (escape === "f") {
      result += "\f"
      continue
    }
    if (escape === "n") {
      result += "\n"
      continue
    }
    if (escape === "r") {
      result += "\r"
      continue
    }
    if (escape === "t") {
      result += "\t"
      continue
    }
    return result
  }
  return result
}

async function resolveModel() {
  const agentName = await Agent.defaultAgent().catch((err) => {
    log.warn("failed to resolve default agent for model", { error: String(err) })
    return undefined
  })
  if (!agentName) return undefined
  const agent = await Agent.get(agentName)
  const target = agent?.model
  if (target) return target
  return Provider.defaultModel().catch((err) => {
    log.warn("failed to resolve default model", { error: String(err) })
    return undefined
  })
}

async function systemPrompt(input: z.infer<typeof ControlMessageInput>) {
  const skill = await Skill.get("panel-control")
  const lines = [
    "You are the core OpenCorvus agent operating in control-plane mode.",
    "Always respond in the same language as the user's message. Default to Chinese (简体中文) when the language is ambiguous.",
    "Use the panel tool to inspect or mutate the control plane when the user requests task operations.",
    "Do not perform coding work directly.",
    "Respond only through the required structured output schema.",
    "For greetings, general questions, or non-task messages, respond with kind=panel_response and a friendly, helpful message explaining what you can do (create tasks, check status, update checks, and control task execution).",
    "Never bypass the panel tool or rely on local UI shortcuts.",
    "Treat metadata as explicit UI context. When metadata provides concrete IDs or target values, prefer those targets over guessing from the text.",
    "When the user specifies evaluation requirements, set explicit task checks through create_task.checks or update_checks instead of relying on planner goals alone.",
    "Only create a new task when allow_create is true and the user explicitly asked you to start or execute work.",
    "For create_task, always place the user's work request in create_task.request.",
    "For create_task.checks, build/test/lint/verify_cmd must be arrays of command strings or false; do not emit bare boolean true.",
    "Desktop panel is task-first. When the user asks to manage sessions on surface=panel, respond with kind=panel_response explaining that overlay only exposes tasks and session management is unavailable there.",
    "When a panel action returns file or image attachments, copy them into the structured result attachments field.",
    "",
    `Surface: ${input.surface}`,
    input.surface === "panel"
      ? "Local panel actions are allowed."
      : "Local panel focus actions are NOT allowed on this surface.",
    input.allow_create
      ? "Task creation is allowed for this request."
      : "Do not create a new task for this request.",
    input.allow_session_mutation
      ? "Session mutation is allowed for this request."
      : "Do not create, fork, or delete sessions for this request.",
    "",
    "Available panel actions on this surface:",
    panelCapabilityPrompt(input.surface),
  ]
  if (skill) {
    lines.push("", skill.content.trim())
  }
  return lines.join("\n")
}

function buildUserParts(input: z.infer<typeof ControlMessageInput>) {
  return [
    {
      type: "text" as const,
      text: input.text,
    },
    ...(input.attachments ?? []).map((item) => ({
      type: "file" as const,
      url: item.url,
      mime: item.mime,
      ...(item.filename ? { filename: item.filename } : {}),
    })),
    {
      type: "text" as const,
      text: JSON.stringify({
        surface: input.surface,
        text: input.text,
        time_created: input.time_created,
        taskID: input.taskID,
        sessionID: input.sessionID,
        executor: input.executor,
        channel: input.channel,
        thread: input.thread,
        source: input.source,
        allow_create: input.allow_create,
        allow_session_mutation: input.allow_session_mutation,
        attachments: (input.attachments ?? []).map((item) => ({
          mime: item.mime,
          filename: item.filename,
        })),
        metadata: input.metadata,
        request_id: input.request_id,
      }),
      kind: "control" as const,
      source: "system" as const,
      audience: {
        model: true,
        ui: false,
        acp: false,
      },
    },
  ]
}

async function panelTools() {
  const ids = await ToolRegistry.ids()
  return Object.fromEntries(ids.map((id) => [id, id === "panel"]))
}

function messageError(message: MessageV2.WithParts) {
  if (message.info.role !== "assistant" || !message.info.error) return ""
  const text = Reflect.get(message.info.error, "message")
  if (typeof text === "string" && text.trim()) return text.trim()
  const data = Reflect.get(message.info.error, "data")
  const nested = data && typeof data === "object" ? Reflect.get(data, "message") : undefined
  return typeof nested === "string" ? nested.trim() : ""
}

function defaultSource(surface: z.infer<typeof ControlMessageInput>["surface"]) {
  if (surface === "panel") return "panel"
  return `channel:${surface}`
}

async function resolveSession(input: z.infer<typeof ControlMessageInput>) {
  const persistent = input.surface !== "panel" && !!input.sessionID
  if (persistent && input.sessionID) {
    return {
      info: await Session.get(input.sessionID),
      created: false,
      persistent: true,
      keep: true,
    } satisfies ControlSession
  }
  const info = await Session.create({
    title: `Control (${input.surface})`,
  })
  return {
    info,
    created: true,
    persistent,
    keep: false,
  } satisfies ControlSession
}

function finalizeResult(
  result: z.infer<typeof ControlMessageResult>,
  control: ControlSession | undefined,
  input: z.infer<typeof ControlMessageInput>,
) {
  if (!control) return normalizeResult(result, input)
  control.keep = shouldKeepSession(control, result)
  const next = !control.keep
    ? result
    : result.session_id
      ? result
      : ControlMessageResult.parse({
        ...result,
        session_id: control.info.id,
      })
  return normalizeResult(next, input)
}

function normalizeResult(result: z.infer<typeof ControlMessageResult>, input: z.infer<typeof ControlMessageInput>) {
  if (input.surface !== "panel") return result
  const action = result.local_action
  if (action && !PanelLocalAction.safeParse(action).success) {
    log.warn("panel returned unsupported local action", {
      input: loggedInput(input),
      result: loggedResult(result),
    })
    return ControlMessageResult.parse({
      kind: "panel_response",
      message: "Desktop overlay only exposes tasks. Session management is unavailable there.",
    })
  }
  return ControlMessageResult.parse({
    ...result,
    session_id: undefined,
  })
}

function shouldKeepSession(control: ControlSession, result: z.infer<typeof ControlMessageResult>) {
  if (!control.persistent) return false
  if (result.task_id) return false
  if (result.session_id && result.session_id !== control.info.id) return false
  return true
}

function shouldAppendTimeline(
  input: z.infer<typeof ControlMessageInput>,
  result: z.infer<typeof ControlMessageResult>,
  control?: ControlSession,
) {
  return true
}

function shouldRemoveSession(control?: ControlSession) {
  if (!control) return false
  if (!control.created) return false
  return !control.keep
}

async function appendSummary(sessionID: string, message: MessageV2.WithParts, text: string) {
  if (message.info.role !== "assistant") return
  const now = Date.now()
  const info = await Session.updateMessage({
    ...message.info,
    id: Identifier.ascending("message"),
    sessionID,
    summary: true,
    structured: undefined,
    time: {
      created: now,
      completed: now,
    },
  })
  await Session.updatePart({
    id: Identifier.ascending("part"),
    sessionID,
    messageID: info.id,
    type: "text",
    text,
    synthetic: true,
    kind: "control",
    source: "system",
    audience: {
      model: false,
      ui: true,
      acp: false,
    },
  })
  await Session.touch(sessionID)
}

function scope(input: z.infer<typeof ControlMessageInput>, result: z.infer<typeof ControlMessageResult>) {
  const taskID = result.task_id ?? input.taskID
  if (taskID) {
    const sessionID = result.session_id ?? input.sessionID ?? taskSession(taskID)
    return {
      taskID,
      ...(sessionID ? { sessionID } : {}),
    }
  }
  if (!input.sessionID && input.surface === "panel") {
    return {}
  }
  const sessionID = result.session_id ?? input.sessionID
  return sessionID ? { sessionID } : {}
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

function loggedInput(input: z.infer<typeof ControlMessageInput>) {
  return {
    surface: input.surface,
    text: input.text,
    ...(typeof input.time_created === "number" ? { time_created: input.time_created } : {}),
    ...(input.taskID ? { taskID: input.taskID } : {}),
    ...(input.sessionID ? { sessionID: input.sessionID } : {}),
    ...(input.executor ? { executor: input.executor } : {}),
    ...(input.channel ? { channel: input.channel } : {}),
    ...(input.thread ? { thread: input.thread } : {}),
    ...(input.user_id ? { user_id: input.user_id } : {}),
    ...(input.request_id ? { request_id: input.request_id } : {}),
    ...(input.source ? { source: input.source } : {}),
    allow_create: input.allow_create,
    ...(input.attachments?.length
      ? {
          attachments: input.attachments.map((item) => ({
            mime: item.mime,
            ...(item.filename ? { filename: item.filename } : {}),
          })),
        }
      : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }
}

function loggedResult(result: z.infer<typeof ControlMessageResult>) {
  return {
    kind: result.kind,
    message: result.message,
    ...(result.task_id ? { task_id: result.task_id } : {}),
    ...(result.session_id ? { session_id: result.session_id } : {}),
    ...(result.interaction_id ? { interaction_id: result.interaction_id } : {}),
    ...(result.local_action ? { local_action: result.local_action } : {}),
    ...(result.attachments ? { attachments: result.attachments } : {}),
  }
}
