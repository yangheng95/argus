import { Provider } from "@/provider/provider"
import { ProviderLLM } from "@/provider/llm"
import { Log } from "@/util/log"
import { Bus } from "@/bus"
import type { ModelMessage, StopCondition, Tool, ToolSet } from "ai"
// Use the wrapped streamText from @/llm/api — its Proxy returns
// `abortableIterable(fullStream, composed)`, which is the only thing that
// rescues a Bun-fetch-backed reader.read() from parking forever when the
// LLM-activity gate fires its abort signal. Importing the raw "ai" form
// bypassed the Proxy and silently parked sub-agents (architect, requirements,
// build) for 14–25 min during alibaba-coding-plan-cn streams (audit §12,
// 2026-04-30 r5/r6/r7 bench evidence). Rule 8 — single source.
import { streamText } from "@/llm/api"
import type { TextHooks } from "@/llm/api"
import { mergeDeep, pipe } from "remeda"
import { ProviderTransform } from "@/provider/transform"
import { EffectiveConfig } from "@/config/effective"
import { Instance } from "@/project/instance"
import { Agent } from "@/agent/agent"
import { PromptProfile } from "@/agent/prompt-profile"
import { Message } from "./message"
import { SessionEvents } from "./events"
import { Plugin } from "@/plugin"
import { SystemPrompt } from "./system"
import { Flag } from "@/flag/flag"
import { PermissionNext } from "@/permission/next"
import { Auth } from "@/auth"
import { AgentTrace } from "@/trace"
import { sessionParentID, taskIDForSession } from "@/orchestrator/task-event"
import { resolveSessionOverlay } from "@/agent/model"

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
    stopWhen?: StopCondition<ToolSet> | Array<StopCondition<ToolSet>>
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
    stream?: TextHooks
    runtimeSystemMode?: "complete"
    preTerminalToolInputStart?: (input: {
      toolName: string
      toolCallID: string
    }) => { output: string; title: string; metadata: object } | undefined
  }

  export type StreamOutput = ReturnType<typeof streamText<ToolSet>>

  export type StreamResult = ReturnType<typeof streamText<ToolSet>>

  export async function composeSystem(input: {
    agent: Agent.Info
    model: Provider.Model
    system: string[]
    user: Message.User
    sessionID?: string
    runtimeSystemMode?: "complete"
  }) {
    const config = input.sessionID
      ? await EffectiveConfig.effective({ sessionID: input.sessionID })
      : await EffectiveConfig.effective()
    const agent = Agent.resolveSessionAgent(
      input.agent,
      await resolveSessionOverlay(input.sessionID ? { sessionID: input.sessionID } : undefined),
    )
    const completeSystemMode = input.runtimeSystemMode === "complete" || input.user.systemMode === "complete"
    const providerPrompt =
      completeSystemMode
        ? []
        : agent.prompt
          ? [
              PromptProfile.composeAgentPrompt({
                agentID: agent.name,
                base: agent.prompt,
                userAppend: agent.promptAppend,
                config,
              }),
            ]
          : await SystemPrompt.provider(input.model, { sessionID: input.sessionID })
    const userSystem = input.runtimeSystemMode === "complete" ? [] : input.user.system ? [input.user.system] : []

    return [
      [
        // use agent prompt otherwise provider prompt, unless caller supplied
        // a complete system prompt for this turn
        ...providerPrompt,
        // any custom prompt passed into this call
        ...input.system,
        // any custom prompt from last user message
        ...userSystem,
      ]
        .filter((x) => x)
        .join("\n"),
    ]
  }

  export async function stream(input: StreamInput): Promise<StreamResult> {
    const config = await EffectiveConfig.effective({ sessionID: input.sessionID })
    const overlay = await resolveSessionOverlay({ sessionID: input.sessionID })
    const agent = Agent.resolveSessionAgent(input.agent, overlay)
    const l = log
      .clone()
      .tag("providerID", input.model.providerID)
      .tag("modelID", input.model.id)
      .tag("sessionID", input.sessionID)
      .tag("small", (input.small ?? false).toString())
      .tag("agent", agent.name)
      .tag("mode", agent.mode)
    l.info("stream", {
      modelID: input.model.id,
      providerID: input.model.providerID,
    })
    const [language, cfg, provider, auth] = await Promise.all([
      Provider.getLanguage(input.model, { config }),
      Promise.resolve(config),
      Provider.getProvider(input.model.providerID, { config }),
      Auth.get(input.model.providerID),
    ])
    const isOpenaiOauth = provider.id === "openai" && auth?.type === "oauth"

    const system = await composeSystem({ ...input, agent, sessionID: input.sessionID })
    const responseLanguage = SystemPrompt.responseLanguage(cfg.locale)
    if (responseLanguage) {
      system[0] = [system[0], responseLanguage].filter(Boolean).join("\n\n")
    }

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
      mergeDeep(agent.options),
      mergeDeep(variant),
    )
    if (isOpenaiOauth) {
      options.instructions = system.join("\n")
    }

    const params = await Plugin.trigger(
      "chat.params",
      {
        sessionID: input.sessionID,
        agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        temperature: input.model.capabilities.temperature
          ? (agent.temperature ?? ProviderTransform.temperature(input.model))
          : undefined,
        topP: agent.topP ?? ProviderTransform.topP(input.model),
        topK: ProviderTransform.topK(input.model),
        options,
      },
    )

    const { headers } = await Plugin.trigger(
      "chat.headers",
      {
        sessionID: input.sessionID,
        agent,
        model: input.model,
        provider,
        message: input.user,
      },
      {
        headers: {},
      },
    )

    const maxOutputTokens = ProviderTransform.maxOutputTokens(input.model)

    const tools = await resolveTools({ ...input, agent })
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
    const systemText = system.join("\n")
    const requestMessages = input.messages

    if (AgentTrace.isEnabled()) {
      const parentSessionID = sessionParentID(input.sessionID)
      const taskID = taskIDForSession(input.sessionID)
      if (taskID) {
        AgentTrace.recordLLMRequest({
          sessionID: input.sessionID,
          parentSessionID,
          taskID,
          agentName: agent.name,
          agentMode: agent.mode,
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
    }

    const result = streamText({
      onError(event) {
        void input.stream?.onError?.(event)
        const error = Message.fromError(event.error, { providerID: input.model.providerID })
        Bus.publish(SessionEvents.Error, {
          sessionID: input.sessionID,
          error,
        })
        l.error("stream error", {
          error,
        })
      },
      // Tool-call repair (name-normalization + discriminated-union legal-value
      // enumeration) is installed once at the `@/llm/api` streamText wrapper —
      // single source for every caller (see session/repair-hint.ts
      // createToolCallRepair). Do not re-add a per-call repair here.
      temperature: params.temperature,
      topP: params.topP,
      topK: params.topK,
      providerOptions,
      activeTools: Object.keys(tools),
      tools,
      toolChoice,
      ...(isOpenaiOauth ? {} : { system: systemText }),
      maxOutputTokens,
      abortSignal: input.abort,
      // Disable the wrapper's 5 s default soft timeout — the LLM-activity
      // gate (`withLLMActivity` in session/processor.ts) is the canonical
      // idle/timeout authority and composes its own abort signal into
      // `input.abort`. A second timeout here would race it.
      timeoutMs: false,
      headers: requestHeaders,
      maxRetries: input.retries ?? 0,
      stopWhen: input.stopWhen,
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
