/**
 * Unified LLM call layer.
 *
 * Two entry points:
 *
 * 1. `ProviderLLM.stream()` — agent-level streamText with full provider
 *    adaptation.  Used by task-agent, requirements, architect, planner.
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
import { Env } from "@/env"
import { Log } from "@/util/log"

const log = Log.create({ service: "provider-llm" })

// ── Sub-agent context pruning ─────────────────────────────────────────────
// AI SDK runs an internal multi-step loop (controlled by `stopWhen`) inside
// a single `streamText` call. Each step appends new tool calls + tool results
// to the conversation, then re-sends the FULL accumulated history to the LLM.
// For long-running sub-agents (requirements doing 20+ codebase explorations)
// this drives input from ~9 KB to ~100 KB across one session — the cost
// problem documented in the screenshot from 2026-04-14.
//
// Vercel AI SDK 5 ships `prepareStep` for exactly this — called before each
// step, can return `{ messages }` to override what the LLM sees. We use it to
// evict OLD tool results (replace `output` with a "[evicted]" stub) once the
// step number passes a small threshold. `toolCallId` / `toolName` stay intact
// so the tool_use ↔ tool_result pairing the provider expects isn't broken.
//
// Anthropic offers a native server-side equivalent via providerOptions
// `context_management.edits = [{type: "clear_tool_uses_20250919", ...}]`
// (beta header `context-management-2025-06-27`). Most of our paths go through
// openai-compatible LiteLLM adapters today, so the native edits payload would
// be silently dropped — we ship the universal client-side prune instead. When
// we add a direct `@ai-sdk/anthropic` provider, layer the native edits on top
// for double protection (server-side eviction is more accurate because it
// happens after token counting, not before).

const PRUNE_KEEP_RECENT_ROUNDS_DEFAULT = 4
const PRUNE_MIN_STEP_TO_TRIGGER = 4
const EVICTED_TEXT = "[evicted: old tool result removed by sub-agent context pruning]"

/**
 * Walk `messages` and replace every tool-result `output` that lives BEFORE
 * the last `keepLastToolRounds` tool messages with an `[evicted]` text stub.
 * Keeps the assistant tool-call envelopes and `toolCallId` pairings intact —
 * providers that validate tool_use/tool_result pairing (Anthropic) will still
 * accept the prompt. Returns a new array; never mutates input.
 */
function pruneStaleToolResults(
  messages: ModelMessage[],
  keepLastToolRounds: number,
): ModelMessage[] {
  // Identify tool-message indices in chronological order.
  const toolIdxs: number[] = []
  for (let i = 0; i < messages.length; i++) {
    if (messages[i]?.role === "tool") toolIdxs.push(i)
  }
  if (toolIdxs.length <= keepLastToolRounds) return messages

  // Cutoff: any tool message at index <= cutoffIdx is stale.
  const firstKeptToolIdx = toolIdxs[toolIdxs.length - keepLastToolRounds]

  let evictedCount = 0
  const next = messages.map((msg, i) => {
    if (msg.role !== "tool" || i >= firstKeptToolIdx) return msg
    const content = msg.content
    if (!Array.isArray(content)) return msg
    const newContent = content.map((part: any) => {
      if (part?.type !== "tool-result") return part
      // Skip already-evicted (idempotent across multiple prepareStep invocations).
      const cur = part.output
      if (cur && cur.type === "text" && typeof cur.value === "string" && cur.value.startsWith("[evicted")) {
        return part
      }
      evictedCount += 1
      return {
        ...part,
        output: { type: "text" as const, value: EVICTED_TEXT },
      }
    })
    return { ...msg, content: newContent } as ModelMessage
  })

  if (evictedCount > 0) {
    log.info("prune-stale-tool-results", {
      total: messages.length,
      toolCount: toolIdxs.length,
      keepLastToolRounds,
      evicted: evictedCount,
    })
  }
  return next
}

function resolvePruneOptions(): { enabled: boolean; keepLastToolRounds: number; minStep: number } {
  const env = Env.get("OPENCORVUS_SUBAGENT_PRUNE_KEEP_TOOL_ROUNDS")
  const fromEnv = env !== undefined ? Number(env) : NaN
  const keep = Number.isFinite(fromEnv) && fromEnv >= 1 ? fromEnv : PRUNE_KEEP_RECENT_ROUNDS_DEFAULT
  const enabledRaw = Env.get("OPENCORVUS_SUBAGENT_PRUNE")
  const enabled = enabledRaw === undefined ? true : enabledRaw !== "0" && enabledRaw.toLowerCase() !== "false"
  return { enabled, keepLastToolRounds: keep, minStep: PRUNE_MIN_STEP_TO_TRIGGER }
}

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

    // 5. Build request headers (baseHeaders handles hexin sticky routing)
    const autoHeaders = baseHeaders(model, input.cacheKey)
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

    // 8. Call streamText — the ONLY streamText call site for agent code.
    //
    // Intentionally NO prepareStep mutation. An earlier attempt evicted old
    // tool results between AI SDK loop steps — it cut input bytes ~50% but
    // ALSO mutated the cached message prefix, invalidating the Anthropic
    // prompt cache (4 breakpoints set in ProviderTransform.applyCaching).
    // Net cost rose ~4× per turn because cache_read at $0.30/MTok flipped to
    // cache_write at $3.75/MTok every step. The cache savings dwarf the
    // savings from message trimming.
    //
    // For real cost control we must EITHER:
    //   (a) keep the prefix byte-stable so cache_read keeps hitting (current
    //       behaviour — verbose but cheap), or
    //   (b) use Anthropic's native server-side `context_management` edits
    //       (beta header context-management-2025-06-27) which evict tool uses
    //       in a cache-aware way. Currently we can't reach that path because
    //       all Claude calls go through LiteLLM/openai-compat shims that drop
    //       the providerOptions field. Re-enable when @ai-sdk/anthropic
    //       direct provider lands.
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
   *
   * @param stickyKey optional stable identifier used for upstream-key sticky
   *   routing at LiteLLM-fronted gateways (currently only hexin). Pass
   *   sessionID for session calls, taskID for agent calls.
   */
  export function baseHeaders(model: Provider.Model, stickyKey?: string): Record<string, string> {
    const headers: Record<string, string> = {
      ...(model.providerID !== "anthropic"
        ? { "User-Agent": `opencorvus/${Installation.VERSION}` }
        : undefined),
      ...model.headers,
    }
    // hexin LiteLLM gateway hashes `x-user` for sticky upstream-key routing.
    // Without it, round-robin lands each request on a cold Anthropic cache,
    // paying cache-creation (~1.25× input) every time. Empirically took
    // claude-sonnet-4-6 hit ratio from ~60% to 100%. Scoped to hexin only so
    // other openai-compatible providers aren't affected.
    if (model.providerID === "hexin" && stickyKey) {
      headers["x-user"] = stickyKey
    }
    return headers
  }
}
