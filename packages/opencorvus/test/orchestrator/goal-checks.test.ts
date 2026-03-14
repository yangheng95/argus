import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EvaluatorService } from "../../src/evaluator/service"
import { CheckConfig } from "../../src/orchestrator/model"
import { blockingEvaluationFailure, evaluateGoal, goalEvaluationOutcome } from "../../src/orchestrator/goal-runner"
import { resetDatabase } from "../fixture/db"

const analysis = {
  verdict: "accepted" as const,
  classification: "unknown" as const,
  summary: "Goal accepted.",
  goal_statuses: [
    {
      goal_index: 0,
      status: "passed" as const,
      evidence: "checks passed",
      reasoning: "checks passed",
    },
  ],
  replan_guidance: null,
}

describe("orchestrator.goal checks", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("scopes goal evaluation checks to the selected goal families", async () => {
    let checks: unknown
    spyOn(EvaluatorService, "evaluate").mockImplementation(async (task) => {
      checks = task.metadata?.checks
      return {
        status: "passed",
        verdict: "accepted",
        summary: "ok",
        checks: [],
        artifacts: [],
      }
    })
    spyOn(EvaluatorService, "analyzeDelivery").mockResolvedValue(analysis)

    await evaluateGoal({
      task: {
        id: "task_goal_checks",
        title: "goal checks",
        request: "goal checks",
        metadata: {
          checks: {
            verify_cmd: ["bun run verify"],
            startup: {
              command: "bun run dev",
              ready_text: "ready",
              mode: "soft",
            },
            ui_review: {
              target: "web",
              url: "https://example.com",
              mode: "soft",
            },
            code_review: {
              enabled: true,
              max_diffs: 2,
              mode: "soft",
            },
            named: {
              typecheck: {
                label: "Type Check",
                family: "lint",
                commands: ["bun run typecheck"],
              },
              smoke: {
                label: "Smoke",
                family: "verify_cmd",
                commands: ["bun run smoke"],
              },
            },
            timeout_ms: 1234,
            custom: {
              sample: {
                enabled: true,
              },
            },
          },
        },
      } as any,
      goal: {
        description: "run startup and verify",
        criteria: "startup and verify pass",
        priority: "blocking",
        metadata: {
          check_selector: ["startup", "verify_cmd"],
        },
      } as any,
      delivery: {
        summary: "delivery",
        diffs: [],
      },
    })

    expect(CheckConfig.safeParse(checks).success).toBe(true)
    expect(checks).toMatchObject({
      build: false,
      test: false,
      lint: false,
      verify_cmd: ["bun run verify"],
      startup: {
        command: "bun run dev",
        ready_text: "ready",
        mode: "soft",
      },
      named: {
        smoke: {
          family: "verify_cmd",
          commands: ["bun run smoke"],
          enabled: true,
        },
      },
      timeout_ms: 1234,
      custom: {
        sample: {
          enabled: true,
        },
      },
      spec_check: {
        enabled: false,
        mode: "strict",
      },
    })
    expect((checks as Record<string, unknown>).ui_review).toBeUndefined()
    expect((checks as Record<string, unknown>).code_review).toBeUndefined()
    expect(((checks as Record<string, unknown>).named as Record<string, unknown>).typecheck).toBeUndefined()
  })

  test("creates a valid minimal ui review config for ui review goals", async () => {
    let checks: unknown
    spyOn(EvaluatorService, "evaluate").mockImplementation(async (task) => {
      checks = task.metadata?.checks
      return {
        status: "passed",
        verdict: "accepted",
        summary: "ok",
        checks: [],
        artifacts: [],
      }
    })
    spyOn(EvaluatorService, "analyzeDelivery").mockResolvedValue(analysis)

    await evaluateGoal({
      task: {
        id: "task_goal_ui_review",
        title: "goal ui review",
        request: "goal ui review",
        metadata: {
          checks: {
            verify_cmd: ["bun run verify"],
          },
        },
      } as any,
      goal: {
        description: "review ui",
        criteria: "ui review passes",
        priority: "blocking",
        metadata: {
          check_selector: ["ui_review"],
        },
      } as any,
      delivery: {
        summary: "delivery",
        diffs: [],
      },
    })

    expect(CheckConfig.safeParse(checks).success).toBe(true)
    expect(checks).toMatchObject({
      build: false,
      test: false,
      lint: false,
      verify_cmd: false,
      ui_review: {
        target: "web",
        mode: "strict",
      },
      spec_check: {
        enabled: false,
        mode: "strict",
      },
    })
  })

  test("allows accepted analysis to override review infrastructure failures", () => {
    const result = {
      status: "failed",
      verdict: "rejected",
      summary: "Failed: code_review (failed). Passed: test.",
      checks: [
        { name: "test", status: "passed", evidence: "5 pass" },
        { name: "code_review", status: "failed", evidence: "Review model call failed after retries." },
      ],
      artifacts: [],
    } as const

    expect(blockingEvaluationFailure(result as any)).toBe(false)
    expect(goalEvaluationOutcome(result as any, analysis)).toEqual({
      verdict: "accepted",
      status: "passed",
      summary: "Goal accepted.",
    })
  })
})
