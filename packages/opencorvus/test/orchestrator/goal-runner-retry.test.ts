import { mkdir } from "fs/promises"
import path from "path"
import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { CheckRunner } from "../../src/evaluator/service"
import { evaluateGoal, evaluateTask } from "../../src/orchestrator/goal-runner"
import { OrchestratorRunTable, OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
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
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: "task_goal_retry",
              project_id: Instance.project.id,
              title: "task",
              request: "task",
              status: "running",
              priority: "normal",
              active_run_id: "run_goal_retry",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: "run_goal_retry",
              task_id: "task_goal_retry",
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
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, "task_goal_retry")).get()!,
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
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: "task_task_retry",
              project_id: Instance.project.id,
              title: "task",
              request: "task",
              status: "running",
              priority: "normal",
              active_run_id: "run_task_retry",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: "run_task_retry",
              task_id: "task_task_retry",
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
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, "task_task_retry")).get()!,
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
        Database.transaction((db) => {
          db.insert(OrchestratorTaskTable)
            .values({
              id: "task_generated_docs",
              project_id: Instance.project.id,
              title: "task",
              request: "task",
              status: "running",
              priority: "normal",
              active_run_id: "run_generated_docs",
              time_created: now,
              time_updated: now,
            })
            .run()
          db.insert(OrchestratorRunTable)
            .values({
              id: "run_generated_docs",
              task_id: "task_generated_docs",
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
          db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, "task_generated_docs")).get()!,
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
})
