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
import { ControlMessageInput, ControlMessageResult } from "./message-schema"
import { ControlTimeline } from "./timeline"
import { Bus } from "@/bus"
import { Log } from "@/util/log"
import { Identifier } from "@/id/id"

const log = Log.create({ service: "control-message" })
const ResultSchema = z.toJSONSchema(ControlMessageResult)

type StreamCallback = (event: { type: string; [key: string]: unknown }) => void
type RunResult = {
  result: z.infer<typeof ControlMessageResult>
  timeline: boolean
}
type StreamState = {
  assistant: Set<string>
  raw: Map<string, string>
  text: Map<string, string>
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
    if (runResult.timeline) appendTimeline(input, runResult.result)
    return runResult.result
  }

  export async function handleStream(
    raw: z.input<typeof ControlMessageInput>,
    onEvent: StreamCallback,
  ) {
    const input = ControlMessageInput.parse(raw)
    const runResult = await run(input, onEvent)
    if (runResult.timeline) appendTimeline(input, runResult.result)
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
      const stream: StreamState = {
        assistant: new Set(),
        raw: new Map(),
        text: new Map(),
      }
      unsubs.push(
        Bus.subscribe(MessageV2.Event.Updated, (event) => {
          const info = event.properties.info
          if (info.sessionID !== control?.info.id) return
          if (info.role !== "assistant") return
          stream.assistant.add(info.id)
        }),
      )
      unsubs.push(
        Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
          const part = event.properties.part
          if (part.sessionID !== control?.info.id) return
          if (!stream.assistant.has(part.messageID)) return
          if (part.type !== "tool") return
          if (part.tool !== "StructuredOutput") {
            onEvent({ type: "tool", tool: part.tool })
            return
          }
          const text = structuredMessageText(part.state.input)
          if (!text) return
          emitStreamText(stream, part.id, text, onEvent)
        }),
      )
      unsubs.push(
        Bus.subscribe(MessageV2.Event.PartDelta, (event) => {
          const part = event.properties
          if (part.sessionID !== control?.info.id) return
          if (!stream.assistant.has(part.messageID)) return
          if (part.field === "text") {
            onEvent({ type: "message_delta", delta: part.delta })
            return
          }
          if (part.field !== "raw") return
          const raw = (stream.raw.get(part.partID) ?? "") + part.delta
          stream.raw.set(part.partID, raw)
          const text = structuredMessageText(raw)
          if (!text) return
          emitStreamText(stream, part.partID, text, onEvent)
        }),
      )
      onEvent({ type: "start" })
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
      ...(input.request_id ? { requestID: input.request_id } : {}),
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
      const output = finalizeResult(ControlMessageResult.parse(result.info.structured), control)
      if (control?.keep) {
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
      } satisfies RunResult
    }

    const text = textFromMessage(result)
    const output = finalizeResult(parseTextAsResult(text), control)
    if (control?.keep) {
      await appendSummary(control.info.id, result, output.message)
    }
    log.info("panel request completed", {
      input: payload,
      panel_session_id: control.info.id,
      result: loggedResult(output),
      fallback_text: text,
    })
    return {
      result: output,
      timeline: shouldAppendTimeline(input, output, control),
    } satisfies RunResult
  } catch (error) {
    const output = finalizeResult(ControlMessageResult.parse({
      kind: "panel_response",
      message: `Control message processing failed: ${error instanceof Error ? error.message : String(error)}`,
    }), control)
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

function appendTimeline(input: z.infer<typeof ControlMessageInput>, result: z.infer<typeof ControlMessageResult>) {
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
          ...(result.attachments ? { attachments: result.attachments } : {}),
        },
      },
    ],
  })
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
    "For greetings, general questions, or non-task messages, respond with kind=panel_response and a friendly, helpful message explaining what you can do (create tasks, check status, manage sessions, etc.).",
    "Never bypass the panel tool or rely on local UI shortcuts.",
    "Treat metadata as explicit UI context. When metadata provides concrete IDs or target values, prefer those targets over guessing from the text.",
    "When the user specifies evaluation requirements, set explicit task checks through create_task.checks or update_checks instead of relying on planner goals alone.",
    "Only create a new task when allow_create is true and the user explicitly asked you to start or execute work.",
    "Only create, fork, or delete sessions when allow_session_mutation is true and the user explicitly asked to manage sessions.",
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
    {
      type: "text" as const,
      text: JSON.stringify({
        surface: input.surface,
        text: input.text,
        taskID: input.taskID,
        sessionID: input.sessionID,
        executor: input.executor,
        channel: input.channel,
        thread: input.thread,
        source: input.source,
        allow_create: input.allow_create,
        allow_session_mutation: input.allow_session_mutation,
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

function textFromMessage(message: MessageV2.WithParts) {
  return message.parts
    .filter((part): part is Extract<typeof part, { type: "text" }> => part.type === "text")
    .map((part) => part.text)
    .join("\n")
}

function parseTextAsResult(text: string): z.infer<typeof ControlMessageResult> {
  // Cascading parse strategy: try progressively looser formats before falling
  // back to wrapping the raw text as a plain panel_response.  Each catch block
  // is intentionally empty so the next strategy is attempted silently.

  // Strategy 1 - the model returned well-formed JSON matching the schema.
  try {
    return ControlMessageResult.parse(JSON.parse(text))
  } catch {
    // JSON parse or schema validation failed; fall through to next strategy.
  }
  // Strategy 2 - the model wrapped its JSON inside a markdown code fence.
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) {
    try {
      return ControlMessageResult.parse(JSON.parse(jsonMatch[1].trim()))
    } catch {
      // Fenced content was not valid JSON or did not match schema; fall through.
    }
  }
  // Strategy 3 (fallback) - treat the entire text as a plain message.
  return ControlMessageResult.parse({
    kind: "panel_response",
    message: text || "（模型未返回有效响应）",
  })
}

function defaultSource(surface: z.infer<typeof ControlMessageInput>["surface"]) {
  if (surface === "panel") return "panel"
  return `channel:${surface}`
}

async function resolveSession(input: z.infer<typeof ControlMessageInput>) {
  const persistent = input.surface === "panel" && !input.taskID
  if (persistent && input.sessionID) {
    return {
      info: await Session.get(input.sessionID),
      created: false,
      persistent: true,
      keep: true,
    } satisfies ControlSession
  }
  const info = await Session.create({
    title: `Panel control (${input.surface})`,
  })
  return {
    info,
    created: true,
    persistent,
    keep: false,
  } satisfies ControlSession
}

function finalizeResult(result: z.infer<typeof ControlMessageResult>, control?: ControlSession) {
  if (!control) return result
  control.keep = shouldKeepSession(control, result)
  if (!control.keep) return result
  if (result.session_id) return result
  return ControlMessageResult.parse({
    ...result,
    session_id: control.info.id,
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
  if (!control) return true
  if (control.keep) return true
  return !(input.surface === "panel" && !input.taskID && !result.task_id)
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
    ...(input.taskID ? { taskID: input.taskID } : {}),
    ...(input.sessionID ? { sessionID: input.sessionID } : {}),
    ...(input.executor ? { executor: input.executor } : {}),
    ...(input.channel ? { channel: input.channel } : {}),
    ...(input.thread ? { thread: input.thread } : {}),
    ...(input.user_id ? { user_id: input.user_id } : {}),
    ...(input.request_id ? { request_id: input.request_id } : {}),
    ...(input.source ? { source: input.source } : {}),
    allow_create: input.allow_create,
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
