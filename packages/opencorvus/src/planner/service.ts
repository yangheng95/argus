import z from "zod"
import { GoalInput } from "@/orchestrator/model"

export const PlanDraft = z.object({
  summary: z.string(),
  prompt: z.string(),
  goals: z.array(
    GoalInput.extend({
      metadata: z
        .object({
          check_selector: z.array(z.string()).optional(),
        })
        .optional(),
    }),
  ),
  metadata: z.object({
    strategy: z.enum(["initial", "replan"]),
    steps: z.array(z.string()),
    failure_summary: z.string().optional(),
    previous_plan_id: z.string().optional(),
  }),
})

export namespace PlannerService {
  export function initial(input: { title: string; request: string; goals?: z.infer<typeof GoalInput>[] }) {
    const goals = normalizeGoals(input.request, input.goals)
    const steps = inferSteps(input.request)
    return {
      summary: summarize(input.request),
      prompt: renderPrompt({
        title: input.title,
        request: input.request,
        goals,
        steps,
      }),
      goals,
      metadata: {
        strategy: "initial" as const,
        steps,
      },
    }
  }

  export function replan(input: {
    title: string
    request: string
    goals: z.infer<typeof GoalInput>[]
    previousPrompt: string
    previousPlanID: string
    failureSummary: string
  }) {
    const goals = normalizeGoals(input.request, input.goals)
    const steps = inferSteps(input.request, input.failureSummary)
    return {
      summary: summarize(`${input.request}\n\nReplan reason: ${input.failureSummary}`),
      prompt: [
        renderPrompt({
          title: input.title,
          request: input.request,
          goals,
          steps,
        }),
        "Previous plan context:",
        input.previousPrompt,
        "Replan guidance:",
        input.failureSummary,
        "Revise the approach, fix the failure, and continue until all blocking goals are satisfied or you are blocked on external input.",
      ].join("\n\n"),
      goals,
      metadata: {
        strategy: "replan" as const,
        steps,
        failure_summary: input.failureSummary,
        previous_plan_id: input.previousPlanID,
      },
    }
  }
}

function normalizeGoals(request: string, goals?: z.infer<typeof GoalInput>[]) {
  if (goals && goals.length > 0) return goals
  return [
    {
      description: summarize(request),
      criteria: "The requested change is implemented and acceptance checks pass.",
      priority: "blocking" as const,
      metadata: {
        check_selector: ["build", "test", "lint", "verify_cmd"],
      },
    },
  ]
}

function inferSteps(request: string, failureSummary?: string) {
  const lines = request
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean)
  const direct = lines
    .filter((item) => item.length > 8)
    .slice(0, 2)
    .map((item) => `Address request detail: ${item}`)
  const steps = [
    "Inspect the repository and identify the files and behaviors affected by the task.",
    ...direct,
    "Implement the required code changes with the smallest coherent edit set.",
    "Run the relevant acceptance checks and confirm the requested outcome.",
  ]
  if (failureSummary) {
    steps.splice(2, 0, `Correct the previously failed acceptance outcome: ${failureSummary}`)
  }
  return [...new Set(steps)]
}

function renderPrompt(input: { title: string; request: string; goals: z.infer<typeof GoalInput>[]; steps: string[] }) {
  return [
    "You are executing a headless coding task inside OpenCorvus.",
    `Task: ${input.title}`,
    "Request:",
    input.request.trim(),
    "Goals:",
    input.goals.map((goal, index) => `${index + 1}. ${goal.description}\nCriteria: ${goal.criteria}`).join("\n\n"),
    "Execution plan:",
    input.steps.map((step, index) => `${index + 1}. ${step}`).join("\n"),
    "Constraints:",
    "- Work autonomously until the task is complete or blocked.",
    "- If you need clarification or approval, use the existing question or permission flow.",
    "- When finished, summarize what changed, what was verified, and any remaining risks.",
  ].join("\n\n")
}

function summarize(input: string) {
  const line = input
    .split("\n")
    .map((item) => item.trim())
    .find(Boolean)
  if (!line) return "Untitled plan"
  if (line.length <= 120) return line
  return line.slice(0, 117) + "..."
}
