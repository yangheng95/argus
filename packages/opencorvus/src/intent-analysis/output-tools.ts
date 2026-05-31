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
 * via the child session's runtime contract so the same session can be
 * resumed later without losing its stage tools.
 *
 * Small tool schemas mirror the architect pattern — gives the LLM an
 * incremental append surface rather than a single monolithic object that
 * amplifies streaming-buffering issues on some providers.
 */
import { tool } from "ai"
import z from "zod"
import { limitSummary, markdownJson, requireReportString, type AgentReportContext } from "@/agent/report"
import type {
  IntentAnalysisResult,
  IntentClarification,
  IntentClass,
  IntentComplexity,
  IntentSlot,
} from "./types"
import { FactCheckItemListSchema } from "@/fact-check/schema"

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
  // Optional fact-check registration: missing means no items registered.
  fact_check_items: FactCheckItemListSchema.default([]).describe(
    "Every factual claim (API behaviour, library version, file path you did not read this session) you have NOT verified via tool calls. Empty when only intent inference or in-session-verified statements.",
  ),
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
    buildReport(context?: AgentReportContext) {
      const structured = IntentFinalSchema.parse(context?.structured)
      const summary = requireReportString(structured.summary, "intent summary")
      return {
        summary: limitSummary(summary),
        detail: [
          `## Summary\n${summary}`,
          `## Structured Payload\n${markdownJson(structured)}`,
        ].join("\n\n"),
      }
    },
  }
}

// ---------------------------------------------------------------------------
// Collector + StructuredOutput → Result
// ---------------------------------------------------------------------------

/**
 * Merge incremental collector state with the terminal StructuredOutput
 * payload. The terminal payload is required — passing `final=undefined`
 * throws.
 *
 * Removed 2026-04-30 (rule 7 / rule 16): the prior implementation returned
 * `intent_class="unclear" / complexity="unknown" / confidence=0` defaults
 * when `final` was missing, which is exactly the fallback path that let
 * the intent-analysis "秒退" incident silently mark workflow.step as
 * completed despite an HTTP 400 from deepseek-reasoner. The runner now
 * throws on `finalMessage.info.error` (agent/runner.ts), so a caller that
 * reaches `collectorToResult` is guaranteed to have a successful
 * StructuredOutput call — making the defensive defaults dead code.
 */
export function collectorToResult(c: IntentCollector, final: IntentFinal): IntentAnalysisResult {
  return {
    intent_class: final.intent_class,
    complexity: final.complexity,
    extracted_slots: c.slots,
    missing_info: c.missing,
    clarifications: c.clarifications,
    confidence: final.confidence,
    summary: final.summary,
  }
}
