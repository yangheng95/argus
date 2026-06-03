/**
 * Canonical Zod schema for GoalContractFields.
 *
 * Single source of truth for goal-contract constraints. Two callers agree
 * on these rules:
 *   1. architect/output-tools.ts register_goal — Architect registers a goal
 *      during decomposition (the authoritative producer)
 *   2. orchestrator/tools.ts modify_goal        — Orchestrator refines a
 *      single goal after evaluation feedback (point-fix; a structural
 *      rewrite goes through a re-run of `architect` instead)
 *
 * The TypeScript `GoalContractFields` interface in pipeline/types.ts
 * intentionally stays looser (e.g. `kind: string`) so existing call sites
 * that pass through runtime values from the database don't break.
 * Validation happens at the input boundaries (tool inputs) where
 * strictness is meaningful.
 */
import { z } from "zod"
import { AcceptanceSpecSchema } from "@/acceptance/types"

export const GOAL_KINDS = ["bootstrap", "feature", "verification", "integration", "system"] as const

export const GOAL_PRIORITIES = ["blocking", "advisory"] as const

/**
 * Core fields, consumed by `register_goal` (Architect registers goals during
 * decomposition). `modify_goal` uses a partial version (`GoalContractUpdateSchema`)
 * further down.
 */
export const GoalContractFieldsSchema = z.object({
  id: z.string().min(1).describe("Unique goal ID, e.g. goal_bootstrap, goal_api, goal_ui"),
  title: z.string().min(1).describe("Short human-readable goal title"),
  objective: z
    .string()
    .min(50)
    .describe(
      "Execution directive for THIS goal. Write ONLY: " +
        "(a) what this goal implements, (b) constraints specific to this goal, " +
        "(c) edge cases the executor must handle. " +
        "Do NOT restate the user's request — the executor has the full user " +
        "task-scoped runtime intent bundle and can reference it. " +
        "Do NOT describe interface signatures or type definitions here — put " +
        "those in the Architect Contract Graph. " +
        "Do NOT paraphrase what other goals do — dependents read graph contracts, " +
        "not your objective.",
    ),
  acceptance_specs: z
    .array(AcceptanceSpecSchema)
    .min(1)
    .describe(
      "Typed acceptance specs. At least one spec is required — a goal " +
        "without acceptance criteria cannot be evaluated.",
    ),
  owned_paths: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Primary responsibility paths for this goal. These guide collaboration and review; " +
        "they are not a file sandbox. Must be discovered via tool exploration — do not guess. " +
        "For frontend-design-skeleton source baselines, write acceptance-root paths such as src/**, public/**, index.html, package.json, and vite.config.ts; do not use frontend-design-skeleton/** as an implementation target.",
    ),
  depends_on: z.array(z.string()).default([]).describe("Goal IDs this depends on (execution order)"),
  priority: z.enum(GOAL_PRIORITIES).default("blocking"),
  kind: z.enum(GOAL_KINDS).default("feature"),
  requirement_ids: z.array(z.string()).default([]).describe("REQ-N references this goal covers"),
})

/**
 * Strict TypeScript type derived from the schema. Use at runtime input
 * boundaries; the looser `GoalContractFields` interface in pipeline/types.ts
 * stays the canonical type for downstream consumers.
 */
export type GoalContractFieldsParsed = z.infer<typeof GoalContractFieldsSchema>

export function normalizeGoalContractFields(input: z.input<typeof GoalContractFieldsSchema>): GoalContractFieldsParsed {
  const withDefaults = { ...input }
  if (withDefaults.depends_on === undefined) withDefaults.depends_on = []
  if (withDefaults.priority === undefined) withDefaults.priority = "blocking"
  if (withDefaults.kind === undefined) withDefaults.kind = "feature"
  if (withDefaults.requirement_ids === undefined) withDefaults.requirement_ids = []
  return GoalContractFieldsSchema.parse(withDefaults)
}

/**
 * Schema for `modify_goal.updates` — every field optional, id excluded
 * (never re-keyed), and constraints still enforced on whichever fields are
 * supplied. Use `.parse()` to reject invalid updates.
 */
export const GoalContractUpdateSchema = z.object({
  title: z.string().min(1).describe("Short human-readable goal title").optional(),
  objective: z
    .string()
    .min(50)
    .describe("Execution directive for this goal. Same constraints as register_goal.objective.")
    .optional(),
  acceptance_specs: z
    .array(AcceptanceSpecSchema)
    .min(1)
    .describe("Typed acceptance specs. Replaces the prior acceptance spec list when present.")
    .optional(),
  owned_paths: z
    .array(z.string().min(1))
    .min(1)
    .describe("Primary responsibility paths for this goal. Replaces the prior path list when present. For source baselines, use acceptance-root paths, not frontend-design-skeleton/**.")
    .optional(),
  depends_on: z
    .array(z.string())
    .describe("Goal IDs this depends on. Replaces the prior dependency list when present.")
    .optional(),
  priority: z.enum(GOAL_PRIORITIES).describe("Goal priority.").optional(),
  kind: z.enum(GOAL_KINDS).describe("Goal kind.").optional(),
  requirement_ids: z
    .array(z.string())
    .describe("REQ-N references this goal covers. Replaces the prior requirement list when present.")
    .optional(),
})

export type GoalContractUpdate = z.infer<typeof GoalContractUpdateSchema>

export function normalizeGoalContractUpdate(input: z.input<typeof GoalContractUpdateSchema>): GoalContractUpdate {
  const parsed = GoalContractUpdateSchema.parse(input)
  return Object.fromEntries(Object.entries(parsed).filter(([, value]) => value !== undefined)) as GoalContractUpdate
}
