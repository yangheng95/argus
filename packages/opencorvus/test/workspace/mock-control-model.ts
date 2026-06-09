import { spyOn } from "bun:test"
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
  LanguageModelV3StreamResult,
  LanguageModelV3ToolCall,
  LanguageModelV3ToolResultPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider"
import { Provider } from "../../src/provider/provider"

const channelPlatforms = new Set([
  "slack",
  "telegram",
  "discord",
  "feishu",
  "whatsapp",
  "googlechat",
  "msteams",
  "line",
  "matrix",
  "mattermost",
  "signal",
  "wecom",
  "dingtalk",
  "qq",
])

const model = Provider.Model.parse({
  id: "control",
  providerID: "mock-control",
  api: {
    id: "control",
    url: "mock://control",
    npm: "@ai-sdk/openai-compatible",
  },
  name: "Mock Control",
  capabilities: {
    temperature: false,
    reasoning: false,
    attachment: false,
    toolcall: true,
    input: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    output: {
      text: true,
      audio: false,
      image: false,
      video: false,
      pdf: false,
    },
    interleaved: false,
  },
  cost: {
    input: 0,
    output: 0,
    cache: {
      read: 0,
      write: 0,
    },
  },
  limit: {
    context: 8192,
    output: 2048,
  },
  status: "active",
  options: {},
  headers: {},
  release_date: "2026-03-08",
  variants: {},
})

const provider = Provider.Info.parse({
  id: "mock-control",
  name: "Mock Control",
  source: "custom",
  env: [],
  options: {},
  models: {
    control: model,
  },
})

export function installControlModel() {
  const language = new TestLanguageModel({
    provider: "mock-control",
    modelId: "control",
    doStream: async (input) => stream(input),
  })
  spyOn(Provider, "defaultModel").mockResolvedValue({
    providerID: "mock-control",
    modelID: "control",
  })
  spyOn(Provider, "getLanguage").mockResolvedValue(language)
  spyOn(Provider, "getModel").mockResolvedValue(model)
  spyOn(Provider, "getProvider").mockResolvedValue(provider)
  return { language, model, provider }
}

const emptyUsage: LanguageModelV3Usage = {
  inputTokens: {
    total: 0,
    noCache: 0,
    cacheRead: 0,
    cacheWrite: 0,
  },
  outputTokens: {
    total: 0,
    text: 0,
    reasoning: 0,
  },
}

function stream(input: LanguageModelV3CallOptions) {
  const tool = lastToolResult(input.prompt, "panel")
  if (tool) {
    return streamCall("StructuredOutput", structured(tool))
  }
  return streamCall("panel", action(input.prompt))
}

function streamCall(toolName: string, value: Record<string, unknown>) {
  const callID = `call_${toolName.toLowerCase()}`
  const raw = JSON.stringify(value)
  return {
    stream: new ReadableStream<LanguageModelV3StreamPart>({
      start(controller) {
        controller.enqueue({
          type: "stream-start",
          warnings: [],
        })
        controller.enqueue({
          type: "tool-input-start",
          id: callID,
          toolName,
        })
        controller.enqueue({
          type: "tool-input-delta",
          id: callID,
          delta: raw,
        })
        controller.enqueue({
          type: "tool-input-end",
          id: callID,
        })
        controller.enqueue({
          type: "tool-call",
          toolCallId: callID,
          toolName,
          input: raw,
        } satisfies LanguageModelV3ToolCall)
        controller.enqueue({
          type: "finish",
          finishReason: {
            reason: "tool-calls",
          },
          usage: emptyUsage,
        })
        controller.close()
      },
    }),
  } satisfies LanguageModelV3StreamResult
}

function action(prompt: LanguageModelV3Prompt) {
  const input = userInput(prompt)
  const meta = object(input.metadata) ?? {}
  const sessionID = text(meta.sessionID, input.sessionID)
  const taskID = text(meta.taskID, input.taskID)
  const interactionID = text(meta.interactionID)
  const goalID = text(meta.goalID)
  const executor = text(meta.executor, input.executor)
  const reply = text(meta.reply)
  const answer = text(meta.answer)
  const criteria = text(meta.criteria)
  const description = text(meta.description)
  const ui = text(meta.ui_context)
  if (interactionID && /reject/i.test(input.text)) {
    return {
      action: "reject_interaction",
      interactionID,
    }
  }
  if (interactionID && (reply || answer || /reply|allow|answer/i.test(input.text))) {
    return {
      action: "reply_interaction",
      interactionID,
      ...(reply ? { reply } : {}),
      ...(answer ? { message: answer } : {}),
    }
  }
  if (goalID && /delete/i.test(input.text)) {
    return {
      action: "delete_goal",
      goalID,
    }
  }
  if (goalID && description) {
    return {
      action: "update_goal",
      goalID,
      description,
      criteria: criteria ?? "The requested change is implemented and acceptance checks pass.",
    }
  }
  if (taskID && meta.selection && ui === "criteria") {
    return {
      action: "update_checks",
      taskID,
      selection: object(meta.selection),
    }
  }
  if (/查看\s*plan|view\s+plan/i.test(input.text) && taskID) {
    return {
      action: "view_plan",
      taskID,
    }
  }
  if (/switch executor|切换.*executor|use executor|executor/i.test(input.text) && executor) {
    return {
      action: "set_executor",
      executor,
    }
  }
  if (/create .*session|new blank session|new session/i.test(input.text)) {
    return {
      action: "create_session",
    }
  }
  if (sessionID && /fork session|fork /i.test(input.text)) {
    return {
      action: "fork_session",
      sessionID,
    }
  }
  if (sessionID && /delete session|delete task session/i.test(input.text)) {
    return {
      action: "delete_session",
      sessionID,
    }
  }
  if (taskID && /perform retry|retry/i.test(input.text)) {
    return {
      action: "retry_task",
      taskID,
    }
  }
  if (taskID && /perform replan|replan/i.test(input.text)) {
    return {
      action: "replan_task",
      taskID,
    }
  }
  if (taskID && /perform cancel|cancel/i.test(input.text)) {
    return {
      action: "cancel_task",
      taskID,
    }
  }
  if (taskID) {
    return {
      action: "send_task_message",
      taskID,
      text: input.text,
      source: text(input.source) ?? (input.surface === "panel" ? "panel" : `channel:${input.surface}`),
      user_id: text(input.user_id),
    }
  }
  if (input.allow_create !== false) {
    return {
      action: "create_task",
      request: input.text,
      executor,
      request_id: text(input.request_id),
      platform: input.surface === "panel" ? undefined : platform(input.surface, input.source),
      channel: text(input.channel),
      thread: text(input.thread),
      metadata: object(input.metadata),
      source: text(input.source) ?? (input.surface === "panel" ? "panel" : `channel:${input.surface}`),
      allow_create: input.allow_create,
      queue: false,
    }
  }
  return {
    action: "view_board",
    taskID,
  }
}

function structured(part: LanguageModelV3ToolResultPart) {
  const raw = part.output.type.endsWith("json")
    ? part.output.value
    : typeof part.output.value === "string"
      ? (parse(part.output.value) ?? {
          kind: "panel_response",
          message: part.output.value,
        })
      : {
          kind: "panel_response",
          message: String(part.output.value),
        }
  return (
    object(raw) ?? {
      kind: "panel_response",
      message: "Control action completed.",
    }
  )
}

function userInput(prompt: LanguageModelV3Prompt) {
  const item = [...prompt].reverse().find((entry) => entry.role === "user")
  const parts = !item ? [] : item.content.filter((part) => part.type === "text").map((part) => part.text)
  const textValue = parts.length === 0 ? "" : parts.join("\n")
  const parsed =
    [...parts]
      .reverse()
      .map(parse)
      .find((value) => !!object(value)) ?? parse(textValue)
  return object(parsed) ?? { text: textValue }
}

function lastToolResult(prompt: LanguageModelV3Prompt, name: string) {
  for (const entry of [...prompt].reverse()) {
    if (!Array.isArray(entry.content)) continue
    for (const part of [...entry.content].reverse()) {
      if (part.type === "tool-result" && part.toolName === name) {
        return part
      }
    }
  }
}

function parse(value: string) {
  try {
    return JSON.parse(value)
  } catch {
    return
  }
}

function object(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return
  return value as Record<string, any>
}

function text(...values: Array<unknown>) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return undefined
}

function platform(surface?: string, source?: string) {
  if (surface && channelPlatforms.has(surface)) return surface
  if (!source?.startsWith("channel:")) return undefined
  const value = source.slice("channel:".length)
  return channelPlatforms.has(value) ? value : undefined
}

class TestLanguageModel implements LanguageModelV3 {
  readonly specificationVersion = "v3" as const
  readonly supportedUrls = Promise.resolve({})

  constructor(
    readonly input: {
      provider: string
      modelId: string
      doStream: LanguageModelV3["doStream"]
    },
  ) {}

  get provider() {
    return this.input.provider
  }

  get modelId() {
    return this.input.modelId
  }

  async doGenerate(): Promise<LanguageModelV3GenerateResult> {
    throw new Error("TestLanguageModel.doGenerate is not implemented")
  }

  async doStream(options: LanguageModelV3CallOptions) {
    return this.input.doStream(options)
  }
}
