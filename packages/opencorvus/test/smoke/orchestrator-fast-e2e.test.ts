import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import path from "path"
import { CheckRunner } from "../../src/evaluator/service"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import { DeliveryService } from "../../src/orchestrator/delivery"
import {
  OrchestratorEvaluationTable,
  OrchestratorPlanVersionTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorService } from "../../src/orchestrator/service"
import { PlannerService } from "../../src/planner/service"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { SpecService } from "../../src/spec/service"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  await resetDatabase().catch(() => undefined)
})

function stubSpec() {
  const build = (input: any) => ({
    summary: `Spec for: ${input.title}`,
    content: `# Scope\n\n${input.request}`,
    scope: input.request,
    goals: Array.isArray(input.goals) && input.goals.length > 0
      ? input.goals
      : [{
          description: "Implement the requested change",
          criteria: "The requested change is implemented and checks pass.",
          priority: "blocking",
          metadata: {
            check_selector: ["build", "test"],
          },
        }],
    assumptions: [],
    risks: [],
    spec_items: [{
      title: "Implement the requested change",
      description: "The requested change is implemented and checks pass.",
      priority: "blocking",
      check_selector: ["build", "test"],
    }],
    evidence_sources: [],
    unresolved_questions: [],
  })
  const initial = spyOn(SpecService, "initial").mockImplementation(async (input: any) => build(input))
  const rewrite = spyOn(SpecService, "rewrite").mockImplementation(async (input: any) => build(input))
  return { initial, rewrite }
}

function stubPlanner() {
  stubSpec()
  const plan = (summary: string, prompt: string, strategy: "initial" | "replan") => ({
    summary,
    prompt,
    goals: [{
      description: "Implement the requested change",
      criteria: "The requested change is implemented and checks pass.",
      priority: "blocking",
      metadata: {
        check_selector: ["build", "test"],
      },
    }],
    metadata: {
      strategy,
      steps: ["Implement", "Verify"],
      planner: {
        role: "headless_compiler",
        quality: "compiled",
        source: "planner_agent",
        clarification_source: "none",
      },
    },
  } as any)
  const initial = spyOn(PlannerService, "initial").mockResolvedValue(
    plan("Compiled plan", "Execute the compiled plan", "initial"),
  )
  const replan = spyOn(PlannerService, "replan").mockResolvedValue(
    plan("Compiled replan", "Execute the replanned approach", "replan"),
  )
  return { initial, replan }
}

function stubEvaluation() {
  spyOn(CheckRunner, "evaluate").mockImplementation(async (_task, delivery) => {
    if (!delivery.changedFiles?.length) {
      return {
        status: "failed",
        verdict: "rejected",
        summary: "No file changes were detected.",
        checks: [],
        artifacts: [],
      } as Awaited<ReturnType<typeof CheckRunner.evaluate>>
    }
    return {
      status: "passed",
      verdict: "accepted",
      summary: "Checks passed.",
      checks: [
        { name: "build", status: "passed", evidence: "build ok" },
        { name: "test", status: "passed", evidence: "test ok" },
      ],
      artifacts: [],
    } as Awaited<ReturnType<typeof CheckRunner.evaluate>>
  })

  spyOn(CheckRunner, "analyzeDelivery").mockImplementation(async (input) => {
    if (input.delivery.changedFiles.length === 0) {
      return {
        verdict: "rejected",
        classification: "evaluation",
        summary: "No files were changed.",
        goal_statuses: input.goals.map((goal, goal_index) => ({
          goal_index,
          status: "failed" as const,
          evidence: "No files were changed.",
          reasoning: `Goal '${goal.description}' has no corresponding file changes.`,
        })),
        replan_guidance: {
          root_cause: "Executor returned zero file changes.",
          what_failed: "The requested files were not created or updated.",
          suggested_strategy: "Create the required files before running checks.",
          avoid_approaches: ["Do not finish the run without writing files."],
        },
      }
    }
    return {
      verdict: "accepted",
      classification: "evaluation",
      summary: "Delivery accepted.",
      goal_statuses: input.goals.map((_, goal_index) => ({
        goal_index,
        status: "passed" as const,
        evidence: "Files were changed and checks passed.",
        reasoning: "Goal criteria are satisfied by the changed files.",
      })),
      replan_guidance: null,
    }
  })

  spyOn(DeliveryService, "deliver").mockResolvedValue({
    status: "delivered",
    summary: "Delivery finalized.",
    artifacts: [],
    publish: {
      mode: "manual",
      adapters: [{ id: "delivery", status: "delivered", summary: "Delivery finalized." }],
    },
  })
}

async function waitForTask(taskID: string, limit = 120) {
  let progress = await OrchestratorService.getProgress(taskID)
  for (const _ of Array.from({ length: limit })) {
    if (["completed", "failed", "cancelled"].includes(progress.task.status)) return progress
    await Bun.sleep(50)
    progress = await OrchestratorService.getProgress(taskID)
  }
  return progress
}

describe("fast orchestrator e2e smoke", () => {
  test("completes the full orchestrator pipeline in seconds", async () => {
    await using tmp = await tmpdir({ git: true })
    stubPlanner()
    stubEvaluation()

    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => {
      const session = await Session.get(sessionID)
      await Bun.write(path.join(session.directory, "src", "done.ts"), "export const done = true\n")
      return {
        sessionID,
        queueTaskID: Identifier.ascending("task"),
      }
    })
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "implement a small change in src/done.ts",
        })

        const progress = await waitForTask(taskID)
        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        const evaluation = Database.use((db) =>
          db.select().from(OrchestratorEvaluationTable).where(eq(OrchestratorEvaluationTable.task_id, taskID)).all(),
        )

        expect(progress.task.status).toBe("completed")
        expect(progress.evaluation?.verdict).toBe("accepted")
        expect(progress.delivery?.result?.changedFiles.length).toBeGreaterThan(0)
        expect(task?.status).toBe("completed")
        expect(evaluation.some((item) => item.status === "passed")).toBe(true)
        expect(await Bun.file(path.join(tmp.path, "src", "done.ts")).exists()).toBe(true)
      },
    })

    expect(submit.mock.calls.length).toBeGreaterThanOrEqual(1)
  }, 15_000)

  test("replans immediately after zero-delivery and succeeds on the next run", async () => {
    await using tmp = await tmpdir({ git: true })
    const { replan } = stubPlanner()
    stubEvaluation()

    let attempts = 0
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => {
      attempts += 1
      const session = await Session.get(sessionID)
      if (attempts >= 2) {
        await Bun.write(path.join(session.directory, "src", "after-replan.ts"), "export const fixed = true\n")
      }
      return {
        sessionID,
        queueTaskID: Identifier.ascending("task"),
      }
    })
    spyOn(OpencodeExecutor, "status").mockResolvedValue({
      queueTaskID: Identifier.ascending("task"),
      status: "completed",
      error: null,
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "create src/after-replan.ts and make checks pass",
          budget: {
            maxRuns: 3,
            maxReplans: 1,
          },
        })

        const progress = await waitForTask(taskID, 180)
        const plans = Database.use((db) =>
          db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.task_id, taskID)).all(),
        )

        expect(progress.task.status).toBe("completed")
        expect(progress.plan?.version).toBe(2)
        expect(plans).toHaveLength(2)
        expect(replan).toHaveBeenCalledTimes(1)
        expect(attempts).toBeGreaterThanOrEqual(2)
        expect(await Bun.file(path.join(tmp.path, "src", "after-replan.ts")).exists()).toBe(true)
      },
    })

    expect(submit.mock.calls.length).toBeGreaterThanOrEqual(2)
  }, 15_000)
})
