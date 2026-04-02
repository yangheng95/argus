/**
 * Shared goal-related type definitions.
 *
 * Migrated from goal/service.ts so that persist and other modules can use
 * these types without depending on the legacy Goal Agent implementation.
 */
import z from "zod"
import { GoalKind, GoalQaProfile } from "@/orchestrator/model"

// ---------------------------------------------------------------------------
// Zod schemas
// ---------------------------------------------------------------------------

export const GoalQaProfileDraft = z.object({
  rule_selectors: z.array(z.string()),
  goal_check_prompt: z.string().optional(),
  spec_scope: z.literal("mapped_requirements"),
})

export const GoalContractDraft = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  objective: z.string().min(1),
  requirement_ids: z.array(z.string().min(1)),
  depends_on_goal_ids: z.array(z.string().min(1)),
  owned_paths: z.array(z.string().min(1)),
  done_definition: z.string().min(1),
  exports: z.array(z.string()).default([]),
  imports: z.array(z.string()).default([]),
  qa_profile: GoalQaProfileDraft,
  priority: z.enum(["blocking", "advisory"]),
  kind: GoalKind,
  source: z.enum(["spec", "system"]).default("spec"),
})

export const GoalDraftSchema = z.object({
  summary: z.string().min(1),
  goals: z.array(GoalContractDraft).min(1),
})

export type GoalDraft = z.infer<typeof GoalDraftSchema>
export type GoalContractDraftType = GoalDraft["goals"][number]

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class GoalFailureError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = "GoalFailureError"
  }
}

// ---------------------------------------------------------------------------
// Conversion utilities
// ---------------------------------------------------------------------------

/**
 * Convert GoalDraft goals to a flat input array.
 * This is the bridge between the GoalDraft format and the old GoalInput
 * format that persist.ts / planner still expect.
 */
export function goalInputsFromDraft(goalDraft: GoalDraft) {
  return goalDraft.goals.map((goal) => ({
    description: goal.title,
    criteria: `Objective: ${goal.objective}\nDone definition: ${goal.done_definition}`,
    priority: goal.priority,
    source: "spec" as const,
    title: goal.title,
    objective: goal.objective,
    requirement_ids: goal.requirement_ids,
    depends_on_goal_ids: goal.depends_on_goal_ids,
    owned_paths: goal.owned_paths,
    done_definition: goal.done_definition,
    qa_profile: GoalQaProfile.parse({
      rule_selectors: goal.qa_profile.rule_selectors,
      goal_check_prompt: goal.qa_profile.goal_check_prompt,
      spec_scope: "mapped_requirements",
    }),
    kind: goal.kind,
    metadata: {
      title: goal.title,
      objective: goal.objective,
      requirement_ids: goal.requirement_ids,
      depends_on_goal_ids: goal.depends_on_goal_ids,
      owned_paths: goal.owned_paths,
      done_definition: goal.done_definition,
      qa_profile: {
        rule_selectors: goal.qa_profile.rule_selectors,
        goal_check_prompt: goal.qa_profile.goal_check_prompt,
        spec_scope: "mapped_requirements",
      },
      kind: goal.kind,
    },
  }))
}
