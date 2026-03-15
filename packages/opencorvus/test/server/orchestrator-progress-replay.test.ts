import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { CheckRunner } from "../../src/evaluator/service"
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
  "GET /task/:id/progress replays a completed run after executor queue state disappears",
  async () => {
    await using tmp = await tmpdir({ git: true })
    mockSpec()
    spyOn(CheckRunner, "evaluate").mockResolvedValue({
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
    spyOn(CheckRunner, "analyzeDelivery").mockImplementation(async (input) => {
      const allPassed = input.checkResults.every((c) => c.status === "passed")
      return {
        verdict: allPassed ? "accepted" : "rejected",
        classification: "evaluation",
        summary: allPassed ? "All checks passed" : "Some checks failed",
        goal_statuses: input.goals.map((_, i) => ({
          goal_index: i,
          status: allPassed ? ("passed" as const) : ("failed" as const),
          evidence: allPassed ? "Checks passed" : "Checks failed",
          reasoning: allPassed ? "All checks passed" : "Some checks failed",
        })),
        replan_guidance: allPassed ? null : {
          root_cause: "Checks failed",
          what_failed: "Automated verification",
          suggested_strategy: "Fix the failing checks",
          avoid_approaches: [],
        },
      }
    })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    spyOn(PlannerService, "initial").mockResolvedValue({
      summary: "stub plan",
      prompt: "Execute the task and verify the checks.",
      goals: [{
        description: "Ship the requested task",
        criteria: "The task is completed and checks pass.",
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
    const status = spyOn(OpencodeExecutor, "status").mockResolvedValue({
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
            request: "ship a completed task",
            checks: {
              verify_cmd: [`"${process.execPath}" -e "process.exit(0)"`],
            },
          }),
        })
        expect(created.status).toBe(202)
        const { task_id } = (await created.json()) as { task_id: string }

        let progressBody: { task: { status: string } } | undefined
        for (let index = 0; index < 30; index++) {
          const progress = await app.request(`/task/${task_id}/progress`, {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })
          expect(progress.status).toBe(200)
          progressBody = await progress.json() as { task: { status: string } }
          if (progressBody.task.status === "completed") break
          await Bun.sleep(50)
        }

        expect(progressBody?.task.status).toBe("completed")
        const calls = status.mock.calls.length
        status.mockRejectedValue(new Error("executor task not found"))

        const replay = await app.request(`/task/${task_id}/progress`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(replay.status).toBe(200)
        const replayBody = await replay.json() as { task: { status: string } }
        expect(replayBody.task.status).toBe("completed")
        expect(status.mock.calls.length).toBe(calls)
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  },
  { timeout: 20_000 },
)
