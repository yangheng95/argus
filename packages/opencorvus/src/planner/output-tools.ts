import z from "zod"

export const PlannerFileAction = z.object({
  path: z.string().min(1).describe("Repository-relative file path the executor should touch"),
  intent: z.string().min(1).describe("What should change in this file and why"),
})

export const PlannerVerificationCommand = z.object({
  command: z.string().min(1).describe("Concrete verification command to run"),
  purpose: z.string().min(1).describe("What this command verifies"),
})

/**
 * Terminal schema delivered via SessionLoop's StructuredOutput. Phase 3-b-4
 * migration (specs/new-arch/16-unified-teardown.md §7-3): the private
 * submit_plan tool has been retired — StructuredOutput now carries the full
 * plan payload as a single terminal call.
 */
export const PlannerReportSchema = z.object({
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

/**
 * Normalise a StructuredOutput payload into the trimmed PlanSteps shape the
 * caller expects. Throws when the payload is absent or when post-trim fields
 * are empty — the caller's error is "the LLM did not deliver a valid plan",
 * which is a hard failure.
 */
export function plannerReportFromStructured(structured: unknown): RegisteredPlan {
  if (!structured || typeof structured !== "object") {
    throw new Error("planner: StructuredOutput missing or not an object")
  }
  const parsed = PlannerReportSchema.safeParse(structured)
  if (!parsed.success) {
    throw new Error(`planner: StructuredOutput schema mismatch: ${parsed.error.message}`)
  }
  const next = {
    title: parsed.data.title.trim(),
    brief: parsed.data.brief.trim(),
    file_actions: parsed.data.file_actions.map((item) => ({
      path: item.path.trim(),
      intent: item.intent.trim(),
    })),
    verification_commands: parsed.data.verification_commands.map((item) => ({
      command: item.command.trim(),
      purpose: item.purpose.trim(),
    })),
  }
  if (!next.title) throw new Error("planner: title is empty after trimming")
  if (!next.brief) throw new Error("planner: brief is empty after trimming")
  if (next.file_actions.some((item) => !item.path || !item.intent)) {
    throw new Error("planner: every file_actions entry requires non-empty path and intent")
  }
  if (next.verification_commands.some((item) => !item.command || !item.purpose)) {
    throw new Error("planner: every verification_commands entry requires non-empty command and purpose")
  }
  return next
}