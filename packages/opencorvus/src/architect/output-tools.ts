/**
 * Structured output tools for the Architect Agent.
 *
 * Replaces YAML-like text output with Zod-validated tool calls.
 * Particularly critical for the `spec` field which contains TypeScript code —
 * the old parseYamlLikeList() mangled multi-line code blocks because lines
 * like `id: string` inside TypeScript were parsed as new YAML keys.
 *
 * Each tool call is small (~500 bytes), avoiding the buffering hang from
 * monolithic tool schemas (see parse-section-tags.ts header comment).
 */
import { tool } from "ai"
import z from "zod"
import type { ArchitectDecisionKey, ArchitectContract } from "./types"

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export interface ArchitectCollector {
  contracts: RegisteredContract[]
  summary: string
  finalized: boolean
}

export interface RegisteredContract {
  category: ArchitectDecisionKey
  title: string
  spec: string
  goalIDs: string[]
}

const VALID_CATEGORIES: ArchitectDecisionKey[] = [
  "directory_blueprint",
  "interface_contract",
  "export_manifest",
  "shared_type",
  "naming_convention",
  "dependency_order",
]

function emptyCollector(): ArchitectCollector {
  return { contracts: [], summary: "", finalized: false }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createArchitectOutputTools(goalIDs: string[]) {
  let collector = emptyCollector()
  const goalSet = new Set(goalIDs)

  const tools = {
    register_contract: tool({
      description:
        "Register a cross-goal consensus contract. Each contract is written to " +
        "the Decision Log and becomes BINDING for all Planners and Executors. " +
        "For interface_contract and shared_type categories, spec MUST be actual TypeScript code.",
      inputSchema: z.object({
        category: z.enum([
          "directory_blueprint",
          "interface_contract",
          "export_manifest",
          "shared_type",
          "naming_convention",
          "dependency_order",
        ] as const).describe("Contract category — determines how it's used downstream"),
        title: z.string().min(1).describe("Short title for this contract"),
        spec: z.string().min(10).describe(
          "The contract specification. For interface_contract and shared_type, " +
          "this MUST be actual TypeScript code (not English description). " +
          "For directory_blueprint, use path → description format.",
        ),
        goal_ids: z.array(z.string().min(1)).min(1).describe(
          "Goal IDs this contract relates to (producer + consumers)",
        ),
      }),
      execute: async ({ category, title, spec, goal_ids }) => {
        // Validate goal references
        const unknown = goal_ids.filter(g => !goalSet.has(g))
        if (unknown.length > 0) {
          return `Error: goal IDs not found: ${unknown.join(", ")}. Available: ${goalIDs.join(", ")}`
        }

        // TypeScript code check for type categories
        if ((category === "interface_contract" || category === "shared_type") &&
            !spec.includes("interface") && !spec.includes("type") &&
            !spec.includes("function") && !spec.includes("export") &&
            !spec.includes("class") && !spec.includes("enum") &&
            !spec.includes("const")) {
          return `Warning: ${category} contracts should contain TypeScript code, not English descriptions. Consider adding actual type/interface definitions.`
        }

        collector.contracts.push({ category, title, spec, goalIDs: goal_ids })
        return `OK: ${category} "${title}" registered (${collector.contracts.length} total)`
      },
    }),

    finalize_blueprint: tool({
      description: "Finalize the architect blueprint. Call after registering all contracts.",
      inputSchema: z.object({
        summary: z.string().min(5).describe("One-line summary of what was coordinated"),
      }),
      execute: async ({ summary }) => {
        collector.summary = summary
        const issues: string[] = []

        if (collector.contracts.length === 0) {
          issues.push("No contracts registered")
        }

        // Check for required categories
        const categories = new Set(collector.contracts.map(c => c.category))
        if (!categories.has("interface_contract") && !categories.has("shared_type")) {
          issues.push("No interface_contract or shared_type — cross-goal types will be undefined")
        }

        if (issues.length === 0) {
          collector.finalized = true
          return `PASS: Blueprint complete. ${collector.contracts.length} contracts across ${categories.size} categories.`
        }

        return `ISSUES:\n${issues.map((i, n) => `${n + 1}. ${i}`).join("\n")}\n\nFix and call finalize_blueprint again.`
      },
    }),
  }

  return {
    tools,
    collector,
    reset() { collector = emptyCollector(); return collector },
    getCollector() { return collector },
  }
}
