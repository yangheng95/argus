/**
 * Zod-validated tool calls for the Architect Agent.
 *
 * The Architect is now the authoritative goal decomposer: it registers goals,
 * metric specs, challenge seeds, traceability, and cross-goal contracts — and
 * can also refine (modify/remove) goals during re-runs triggered by delivery
 * feedback. Every registration path writes into a single collector; the
 * orchestrator tool reads the finalized collector after the agent session
 * ends and performs DB upsert + event emission in one place.
 *
 * Small tool calls (~500 bytes each) avoid the streaming buffering that a
 * monolithic submit tool would trigger for TypeScript source inside `spec`
 * or long acceptance criteria.
 *
 * NOTE: `MANDATORY_*_BLOCKING_METRICS` constants and `Architect*Spec` / `...Seed`
 * / `TraceabilityEntry` types currently live under `@/requirements/*`; they
 * will move to `@/architect/types` in Phase 3 of the decompose migration. The
 * cross-package import below is the single source of truth until then.
 */
import { tool } from "ai"
import z from "zod"
import path from "path"
import fs from "fs"
import { Instance } from "@/project/instance"
import {
  GoalContractFieldsSchema,
  GoalContractUpdateSchema,
} from "@/pipeline/goal-contract.schema"
import type { AcceptanceSpec } from "@/acceptance/types"
import {
  MANDATORY_GOAL_BLOCKING_METRICS,
  MANDATORY_GLOBAL_BLOCKING_METRICS,
} from "@/requirements/output-tools"
import type {
  ArchitectChallengeSeed,
  ArchitectGlobalMetricSpec,
  ArchitectGoalMetricSpec,
  TraceabilityEntry,
} from "@/requirements/types"
import type { ArchitectContract, ArchitectDecisionKey } from "./types"

// ---------------------------------------------------------------------------
// Collector — single buffer for the full Architect output
// ---------------------------------------------------------------------------

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

export interface RegisteredContract {
  category: ArchitectDecisionKey
  title: string
  spec: string
  goalIDs: string[]
}

export interface ArchitectCollector {
  goals: RegisteredGoal[]
  goal_metric_specs: ArchitectGoalMetricSpec[]
  global_metric_specs: ArchitectGlobalMetricSpec[]
  challenge_seeds: ArchitectChallengeSeed[]
  traceability: TraceabilityEntry[]
  contracts: RegisteredContract[]
  /** Goal IDs the agent has explicitly removed during a re-run session. */
  removed_goal_ids: string[]
  summary: string
  finalized: boolean
}

const VALID_CONTRACT_CATEGORIES: ArchitectDecisionKey[] = [
  "directory_blueprint",
  "interface_contract",
  "export_manifest",
  "shared_type",
  "naming_convention",
  "dependency_order",
]

function emptyCollector(): ArchitectCollector {
  return {
    goals: [],
    goal_metric_specs: [],
    global_metric_specs: [],
    challenge_seeds: [],
    traceability: [],
    contracts: [],
    removed_goal_ids: [],
    summary: "",
    finalized: false,
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createArchitectOutputTools(input: {
  /**
   * Goals already persisted from prior runs. During a re-run the Architect
   * may modify or remove these; a fresh run receives an empty list.
   */
  existingGoals?: RegisteredGoal[]
  workDir?: string
}) {
  let collector = emptyCollector()
  const dir = input.workDir ?? Instance.directory

  // Seed the collector with existing goals so modify_goal / remove_goal work
  // without the LLM having to re-register them first. register_goal still
  // wins if the LLM chooses to overwrite an existing id.
  if (input.existingGoals?.length) {
    for (const g of input.existingGoals) collector.goals.push({ ...g })
  }

  const tools = {
    register_goal: tool({
      description:
        "Register a new goal contract, or overwrite a prior registration with " +
        "the same id. Each goal will execute in an isolated worktree — the " +
        "objective MUST be self-contained (executor sees only this goal). All " +
        "fields are schema-validated.",
      inputSchema: GoalContractFieldsSchema,
      execute: async (input) => {
        const warnings: string[] = []
        for (const p of input.owned_paths) {
          try {
            const abs = path.resolve(dir, p)
            if (!fs.existsSync(abs) && !fs.existsSync(path.dirname(abs))) {
              warnings.push(p)
            }
          } catch { /* cross-platform path issues — skip */ }
        }

        const existingIdx = collector.goals.findIndex((g) => g.id === input.id)
        let msg: string
        if (existingIdx >= 0) {
          collector.goals[existingIdx] = input
          msg = `OK: goal "${input.id}" updated in-place (${collector.goals.length} total)`
        } else {
          collector.goals.push(input)
          msg = `OK: goal "${input.id}" registered (${collector.goals.length} total)`
        }
        // A newly registered/updated id cannot also be in the removal list.
        collector.removed_goal_ids = collector.removed_goal_ids.filter(
          (id) => id !== input.id,
        )
        if (warnings.length > 0) {
          msg += `\nWarning: paths without an existing parent directory: ${warnings.join(", ")}. Verify these are intentional.`
        }
        return msg
      },
    }),

    modify_goal: tool({
      description:
        "Refine fields on an already-registered goal (including those seeded " +
        "from a prior run). Supply only the fields you want to change. Unknown " +
        "ids are rejected — use register_goal if you intend a brand-new goal.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Existing goal id to modify"),
        updates: GoalContractUpdateSchema.describe(
          "Subset of contract fields to overwrite (id is not modifiable).",
        ),
      }),
      execute: async ({ id, updates }) => {
        const idx = collector.goals.findIndex((g) => g.id === id)
        if (idx < 0) {
          return `Error: goal "${id}" not registered. Use register_goal to add new goals.`
        }
        const prior = collector.goals[idx]
        collector.goals[idx] = { ...prior, ...updates }
        return `OK: goal "${id}" fields updated (${Object.keys(updates).length} change(s))`
      },
    }),

    remove_goal: tool({
      description:
        "Remove a previously-registered goal (typically during a re-run when " +
        "delivery feedback showed the goal was redundant or wrong). The goal " +
        "id is recorded so the orchestrator can delete the DB row on finalize. " +
        "Any metric specs / seeds / traceability / contracts referencing the " +
        "removed id must also be re-registered without it.",
      inputSchema: z.object({
        id: z.string().min(1).describe("Goal id to remove"),
        reason: z
          .string()
          .min(5)
          .describe("Why this goal is being removed (recorded for audit)"),
      }),
      execute: async ({ id, reason }) => {
        const idx = collector.goals.findIndex((g) => g.id === id)
        if (idx < 0) {
          return `Error: goal "${id}" not in collector — nothing to remove.`
        }
        collector.goals.splice(idx, 1)
        if (!collector.removed_goal_ids.includes(id)) {
          collector.removed_goal_ids.push(id)
        }
        return `OK: goal "${id}" removed. Reason: ${reason}. (${collector.goals.length} remaining)`
      },
    }),

    register_goal_metric_spec: tool({
      description:
        "Register ONE per-goal metric. Call once per (goal, metric_name). Every " +
        "goal MUST end with all four mandatory BLOCKING metrics: " +
        "functional_correctness, scenario_coverage, contract_compliance, " +
        "regression_count. Diagnostic metrics (rubric_judge_score, " +
        "reproducibility, defect_density) are recommended. Specs are immutable " +
        "after Architect finalize — the Prosecutor cannot edit them.",
      inputSchema: z.object({
        goal_id: z
          .string()
          .min(1)
          .describe(
            "The architect-level goal id this metric belongs to (must match a prior register_goal).",
          ),
        ...metricCommonFields(),
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
        if (
          input.gate_class === "blocking" &&
          input.floor === input.target &&
          input.direction === "higher_better"
        ) {
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
        "Register ONE global (task-scoped) metric. Mandatory BLOCKING set: " +
        "cross_goal_contract_consistency, non_regression_surface, " +
        "architecture_integrity, user_intent_fidelity. Global blocking metrics " +
        "can VETO acceptance even when every per-goal metric is green.",
      inputSchema: z.object(metricCommonFields()),
      execute: async (input) => {
        const dup = collector.global_metric_specs.find((m) => m.name === input.name)
        if (dup) return `Error: global metric "${input.name}" already registered`
        if (
          input.gate_class === "blocking" &&
          input.floor === input.target &&
          input.direction === "higher_better"
        ) {
          return `Error: blocking metric "${input.name}" has floor==target (${input.floor}) — floor must be strictly lower than target`
        }
        collector.global_metric_specs.push(input)
        return `OK: global metric "${input.name}" registered (${collector.global_metric_specs.length} total globals)`
      },
    }),

    register_challenge_seed: tool({
      description:
        "Register a Prosecutor challenge seed — a candidate reproducer or risk " +
        "area worth probing. Phase-4 Prosecutor reads these as priors when it " +
        "opens the adversarial session. Seeds are optional; register 0–6 based " +
        "on how risk-heavy the task feels.",
      inputSchema: z.object({
        id: z
          .string()
          .min(1)
          .describe("Seed id; free-form but stable across finalize/retry."),
        scope: z.enum(["goal", "global"]),
        target_ref: z
          .string()
          .min(1)
          .describe(
            "Goal id (for scope='goal') or free-form risk label (for scope='global').",
          ),
        claim: z
          .string()
          .min(5)
          .describe(
            "The concrete reproducer / counterexample hypothesis, one sentence.",
          ),
        rationale: z
          .string()
          .min(5)
          .describe("Why this is worth probing — reference the code/PRD evidence."),
        priority_hint: z.enum(["high", "medium", "low"]),
      }),
      execute: async (input) => {
        if (collector.challenge_seeds.some((s) => s.id === input.id)) {
          return `Error: seed id "${input.id}" already registered`
        }
        if (
          input.scope === "goal" &&
          !collector.goals.some((g) => g.id === input.target_ref)
        ) {
          return `Warning: seed "${input.id}" references goal "${input.target_ref}" that isn't registered`
        }
        collector.challenge_seeds.push(input)
        return `OK: challenge seed "${input.id}" registered (${collector.challenge_seeds.length} total)`
      },
    }),

    register_traceability: tool({
      description:
        "Map a requirement to the goals that cover it. Call once per " +
        "requirement you intend to trace.",
      inputSchema: z.object({
        requirement_id: z.string().describe("REQ-N format"),
        goal_ids: z
          .array(z.string().min(1))
          .min(1)
          .describe("Goal IDs that implement this requirement"),
      }),
      execute: async ({ requirement_id, goal_ids }) => {
        const warnings: string[] = []
        const missing = goal_ids.filter(
          (g) => !collector.goals.some((gl) => gl.id === g),
        )
        if (missing.length > 0) warnings.push(`goals not registered: ${missing.join(", ")}`)
        collector.traceability.push({ requirementID: requirement_id, goalIDs: goal_ids })
        let msg = `OK: ${requirement_id} → ${goal_ids.join(", ")}`
        if (warnings.length > 0) msg += `\nWarning: ${warnings.join("; ")}`
        return msg
      },
    }),

    register_contract: tool({
      description:
        "Register a cross-goal consensus contract. Each contract is written to " +
        "the Decision Log and becomes BINDING for all Planners and Executors. " +
        "For interface_contract and shared_type categories, spec MUST be actual " +
        "source code in the project's language, wrapped in a fenced code block.",
      inputSchema: z.object({
        category: z
          .enum([
            "directory_blueprint",
            "interface_contract",
            "export_manifest",
            "shared_type",
            "naming_convention",
            "dependency_order",
          ] as const)
          .describe("Contract category — determines how it's used downstream"),
        title: z.string().min(1).describe("Short title for this contract"),
        spec: z
          .string()
          .min(10)
          .describe(
            "The contract specification. Rendered as Markdown downstream — wrap " +
              "source code in a fenced block tagged with the project's actual " +
              "language (```ts, ```py, ```go, ```rs, ```java, ```sql, ...) and " +
              "directory trees / ASCII layouts in ```text. For interface_contract " +
              "and shared_type, this MUST be actual source code (not English " +
              "description). For directory_blueprint, use path → description " +
              "format inside a ```text fence.",
          ),
        goal_ids: z
          .array(z.string().min(1))
          .min(1)
          .describe("Goal IDs this contract relates to (producer + consumers)"),
      }),
      execute: async ({ category, title, spec, goal_ids }) => {
        const knownGoals = new Set(collector.goals.map((g) => g.id))
        const unknown = goal_ids.filter((g) => !knownGoals.has(g))
        if (unknown.length > 0) {
          return `Error: goal IDs not found: ${unknown.join(", ")}. Register the goals first.`
        }
        if (
          (category === "interface_contract" || category === "shared_type") &&
          !spec.includes("```")
        ) {
          return `Warning: ${category} spec must contain a fenced code block (\`\`\`<lang> ... \`\`\`) with actual source code, not an English description.`
        }
        collector.contracts.push({ category, title, spec, goalIDs: goal_ids })
        return `OK: ${category} "${title}" registered (${collector.contracts.length} contracts total)`
      },
    }),

    finalize_architect: tool({
      description:
        "Validate the full Architect output (goals + metric specs + seeds + " +
        "traceability + contracts) and finalize. Call AFTER every register/modify " +
        "tool. Returns a list of issues if any — fix them and call again.",
      inputSchema: z.object({
        summary: z
          .string()
          .min(5)
          .describe("One-line summary of what was decomposed and coordinated"),
      }),
      execute: async ({ summary }) => {
        collector.summary = summary
        const issues: string[] = []

        // 1. Goal structural integrity --------------------------------------
        if (collector.goals.length === 0) {
          issues.push("No goals registered — Architect must produce at least one goal")
        }
        for (const g of collector.goals) {
          if (
            g.exports.length === 0 &&
            g.kind !== "verification" &&
            g.kind !== "system"
          ) {
            const hasConsumers = collector.goals.some((other) =>
              other.depends_on.includes(g.id),
            )
            if (hasConsumers) {
              issues.push(
                `Goal ${g.id}: has dependents but no exports — dependents can't code against its interfaces`,
              )
            }
          }
          for (const dep of g.depends_on) {
            if (!collector.goals.some((gl) => gl.id === dep)) {
              issues.push(`Goal ${g.id}: depends_on "${dep}" not registered`)
            }
          }

          // Mandatory blocking metric coverage per goal.
          const goalMetrics = collector.goal_metric_specs.filter(
            (m) => m.goal_id === g.id,
          )
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

        // 2. Mandatory global blocking metrics ------------------------------
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

        // 3. Metric-goal cross references -----------------------------------
        for (const m of collector.goal_metric_specs) {
          if (!collector.goals.some((g) => g.id === m.goal_id)) {
            issues.push(
              `Goal metric "${m.name}" references unknown goal "${m.goal_id}"`,
            )
          }
        }

        // 4. Contract category coverage -------------------------------------
        const categories = new Set(collector.contracts.map((c) => c.category))
        if (collector.goals.length >= 2) {
          if (
            !categories.has("interface_contract") &&
            !categories.has("shared_type")
          ) {
            issues.push(
              "No interface_contract or shared_type contract — cross-goal types will be undefined",
            )
          }
        }

        // 5. Seed target references -----------------------------------------
        for (const s of collector.challenge_seeds) {
          if (
            s.scope === "goal" &&
            !collector.goals.some((g) => g.id === s.target_ref)
          ) {
            issues.push(
              `Challenge seed "${s.id}" targets unknown goal "${s.target_ref}"`,
            )
          }
        }

        if (issues.length === 0) {
          collector.finalized = true
          return [
            "PASS: Architect output finalized.",
            `  ${collector.goals.length} goals (${collector.removed_goal_ids.length} removed),`,
            `  ${collector.goal_metric_specs.length} goal metrics, ${collector.global_metric_specs.length} global metrics,`,
            `  ${collector.challenge_seeds.length} challenge seeds,`,
            `  ${collector.traceability.length} traceability mappings,`,
            `  ${collector.contracts.length} cross-goal contracts across ${categories.size} categories.`,
          ].join("\n")
        }

        return `ISSUES (${issues.length}):\n${issues.map((i, n) => `${n + 1}. ${i}`).join("\n")}\n\nFix and call finalize_architect again.`
      },
    }),
  }

  return {
    tools,
    /** Reset the collector between retry attempts. */
    reset() {
      collector = emptyCollector()
      if (input.existingGoals?.length) {
        for (const g of input.existingGoals) collector.goals.push({ ...g })
      }
      return collector
    },
    getCollector() {
      return collector
    },
  }
}

// ---------------------------------------------------------------------------
// Shared Zod shapes for metric registration
// ---------------------------------------------------------------------------

function metricCommonFields() {
  return {
    name: z
      .string()
      .min(1)
      .describe(
        "Canonical metric name. Use the spec's mandatory names where applicable (e.g. 'functional_correctness').",
      ),
    description: z
      .string()
      .min(5)
      .describe("One-sentence description of what this metric captures."),
    unit: z.string().min(1).describe("'ratio' | 'count' | 'latency_ms' | ..."),
    direction: z.enum(["higher_better", "lower_better"]),
    target: z.number().describe("Aspirational threshold."),
    floor: z
      .number()
      .describe(
        "Veto threshold for blocking metrics — below this rejects acceptance.",
      ),
    weight: z.number().min(0).describe("Weight in S_k aggregation."),
    gate_class: z.enum(["blocking", "diagnostic", "efficiency"]),
    evaluator_kind: z
      .enum(["shell", "judge", "query", "aggregator"])
      .describe("How the Executor computes raw_value every iteration."),
    evaluator_config: z
      .record(z.string(), z.unknown())
      .default({})
      .describe(
        "Kind-specific config (e.g. {cmd} for shell, {criteria, rubric} for judge).",
      ),
    source_requirement_ids: z
      .array(z.string())
      .default([])
      .describe("REQ-N IDs this metric ties back to; [] for cross-cutting globals."),
  }
}
