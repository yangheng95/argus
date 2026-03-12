import { afterEach, expect, mock, spyOn, test } from "bun:test"
import { EvaluatorService } from "../../src/evaluator/service"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Identifier } from "../../src/id/id"
import { DeliveryService } from "../../src/orchestrator/delivery"
import { OrchestratorGit } from "../../src/orchestrator/git"
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
  "task fails cleanly when evaluator agent analysis fails after automated checks pass",
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
      summary: "Plan: analysis failure",
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
    spyOn(DeliveryService, "deliver").mockResolvedValue({
      status: "delivered",
      summary: "Delivery published.",
      artifacts: [],
      publish: {
        mode: "manual",
        adapters: [],
      },
    })
    spyOn(OrchestratorGit, "complete").mockImplementation(async (task) => ({ task }))
    spyOn(EvaluatorService, "analyzeDelivery").mockRejectedValue(new Error("ProviderModelNotFoundError"))
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
            request: "complete task with evaluator analysis failure",
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
              evaluation?: { verdict: string; summary: string }
            }
          | undefined
        for (let index = 0; index < 40; index++) {
          const progress = await app.request(`/task/${task_id}/progress`, {
            headers: {
              "x-opencorvus-directory": tmp.path,
            },
          })
          expect(progress.status).toBe(200)
          progressBody = await progress.json() as {
            task: { status: string; error?: string }
            evaluation?: { verdict: string; summary: string }
          }
          if (["completed", "failed"].includes(progressBody.task.status)) break
          await Bun.sleep(50)
        }

        expect(progressBody?.task.status).toBe("failed")
        expect(progressBody?.task.error).toContain("Evaluator agent analysis failed")

        const exported = await app.request(`/export/task/${task_id}`, {
          headers: {
            "x-opencorvus-directory": tmp.path,
          },
        })
        expect(exported.status).toBe(200)
        const exportBody = await exported.json() as {
          coordinatorRun?: { id: string; status: string }
          goalRuns?: Array<{ coordinatorRunID: string }>
          deliveries: Array<{ goalRunID?: string }>
          evaluations: Array<{ goalRunID?: string }>
          artifacts: Array<{ label: string; payload?: { analysis_failed?: boolean } }>
        }
        expect(exportBody.coordinatorRun?.status).toBe("failed")
        expect(exportBody.goalRuns?.every((item) => item.coordinatorRunID === exportBody.coordinatorRun?.id)).toBe(true)
        expect(exportBody.deliveries.some((item) => !!item.goalRunID)).toBe(true)
        expect(exportBody.evaluations.some((item) => !!item.goalRunID)).toBe(true)
        expect(exportBody.artifacts.some((item) => item.label === "evaluator-agent-error" && item.payload?.analysis_failed === true)).toBe(true)
      },
    })
  },
  { timeout: 20_000 },
)
