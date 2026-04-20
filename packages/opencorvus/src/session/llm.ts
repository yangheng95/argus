import { Provider } from "@/provider/provider"
import { ProviderLLM } from "@/provider/llm"
import { Log } from "@/util/log"
import {
  streamText,
  type ModelMessage,
  type StreamTextResult,
  type Tool,
  type ToolSet,
} from "ai"
import { mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { Config } from "@/config/config"
import { Instance } from "@/project/instance"
import type { Agent } from "@/agent/agent"
import type { Message } from "./message"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"
import { Auth } from "@/auth"

export namespace LLM {
  const log = Log.create({ service: "llm" })
  export const OUTPUT_TOKEN_MAX = ProviderTransform.OUTPUT_TOKEN_MAX

  export type StreamInput = {
    user: Message.User
    sessionID: string
    model: Provider.Model
    agent: Agent.Info
    system: string[]
    abort: AbortSignal
    messages: ModelMessage[]
    small?: boolean
    tools: Record<string, Tool>
    retries?: number
    toolChoice?: "auto" | "required" | "none"
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  export type StreamResult = StreamTextResult<ToolSet, unknown> & {
    pauseInactivityTimer: (() => void) | undefined
    resumeInactivityTimer: (() => void) | undefined
  }

  export async function stream(input: StreamInput): Promise<StreamResult> {
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", input.agent.name)
      .tag("mode", input.agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model),
      Config.get(),
      Provider.getProvider(input.model.providerID),
      Auth.get(input.model.providerID),
    ])
    const isOpenaiOauth = provider.id === "openai" && auth?.type === "oauth"

    const system: string[] = []
    const providerPrompt = input.agent.prompt ? [input.agent.prompt] : await SystemPrompt.provider(input.model)
    system.push(
      [
        // use agent prompt otherwise provider prompt
        ...providerPrompt,
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...(input.user.system ? [input.user.system] : []),
      ]
        .filter((x) => x)
        .join("\n"),
    )

    const header = system[0]
    await Plugin.trigger(
      "experimental.chat.system.transform",
      { sessionID: input.sessionID, model: input.model },
      { system },
    )
    // rejoin to maintain 2-part structure for caching if header unchanged
    if (system.length > 2 && system[0] === header) {
      const rest = system.slice(1)
      system.length = 0
      system.push(header, rest.join("\n"))
    }

    const variant =
      !input.small && input.model.variants && input.user.variant ? input.model.variants[input.user.variant] : {}
    const base = input.small
      ? ProviderTransform.smallOptions(input.model)
      : ProviderTransform.options({
          model: input.model,
          sessionID: input.sessionID,
          providerOptions: provider.options,
        })
    const options: Record<string, any> = pipe(
      base,
      mergeDeep(input.model.options),
      mergeDeep(input.agent.options),
      mergeDeep(variant),
    )
    if (isOpenaiOauth) {
      options.instructions = system.join("\n")
    }

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (input.agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: input.agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent: input.agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const maxOutputTokens = ProviderTransform.maxOutputTokens(input.model)

    const tools = await resolveTools(input)
    const providerOptions = ProviderTransform.providerOptions(input.model, params.options)
    const requestHeaders = {
      ...(input.model.providerID.startsWith("opencorvus")
        ? {
            "x-opencorvus-project": Instance.project.id,
            "x-opencorvus-session": input.sessionID,
            "x-opencorvus-request": input.user.id,
            "x-opencorvus-client": Flag.OPENCORVUS_CLIENT,
          }
        : ProviderLLM.baseHeaders(input.model, input.sessionID)),
      ...headers,
    }
    const requestMessages = [
      ...system.map(
        (x): ModelMessage => ({
          role: "system",
          content: x,
        }),
      ),
      ...input.messages,
    ]

    const STREAM_INACTIVITY_MS = 2 * 60 * 1000

    const inactivityAbort = new AbortController()
    let inactivityTimer: ReturnType<typeof setTimeout> | undefined

    const resetInactivityTimer = () => {
      if (inactivityTimer !== undefined) clearTimeout(inactivityTimer)
      inactivityTimer = setTimeout(() => {
        l.warn("stream inactivity timeout", { inactivityMs: STREAM_INACTIVITY_MS, modelID: input.model.id, providerID: input.model.providerID })
        inactivityAbort.abort(new Error(`LLM stream stalled: no tokens received for ${STREAM_INACTIVITY_MS / 1000}s`))
      }, STREAM_INACTIVITY_MS)
    }

    const clearInactivityTimer = () => {
      if (inactivityTimer !== undefined) {
        clearTimeout(inactivityTimer)
        inactivityTimer = undefined
      }
    }

    resetInactivityTimer()
    input.abort.addEventListener("abort", clearInactivityTimer, { once: true })

    const result = streamText({
      onChunk() {
        resetInactivityTimer()
      },
      onError(event) {
        clearInactivityTimer()
        l.error("stream error", {
          error: event.error,
        })
      },
      onAbort() {
        clearInactivityTimer()
      },
      onFinish() {
        clearInactivityTimer()
      },
      async experimental_repairToolCall(failed) {
        const lower = failed.toolCall.toolName.toLowerCase()
        if (lower !== failed.toolCall.toolName && tools[lower]) {
          l.info("repairing tool call", {
            tool: failed.toolCall.toolName,
            repaired: lower,
          })
          return {
            ...failed.toolCall,
            toolName: lower,
          }
        }
        return {
          ...failed.toolCall,
          input: JSON.stringify({
            tool: failed.toolCall.toolName,
            error: failed.error?.message ?? "unknown error",
          }),
          toolName: "invalid",
        }
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions,
      activeTools: Object.keys(tools).filter((x) => x !== "invalid"),
      tools,
      toolChoice: input.toolChoice,
      maxOutputTokens,
      abortSignal: AbortSignal.any([input.abort, inactivityAbort.signal]),
      headers: requestHeaders,
      maxRetries: input.retries ?? 0,
      messages: requestMessages,
      model: ProviderLLM.wrapModel(language, input.model, options),
      experimental_telemetry: {
        isEnabled: cfg.experimental?.openTelemetry,
        metadata: {
          userId: cfg.username ?? "unknown",
          sessionId: input.sessionID,
        },
      },
    })
    const streamResult: StreamResult = Object.assign(result, {
      pauseInactivityTimer: clearInactivityTimer,
      resumeInactivityTimer: resetInactivityTimer,
    })
    return streamResult
  }

  async function resolveTools(input: Pick<StreamInput, "tools" | "agent" | "user">) {
    const disabled = PermissionNext.disabled(Object.keys(input.tools), input.agent.permission)
    for (const tool of Object.keys(input.tools)) {
      if (input.user.tools?.[tool] === false || disabled.has(tool)) {
        delete input.tools[tool]
      }
    }
    return input.tools
  }

}
