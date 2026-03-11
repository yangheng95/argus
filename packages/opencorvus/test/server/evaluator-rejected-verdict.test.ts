import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { EvaluatorService } from "../../src/evaluator/service"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Identifier } from "../../src/id/id"
import { PlannerService } from "../../src/planner/service"
import { Instance } from "../../src/project/instance"
import { Server } from "../../src/server/server"
import { SpecService } from "../../src/spec/service"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  ExecutorRegistry.reset()
  await resetDatabase()
})

function mockSpec() {
  spyOn(SpecService, "initial").mockImplementation(async (input) => ({
    summary: `Spec: ${input.title}`,
    content: `# Scope\n\n${input.request}`,
    goals: (input.goals ?? [{
      description: input.request,
      criteria: "Task completed successfully",
      priority: "blocking" as const,
    }]).map((goal) => ({
      description: goal.description,
      criteria: goal.criteria,
      priority: goal.priority ?? ("blocking" as const),
      metadata: { check_selector: ["verify_cmd"] },
    })),
    assumptions: [],
    risks: [],
    clarifications: [],
    spec_items: [{
      title: input.title,
      description: input.request,
      priority: "blocking" as const,
      check_selector: ["spec_check"],
    }],
    evidence_sources: [],
    unresolved_questions: [],
  }))
}

test(
  "task fails when evaluator analysis rejects a blocking goal after automated checks pass",
  async () => {
    await using tmp = await tmpdir({ git: true })
    mockSpec()
    spyOn(EvaluatorService, "evaluate").mockResolvedValue({
      status: "passed",
      verdict: "accepted",
      summary: "Automated checks passed.",
      checks: [
        {
          name: "verify_cmd",
          status: "passed",
          evidence: "ok",
        },
        {
          name: "spec_check",
          status: "passed",
          evidence: "ok",
        },
      ],
      artifacts: [],
    })
    spyOn(PlannerService, "initial").mockResolvedValue({
      summary: "Plan: rejected analysis",
      prompt: "Execute the task and pass the checks.",
      goals: [{
        description: "Task completed successfully",
        criteria: "Automated checks pass.",
        priority: "blocking",
        metadata: {
          check_selector: ["verify_cmd"],
        },
      }],
      metadata: {
        strategy: "initial",
        steps: ["Execute the task"],
        planner: {
          role: "headless_compiler",
          quality: "compiled",
          source: "planner_agent",
          clarification_source: "none",
        },
      },
    })
    spyOn(EvaluatorService, "analyzeDelivery").mockResolvedValue({
      verdict: "rejected",
      classification: "evaluation",
      summary: "Evaluator analysis rejected the blocking goal.",
      goal_statuses: [{
        goal_index: 0,
        status: "failed",
        evidence: "Automated checks passed but the implementation did not satisfy the contract.",
        reasoning: "Goal verification found a contract mismatch.",
      }],
      replan_guidance: {
        root_cause: "Goal verification found a contract mismatch",
        what_failed: "Final evaluator analysis",
        suggested_strategy: "Tighten the implementation or the evaluation evidence and retry.",
        avoid_approaches: [],
      },
    })
    spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const app = Server.App()
        const created = await app.request("/task", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-opencorvus-directory": tmp.path,
          },
          body: JSON.stringify({
            project: Instance.project.id,
            request: "complete task with rejected evaluator analysis",
            checks: {
              verify_cmd: [`"${process.execPath}" -e "process.exit(0)"`],
            },
          }),
        })
        expect(created.status).toBe(202)
        const { task_id } = (await created.json()) as { task_id: string }

        let progressBody:
          | {
              task: { status: string; error?: string }
            }
          | undefined
        for (const _ of Array.from({ length: 40 })) {
          const progress = await app.request(`/task/${task_id}/progress`, {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })
          expect(progress.status).toBe(200)
          progressBody = await progress.json() as {
            task: { status: string; error?: string }
          }
          if (["completed", "failed"].includes(progressBody.task.status)) break
          await Bun.sleep(50)
        }

        expect(progressBody?.task.status).toBe("failed")
        expect(progressBody?.task.error).toContain("rejected the blocking goal")

        const exported = await app.request(`/export/task/${task_id}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(exported.status).toBe(200)
        const exportBody = await exported.json() as {
          coordinatorRun?: { status: string }
        }
        expect(exportBody.coordinatorRun?.status).toBe("failed")
      },
    })
  },
  { timeout: 20_000 },
)
