import { afterEach, expect, mock, spyOn, test } from "bun:test"
import type { GoalJudgmentType } from "../../src/evaluator/agent"
import { buildSpecReplanInput } from "../../src/orchestrator/spec-goal-service"
import * as Store from "../../src/orchestrator/store"
import * as Preference from "../../src/workbench/preference"

afterEach(() => {
  mock.restore()
})

test("buildSpecReplanInput keeps only unresolved goals during replan", () => {
  spyOn(Preference, "taskNotes").mockReturnValue([])
  spyOn(Store, "listGoalsBySpec").mockReturnValue([
    {
      description: "Bootstrap the project",
      criteria: "The app builds and runs",
      priority: "blocking",
      metadata: undefined,
    },
    {
      description: "Implement diary CRUD",
      criteria: "Create, edit, search, and delete diary entries",
      priority: "blocking",
      metadata: undefined,
    },
    {
      description: "Ship the reminder flow",
      criteria: "Reminder scheduling and cancellation work end to end",
      priority: "blocking",
      metadata: undefined,
    },
  ] as ReturnType<typeof Store.listGoalsBySpec>)

  const analysis = {
    verdict: "rejected",
    classification: "strategy",
    summary: "Only the foundation goal passed.",
    goal_statuses: [
      {
        goal_index: 0,
        status: "passed",
        evidence: "Build and startup checks passed.",
        reasoning: "Foundation is complete.",
      },
      {
        goal_index: 1,
        status: "failed",
        evidence: "Diary service contract is incomplete.",
        reasoning: "CRUD is still broken.",
      },
      {
        goal_index: 2,
        status: "failed",
        evidence: "Reminder exports are missing.",
        reasoning: "Reminder flow is incomplete.",
      },
    ],
    replan_guidance: {
      root_cause: "The previous run spread effort across too many goals.",
      what_failed: "Diary and reminder features remained incomplete.",
      suggested_strategy: "Focus the replan on unresolved goals only.",
      avoid_approaches: ["Do not rebuild the already passing foundation."],
    },
  } as GoalJudgmentType

  const rewrite = buildSpecReplanInput(
    {
      id: "tsk_replan",
      request: "Build the diary app.",
    } as Parameters<typeof buildSpecReplanInput>[0],
    "spc_replan",
    analysis,
  )

  expect(rewrite.goals.map((goal) => goal.description)).toEqual([
    "Implement diary CRUD",
    "Ship the reminder flow",
  ])
  expect(rewrite.request).toContain("Goals already satisfied in previous runs")
  expect(rewrite.request).toContain("Bootstrap the project")
  expect(rewrite.request).toContain("Focus this rewrite on the remaining unresolved goals")
  expect(rewrite.request).not.toContain("- Bootstrap the project\n- Implement diary CRUD\n- Ship the reminder flow")
})
