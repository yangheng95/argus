import z from "zod"
import { Agent } from "@/agent/agent"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { Message } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { ToolRegistry } from "@/tool/registry"
import { Database, eq } from "@/storage/db"
import { EngineTaskTable } from "@/engine"
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

  export async function handleStream(raw: z.input<typeof ControlMessageInput>, onEvent: StreamCallback) {
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
  const model = await resolveModel(input.model)
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
    return { result, timeline: false } satisfies RunResult
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
      unsubs.push(
        Bus.subscribe(Message.Event.PartUpdated, (event) => {
          const part = event.properties.part as Record<string, unknown>
          if (part.sessionID !== control?.info.id) return
          if (part.type === "tool") {
            onEvent({ type: "tool", tool: part.tool as string })
          }
        }),
      )
      onEvent({ type: "start" })
    }

    const agent = "control"
    const system = await systemPrompt(input)
    const parts = buildUserParts(input)
    const tools = await panelTools()
    const extra = {
      surface: input.surface,
      source: input.source ?? defaultSource(input.surface),
      ...(input.request_id ? { requestID: input.request_id } : {}),
      originalText: input.text,
      // Pass raw attachments so panel tool handlers can decode them into the task request
      attachments: input.attachments ?? [],
      // Forward web_search flag so panel tool handlers can propagate it to task metadata
      ...(input.metadata?.web_search === true ? { web_search: true } : {}),
    }

    const result = await SessionPrompt.prompt({
      sessionID: control.info.id,
      agent,
      model,
      system,
      systemMode: "complete",
      parts: parts as any,
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

    throw new Error(structuredOutputFailureMessage(result))
  } catch (error) {
    const output = finalizeResult(
      ControlMessageResult.parse({
        kind: "panel_response",
        message: `Control message processing failed: ${error instanceof Error ? error.message : String(error)}`,
      }),
      control,
    )
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
    if (shouldRemoveSession(control)) {
      // Best-effort cleanup in finally — if the session was already removed
      // (concurrent teardown) we move on; any real failure surfaces in the
      // log but does not mask the main-branch result.
      await Session.remove(control!.info.id).catch((err) =>
        log.warn("panel control session remove failed", { error: String(err) }),
      )
      log.info("panel control session removed", {
        input: payload,
        panel_session_id: control!.info.id,
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
        metadata: userTimelineMetadata(input),
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

function userTimelineMetadata(input: z.infer<typeof ControlMessageInput>) {
  return {
    kind: "control_input",
    allow_create: input.allow_create,
    ...(input.executor ? { executor: input.executor } : {}),
    ...(input.model ? { model: input.model } : {}),
    ...(input.taskID ? { task_id: input.taskID } : {}),
    ...(input.sessionID ? { session_id: input.sessionID } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    ...(input.attachments?.length
      ? {
          input_attachments: input.attachments.map((attachment) => ({
            mime: attachment.mime,
            ...(attachment.filename ? { filename: attachment.filename } : {}),
          })),
        }
      : {}),
  }
}

async function resolveModel(explicitModel?: string) {
  // Single model resolver (spec §13.1/§13.2). Agent.defaultAgent throws on
  // config issues (no visible agent, hidden default) — those surface.
  // resolveAgentModelRef gives base agent.<name>.model then base cfg.model
  // then MissingModelConfigError (control plane has no session overlay).
  // The strict no-default contract is preserved: when the operator hasn't
  // declared a model there is no safe pick — it must throw, not return
  // undefined into downstream prompts.
  const { resolveAgentModelRef } = await import("@/agent/model")
  return resolveAgentModelRef(await Agent.defaultAgent(), {
    explicitModel: explicitModel ? Provider.parseModel(explicitModel) : null,
  })
}

async function systemPrompt(input: z.infer<typeof ControlMessageInput>) {
  const lines = [
    "You are the core OpenCorvus agent operating in control-plane mode.",
    "Always respond in the same language as the user's message. Default to Chinese (简体中文) when the language is ambiguous.",
    "Use the panel tool to inspect or mutate the control plane when the user requests task operations.",
    "Respond only through the required structured output schema.",
    "When creating a task, always include a natural language acknowledgment in your message field explaining what you understand and will do.",
    "When creating a panel task, set create_task.queue=true only when the user explicitly wants the new task to queue; omit queue otherwise because omitted queue starts immediately and bypasses the directory queue.",
    "For greetings, general questions, or non-task messages, respond with kind=panel_response and a friendly, helpful message.",
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
  return lines.join("\n")
}

function buildUserParts(input: z.infer<typeof ControlMessageInput>) {
  const parts: Array<Record<string, unknown>> = [
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
        model: input.model,
        channel: input.channel,
        thread: input.thread,
        source: input.source,
        allow_create: input.allow_create,
        metadata: input.metadata,
        request_id: input.request_id,
      }),
      kind: "control" as const,
      source: "system" as const,
    },
  ]
  if (input.attachments?.length) {
    for (const att of input.attachments) {
      parts.push({
        type: "file" as const,
        mime: att.mime,
        url: att.url,
        ...(att.filename ? { filename: att.filename } : {}),
      })
    }
  }
  return parts
}

async function panelTools() {
  const ids = await ToolRegistry.ids()
  return Object.fromEntries(ids.map((id) => [id, id === "panel"]))
}

function assistantErrorText(message: Message.WithParts) {
  if (message.info.role !== "assistant" || !message.info.error) return
  const source = `${message.info.providerID}/${message.info.modelID}`
  const error = message.info.error
  const status =
    "statusCode" in error.data && typeof error.data.statusCode === "number" ? `, status ${error.data.statusCode}` : ""
  const detail = "message" in error.data && typeof error.data.message === "string" ? error.data.message : undefined
  if (detail) return `Provider error (${source}${status}): ${detail}`
  return `Provider error (${source}): ${error.name}`
}

export function structuredOutputFailureMessage(message: Message.WithParts) {
  const rawError = assistantErrorText(message)
  if (rawError) return rawError
  return "Control message did not produce the required structured output."
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
    kind: "assistant",
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
  if (control.keep) return false
  return !(input.surface === "panel" && !input.taskID && !result.task_id)
}

function shouldRemoveSession(control?: ControlSession) {
  if (!control) return false
  if (!control.created) return false
  return !control.keep
}

async function appendSummary(sessionID: string, message: Message.WithParts, text: string) {
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
    kind: "control",
    source: "system",
  })
  await Session.touch(sessionID)
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
      .select({ sessionID: EngineTaskTable.session_id })
      .from(EngineTaskTable)
      .where(eq(EngineTaskTable.id, taskID))
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
    ...(input.model ? { model: input.model } : {}),
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
