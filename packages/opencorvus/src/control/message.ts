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
import { ControlMessageInput, ControlMessageResult } from "./message-schema"
import { ControlTimeline } from "./timeline"

const ResultSchema = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: ["panel_response", "created", "message", "interaction"],
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
    "IMPORTANT: If the user sends a greeting, casual message, or non-command text (e.g. '你好', 'hello', 'hi'),",
    "respond with kind 'panel_response' and a friendly message that briefly explains what you can do:",
    "create tasks, view task status, manage sessions, retry/replan tasks, etc.",
    "Always respond with something helpful.",
    "",
    "If the user's message looks like a task request (asking to build, fix, implement something),",
    "use the panel tool with action 'create_task' to create a new task from their request.",
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
