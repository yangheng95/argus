import { Provider } from "@/provider/provider"
import { ProviderLLM } from "@/provider/llm"
import { Log } from "@/util/log"
import type { ModelMessage, StreamTextResult, Tool, ToolSet } from "ai"
// Use the wrapped streamText from @/llm/api — its Proxy returns
// `abortableIterable(fullStream, composed)`, which is the only thing that
// rescues a Bun-fetch-backed reader.read() from parking forever when the
// LLM-activity gate fires its abort signal. Importing the raw "ai" form
// bypassed the Proxy and silently parked sub-agents (architect, requirements,
// build) for 14–25 min during alibaba-coding-plan-cn streams (audit §12,
// 2026-04-30 r5/r6/r7 bench evidence). Rule 8 — single source.
import { streamText } from "@/llm/api"
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
import { AgentTrace } from "@/trace"

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
    /**
     * Tool-call enforcement passed straight through to streamText. The
     * three string forms ('auto' / 'required' / 'none') are the soft
     * controls; the object form pins the next call to a specific tool
     * (e.g. {type:'tool', toolName:'StructuredOutput'}) and is the only
     * structural guarantee the protocol gives us that the model cannot
     * keep selecting a different work tool to dodge finalisation. Use
     * the object form sparingly — once it is set, the model can ONLY
     * call that one tool, so it must already be in a state where the
     * work tools are no longer needed.
     */
    toolChoice?: "auto" | "required" | "none" | { type: "tool"; toolName: string }
  }

  export type StreamOutput = StreamTextResult<ToolSet, unknown>

  export type StreamResult = StreamTextResult<ToolSet, unknown>

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
    const toolChoice = input.toolChoice
    const providerOptions = ProviderTransform.providerOptions(
      input.model,
      ProviderTransform.optionsForToolChoice(input.model, params.options, toolChoice),
    )
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

    if (AgentTrace.isEnabled()) {
      AgentTrace.recordLLMRequest({
        sessionID: input.sessionID,
        agentName: input.agent.name,
        agentMode: input.agent.mode,
        model: { providerID: input.model.providerID, modelID: input.model.id },
        small: input.small,
        toolChoice,
        system,
        messages: requestMessages,
        tools: Object.entries(tools).map(([name, t]) => ({
          name,
          description:
            typeof (t as { description?: unknown }).description === "string"
              ? (t as { description: string }).description
              : undefined,
        })),
      })
    }

    const result = streamText({
      onError(event) {
        l.error("stream error", {
          error: event.error,
        })
      },
      async experimental_repairToolCall(failed) {
        // Sole legitimate repair: case-normalize a model-emitted tool name
        // (e.g. "Register_Traceability" → "register_traceability"). Anything
        // else — unknown tool, malformed input, schema violation — must
        // surface to the model as a real tool-error so it can retry with
        // the corrected call. Rewriting to a sentinel "invalid" tool was a
        // fallback (CLAUDE.md rule 1) that hid the real error and trapped
        // the model in a "tool 'invalid' unavailable" dead end with no
        // feedback path.
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
        // Returning null tells AI SDK "I couldn't fix it" — the SDK then
        // emits a tool-error part the model can read and retry against.
        return null
      },
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions,
      activeTools: Object.keys(tools),
      tools,
      toolChoice,
      maxOutputTokens,
      abortSignal: input.abort,
      // Disable the wrapper's 5 s default soft timeout — the LLM-activity
      // gate (`withLLMActivity` in session/processor.ts) is the canonical
      // idle/timeout authority and composes its own abort signal into
      // `input.abort`. A second timeout here would race it.
      timeoutMs: false,
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
    return result
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
