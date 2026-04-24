import z from "zod"

const PlannerFileAction = z.object({
  path: z.string().min(1).describe("Repository-relative file path the executor should touch"),
  intent: z.string().min(1).describe("What should change in this file and why"),
})

const PlannerVerificationCommand = z.object({
  command: z.string().min(1).describe("Concrete verification command to run"),
  purpose: z.string().min(1).describe("What this command verifies"),
})

const PlannerReportSchema = z.object({
  title: z.string().min(1).describe("Short plan title for this goal"),
  brief: z.string().min(1).describe("Ordered, concrete implementation steps for the executor"),
  file_actions: z.array(PlannerFileAction).min(1).describe("Concrete file-level actions the executor should take"),
  verification_commands: z.array(PlannerVerificationCommand).default([]).describe("Concrete verification commands that validate the plan"),
})

export interface RegisteredPlan extends z.infer<typeof PlannerReportSchema> {}

/**
 * Reconstruct a RegisteredPlan from plan_node metadata written in a previous
 * planner run. Used by the goal runner and the workbench board to render the
 * historical plan without re-invoking the planner agent.
 */
export function plannerReportFromMetadata(metadata: unknown): RegisteredPlan | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  const parsed = PlannerReportSchema.safeParse((metadata as Record<string, unknown>).planner_report)
  return parsed.success ? parsed.data : undefined
}