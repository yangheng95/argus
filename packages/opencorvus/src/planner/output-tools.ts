import { tool } from "ai"
import z from "zod"

export const PlannerFileAction = z.object({
  path: z.string().min(1).describe("Repository-relative file path the executor should touch"),
  intent: z.string().min(1).describe("What should change in this file and why"),
})

export const PlannerVerificationCommand = z.object({
  command: z.string().min(1).describe("Concrete verification command to run"),
  purpose: z.string().min(1).describe("What this command verifies"),
})

export const PlannerReportSchema = z.object({
  title: z.string().min(1).describe("Short plan title for this goal"),
  brief: z.string().min(1).describe("Ordered, concrete implementation steps for the executor"),
  file_actions: z.array(PlannerFileAction).min(1).describe("Concrete file-level actions the executor should take"),
  verification_commands: z.array(PlannerVerificationCommand).default([]).describe("Concrete verification commands that validate the plan"),
})

export interface RegisteredPlan extends z.infer<typeof PlannerReportSchema> {}

export interface PlannerCollector {
  plan?: RegisteredPlan
  finalized: boolean
  errors: string[]
}

function emptyCollector(): PlannerCollector {
  return {
    finalized: false,
    errors: [],
  }
}

export function plannerReportFromMetadata(metadata: unknown): RegisteredPlan | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  const parsed = PlannerReportSchema.safeParse((metadata as Record<string, unknown>).planner_report)
  return parsed.success ? parsed.data : undefined
}

export function createPlannerOutputTools() {
  let collector = emptyCollector()

  const tools = {
    submit_plan: tool({
      description:
        "Emit the FINAL per-goal implementation plan. Call this exactly once, as the " +
        "last action of the planner session, after exploring the codebase and deciding " +
        "the concrete file-level steps. This is the ONLY supported output path for the " +
        "planner — plain-text tags like <plan_steps> are ignored.\n\n" +
        "Contract:\n" +
        "- title: short plan title for this goal\n" +
        "- brief: ordered implementation steps the downstream executor will follow\n" +
        "- file_actions: concrete file-level actions (at least one)\n" +
        "- verification_commands: commands the executor should run to validate the work\n" +
        "- brief must be non-empty and concrete\n" +
        "- submit_plan may succeed only once; repeated successful submissions are rejected",
      inputSchema: PlannerReportSchema,
      execute: async (input) => {
        if (collector.finalized) {
          const error =
            "Error: submit_plan was already accepted for this planner run. " +
            "The planner must emit exactly one final plan."
          collector.errors.push(error)
          return error
        }

        const next = {
          title: input.title.trim(),
          brief: input.brief.trim(),
          file_actions: input.file_actions.map((item) => ({
            path: item.path.trim(),
            intent: item.intent.trim(),
          })),
          verification_commands: input.verification_commands.map((item) => ({
            command: item.command.trim(),
            purpose: item.purpose.trim(),
          })),
        }

        if (!next.title) {
          const error = "Error: title is empty after trimming. Provide a non-empty plan title."
          collector.errors.push(error)
          return error
        }

        if (!next.brief) {
          const error = "Error: brief is empty after trimming. Provide concrete plan steps."
          collector.errors.push(error)
          return error
        }

        if (next.file_actions.some((item) => !item.path || !item.intent)) {
          const error = "Error: every file_actions entry requires non-empty path and intent values."
          collector.errors.push(error)
          return error
        }

        if (next.verification_commands.some((item) => !item.command || !item.purpose)) {
          const error = "Error: every verification_commands entry requires non-empty command and purpose values."
          collector.errors.push(error)
          return error
        }

        collector.plan = next
        collector.finalized = true
        return `PASS: plan submitted (${next.brief.length} chars)`
      },
    }),
  }

  return {
    tools,
    getCollector() {
      return collector
    },
    reset() {
      collector = emptyCollector()
      return collector
    },
  }
}