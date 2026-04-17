/**
 * Zod-validated tool calls for Intent Analysis Agent structured output.
 *
 * The agent emits 4 tool kinds:
 *   - extract_slot      — one call per extracted requirement element
 *   - flag_missing_info — one call per missing-but-important piece
 *   - ask_clarification — one call per clarification question
 *   - finalize_intent   — exactly one call to close analysis with class/complexity/confidence/summary
 *
 * Small tool schemas mirror the architect pattern — avoids the streaming
 * buffering issues of monolithic tool schemas and gives the LLM an
 * incremental append surface rather than one giant JSON object.
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

const INTENT_CLASSES = [
  "question",
  "bug_fix",
  "feature",
  "refactor",
  "exploration",
  "chore",
  "unclear",
] as const satisfies readonly IntentClass[]

const COMPLEXITY_BANDS = [
  "trivial",
  "small",
  "medium",
  "large",
  "unknown",
] as const satisfies readonly IntentComplexity[]

const CLARIFICATION_PRIORITIES = ["blocker", "nice"] as const

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export interface IntentCollector {
  slots: IntentSlot[]
  missing: string[]
  clarifications: IntentClarification[]
  intent_class?: IntentClass
  complexity?: IntentComplexity
  confidence?: number
  summary: string
  finalized: boolean
}

function emptyCollector(): IntentCollector {
  return {
    slots: [],
    missing: [],
    clarifications: [],
    summary: "",
    finalized: false,
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
        return `OK: slot "${key}" recorded (${collector.slots.length} total)`
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
        return `OK: missing "${key}" flagged (${collector.missing.length} total)`
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
        return `OK: clarification recorded (${collector.clarifications.length} total)`
      },
    }),

    finalize_intent: tool({
      description:
        "Finalize the intent analysis. Call exactly once at the end after " +
        "all extract_slot / flag_missing_info / ask_clarification calls. " +
        "Sets the intent class, complexity band, overall confidence, and " +
        "a one-line summary of what the user wants.",
      inputSchema: z.object({
        intent_class: z
          .enum(INTENT_CLASSES)
          .describe(
            "Primary intent class — pick 'unclear' only when no class fits " +
              "better than random guessing.",
          ),
        complexity: z
          .enum(COMPLEXITY_BANDS)
          .describe(
            "Rough work size: trivial (minutes), small (one file / one goal), " +
              "medium (few files, coordinated), large (multi-subsystem), " +
              "unknown (not enough info to judge).",
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
      }),
      execute: async ({ intent_class, complexity, confidence, summary }) => {
        collector.intent_class = intent_class
        collector.complexity = complexity
        collector.confidence = confidence
        collector.summary = summary
        collector.finalized = true
        return `OK: intent finalized (class=${intent_class}, complexity=${complexity}, slots=${collector.slots.length}, clarifications=${collector.clarifications.length})`
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
// Collector → Result
// ---------------------------------------------------------------------------

export function collectorToResult(c: IntentCollector): IntentAnalysisResult {
  return {
    intent_class: c.intent_class ?? "unclear",
    complexity: c.complexity ?? "unknown",
    extracted_slots: c.slots,
    missing_info: c.missing,
    clarifications: c.clarifications,
    confidence: c.confidence ?? 0,
    summary: c.summary,
  }
}
