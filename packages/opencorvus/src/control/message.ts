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

const log = Log.create({ service: "control-message" })
const ResultSchema = z.toJSONSchema(ControlMessageResult)

type StreamCallback = (event: { type: string; [key: string]: unknown }) => void

export namespace ControlMessage {
  export async function handle(raw: z.input<typeof ControlMessageInput>) {
    const input = ControlMessageInput.parse(raw)
    const result = await run(input)
    appendTimeline(input, result)
    return result
  }

  export async function handleStream(
    raw: z.input<typeof ControlMessageInput>,
    onEvent: StreamCallback,
  ) {
    const input = ControlMessageInput.parse(raw)
    const result = await run(input, onEvent)
    appendTimeline(input, result)
    return result
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
    return result
  }

  let session: Awaited<ReturnType<typeof Session.create>> | undefined

  const unsubs: (() => void)[] = []

  try {
    session = await Session.create({
      title: `Panel control (${input.surface})`,
    })
    log.info("panel control session created", {
      input: payload,
      panel_session: session,
      stream: !!onEvent,
    })

    if (onEvent) {
      unsubs.push(
        Bus.subscribe(MessageV2.Event.PartUpdated, (event) => {
          const part = event.properties.part as Record<string, unknown>
          if (part.sessionID !== session?.id) return
          if (part.type === "tool") {
            onEvent({ type: "tool", tool: part.tool as string })
          }
        }),
      )
      onEvent({ type: "start" })
    }

    const agent = await Agent.defaultAgent()
    const system = await systemPrompt(input)
    const parts: Array<{ type: "text"; text: string }> = [{ type: "text", text: buildUserPrompt(input) }]
    const tools = await panelTools()
    const extra = {
      surface: input.surface,
      source: input.source ?? defaultSource(input.surface),
    }

    const result = await SessionPrompt.prompt({
      sessionID: session.id,
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
      const output = ControlMessageResult.parse(result.info.structured)
      log.info("panel request completed", {
        input: payload,
        panel_session_id: session.id,
        result: loggedResult(output),
      })
      return output
    }

    const text = textFromMessage(result)
    const output = parseTextAsResult(text)
    log.info("panel request completed", {
      input: payload,
      panel_session_id: session.id,
      result: loggedResult(output),
      fallback_text: text,
    })
    return output
  } catch (error) {
    const output = ControlMessageResult.parse({
      kind: "panel_response",
      message: `Control message processing failed: ${error instanceof Error ? error.message : String(error)}`,
    })
    log.error("panel request failed", {
      input: payload,
      panel_session_id: session?.id,
      error: error instanceof Error ? error.message : String(error),
      result: loggedResult(output),
    })
    return output
  } finally {
    for (const unsub of unsubs) unsub()
    if (session?.id) {
      await Session.remove(session.id).catch(() => undefined)
      log.info("panel control session removed", {
        input: payload,
        panel_session_id: session.id,
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
    "Always respond in the same language as the user's message. Default to Chinese (简体中文) when the language is ambiguous.",
    "Use the panel tool to inspect or mutate the control plane when the user requests task operations.",
    "Do not perform coding work directly.",
    "Respond only through the required structured output schema.",
    "For greetings, general questions, or non-task messages, respond with kind=panel_response and a friendly, helpful message explaining what you can do (create tasks, check status, manage sessions, etc.).",
    "Never bypass the panel tool or rely on local UI shortcuts.",
    "Treat metadata as explicit UI context. When metadata provides concrete IDs or target values, prefer those targets over guessing from the text.",
    "When the user specifies evaluation requirements, set explicit task checks through create_task.checks or update_checks instead of relying on planner goals alone.",
    "When a panel action returns file or image attachments, copy them into the structured result attachments field.",
    "",
    `Surface: ${input.surface}`,
    input.surface === "panel"
      ? "Local panel actions are allowed."
      : "Local panel focus actions are NOT allowed on this surface.",
    "",
    "Available panel actions on this surface:",
    panelCapabilityPrompt(input.surface),
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

function parseTextAsResult(text: string): z.infer<typeof ControlMessageResult> {
  // Try to parse as JSON directly
  try {
    return ControlMessageResult.parse(JSON.parse(text))
  } catch {}
  // Try to extract JSON from markdown code blocks
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (jsonMatch) {
    try {
      return ControlMessageResult.parse(JSON.parse(jsonMatch[1].trim()))
    } catch {}
  }
  // Fallback: treat entire text as the message
  return ControlMessageResult.parse({
    kind: "panel_response",
    message: text || "（模型未返回有效响应）",
  })
}

function defaultSource(surface: z.infer<typeof ControlMessageInput>["surface"]) {
  if (surface === "panel") return "panel"
  return `channel:${surface}`
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
