/**
 * Unified LLM call layer.
 *
 * Two entry points:
 *
 * 1. `ProviderLLM.stream()` — agent-level streamText with full provider
 *    adaptation.  Used by task-agent, decompose, architect, planner.
 *
 * 2. `ProviderLLM.wrapModel()` / `ProviderLLM.baseHeaders()` — low-level
 *    helpers reused by session/llm.ts which needs its own streamText call
 *    for session-specific concerns (plugin hooks, permission filtering,
 *    LLM traces, telemetry, tool repair, inactivity timeout).
 *
 * Provider-specific adaptation (providerOptions, maxOutputTokens, message
 * normalization, request headers) is handled here so that callers never
 * need to know Anthropic requires `max_tokens` or OpenAI needs `store: false`.
 */
import {
  streamText,
  wrapLanguageModel,
  type ModelMessage,
  type StreamTextResult,
  type ToolSet,
} from "ai"
import { mergeDeep } from "remeda"
import { Provider } from "./provider"
import { ProviderTransform } from "./transform"
import { Installation } from "@/installation"
import { Flag } from "@/flag/flag"
import { Log } from "@/util/log"

const log = Log.create({ service: "provider-llm" })

export namespace ProviderLLM {

  export interface StreamInput {
    /** Resolved model object — NOT a raw LanguageModelV2 */
    model: Provider.Model
    /** System prompt(s).  Joined with newline if string[]. */
    system: string | string[]
    /** Conversation messages */
    messages: ModelMessage[]

    // ── Agent concerns (all optional) ──
    tools?: ToolSet
    toolChoice?: "auto" | "required" | "none"
    abortSignal?: AbortSignal
    /** AI SDK stopWhen condition (e.g. stepCountIs(20)) */
    stopWhen?: any
    maxRetries?: number

    // ── Callbacks ──
    onChunk?: (chunk: any) => void
    onError?: (error: { error: unknown }) => void
    onStepFinish?: (step: any) => void

    // ── Overrides (rare — let the layer compute by default) ──
    /** Override auto-computed maxOutputTokens */
    maxOutputTokens?: number
    temperature?: number
    topP?: number
    topK?: number
    /** Merged INTO auto-computed providerOptions (does not replace) */
    extraProviderOptions?: Record<string, any>
    /** Merged INTO auto-computed headers (does not replace) */
    extraHeaders?: Record<string, string>
    /** Full options override — merged into base options before providerOptions computation.
     *  Used by session/llm.ts to inject plugin-mutated options. */
    optionsOverride?: Record<string, any>

    /** Cache key for providers that use explicit prompt caching (OpenAI, OpenRouter, etc.).
     *  For agent calls, pass a task-scoped key (e.g. `task-${taskID}`).
     *  Session-level calls use sessionID directly via ProviderTransform.options(). */
    cacheKey?: string
  }

  /**
   * Stream an LLM call with full provider adaptation.
   *
   * Handles: LanguageModelV2 creation, providerOptions, maxOutputTokens,
   * message transform middleware, request headers.
   */
  export async function stream(input: StreamInput): Promise<StreamTextResult<ToolSet, unknown>> {
    const { model } = input

    // 1. Resolve LanguageModelV2
    const language = await Provider.getLanguage(model)

    // 2. Compute base options (provider-specific: reasoning, caching, store, etc.)
    const baseOptions = ProviderTransform.options({
      model,
      sessionID: input.cacheKey || "",
      providerOptions: (await Provider.getProvider(model.providerID).catch(() => ({ options: {} }))).options,
    })

    // Merge overrides (model-level options, caller overrides)
    const options: Record<string, any> = input.optionsOverride
      ? mergeDeep(baseOptions, input.optionsOverride)
      : mergeDeep(baseOptions, model.options ?? {})

    // 3. Compute providerOptions (namespace-wrapped for the correct SDK key)
    let providerOptions = ProviderTransform.providerOptions(model, options)
    if (input.extraProviderOptions) {
      providerOptions = mergeDeep(providerOptions, input.extraProviderOptions)
    }

    // 4. Compute maxOutputTokens
    const maxOutputTokens = input.maxOutputTokens ?? ProviderTransform.maxOutputTokens(model)

    // 5. Build request headers
    const autoHeaders: Record<string, string> = {
      ...(model.providerID !== "anthropic"
        ? { "User-Agent": `opencorvus/${Installation.VERSION}` }
        : undefined),
      ...model.headers,
    }
    const headers = input.extraHeaders
      ? { ...autoHeaders, ...input.extraHeaders }
      : autoHeaders

    // 6. Wrap model with message-transform middleware
    const wrappedModel = wrapLanguageModel({
      model: language,
      middleware: [
        {
          async transformParams(args: any) {
            if (args.type === "stream") {
              args.params.prompt = ProviderTransform.message(
                args.params.prompt,
                model,
                options,
              )
            }
            return args.params
          },
        },
      ],
    })

    // 7. Build system messages
    const systemParts = Array.isArray(input.system) ? input.system : [input.system]
    const systemMessages: ModelMessage[] = systemParts
      .filter(Boolean)
      .map((s) => ({ role: "system" as const, content: s }))

    log.info("stream", {
      providerID: model.providerID,
      modelID: model.id,
      maxOutputTokens: maxOutputTokens ?? null,
      toolCount: input.tools ? Object.keys(input.tools).length : 0,
      providerOptionsKeys: Object.keys(providerOptions),
      headersKeys: Object.keys(headers),
      systemPartCount: systemMessages.length,
      messageCount: input.messages.length,
    })

    // 8. Call streamText — the ONLY streamText call site for agent code
    return streamText({
      model: wrappedModel,
      providerOptions,
      maxOutputTokens,
      headers,
      maxRetries: input.maxRetries ?? 0,
      messages: [...systemMessages, ...input.messages],
      tools: input.tools,
      toolChoice: input.toolChoice,
      temperature: input.temperature,
      topP: input.topP,
      topK: input.topK,
      abortSignal: input.abortSignal,
      ...(input.stopWhen ? { stopWhen: input.stopWhen } : {}),
      ...(input.onChunk ? { onChunk: input.onChunk } : {}),
      ...(input.onError ? { onError: input.onError } : {}),
      ...(input.onStepFinish ? { onStepFinish: input.onStepFinish } : {}),
    })
  }

  // ── Low-level helpers (reused by session/llm.ts) ──

  /**
   * Wrap a LanguageModelV2 with the message-transform middleware that
   * normalizes messages for the target provider (Anthropic empty-content
   * filtering, unsupported modality removal, cache markers, etc.).
   */
  export function wrapModel(
    language: Awaited<ReturnType<typeof Provider.getLanguage>>,
    model: Provider.Model,
    options: Record<string, any>,
  ) {
    return wrapLanguageModel({
      model: language,
      middleware: [
        {
          async transformParams(args: any) {
            if (args.type === "stream") {
              args.params.prompt = ProviderTransform.message(
                args.params.prompt,
                model,
                options,
              )
            }
            return args.params
          },
        },
      ],
    })
  }

  /**
   * Compute default request headers for a model.
   * Does NOT include opencorvus project/session headers — those are session-specific.
   */
  export function baseHeaders(model: Provider.Model): Record<string, string> {
    return {
      ...(model.providerID !== "anthropic"
        ? { "User-Agent": `opencorvus/${Installation.VERSION}` }
        : undefined),
      ...model.headers,
    }
  }
}
