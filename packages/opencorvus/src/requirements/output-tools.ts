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
import type { AcceptanceSpec } from "@/acceptance/types"
import type {
  ArchitectChallengeSeed,
  ArchitectGlobalMetricSpec,
  ArchitectGoalMetricSpec,
} from "./types"

/**
 * Mandatory blocking metric coverage. Architect must register a spec with each
 * of these names in order to finalize — these are the gates Arbiter reads when
 * deciding accept/stalled/abort. Gate class must be 'blocking'; diagnostic and
 * efficiency classes are additive signals that do not substitute for these.
 */
export const MANDATORY_GOAL_BLOCKING_METRICS = [
  "functional_correctness",
  "scenario_coverage",
  "contract_compliance",
  "regression_count",
] as const

export const MANDATORY_GLOBAL_BLOCKING_METRICS = [
  "cross_goal_contract_consistency",
  "non_regression_surface",
  "architecture_integrity",
  "user_intent_fidelity",
] as const

// ---------------------------------------------------------------------------
// Collector — accumulates registered items across tool calls
// ---------------------------------------------------------------------------

export interface RequirementsCollector {
  requirements: RegisteredRequirement[]
  goals: RegisteredGoal[]
  decisions: RegisteredDecision[]
  traceability: RegisteredTraceability[]
  goal_metric_specs: ArchitectGoalMetricSpec[]
  global_metric_specs: ArchitectGlobalMetricSpec[]
  challenge_seeds: ArchitectChallengeSeed[]
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
  acceptance_specs: AcceptanceSpec[]
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
  return {
    requirements: [],
    goals: [],
    decisions: [],
    traceability: [],
    goal_metric_specs: [],
    global_metric_specs: [],
    challenge_seeds: [],
    summary: "",
    finalized: false,
  }
}

// ---------------------------------------------------------------------------
// Zod shapes reused across metric tools
// ---------------------------------------------------------------------------

const DirectionSchema = z.enum(["higher_better", "lower_better"])
const GateClassSchema = z.enum(["blocking", "diagnostic", "efficiency"])
const EvaluatorKindSchema = z.enum(["shell", "judge", "query", "aggregator"])

const MetricCommonFields = {
  name: z.string().min(1).describe("Canonical metric name. Use the spec's mandatory names where applicable (e.g. 'functional_correctness')."),
  description: z.string().min(5).describe("One-sentence description of what this metric captures."),
  unit: z.string().min(1).describe("'ratio' | 'count' | 'latency_ms' | ..."),
  direction: DirectionSchema,
  target: z.number().describe("Aspirational threshold."),
  floor: z.number().describe("Veto threshold for blocking metrics — below this rejects acceptance."),
  weight: z.number().min(0).describe("Weight in S_k aggregation."),
  gate_class: GateClassSchema,
  evaluator_kind: EvaluatorKindSchema.describe("How the Executor computes raw_value every iteration."),
  evaluator_config: z.record(z.string(), z.unknown()).default({}).describe("Kind-specific config (e.g. {cmd} for shell, {criteria, rubric} for judge)."),
  source_requirement_ids: z.array(z.string()).default([]).describe("REQ-N IDs this metric ties back to; [] for cross-cutting globals."),
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

    register_goal_metric_spec: tool({
      description:
        "Register ONE per-goal metric. Call once per (goal, metric_name). Every goal you register " +
        "MUST end with all four mandatory BLOCKING metrics attached: functional_correctness, " +
        "scenario_coverage, contract_compliance, regression_count. Diagnostic metrics " +
        "(rubric_judge_score, reproducibility, defect_density) are recommended. These specs are " +
        "immutable after task start — the Prosecutor cannot edit them. Choose targets/floors " +
        "carefully: floor is a veto, and you cannot relax it mid-run.",
      inputSchema: z.object({
        goal_id: z.string().min(1).describe("The architect-level goal id this metric belongs to (must match a prior register_goal)."),
        ...MetricCommonFields,
      }),
      execute: async (input) => {
        if (!collector.goals.some((g) => g.id === input.goal_id)) {
          return `Error: goal "${input.goal_id}" not registered — call register_goal first`
        }
        const dup = collector.goal_metric_specs.find(
          (m) => m.goal_id === input.goal_id && m.name === input.name,
        )
        if (dup) {
          return `Error: metric "${input.name}" already registered for goal "${input.goal_id}"`
        }
        if (input.gate_class === "blocking" && input.floor === input.target && input.direction === "higher_better") {
          return `Error: blocking metric "${input.name}" has floor==target (${input.floor}) — floor must be strictly lower than target for higher_better direction`
        }
        collector.goal_metric_specs.push({
          goal_id: input.goal_id,
          name: input.name,
          description: input.description,
          unit: input.unit,
          direction: input.direction,
          target: input.target,
          floor: input.floor,
          weight: input.weight,
          gate_class: input.gate_class,
          evaluator_kind: input.evaluator_kind,
          evaluator_config: input.evaluator_config,
          source_requirement_ids: input.source_requirement_ids,
        })
        return `OK: goal metric "${input.name}" registered for ${input.goal_id} (${collector.goal_metric_specs.length} total goal metrics)`
      },
    }),

    register_global_metric_spec: tool({
      description:
        "Register ONE global (task-scoped) metric. Mandatory BLOCKING set: cross_goal_contract_consistency, " +
        "non_regression_surface, architecture_integrity, user_intent_fidelity. Global blocking metrics " +
        "can VETO acceptance even when every per-goal metric is green — that is their purpose. " +
        "Efficiency-class globals (rework_efficiency, novelty_exhaustion) are trend signals only and " +
        "never block.",
      inputSchema: z.object(MetricCommonFields),
      execute: async (input) => {
        const dup = collector.global_metric_specs.find((m) => m.name === input.name)
        if (dup) return `Error: global metric "${input.name}" already registered`
        if (input.gate_class === "blocking" && input.floor === input.target && input.direction === "higher_better") {
          return `Error: blocking metric "${input.name}" has floor==target (${input.floor}) — floor must be strictly lower than target`
        }
        collector.global_metric_specs.push(input)
        return `OK: global metric "${input.name}" registered (${collector.global_metric_specs.length} total globals)`
      },
    }),

    register_challenge_seed: tool({
      description:
        "Register a Prosecutor challenge seed — a candidate reproducer or risk area the Architect " +
        "thinks is worth probing. Phase 4's Prosecutor reads these as priors when it opens the " +
        "adversarial session. Seeds are optional; register 0–6 depending on how risk-heavy the task " +
        "feels. Do NOT use seeds as a way to backfill a missing metric — register the metric " +
        "directly instead.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Seed id; free-form but stable across finalize/retry."),
        scope: z.enum(["goal", "global"]),
        target_ref: z.string().min(1).describe("Goal id (for scope='goal') or free-form risk label (for scope='global')."),
        claim: z.string().min(5).describe("The concrete reproducer / counterexample hypothesis, one sentence."),
        rationale: z.string().min(5).describe("Why this is worth probing — reference the code/PRD evidence."),
        priority_hint: z.enum(["high", "medium", "low"]),
      }),
      execute: async (input) => {
        if (collector.challenge_seeds.some((s) => s.id === input.id)) {
          return `Error: seed id "${input.id}" already registered`
        }
        if (input.scope === "goal" && !collector.goals.some((g) => g.id === input.target_ref)) {
          return `Warning: seed "${input.id}" references goal "${input.target_ref}" that isn't registered`
        }
        collector.challenge_seeds.push(input)
        return `OK: challenge seed "${input.id}" registered (${collector.challenge_seeds.length} total)`
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

          // Mandatory blocking metric coverage per goal.
          const goalMetrics = collector.goal_metric_specs.filter((m) => m.goal_id === g.id)
          const blockingNames = new Set(
            goalMetrics.filter((m) => m.gate_class === "blocking").map((m) => m.name),
          )
          const missingBlocking = MANDATORY_GOAL_BLOCKING_METRICS.filter(
            (n) => !blockingNames.has(n),
          )
          if (missingBlocking.length > 0) {
            issues.push(
              `Goal ${g.id}: missing mandatory BLOCKING metrics: ${missingBlocking.join(", ")} — register each via register_goal_metric_spec with gate_class="blocking"`,
            )
          }
        }

        // Mandatory global blocking metric coverage.
        const globalBlockingNames = new Set(
          collector.global_metric_specs
            .filter((m) => m.gate_class === "blocking")
            .map((m) => m.name),
        )
        const missingGlobal = MANDATORY_GLOBAL_BLOCKING_METRICS.filter(
          (n) => !globalBlockingNames.has(n),
        )
        if (missingGlobal.length > 0) {
          issues.push(
            `Missing mandatory GLOBAL BLOCKING metrics: ${missingGlobal.join(", ")} — register each via register_global_metric_spec with gate_class="blocking"`,
          )
        }

        // Cross-reference: every goal metric must reference a registered goal.
        for (const m of collector.goal_metric_specs) {
          if (!collector.goals.some((g) => g.id === m.goal_id)) {
            issues.push(
              `Goal metric "${m.name}" references unknown goal "${m.goal_id}"`,
            )
          }
        }

        if (issues.length === 0) {
          collector.finalized = true
          void warnings
          return [
            `PASS: Decomposition complete.`,
            `  ${collector.goals.length} goals, ${collector.requirements.length} requirements,`,
            `  ${collector.decisions.length} decisions, ${collector.traceability.length} traceability mappings,`,
            `  ${collector.goal_metric_specs.length} goal metrics, ${collector.global_metric_specs.length} global metrics,`,
            `  ${collector.challenge_seeds.length} challenge seeds.`,
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
