/**
 * Structured output tools for the Requirements Agent.
 *
 * Requirements is narrow: it parses the user input into REQ-N requirements
 * and records foundational technical decisions (runtime / framework / test
 * strategy). Goals, acceptance specs, traceability, source/reference
 * coverage, and cross-goal contracts are produced by the Architect — not
 * here.
 *
 * Each tool call is small (~500 bytes). Zod schema validation at the wire
 * enforces required fields, enums, and min lengths.
 */
import { tool } from "ai"
import z from "zod"
import { limitSummary, markdownList } from "@/agent/report"
import type { DecisionLog } from "@/decision-log"
import { FactCheckItemListSchema, type FactCheckItem } from "@/fact-check/schema"

// ---------------------------------------------------------------------------
// Collector — accumulates registered items across tool calls
// ---------------------------------------------------------------------------

export interface RequirementsCollector {
  requirements: RegisteredRequirement[]
  decisions: RegisteredDecision[]
  fact_check_items: FactCheckItem[]
  finalized: boolean
}

export interface RegisteredRequirement {
  id: string
  type: "explicit" | "implicit"
  description: string
  acceptance: string
  non_goals: string
  evidence_refs: string[]
}

export interface RegisteredDecision {
  key: string
  value: string
  reason: string
}

export interface RequirementsOutputToolOptions {
  decisionLog?: DecisionLog
  decisionPhase?: string
  allowedResearchEvidenceIDs?: string[]
}

const REQUIRED_DECISION_KEYS = [
  "runtime",
  "test_framework",
  "affected_modules",
  "affected_concepts",
  "impact_size",
] as const

const FRAMEWORK_DECISION_KEYS = ["frontend_framework", "backend_framework", "framework", "runtime_framework"] as const

function missingRequiredDecisions(collector: RequirementsCollector): string[] {
  const keys = new Set(collector.decisions.map((decision) => decision.key))
  const missing: string[] = REQUIRED_DECISION_KEYS.filter((key) => !keys.has(key))
  if (!FRAMEWORK_DECISION_KEYS.some((key) => keys.has(key))) {
    missing.push("one_framework")
  }
  return missing
}

export const RequirementsSubmitSchema = z.object({
  final: z.literal(true).describe("Explicit confirmation that requirement and decision registration is complete."),
  // Optional fact-check registration: missing means no items registered.
  fact_check_items: FactCheckItemListSchema.default([]).describe(
    "Every factual claim (API behaviour, library version, third-party protocol, number, path, history) you have NOT verified via tool calls in this session. Empty when only opinions or in-session-verified statements.",
  ),
})

export const RequirementRegistrationSchema = z.object({
  id: z.string().describe("Requirement ID in REQ-N format, e.g. REQ-1"),
  type: z.enum(["explicit", "implicit"]).describe("explicit = directly stated, implicit = logically required"),
  description: z.string().trim().min(5).describe("What the requirement asks for"),
  acceptance: z.string().trim().min(1).describe("One observable success condition for this REQ-N"),
  non_goals: z.string().trim().min(1).describe("One nearby behavior this REQ-N does not cover"),
  evidence_refs: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Research evidence IDs that support this requirement. Empty when the requirement does not depend on research facts.",
    ),
})

function emptyCollector(): RequirementsCollector {
  return {
    requirements: [],
    decisions: [],
    fact_check_items: [],
    finalized: false,
  }
}

export function summarizeRequirements(collector: RequirementsCollector): string {
  const explicit = collector.requirements.filter((r) => r.type === "explicit").length
  const implicit = collector.requirements.length - explicit
  return `Parsed ${collector.requirements.length} requirement(s): ${explicit} explicit, ${implicit} implicit.`
}

export function buildRequirementsReport(collector: RequirementsCollector) {
  const requirementLines = collector.requirements.map(
    (r) =>
      `${r.id} [${r.type}]: ${r.description} Acceptance: ${r.acceptance} Non-goals: ${r.non_goals} Evidence: ${r.evidence_refs.join(", ") || "(none)"}`,
  )
  const decisionLines = collector.decisions.map((d) => `${d.key}=${d.value} - ${d.reason}`)
  return {
    summary: limitSummary(summarizeRequirements(collector)),
    detail: [
      `## Summary\n${summarizeRequirements(collector)}`,
      `## Requirements\n${requirementLines.length ? markdownList(requirementLines) : "- none submitted"}`,
      `## Decisions\n${decisionLines.length ? markdownList(decisionLines) : "- none submitted"}`,
    ].join("\n\n"),
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createRequirementsOutputTools(options: RequirementsOutputToolOptions = {}) {
  let collector = emptyCollector()
  const allowedEvidenceIDs =
    options.allowedResearchEvidenceIDs !== undefined ? new Set(options.allowedResearchEvidenceIDs) : undefined

  const tools = {
    register_requirement: tool({
      description: "Register a parsed requirement from user input. Call once per requirement.",
      inputSchema: RequirementRegistrationSchema,
      execute: async ({ id, type, description, acceptance, non_goals, evidence_refs = [] }) => {
        if (collector.finalized) return "Error: requirements already finalized; collector is closed."
        if (!/^REQ-\d+$/.test(id)) return `Error: id must be REQ-N format (got "${id}")`
        if (collector.requirements.some((r) => r.id === id)) return `Error: ${id} already registered`
        if (evidence_refs.length > 0) {
          if (!allowedEvidenceIDs || allowedEvidenceIDs.size === 0) {
            return "Error: evidence_refs were provided but there is no active non-stale research brief for this task."
          }
          const unknown = evidence_refs.filter((ref) => !allowedEvidenceIDs.has(ref))
          if (unknown.length > 0) {
            return `Error: evidence_refs contain unknown research evidence id(s): ${[...new Set(unknown)].join(", ")}`
          }
        }
        collector.requirements.push({ id, type, description, acceptance, non_goals, evidence_refs })
        return `OK: ${id} registered (${collector.requirements.length} total)`
      },
    }),

    register_decision: tool({
      description:
        "Register a foundational technical decision (runtime, backend_framework, " +
        "test_framework, etc.) or scope-calibration decision (user_workflows, " +
        "visual_surfaces, interactions_and_states, data_contracts, " +
        "verification_surfaces, complexity_drivers). These seed the Decision " +
        "Log under phase='requirements' so the Architect and later agents build " +
        "on the same foundation.",
      inputSchema: z.object({
        key: z
          .string()
          .min(1)
          .describe("Decision key, e.g. runtime, backend_framework, test_framework, user_workflows, visual_surfaces"),
        value: z
          .string()
          .min(1)
          .describe("Decision value, e.g. Bun, Hono, bun:test, or a concise comma/semicolon-separated inventory"),
        reason: z.string().describe("Why this decision was made (based on codebase evidence)"),
      }),
      execute: async ({ key, value, reason }) => {
        if (collector.finalized) return "Error: requirements already finalized; collector is closed."
        collector.decisions.push({ key, value, reason })
        options.decisionLog?.append({
          phase: options.decisionPhase ?? "requirements",
          key,
          value,
          reason,
        })
        return `OK: decision "${key}=${value}" registered`
      },
    }),

    submit_requirements: tool({
      description:
        "Finalize requirements after all register_requirement and register_decision calls are complete. " +
        "Call with final=true; include fact_check_items only when registering unverified claims.",
      inputSchema: RequirementsSubmitSchema,
      execute: async ({ fact_check_items }) => {
        if (collector.finalized) return "Error: requirements already finalized; duplicate submit_requirements ignored."
        const items = fact_check_items ?? []
        if (collector.requirements.length === 0) {
          return "Error: no requirements registered. Call register_requirement at least once before submit_requirements."
        }
        const missing = missingRequiredDecisions(collector)
        if (missing.length > 0) {
          return (
            `Error: missing required foundational decision(s): ${missing.join(", ")}. ` +
            "Register runtime, one framework, test_framework, affected_modules, affected_concepts, and impact_size before submit_requirements."
          )
        }
        collector.fact_check_items = items
        collector.finalized = true
        return `PASS: Requirements finalized (${collector.requirements.length} requirement(s), ${collector.decisions.length} decision(s), ${items.length} fact-check item(s) registered).`
      },
    }),
  }

  return {
    tools,
    collector,
    /** Reset collector between retry attempts. */
    reset() {
      collector = emptyCollector()
      return collector
    },
    /** Get current collector reference. */
    getCollector() {
      return collector
    },
    buildReport() {
      return buildRequirementsReport(collector)
    },
  }
}
