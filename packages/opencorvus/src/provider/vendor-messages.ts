/**
 * Vendor-specific message normalization registry.
 *
 * Design (per specs/new-arch/06-provider.md Path 3): vendor-specific behavior
 * belongs in vendor modules, not in the shared transform layer. Each entry
 * is a pure function keyed by a model-matcher predicate. Adding a new
 * vendor's quirk means appending one entry here — `ProviderTransform.message()`
 * stays a vendor-agnostic dispatcher.
 *
 * Two stages:
 *
 *   1. PRE_NORMALIZERS — run in array order, every matching entry applies.
 *      Used for cross-cutting cleanup (e.g. Anthropic rejects empty-content
 *      messages, which is a preprocessing step that composes with whatever
 *      terminal normalization follows).
 *
 *   2. TERMINAL_NORMALIZERS — first match wins, returns the final message
 *      shape. Used when the vendor has a self-contained tool-call format
 *      that conflicts with other normalizers (Claude vs Mistral tool IDs,
 *      interleaved reasoning for Qwen-style models).
 */
import type { ModelMessage } from "ai"
import type { Provider } from "./provider"

type NormalizeMessages = (msgs: ModelMessage[], model: Provider.Model) => ModelMessage[]

interface NormalizerEntry {
  /** Human-readable tag (used only in errors/logs). */
  tag: string
  /** Model matcher — returns true if this normalizer should apply. */
  match: (model: Provider.Model) => boolean
  /** Pure transform. */
  normalize: NormalizeMessages
}

// ────────── individual normalizers ──────────

const anthropicFilterEmpty: NormalizeMessages = (msgs) => {
  // Anthropic rejects messages whose content is empty string or whose content
  // array has no non-empty text/reasoning parts. Drop them.
  return msgs
    .map((msg) => {
      if (typeof msg.content === "string") {
        if (msg.content === "") return undefined
        return msg
      }
      if (!Array.isArray(msg.content)) return msg
      const filtered = msg.content.filter((part) => {
        if (part.type === "text" || part.type === "reasoning") {
          return part.text !== ""
        }
        return true
      })
      if (filtered.length === 0) return undefined
      return { ...msg, content: filtered }
    })
    .filter((msg): msg is ModelMessage => msg !== undefined && msg.content !== "")
}

const claudeSanitizeToolCallIds: NormalizeMessages = (msgs) => {
  // Claude tool IDs must be [a-zA-Z0-9_-]; replace everything else with `_`.
  return msgs.map((msg) => {
    if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
      msg.content = msg.content.map((part) => {
        if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
          return {
            ...part,
            toolCallId: part.toolCallId.replace(/[^a-zA-Z0-9_-]/g, "_"),
          }
        }
        return part
      })
    }
    return msg
  })
}

const claudeDropToolResultAssistantTail: NormalizeMessages = (msgs) => {
  const last = msgs[msgs.length - 1]
  const previous = msgs[msgs.length - 2]
  if (!last || !previous) return msgs
  if (previous.role !== "tool" || last.role !== "assistant") return msgs
  if (!isTextOnlyAssistant(last)) return msgs
  return msgs.slice(0, -1)
}

const claudeNormalize: NormalizeMessages = (msgs, model) => {
  return claudeDropToolResultAssistantTail(claudeSanitizeToolCallIds(msgs, model), model)
}

function isTextOnlyAssistant(msg: ModelMessage) {
  if (msg.role !== "assistant") return false
  if (typeof msg.content === "string") return msg.content.length > 0
  if (!Array.isArray(msg.content) || msg.content.length === 0) return false
  return msg.content.every((part) => part.type === "text" && part.text.length > 0)
}

const mistralToolCallIdPadAndSeq: NormalizeMessages = (msgs) => {
  // Mistral tool IDs must be exactly 9 alphanumeric characters; pad/truncate.
  // Also: a `tool` message cannot be followed directly by `user`; insert an
  // `assistant` bridge.
  const result: ModelMessage[] = []
  for (let i = 0; i < msgs.length; i++) {
    const msg = msgs[i]
    const nextMsg = msgs[i + 1]

    if ((msg.role === "assistant" || msg.role === "tool") && Array.isArray(msg.content)) {
      msg.content = msg.content.map((part) => {
        if ((part.type === "tool-call" || part.type === "tool-result") && "toolCallId" in part) {
          const normalizedId = part.toolCallId
            .replace(/[^a-zA-Z0-9]/g, "")
            .substring(0, 9)
            .padEnd(9, "0")
          return { ...part, toolCallId: normalizedId }
        }
        return part
      })
    }

    result.push(msg)

    if (msg.role === "tool" && nextMsg?.role === "user") {
      result.push({
        role: "assistant",
        content: [{ type: "text", text: "Done." }],
      })
    }
  }
  return result
}

function extractInlineThink(text: string) {
  const reasoning: string[] = []
  const withoutBlocks = text.replace(/<think\b[^>]*>([\s\S]*?)<\/think>/gi, (_match, inner) => {
    reasoning.push(inner)
    return ""
  })
  return {
    text: withoutBlocks.replace(/<\/?think\b[^>]*>/gi, ""),
    reasoning: reasoning.join(""),
  }
}

const interleavedReasoning: NormalizeMessages = (msgs, model) => {
  // For models that carry reasoning inline in the assistant message via a
  // provider-specific field (qwen: reasoning_content, etc.), extract the
  // reasoning parts into that field and strip them from the content array.
  if (typeof model.capabilities.interleaved !== "object") return msgs
  const field = model.capabilities.interleaved.field
  if (!field) return msgs
  const extractsInlineThinkTags = model.providerID === "hexin" && model.family === "glm"
  return msgs.map((msg) => {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      const contentWithInlineThink = msg.content.flatMap((part: any) => {
        if (!extractsInlineThinkTags || part.type !== "text" || typeof part.text !== "string") return [part]
        const extracted = extractInlineThink(part.text)
        const parts: any[] = []
        if (extracted.reasoning) parts.push({ type: "reasoning", text: extracted.reasoning })
        if (extracted.text) parts.push({ ...part, text: extracted.text })
        return parts
      })
      const reasoningParts = contentWithInlineThink.filter((part: any) => part.type === "reasoning")
      const reasoningText = reasoningParts.map((part: any) => part.text).join("")
      const existingReasoningText = (msg.providerOptions as any)?.openaiCompatible?.[field]
      const filteredContent = contentWithInlineThink.filter((part: any) => part.type !== "reasoning")

      return {
        ...msg,
        content: filteredContent,
        providerOptions: {
          ...msg.providerOptions,
          openaiCompatible: {
            ...(msg.providerOptions as any)?.openaiCompatible,
            [field]: reasoningParts.length > 0 ? reasoningText : (existingReasoningText ?? ""),
          },
        },
      }
    }
    return msg
  })
}

// ────────── registries ──────────

const PRE_NORMALIZERS: NormalizerEntry[] = [
  {
    tag: "anthropic-filter-empty",
    match: (m) => m.api.npm === "@ai-sdk/anthropic",
    normalize: anthropicFilterEmpty,
  },
]

const TERMINAL_NORMALIZERS: NormalizerEntry[] = [
  {
    tag: "claude-tool-ids",
    match: (m) => m.api.id.includes("claude"),
    normalize: claudeNormalize,
  },
  {
    tag: "mistral-tool-ids-and-seq",
    match: (m) =>
      m.providerID === "mistral" ||
      m.api.id.toLowerCase().includes("mistral") ||
      m.api.id.toLowerCase().includes("devstral"),
    normalize: mistralToolCallIdPadAndSeq,
  },
  {
    tag: "interleaved-reasoning",
    match: (m) =>
      m.api.npm !== "@openrouter/ai-sdk-provider" &&
      typeof m.capabilities.interleaved === "object" &&
      !!m.capabilities.interleaved.field,
    normalize: interleavedReasoning,
  },
]

/**
 * Apply vendor-specific message normalization. Pre-normalizers all run; the
 * first matching terminal normalizer is used (its output is returned). If no
 * terminal normalizer matches, the (possibly pre-normalized) messages pass
 * through unchanged.
 */
export function normalizeVendorMessages(msgs: ModelMessage[], model: Provider.Model): ModelMessage[] {
  let current = msgs
  for (const entry of PRE_NORMALIZERS) {
    if (entry.match(model)) current = entry.normalize(current, model)
  }
  for (const entry of TERMINAL_NORMALIZERS) {
    if (entry.match(model)) return entry.normalize(current, model)
  }
  return current
}
