import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { type ExecutorAdapter } from "../../src/executor/compat"
import { ExecutorRegistry } from "../../src/executor/registry"
import { OpencodeExecutor } from "../../src/executor/opencode"
import { Identifier } from "../../src/id/id"
import {
  OrchestratorEvaluationTable,
  OrchestratorPlanVersionTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { OrchestratorService } from "../../src/orchestrator/service"
import { Instance } from "../../src/project/instance"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("orchestrator.service", () => {
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await resetDatabase()
  })

  test("retries same plan after first evaluation failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.task.status).toBe("running")
        expect(progress.run?.status).toBe("accepted")
        expect(progress.run?.retryCount).toBe(1)
        expect(progress.run?.planVersionID).toBe(progress.plan?.id)

        const runs = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).all(),
        )
        const evaluations = Database.use((db) =>
          db.select().from(OrchestratorEvaluationTable).where(eq(OrchestratorEvaluationTable.task_id, taskID)).all(),
        )
        expect(runs.length).toBe(2)
        expect(evaluations.length).toBe(1)
        expect(evaluations[0]?.status).toBe("failed")
        expect(runs.some((item) => item.status === "completed")).toBe(true)
        expect(runs.some((item) => item.status === "accepted" && item.retry_count === 1)).toBe(true)
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("replans after second evaluation failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        await OrchestratorService.getProgress(taskID)
        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.task.status).toBe("running")
        expect(progress.run?.status).toBe("accepted")
        expect(progress.run?.phase).toBe("replan")
        expect(progress.plan?.version).toBe(2)

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        const plans = Database.use((db) =>
          db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.task_id, taskID)).all(),
        )
        const evaluations = Database.use((db) =>
          db.select().from(OrchestratorEvaluationTable).where(eq(OrchestratorEvaluationTable.task_id, taskID)).all(),
        )
        expect(task?.active_plan_version_id).toBe(progress.plan?.id)
        expect(plans.length).toBe(2)
        expect(evaluations.length).toBe(2)
        expect(evaluations.every((item) => item.status === "failed")).toBe(true)
        expect(plans.some((item) => item.status === "superseded")).toBe(true)
      },
    })

    expect(submit).toHaveBeenCalledTimes(3)
  })

  test("marks task failed when retry and replan budgets are exhausted", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          budget: {
            maxRuns: 1,
          },
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.task.status).toBe("failed")
        expect(progress.run?.status).toBe("completed")
        expect(progress.evaluation?.status).toBe("failed")
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("records operator note and queues a follow-up run when task is not actively running", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
      sessionID,
      queueTaskID: Identifier.ascending("task"),
    }))
    let calls = 0
    spyOn(OpencodeExecutor, "status").mockImplementation(async () => {
      calls += 1
      if (calls === 1) {
        return {
          queueTaskID: Identifier.ascending("task"),
          status: "completed",
          error: null,
        }
      }
      return {
        queueTaskID: Identifier.ascending("task"),
        status: "queued",
        error: null,
      }
    })
    spyOn(OpencodeExecutor, "delivery").mockResolvedValue({
      summary: "executor finished",
      diffs: [],
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          budget: {
            maxRuns: 1,
          },
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const failed = await OrchestratorService.getProgress(taskID)
        expect(failed.task.status).toBe("failed")

        const note = await OrchestratorService.recordOperatorNote(taskID, "Please also update the copy.")
        expect(note.resumed).toBe(true)

        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.task.status).toBe("running")
        expect(progress.run?.status).toBe("accepted")
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("retryTask queues a deterministic retry run without task-message NLP", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          budget: {
            maxRuns: 1,
          },
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const failed = await OrchestratorService.getProgress(taskID)
        expect(failed.task.status).toBe("failed")

        const run = await OrchestratorService.retryTask(taskID)
        expect(run.status).toBe("accepted")
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("replanTask queues a new plan version without task-message NLP", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          budget: {
            maxRuns: 1,
          },
          checks: {
            verify_cmd: [`"${process.execPath}" -e "process.exit(1)"`],
          },
        })

        const failed = await OrchestratorService.getProgress(taskID)
        expect(failed.task.status).toBe("failed")
        expect(failed.plan?.version).toBe(1)

        const run = await OrchestratorService.replanTask(taskID)
        expect(run.status).toBe("accepted")
        expect(run.phase).toBe("replan")

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get(),
        )
        const plans = Database.use((db) =>
          db.select().from(OrchestratorPlanVersionTable).where(eq(OrchestratorPlanVersionTable.task_id, taskID)).all(),
        )
        expect(task?.active_plan_version_id).toBe(run.planVersionID)
        expect(plans.length).toBe(2)
        expect(plans.some((item) => item.status === "superseded")).toBe(true)
      },
    })

    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("only marks goals passed when evaluation checks match goal selectors", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          checks: {
            build: [`"${process.execPath}" -e "process.exit(0)"`],
          },
          goals: [
            {
              description: "Build passes",
              criteria: "Build command passes.",
              priority: "blocking",
              metadata: {
                check_selector: ["build"],
              },
            } as any,
            {
              description: "Tests pass",
              criteria: "Test command passes.",
              priority: "blocking",
              metadata: {
                check_selector: ["test"],
              },
            } as any,
          ],
        })

        const progress = await OrchestratorService.getProgress(taskID)
        const goals = progress.goals
        // With goal-gating: evaluation passed but "Tests pass" goal still pending
        // so task should retry instead of completing
        expect(progress.task.status).toBe("running")
        expect(goals.find((item) => item.description === "Build passes")?.status).toBe("passed")
        expect(goals.find((item) => item.description === "Tests pass")?.status).toBe("pending")
      },
    })

    // Initial run + retry because pending blocking goals remain
    expect(submit).toHaveBeenCalledTimes(2)
  })

  test("completes task when evaluation passes and all blocking goals are satisfied", async () => {
    await using tmp = await tmpdir({ git: true })
    const submit = spyOn(OpencodeExecutor, "submit").mockImplementation(async ({ sessionID }) => ({
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
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          checks: {
            build: [`"${process.execPath}" -e "process.exit(0)"`],
          },
          goals: [
            {
              description: "Build passes",
              criteria: "Build command passes.",
              priority: "blocking",
              metadata: {
                check_selector: ["build"],
              },
            } as any,
            {
              description: "Nice to have",
              criteria: "Advisory goal.",
              priority: "advisory",
              metadata: {
                check_selector: ["test"],
              },
            } as any,
          ],
        })

        const progress = await OrchestratorService.getProgress(taskID)
        // All blocking goals passed (only "Build passes" is blocking), so task completes
        expect(progress.task.status).toBe("completed")
        expect(progress.goals.find((item) => item.description === "Build passes")?.status).toBe("passed")
        // Advisory goal stays pending but doesn't block completion
        expect(progress.goals.find((item) => item.description === "Nice to have")?.status).toBe("pending")
      },
    })

    expect(submit).toHaveBeenCalledTimes(1)
  })

  test("dispatches with the configured executor when registered", async () => {
    await using tmp = await tmpdir({ git: true })
    const calls: Array<{ sessionID: string; prompt: string; priority?: "high" | "normal" | "low" }> = []
    const codex: ExecutorAdapter = {
      capabilities() {
        return {
          submit: true,
          status: true,
          abort: true,
          delivery: true,
          resume: true,
          events: true,
        }
      },
      async submit(input: { sessionID: string; prompt: string; priority?: "high" | "normal" | "low" }) {
        calls.push(input)
        return {
          sessionID: input.sessionID,
          queueTaskID: Identifier.ascending("task"),
        }
      },
      async status(queueTaskID: string) {
        return {
          queueTaskID,
          status: "queued",
          error: null,
        }
      },
      async abort() {
        return true
      },
      async delivery() {
        return {
          summary: "done",
          diffs: [],
        }
      },
      async resume(input: { sessionID: string; message: string; priority?: "high" | "normal" | "low" }) {
        return this.submit({
          sessionID: input.sessionID,
          prompt: input.message,
          priority: input.priority,
        })
      },
      async *events() {},
    }
    ExecutorRegistry.register("codex", codex)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const taskID = await OrchestratorService.createTask({
          request: "update the landing page hero section copy",
          executor: "codex",
        })

        const progress = await OrchestratorService.getProgress(taskID)
        expect(progress.run?.executor).toBe("codex")
        expect(progress.run?.status).toBe("accepted")

        const run = Database.use((db) =>
          db.select().from(OrchestratorRunTable).where(eq(OrchestratorRunTable.task_id, taskID)).get(),
        )
        expect(run?.executor).toBe("codex")
        expect(run?.executor_ref?.queue_task_id).toBeTruthy()
      },
    })

    expect(calls).toHaveLength(1)
    expect(calls[0]?.prompt).toContain("update the landing page hero section copy")
  })
})
