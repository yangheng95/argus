import { mkdir } from "fs/promises"
import path from "path"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { CheckRunner } from "../../src/evaluator/service"
import { evaluateGoal, evaluateTask } from "../../src/orchestrator/goal-runner"
import {
  OrchestratorDeliveryTable,
  OrchestratorGoalTable,
  OrchestratorGoalRunTable,
  OrchestratorRunTable,
  OrchestratorSpecSnapshotTable,
  OrchestratorTaskTable,
} from "../../src/orchestrator/orchestrator.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const analysis = {
  verdict: "accepted" as const,
  classification: "unknown" as const,
  summary: "accepted",
  goal_statuses: [
    {
      goal_index: 0,
      status: "passed" as const,
      evidence: "ok",
      reasoning: "ok",
    },
  ],
  replan_guidance: null,
}

describe("orchestrator.goal runner retry fallback", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("evaluateGoal replays previously changed files when a retry delivery is empty", async () => {
    await using tmp = await tmpdir({ git: true })
    let captured:
      | {
          task: Parameters<typeof CheckRunner.evaluate>[0]
          delivery: Parameters<typeof CheckRunner.evaluate>[1]
        }
      | undefined

    await mkdir(path.join(tmp.path, "src"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "retry.ts"), "export const retry = true\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "task",
              request: "task",
              status: "running",
              priority: "normal",
              active_run_id: runID,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              executor: "opencode",
              status: "running",
              phase: "dispatch",
              retry_count: 1,
              metadata: {
                retry_context: {
                  changedFiles: ["src/retry.ts"],
                },
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        spyOn(CheckRunner, "evaluate").mockImplementation(async (task, delivery) => {
          captured = { task, delivery }
          return {
            status: "passed",
            verdict: "accepted",
            summary: "ok",
            checks: [],
            artifacts: [],
          }
        })
        spyOn(CheckRunner, "analyzeDelivery").mockResolvedValue(analysis)

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
        )

        await evaluateGoal({
          task,
          goal: {
            id: "goal_goal_retry",
            task_id: task.id,
            spec_snapshot_id: "spec_goal_retry",
            description: "goal",
            criteria: "criteria",
            priority: "blocking",
            source: "spec",
            status: "pending",
            order_index: 0,
            metadata: {
              check_selector: ["spec_check"],
            },
            time_created: now,
            time_updated: now,
          },
          delivery: {
            summary: "Goal delivery. No file changes were detected.",
            diffs: [],
          },
        })

        expect(captured?.task.metadata?.delivery_changed_files).toEqual(["src/retry.ts"])
        expect(captured?.delivery.changedFiles).toEqual(["src/retry.ts"])
        expect(captured?.delivery.summary).toContain("re-evaluating previously changed files")
        expect(captured?.delivery.diffs?.[0]).toMatchObject({
          file: "src/retry.ts",
          after: "export const retry = true\n",
          status: "modified",
        })
      },
    })
  })

  test("evaluateTask replays previously changed files when a retry delivery is empty", async () => {
    await using tmp = await tmpdir({ git: true })
    let captured:
      | {
          task: Parameters<typeof CheckRunner.evaluate>[0]
          delivery: Parameters<typeof CheckRunner.evaluate>[1]
        }
      | undefined

    await mkdir(path.join(tmp.path, "src"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "task-retry.ts"), "export const taskRetry = true\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "task",
              request: "task",
              status: "running",
              priority: "normal",
              active_run_id: runID,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              executor: "opencode",
              status: "running",
              phase: "dispatch",
              retry_count: 1,
              metadata: {
                retry_context: {
                  changedFiles: ["src/task-retry.ts"],
                },
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        spyOn(CheckRunner, "evaluate").mockImplementation(async (task, delivery) => {
          captured = { task, delivery }
          return {
            status: "passed",
            verdict: "accepted",
            summary: "ok",
            checks: [],
            artifacts: [],
          }
        })
        spyOn(CheckRunner, "analyzeDelivery").mockResolvedValue({
          ...analysis,
          goal_statuses: [],
        })

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
        )

        await evaluateTask({
          task,
          goals: [
            {
              id: "goal_task_retry",
              task_id: task.id,
              spec_snapshot_id: "spec_task_retry",
              description: "goal",
              criteria: "criteria",
              priority: "blocking",
              source: "spec",
              status: "pending",
              order_index: 0,
              metadata: {
                check_selector: ["spec_check"],
              },
              time_created: now,
              time_updated: now,
            },
          ],
          delivery: {
            summary: "Task delivery. No file changes were detected.",
            diffs: [],
          },
        })

        expect(captured?.task.metadata?.delivery_changed_files).toEqual(["src/task-retry.ts"])
        expect(captured?.delivery.changedFiles).toEqual(["src/task-retry.ts"])
        expect(captured?.delivery.summary).toContain("re-evaluating previously changed files")
        expect(captured?.delivery.diffs?.[0]).toMatchObject({
          file: "src/task-retry.ts",
          after: "export const taskRetry = true\n",
          status: "modified",
        })
      },
    })
  })

  test("evaluateTask ignores generated orchestrator docs in delivery diffs", async () => {
    await using tmp = await tmpdir({ git: true })
    let captured:
      | {
          task: Parameters<typeof CheckRunner.evaluate>[0]
          delivery: Parameters<typeof CheckRunner.evaluate>[1]
        }
      | undefined

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "task",
              request: "task",
              status: "running",
              priority: "normal",
              active_run_id: runID,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              executor: "opencode",
              status: "running",
              phase: "dispatch",
              retry_count: 0,
              metadata: {},
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        spyOn(CheckRunner, "evaluate").mockImplementation(async (task, delivery) => {
          captured = { task, delivery }
          return {
            status: "passed",
            verdict: "accepted",
            summary: "ok",
            checks: [],
            artifacts: [],
          }
        })
        spyOn(CheckRunner, "analyzeDelivery").mockResolvedValue({
          ...analysis,
          goal_statuses: [],
        })

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
        )

        await evaluateTask({
          task,
          goals: [
            {
              id: "goal_generated_docs",
              task_id: task.id,
              spec_snapshot_id: "spec_generated_docs",
              description: "goal",
              criteria: "criteria",
              priority: "blocking",
              source: "spec",
              status: "pending",
              order_index: 0,
              metadata: {
                check_selector: ["spec_check"],
              },
              time_created: now,
              time_updated: now,
            },
          ],
          delivery: {
            summary: "Task delivery. Changed files: docs and src.",
            diffs: [
              {
                file: ".opencorvus/evaluations/example.md",
                before: "",
                after: "# generated\n",
                additions: 1,
                deletions: 0,
                status: "added",
              },
              {
                file: ".opencorvus/goals/example.md",
                before: "",
                after: "# generated\n",
                additions: 1,
                deletions: 0,
                status: "added",
              },
              {
                file: "src/note-store.ts",
                before: "",
                after: "export const ok = true\n",
                additions: 1,
                deletions: 0,
                status: "added",
              },
            ],
          },
        })

        expect(captured?.task.metadata?.delivery_changed_files).toEqual(["src/note-store.ts"])
        expect(captured?.delivery.changedFiles).toEqual(["src/note-store.ts"])
        expect(captured?.delivery.diffs).toHaveLength(1)
        expect(captured?.delivery.diffs?.[0]?.file).toBe("src/note-store.ts")
      },
    })
  })

  test("evaluateGoal replays changed files from an earlier goal delivery in the same run", async () => {
    await using tmp = await tmpdir({ git: true })
    let captured:
      | {
          task: Parameters<typeof CheckRunner.evaluate>[0]
          delivery: Parameters<typeof CheckRunner.evaluate>[1]
        }
      | undefined

    await mkdir(path.join(tmp.path, "src"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "same-run.ts"), "export const sameRun = true\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const specID = Identifier.ascending("spec")
        const goalID = Identifier.ascending("goal")
        const goalRunID = Identifier.ascending("goal_run")
        const deliveryID = Identifier.ascending("delivery")
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "task",
              request: "task",
              status: "running",
              priority: "normal",
              active_run_id: runID,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "spec",
              content: "spec",
              scope: "",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              spec_snapshot_id: specID,
              description: "goal",
              criteria: "criteria",
              priority: "blocking",
              source: "spec",
              status: "passed",
              order_index: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              executor: "opencode",
              status: "running",
              phase: "dispatch",
              retry_count: 0,
              metadata: {},
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorGoalRunTable)
            .values({
              id: goalRunID,
              task_id: taskID,
              coordinator_run_id: runID,
              goal_id: goalID,
              executor: "opencode",
              status: "completed",
              metadata: {},
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorDeliveryTable)
            .values({
              id: deliveryID,
              task_id: taskID,
              run_id: runID,
              goal_run_id: goalRunID,
              status: "candidate",
              summary: "previous goal delivery",
              result: {
                summary: "previous goal delivery",
                changed_files: ["src/same-run.ts"],
                diffs: [],
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        spyOn(CheckRunner, "evaluate").mockImplementation(async (task, delivery) => {
          captured = { task, delivery }
          return {
            status: "passed",
            verdict: "accepted",
            summary: "ok",
            checks: [],
            artifacts: [],
          }
        })
        spyOn(CheckRunner, "analyzeDelivery").mockResolvedValue(analysis)

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
        )

        await evaluateGoal({
          task,
          goal: {
            id: "goal_current_same_run",
            task_id: task.id,
            spec_snapshot_id: "spec_same_run",
            description: "goal",
            criteria: "criteria",
            priority: "blocking",
            source: "spec",
            status: "pending",
            order_index: 0,
            metadata: {
              check_selector: ["spec_check"],
            },
            time_created: now,
            time_updated: now,
          },
          delivery: {
            summary: "Goal delivery. No file changes were detected.",
            diffs: [],
          },
        })

        expect(captured?.task.metadata?.delivery_changed_files).toEqual(["src/same-run.ts"])
        expect(captured?.delivery.changedFiles).toEqual(["src/same-run.ts"])
        expect(captured?.delivery.summary).toContain("re-evaluating previously changed files")
      },
    })
  })

  test("evaluateTask replays changed files from a previous replan-chain delivery without retry_context", async () => {
    await using tmp = await tmpdir({ git: true })
    let captured:
      | {
          task: Parameters<typeof CheckRunner.evaluate>[0]
          delivery: Parameters<typeof CheckRunner.evaluate>[1]
        }
      | undefined

    await mkdir(path.join(tmp.path, "src"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "replan-chain.ts"), "export const replanChain = true\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const previousRunID = Identifier.ascending("run")
        const runID = Identifier.ascending("run")
        const previousDeliveryID = Identifier.ascending("delivery")
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "task",
              request: "task",
              status: "running",
              priority: "normal",
              active_run_id: runID,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: previousRunID,
              task_id: taskID,
              executor: "opencode",
              status: "failed",
              phase: "dispatch",
              retry_count: 1,
              metadata: {},
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorDeliveryTable)
            .values({
              id: previousDeliveryID,
              task_id: taskID,
              run_id: previousRunID,
              status: "candidate",
              summary: "previous run delivery",
              result: {
                summary: "previous run delivery",
                changed_files: ["src/replan-chain.ts"],
                diffs: [],
              },
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              executor: "opencode",
              status: "running",
              phase: "replan",
              retry_count: 0,
              metadata: {
                previous_run_id: previousRunID,
                strategy: "replan",
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        spyOn(CheckRunner, "evaluate").mockImplementation(async (task, delivery) => {
          captured = { task, delivery }
          return {
            status: "passed",
            verdict: "accepted",
            summary: "ok",
            checks: [],
            artifacts: [],
          }
        })
        spyOn(CheckRunner, "analyzeDelivery").mockResolvedValue({
          ...analysis,
          goal_statuses: [],
        })

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
        )

        await evaluateTask({
          task,
          goals: [
            {
              id: "goal_replan_chain",
              task_id: task.id,
              spec_snapshot_id: "spec_replan_chain",
              description: "goal",
              criteria: "criteria",
              priority: "blocking",
              source: "spec",
              status: "pending",
              order_index: 0,
              metadata: {
                check_selector: ["spec_check"],
              },
              time_created: now,
              time_updated: now,
            },
          ],
          delivery: {
            summary: "Task delivery. No file changes were detected.",
            diffs: [],
          },
        })

        expect(captured?.task.metadata?.delivery_changed_files).toEqual(["src/replan-chain.ts"])
        expect(captured?.delivery.changedFiles).toEqual(["src/replan-chain.ts"])
        expect(captured?.delivery.summary).toContain("re-evaluating previously changed files")
      },
    })
  })

  test("evaluateTask merges current delivery files with historical changed files from the same run", async () => {
    await using tmp = await tmpdir({ git: true })
    let captured:
      | {
          task: Parameters<typeof CheckRunner.evaluate>[0]
          delivery: Parameters<typeof CheckRunner.evaluate>[1]
        }
      | undefined

    await mkdir(path.join(tmp.path, "src"), { recursive: true })
    await Bun.write(path.join(tmp.path, "src", "note-store.ts"), "export const noteStore = true\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const runID = Identifier.ascending("run")
        const specID = Identifier.ascending("spec")
        const goalID = Identifier.ascending("goal")
        const goalRunID = Identifier.ascending("goal_run")
        const deliveryID = Identifier.ascending("delivery")
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              title: "task",
              request: "task",
              status: "running",
              priority: "normal",
              active_run_id: runID,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorSpecSnapshotTable)
            .values({
              id: specID,
              task_id: taskID,
              version: 1,
              status: "ready",
              summary: "spec",
              content: "spec",
              scope: "",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              spec_snapshot_id: specID,
              description: "goal",
              criteria: "criteria",
              priority: "blocking",
              source: "spec",
              status: "passed",
              order_index: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: runID,
              task_id: taskID,
              executor: "opencode",
              status: "running",
              phase: "dispatch",
              retry_count: 0,
              metadata: {},
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorGoalRunTable)
            .values({
              id: goalRunID,
              task_id: taskID,
              coordinator_run_id: runID,
              goal_id: goalID,
              executor: "opencode",
              status: "completed",
              metadata: {},
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorDeliveryTable)
            .values({
              id: deliveryID,
              task_id: taskID,
              run_id: runID,
              goal_run_id: goalRunID,
              status: "candidate",
              summary: "previous goal delivery",
              result: {
                summary: "previous goal delivery",
                changed_files: ["src/note-store.ts"],
                diffs: [],
              },
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        spyOn(CheckRunner, "evaluate").mockImplementation(async (task, delivery) => {
          captured = { task, delivery }
          return {
            status: "passed",
            verdict: "accepted",
            summary: "ok",
            checks: [],
            artifacts: [],
          }
        })
        spyOn(CheckRunner, "analyzeDelivery").mockResolvedValue({
          ...analysis,
          goal_statuses: [],
        })

        const task = Database.use((db) =>
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, taskID)).get()!,
        )

        await evaluateTask({
          task,
          goals: [
            {
              id: "goal_partial_delivery",
              task_id: task.id,
              spec_snapshot_id: "spec_partial_delivery",
              description: "goal",
              criteria: "criteria",
              priority: "blocking",
              source: "spec",
              status: "pending",
              order_index: 0,
              metadata: {
                check_selector: ["spec_check"],
              },
              time_created: now,
              time_updated: now,
            },
          ],
          delivery: {
            summary: "Task delivery. Changed files: package.json.",
            diffs: [
              {
                file: "package.json",
                before: "{\"name\":\"demo\"}\n",
                after: "{\"name\":\"demo\",\"scripts\":{\"test\":\"bun test\"}}\n",
                additions: 1,
                deletions: 1,
                status: "modified",
              },
            ],
          },
        })

        expect(captured?.task.metadata?.delivery_changed_files).toEqual(["package.json", "src/note-store.ts"])
        expect(captured?.delivery.changedFiles).toEqual(["package.json", "src/note-store.ts"])
        expect(captured?.delivery.diffs?.map((item) => item.file)).toEqual(["package.json", "src/note-store.ts"])
        expect(captured?.delivery.summary).toContain("cumulative changed files")
      },
    })
  })
})
