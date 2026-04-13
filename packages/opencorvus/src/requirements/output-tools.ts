/**
 * Structured output tools for the Requirements Agent.
 *
 * Instead of producing YAML-like text parsed by regex, the LLM registers each
 * item via a Zod-validated tool call. Benefits over text-based output:
 *
 * ① Schema validation per call — required fields, enums, min lengths enforced
 * ② Anti-hallucination — owned_paths verified against filesystem
 * ③ Anti-omission — missing fields produce immediate error messages
 * ④ Multi-line support — JSON strings handle objectives/definitions naturally
 * ⑤ Incremental — LLM registers one goal at a time, reducing context pressure
 *
 * Each tool call is small (~500 bytes), avoiding the buffering hang that killed
 * the old monolithic submit_spec/submit_plan approach (see parse-section-tags.ts).
 */
import { tool } from "ai"
import z from "zod"
import path from "path"
import fs from "fs"
import { Instance } from "@/project/instance"
import { GoalContractFieldsSchema } from "@/pipeline/goal-contract.schema"

// ---------------------------------------------------------------------------
// Collector — accumulates registered items across tool calls
// ---------------------------------------------------------------------------

export interface RequirementsCollector {
  requirements: RegisteredRequirement[]
  goals: RegisteredGoal[]
  decisions: RegisteredDecision[]
  traceability: RegisteredTraceability[]
  summary: string
  finalized: boolean
}

export interface RegisteredRequirement {
  id: string
  type: "explicit" | "implicit"
  description: string
}

export interface RegisteredGoal {
  id: string
  title: string
  objective: string
  done_definition: string
  owned_paths: string[]
  depends_on: string[]
  exports: string[]
  imports: string[]
  priority: "blocking" | "advisory"
  kind: "bootstrap" | "feature" | "verification" | "integration" | "system"
  requirement_ids: string[]
}

export interface RegisteredDecision {
  key: string
  value: string
  reason: string
}

export interface RegisteredTraceability {
  requirementID: string
  goalIDs: string[]
}

function emptyCollector(): RequirementsCollector {
  return { requirements: [], goals: [], decisions: [], traceability: [], summary: "", finalized: false }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createRequirementsOutputTools(workDir?: string) {
  let collector = emptyCollector()
  const dir = workDir ?? Instance.directory

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
        if (collector.requirements.some(r => r.id === id)) return `Error: ${id} already registered`
        collector.requirements.push({ id, type, description })
        return `OK: ${id} registered (${collector.requirements.length} total)`
      },
    }),

    register_goal: tool({
      description:
        "Register a goal contract. Each goal executes in an isolated worktree — " +
        "the objective must be SELF-CONTAINED (executor sees only this goal). " +
        "All fields are schema-validated; invalid input returns an error to fix.",
      inputSchema: GoalContractFieldsSchema,
      execute: async (input) => {
        // Path existence check (warning, not error — new projects create files)
        const warnings: string[] = []
        for (const p of input.owned_paths) {
          try {
            const abs = path.resolve(dir, p)
            if (!fs.existsSync(abs) && !fs.existsSync(path.dirname(abs))) {
              warnings.push(p)
            }
          } catch { /* cross-platform path issues — skip */ }
        }

        // Upsert: if same ID exists, overwrite (LLM may refine a goal it already registered)
        const existingIdx = collector.goals.findIndex(g => g.id === input.id)
        let msg: string
        if (existingIdx >= 0) {
          collector.goals[existingIdx] = input
          msg = `OK: goal "${input.id}" updated (${collector.goals.length} total)`
        } else {
          collector.goals.push(input)
          msg = `OK: goal "${input.id}" registered (${collector.goals.length} total)`
        }
        if (warnings.length > 0) {
          msg += `\nWarning: paths with no existing parent directory: ${warnings.join(", ")}. Verify these are intentional.`
        }
        return msg
      },
    }),

    register_decision: tool({
      description: "Register a technical decision (runtime, framework, test strategy, etc.).",
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

    register_traceability: tool({
      description: "Map a requirement to the goals that cover it. Call once per requirement.",
      inputSchema: z.object({
        requirement_id: z.string().describe("REQ-N format"),
        goal_ids: z.array(z.string().min(1)).min(1).describe("Goal IDs that implement this requirement"),
      }),
      execute: async ({ requirement_id, goal_ids }) => {
        const warnings: string[] = []
        if (!collector.requirements.some(r => r.id === requirement_id)) {
          warnings.push(`${requirement_id} not registered as requirement`)
        }
        const missing = goal_ids.filter(g => !collector.goals.some(gl => gl.id === g))
        if (missing.length > 0) warnings.push(`goals not registered: ${missing.join(", ")}`)
        collector.traceability.push({ requirementID: requirement_id, goalIDs: goal_ids })
        let msg = `OK: ${requirement_id} → ${goal_ids.join(", ")}`
        if (warnings.length > 0) msg += `\nWarning: ${warnings.join("; ")}`
        return msg
      },
    }),

    finalize_decomposition: tool({
      description:
        "Validate decomposition completeness and finalize. " +
        "Call AFTER registering all requirements, goals, decisions, and traceability. " +
        "Returns quality issues if any — fix them and call again.",
      inputSchema: z.object({
        summary: z.string().min(5).describe("One-line summary of the decomposition"),
      }),
      execute: async ({ summary }) => {
        collector.summary = summary
        const issues: string[] = []

        if (collector.requirements.length === 0) {
          issues.push("No requirements registered")
        }
        if (collector.goals.length === 0) {
          issues.push("No goals registered")
        }
        if (collector.decisions.length < 2) {
          issues.push(`Only ${collector.decisions.length} decisions — record at least runtime + framework`)
        }

        // Traceability coverage
        if (collector.requirements.length > 0) {
          const covered = new Set(collector.traceability.map(t => t.requirementID))
          const uncovered = collector.requirements.filter(r => !covered.has(r.id))
          if (uncovered.length > 0) {
            issues.push(`Uncovered requirements: ${uncovered.map(r => r.id).join(", ")}`)
          }
        }

        // Per-goal checks
        const warnings: string[] = []
        for (const g of collector.goals) {
          // Goals without exports are fine for verification/system/leaf goals.
          // Only warn (not block) for feature goals — LLM may have valid reasons.
          if (g.exports.length === 0 && g.kind !== "verification" && g.kind !== "system") {
            const hasConsumers = collector.goals.some(other => other.depends_on.includes(g.id))
            if (hasConsumers) {
              issues.push(`Goal ${g.id}: has dependents but no exports — dependents can't code against its interfaces`)
            }
          }
          // Validate depends_on references
          for (const dep of g.depends_on) {
            if (!collector.goals.some(gl => gl.id === dep)) {
              issues.push(`Goal ${g.id}: depends_on "${dep}" not registered`)
            }
          }
        }

        if (issues.length === 0) {
          collector.finalized = true
          return [
            `PASS: Decomposition complete.`,
            `  ${collector.goals.length} goals, ${collector.requirements.length} requirements,`,
            `  ${collector.decisions.length} decisions, ${collector.traceability.length} traceability mappings.`,
          ].join("\n")
        }

        return `ISSUES (${issues.length}):\n${issues.map((i, n) => `${n + 1}. ${i}`).join("\n")}\n\nFix and call finalize_decomposition again.`
      },
    }),
  }

  return {
    tools,
    collector,
    /** Reset collector between retry attempts. */
    reset() { collector = emptyCollector(); return collector },
    /** Get current collector reference. */
    getCollector() { return collector },
  }
}
