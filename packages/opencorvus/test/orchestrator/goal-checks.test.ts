import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { CheckRunner } from "../../src/evaluator/service"
import { CheckConfig } from "../../src/orchestrator/model"
import { blockingEvaluationFailure, evaluateGoal, goalEvaluationOutcome } from "../../src/orchestrator/goal-runner"
import { Instance } from "../../src/project/instance"
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

function withinInstance<T>(fn: () => Promise<T>) {
  return Instance.provide({
    directory: process.cwd(),
    fn,
  })
}

describe("orchestrator.goal checks", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("scopes goal evaluation checks to executor-runnable selectors and named commands", async () => {
    let checks: unknown
    spyOn(CheckRunner, "evaluate").mockImplementation(async (task) => {
      checks = task.metadata?.checks
      return {
        status: "passed",
        verdict: "accepted",
        summary: "ok",
        checks: [],
        artifacts: [],
      }
    })
    spyOn(CheckRunner, "analyzeDelivery").mockResolvedValue(analysis)

    await withinInstance(() =>
      evaluateGoal({
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
            check_selector: ["startup", "smoke", "ui_review", "code_review"],
          },
        } as any,
        delivery: {
          summary: "delivery",
          diffs: [],
        },
      }),
    )

    expect(CheckConfig.safeParse(checks).success).toBe(true)
    expect(checks).toMatchObject({
      build: false,
      test: false,
      lint: false,
      verify_cmd: false,
      named: {
        smoke: {
          label: "Smoke",
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
    expect((checks as Record<string, unknown>).startup).toBeUndefined()
    expect((checks as Record<string, unknown>).ui_review).toBeUndefined()
    expect((checks as Record<string, unknown>).code_review).toBeUndefined()
    expect(((checks as Record<string, unknown>).named as Record<string, unknown>).typecheck).toBeUndefined()
  })

  test("defers evaluator-managed goal selectors to the judge instead of local goal checks", async () => {
    let checks: unknown
    spyOn(CheckRunner, "evaluate").mockImplementation(async (task) => {
      checks = task.metadata?.checks
      return {
        status: "passed",
        verdict: "accepted",
        summary: "ok",
        checks: [],
        artifacts: [],
      }
    })
    spyOn(CheckRunner, "analyzeDelivery").mockResolvedValue(analysis)

    await withinInstance(() =>
      evaluateGoal({
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
          criteria: "ui review and startup checks pass",
          priority: "blocking",
          metadata: {
            check_selector: ["ui_review", "startup"],
          },
        } as any,
        delivery: {
          summary: "delivery",
          diffs: [],
        },
      }),
    )

    expect(CheckConfig.safeParse(checks).success).toBe(true)
    expect(checks).toMatchObject({
      build: false,
      test: false,
      lint: false,
      verify_cmd: false,
      spec_check: {
        enabled: false,
        mode: "strict",
      },
    })
    expect((checks as Record<string, unknown>).ui_review).toBeUndefined()
    expect((checks as Record<string, unknown>).startup).toBeUndefined()
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
