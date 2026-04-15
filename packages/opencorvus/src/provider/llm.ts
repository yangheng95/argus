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

// ── Sub-agent context pruning (batched drop) ──────────────────────────────
// AI SDK runs an internal multi-step loop inside a single `streamText` call.
// Each step appends a new (assistant with tool_calls, tool message with
// tool_results) pair and re-sends the FULL history. Sub-agents that do 20+
// codebase explorations push input from ~9 KB to ~100 KB per session.
//
// `prepareStep` drops OLD (assistant+tool) round pairs entirely — not a stub,
// not partial eviction, the whole pair. This is safe because Anthropic's API
// only requires each `tool_use` be matched by a `tool_result` in the request;
// dropping both sides of the pair preserves the invariant.
//
// Cutoff is batched: we maintain a monotonic `evictedCallIds` set that only
// grows at step boundaries every `batchInterval` steps. Between growth events
// the set is stable, so repeatedly re-applying the (idempotent) drop yields a
// byte-identical prefix — Anthropic prompt cache keeps hitting. At each
// growth we pay one cache_write, then cache_read for the next interval.
// Break-even vs no eviction is ~K=4 at current Anthropic pricing; default K=8
// leaves margin.
//
// Anthropic offers a server-side equivalent via providerOptions
// `context_management.edits` (beta header context-management-2025-06-27),
// but most sub-agent traffic here goes through LiteLLM / openai-compatible
// shims that drop provider-specific payloads. Client-side drop is universal.

const PRUNE_KEEP_RECENT_ROUNDS_DEFAULT = 4
const PRUNE_MIN_STEP_TO_TRIGGER = 4
const PRUNE_BATCH_INTERVAL_DEFAULT = 8

type ToolResultPart = { type: "tool-result"; toolCallId: string }
type ToolCallPart = { type: "tool-call"; toolCallId: string }

/**
 * Grow `evictedIds` with the toolCallIds from every tool-role message EXCEPT
 * the last `keepRounds`. Idempotent — re-adding an existing id is a no-op.
 */
function growEvictedCallIds(
  messages: ModelMessage[],
  keepRounds: number,
  evictedIds: Set<string>,
): void {
  const toolMsgCallIds: string[][] = []
  for (const m of messages) {
    if (m.role !== "tool") continue
    if (!Array.isArray(m.content)) continue
    const ids: string[] = []
    for (const part of m.content as ToolResultPart[]) {
      if (part?.type === "tool-result" && typeof part.toolCallId === "string") {
        ids.push(part.toolCallId)
      }
    }
    toolMsgCallIds.push(ids)
  }
  const dropCount = toolMsgCallIds.length - keepRounds
  if (dropCount <= 0) return
  for (let k = 0; k < dropCount; k++) {
    for (const id of toolMsgCallIds[k]) evictedIds.add(id)
  }
}

/**
 * Drop every tool-role message whose tool-result parts are ALL in `evictedIds`,
 * and the paired assistant message that produced those tool-calls. The pair is
 * always adjacent in AI SDK output (`assistant(calls) → tool(results)`), but
 * we still verify by call-id membership so we never strand a tool_use without
 * its tool_result.
 */
function dropEvictedRounds(
  messages: ModelMessage[],
  evictedIds: Set<string>,
): ModelMessage[] {
  if (evictedIds.size === 0) return messages
  const keep = new Array<boolean>(messages.length).fill(true)
  let droppedRounds = 0

  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    if (m.role !== "tool") continue
    if (!Array.isArray(m.content)) continue
    let allEvicted = true
    let anyResult = false
    for (const part of m.content as ToolResultPart[]) {
      if (part?.type !== "tool-result") continue
      anyResult = true
      if (!evictedIds.has(part.toolCallId)) {
        allEvicted = false
        break
      }
    }
    if (!anyResult || !allEvicted) continue
    keep[i] = false

    // Find the paired assistant: nearest preceding still-kept assistant whose
    // tool-call ids are all in evictedIds. Almost always i-1.
    for (let j = i - 1; j >= 0; j--) {
      if (!keep[j]) continue
      const am = messages[j]
      if (am.role !== "assistant") break
      if (!Array.isArray(am.content)) break
      const callIds: string[] = []
      for (const part of am.content as ToolCallPart[]) {
        if (part?.type === "tool-call" && typeof part.toolCallId === "string") {
          callIds.push(part.toolCallId)
        }
      }
      if (callIds.length === 0) break
      if (callIds.every((id) => evictedIds.has(id))) {
        keep[j] = false
        droppedRounds += 1
      }
      break
    }
  }

  if (droppedRounds === 0) return messages
  const next = messages.filter((_, i) => keep[i])
  log.info("drop-evicted-tool-rounds", {
    droppedRounds,
    evictedCallIds: evictedIds.size,
    before: messages.length,
    after: next.length,
  })
  return next
}

function resolvePruneOptions(): {
  enabled: boolean
  keepLastToolRounds: number
  minStep: number
  batchInterval: number
} {
  const keepRaw = Env.get("OPENCORVUS_SUBAGENT_PRUNE_KEEP_TOOL_ROUNDS")
  const keepNum = keepRaw !== undefined ? Number(keepRaw) : NaN
  const keepLastToolRounds = Number.isFinite(keepNum) && keepNum >= 1 ? keepNum : PRUNE_KEEP_RECENT_ROUNDS_DEFAULT

  const intervalRaw = Env.get("OPENCORVUS_SUBAGENT_PRUNE_BATCH_INTERVAL")
  const intervalNum = intervalRaw !== undefined ? Number(intervalRaw) : NaN
  const batchInterval = Number.isFinite(intervalNum) && intervalNum >= 1 ? intervalNum : PRUNE_BATCH_INTERVAL_DEFAULT

  const enabledRaw = Env.get("OPENCORVUS_SUBAGENT_PRUNE")
  const enabled = enabledRaw === undefined ? true : enabledRaw !== "0" && enabledRaw.toLowerCase() !== "false"

  return { enabled, keepLastToolRounds, minStep: PRUNE_MIN_STEP_TO_TRIGGER, batchInterval }
}

// Test-only exports — DO NOT use from application code. Keep the leading
// underscore so linters flag unintended consumers.
export const __pruneInternal = {
  growEvictedCallIds,
  dropEvictedRounds,
  resolvePruneOptions,
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
    // `prepareStep` drops old (assistant+tool) round pairs whose toolCallIds
    // have fallen into `evictedCallIds`. The set only grows at batch
    // boundaries, so between boundaries the drop function returns a
    // byte-identical prefix and Anthropic's prompt cache keeps hitting.
    const pruneOpts = resolvePruneOptions()
    const evictedCallIds = new Set<string>()
    const prepareStep = pruneOpts.enabled
      ? ({ stepNumber, messages: stepMessages }: { stepNumber: number; messages: ModelMessage[] }) => {
          if (stepNumber < pruneOpts.minStep) return undefined
          const sinceMinStep = stepNumber - pruneOpts.minStep
          const isBoundary = sinceMinStep % pruneOpts.batchInterval === 0
          if (isBoundary) {
            growEvictedCallIds(stepMessages, pruneOpts.keepLastToolRounds, evictedCallIds)
          }
          if (evictedCallIds.size === 0) return undefined
          const next = dropEvictedRounds(stepMessages, evictedCallIds)
          if (next === stepMessages) return undefined
          return { messages: next }
        }
      : undefined

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
      ...(prepareStep ? { prepareStep } : {}),
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
