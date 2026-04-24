/**
 * Structured output tools for the Requirements Agent.
 *
 * Requirements is narrow: it parses the user input into REQ-N requirements
 * and records foundational technical decisions (runtime / framework / test
 * strategy). Goals, metric specs, challenge seeds, traceability, and
 * cross-goal contracts are all produced by the Architect — not here.
 *
 * Each tool call is small (~500 bytes). Zod schema validation at the wire
 * enforces required fields, enums, and min lengths.
 */
import { tool } from "ai"
import z from "zod"

// ---------------------------------------------------------------------------
// Collector — accumulates registered items across tool calls
// ---------------------------------------------------------------------------

export interface RequirementsCollector {
  requirements: RegisteredRequirement[]
  decisions: RegisteredDecision[]
}

/** Terminal schema for SessionLoop's StructuredOutput (phase 3-b migration). */
export const RequirementsFinalSchema = z.object({
  summary: z
    .string()
    .min(5)
    .describe(
      "One-line summary of the parsed requirements — what the user wants, " +
        "in plain prose, under ~25 words.",
    ),
})
export type RequirementsFinal = z.infer<typeof RequirementsFinalSchema>

export interface RegisteredRequirement {
  id: string
  type: "explicit" | "implicit"
  description: string
}

export interface RegisteredDecision {
  key: string
  value: string
  reason: string
}

function emptyCollector(): RequirementsCollector {
  return {
    requirements: [],
    decisions: [],
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createRequirementsOutputTools() {
  let collector = emptyCollector()

  const tools = {
    register_requirement: tool({
      description: "Register a parsed requirement from user input. Call once per requirement.",
      inputSchema: z.object({
        id: z.string().describe("Requirement ID in REQ-N format, e.g. REQ-1"),
        type: z.enum(["explicit", "implicit"]).describe("explicit = directly stated, implicit = logically required"),
        description: z.string().min(5).describe("What the requirement asks for"),
      }),
      execute: async ({ id, type, description }) => {
        if (!/^REQ-\d+$/.test(id)) return `Error: id must be REQ-N format (got "${id}")`
        if (collector.requirements.some((r) => r.id === id)) return `Error: ${id} already registered`
        collector.requirements.push({ id, type, description })
        return `OK: ${id} registered (${collector.requirements.length} total)`
      },
    }),

    register_decision: tool({
      description:
        "Register a foundational technical decision (runtime, backend_framework, " +
        "test_framework, etc.). These seed the Decision Log under phase='requirements' " +
        "so the Architect and later agents build on the same foundation.",
      inputSchema: z.object({
        key: z.string().min(1).describe("Decision key, e.g. runtime, backend_framework, test_framework"),
        value: z.string().min(1).describe("Decision value, e.g. Bun, Hono, bun:test"),
        reason: z.string().describe("Why this decision was made (based on codebase evidence)"),
      }),
      execute: async ({ key, value, reason }) => {
        collector.decisions.push({ key, value, reason })
        return `OK: decision "${key}=${value}" registered`
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
  }
}
