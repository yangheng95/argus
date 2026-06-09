/**
 * Intent Analysis Agent types.
 *
 * The Intent Analysis Agent runs BEFORE any downstream planning agent
 * (Requirements / Planner / Architect / …). Its job is to read a raw,
 * often very short, user request and return a structured understanding:
 * intent class, complexity band, extracted slots, missing information,
 * and any clarification questions the downstream agents would need
 * answered before they can proceed safely.
 *
 * Not wired into the workflow yet — this module defines the public
 * surface area so callers can invoke `IntentAnalysisAgent.analyze(...)`
 * directly when ready.
 */

export type IntentClass = "question" | "bug_fix" | "feature" | "refactor" | "exploration" | "chore" | "unclear"

export type IntentComplexity = "trivial" | "small" | "medium" | "large" | "unknown"

export type ClarificationPriority = "blocker" | "nice"

export interface IntentSlot {
  /** Slot name, e.g. "target_file", "module", "stack", "action_verb". */
  key: string
  /** Extracted value, verbatim or normalized. */
  value: string
  /** Confidence in this extraction, 0-1. */
  confidence: number
}

export interface IntentClarification {
  /** The clarifying question to ask the user. */
  question: string
  /** Why answering this is needed before downstream agents can proceed. */
  why_needed: string
  /** blocker = downstream cannot start without this; nice = helpful but skippable. */
  priority: ClarificationPriority
}

export interface IntentAnalysisResult {
  intent_class: IntentClass
  complexity: IntentComplexity
  extracted_slots: IntentSlot[]
  /** Keys of information judged missing but important — empty means fully specified. */
  missing_info: string[]
  clarifications: IntentClarification[]
  /** Overall confidence in this analysis, 0-1. */
  confidence: number
  /** One-line statement of what the user wants. */
  summary: string
}
