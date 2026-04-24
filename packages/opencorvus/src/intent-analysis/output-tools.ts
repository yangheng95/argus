/**
 * Zod-validated tool calls for Intent Analysis Agent incremental recording.
 *
 * Phase 3-b migration (specs/new-arch/16-unified-teardown.md §7-3): the
 * terminal `finalize_intent` tool is gone — final intent_class, complexity,
 * confidence, and summary now arrive through SessionLoop's StructuredOutput
 * tool driven by the agent's `format: { type: "json_schema", schema }` input.
 *
 * The remaining three tools (`extract_slot`, `flag_missing_info`,
 * `ask_clarification`) stay as incremental "scratchpad" tools, injected
 * via `SessionPrompt.setExtraTools(childSessionID, ...)` for the life of
 * a single agent invocation.
 *
 * Small tool schemas mirror the architect pattern — gives the LLM an
 * incremental append surface rather than a single monolithic object that
 * amplifies streaming-buffering issues on some providers.
 */
import { tool } from "ai"
import z from "zod"
import type {
  IntentAnalysisResult,
  IntentClarification,
  IntentClass,
  IntentComplexity,
  IntentSlot,
} from "./types"

export const INTENT_CLASSES = [
  "question",
  "bug_fix",
  "feature",
  "refactor",
  "exploration",
  "chore",
  "unclear",
] as const satisfies readonly IntentClass[]

export const COMPLEXITY_BANDS = [
  "trivial",
  "small",
  "medium",
  "large",
  "unknown",
] as const satisfies readonly IntentComplexity[]

const CLARIFICATION_PRIORITIES = ["blocker", "nice"] as const

// ---------------------------------------------------------------------------
// Terminal JSON-schema: payload the StructuredOutput tool must deliver.
// The incremental fields (slots / missing / clarifications) stay in the
// collector below and are merged in by `collectorToResult` so the final
// `IntentAnalysisResult` matches the pre-migration shape.
// ---------------------------------------------------------------------------

export const IntentFinalSchema = z.object({
  intent_class: z
    .enum(INTENT_CLASSES)
    .describe(
      "Primary intent class — pick 'unclear' only when no class fits better than random guessing.",
    ),
  complexity: z
    .enum(COMPLEXITY_BANDS)
    .describe(
      "Rough work size: trivial (minutes), small (one file / one goal), medium (few files, coordinated), large (multi-subsystem), unknown (not enough info to judge).",
    ),
  confidence: z
    .number()
    .min(0)
    .max(1)
    .describe("Overall confidence in this analysis, 0-1."),
  summary: z
    .string()
    .min(1)
    .describe("One-line statement of what the user wants."),
})
export type IntentFinal = z.infer<typeof IntentFinalSchema>

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export interface IntentCollector {
  slots: IntentSlot[]
  missing: string[]
  clarifications: IntentClarification[]
}

function emptyCollector(): IntentCollector {
  return {
    slots: [],
    missing: [],
    clarifications: [],
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createIntentOutputTools() {
  let collector = emptyCollector()

  const tools = {
    extract_slot: tool({
      description:
        "Record one extracted requirement element (a 'slot') from the user's " +
        "request. Call once per distinct element — e.g. target file, module, " +
        "action verb, stack, constraint, data source, etc. If nothing can be " +
        "extracted with non-trivial confidence, do not call this tool.",
      inputSchema: z.object({
        key: z
          .string()
          .min(1)
          .describe(
            "Slot name in snake_case, e.g. 'target_file', 'module', 'stack', " +
              "'action_verb', 'constraint', 'data_source'.",
          ),
        value: z
          .string()
          .min(1)
          .describe("Extracted value, verbatim or lightly normalized."),
        confidence: z
          .number()
          .min(0)
          .max(1)
          .describe("Confidence in this extraction, 0-1."),
      }),
      execute: async ({ key, value, confidence }) => {
        collector.slots.push({ key, value, confidence })
        const output = `OK: slot "${key}" recorded (${collector.slots.length} total)`
        return { output, title: `slot:${key}`, metadata: { count: collector.slots.length } }
      },
    }),

    flag_missing_info: tool({
      description:
        "Flag one piece of information judged missing but important for the " +
        "downstream planning agents. Use short snake_case keys; the matching " +
        "human-phrased question (if any) belongs in ask_clarification.",
      inputSchema: z.object({
        key: z
          .string()
          .min(1)
          .describe(
            "Missing info key in snake_case, e.g. 'target_file', " +
              "'acceptance_criteria', 'env_credentials'.",
          ),
      }),
      execute: async ({ key }) => {
        if (!collector.missing.includes(key)) collector.missing.push(key)
        const output = `OK: missing "${key}" flagged (${collector.missing.length} total)`
        return { output, title: `missing:${key}`, metadata: { count: collector.missing.length } }
      },
    }),

    ask_clarification: tool({
      description:
        "Record one clarification question the user would need to answer " +
        "before downstream agents can proceed safely. Use priority='blocker' " +
        "when downstream cannot start without it, 'nice' when it is merely " +
        "helpful. Skip entirely when the request is already unambiguous.",
      inputSchema: z.object({
        question: z
          .string()
          .min(1)
          .describe("The clarifying question, phrased directly to the user."),
        why_needed: z
          .string()
          .min(1)
          .describe(
            "Why answering is needed — which downstream decision it unblocks.",
          ),
        priority: z
          .enum(CLARIFICATION_PRIORITIES)
          .describe("'blocker' or 'nice'."),
      }),
      execute: async ({ question, why_needed, priority }) => {
        collector.clarifications.push({ question, why_needed, priority })
        const output = `OK: clarification recorded (${collector.clarifications.length} total)`
        return {
          output,
          title: `clarify:${priority}`,
          metadata: { count: collector.clarifications.length, priority },
        }
      },
    }),
  }

  return {
    tools,
    reset() {
      collector = emptyCollector()
      return collector
    },
    getCollector() {
      return collector
    },
  }
}

// ---------------------------------------------------------------------------
// Collector + StructuredOutput → Result
// ---------------------------------------------------------------------------

/**
 * Merge incremental collector state with the terminal StructuredOutput
 * payload. Returns a fully-populated IntentAnalysisResult. Passing
 * `final=undefined` keeps `intent_class="unclear"` / `complexity="unknown"`
 * and `confidence=0` so callers can still render something when the LLM
 * skipped the StructuredOutput call — the same defensive defaults the
 * pre-migration `collectorToResult` used.
 */
export function collectorToResult(c: IntentCollector, final?: IntentFinal): IntentAnalysisResult {
  return {
    intent_class: final?.intent_class ?? "unclear",
    complexity: final?.complexity ?? "unknown",
    extracted_slots: c.slots,
    missing_info: c.missing,
    clarifications: c.clarifications,
    confidence: final?.confidence ?? 0,
    summary: final?.summary ?? "",
  }
}
