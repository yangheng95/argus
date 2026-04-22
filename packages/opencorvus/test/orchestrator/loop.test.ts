import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { EngineGoalRunTable, EngineGoalTable, EngineRunTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { hooks, updateTask } from "../../src/engine/state"
import { requireTask } from "../../src/engine/store"
import { Orchestrator } from "../../src/orchestrator/agent"
import { interruptTaskLoop, runTaskLoop } from "../../src/orchestrator/loop"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("orchestrator loop", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("operator_message interrupts wait on active goal runs and re-enters decision promptly", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "Loop interrupt test" })
        const now = Date.now()
        const taskID = `tsk_loop_interrupt_${now}`
        const runID = `run_loop_interrupt_${now}`
        const goalID = `goal_loop_interrupt_${now}`
        const goalRunID = `goalrun_loop_interrupt_${now}`
        const seen: string[] = []

        Database.use((db) => {
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            source: "test",
            title: "Loop interrupt task",
            request: "Verify operator messages interrupt loop waits",
            status: "active",
            priority: "normal",
            active_run_id: runID,
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineRunTable).values({
            id: runID,
            task_id: taskID,
            session_id: session.id,
            executor: "opencode",
            status: "running",
            phase: "dispatch",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineGoalTable).values({
            id: goalID,
            task_id: taskID,
            title: "Loop interrupt goal",
            slug: "loop-interrupt-goal",
            objective: "Keep one goal running so the loop enters its wait path.",
            acceptance_specs: [],
            owned_paths: ["src/loop-interrupt.ts"],
            depends_on: [],
            exports: [],
            imports: [],
            kind: "feature",
            requirement_ids: [],
            priority: "blocking",
            source: "spec",
            status: "running",
            order_index: 0,
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineGoalRunTable).values({
            id: goalRunID,
            task_id: taskID,
            goal_id: goalID,
            coordinator_run_id: runID,
            executor: "opencode",
            status: "running",
            time_started: now - 1_000,
            time_created: now - 1_000,
            time_updated: now - 1_000,
          }).run()
        })

        spyOn(Orchestrator, "processTask").mockImplementation(async (id, trigger: any) => {
          seen.push(trigger.kind)
          if (trigger.kind === "operator_message") {
            await updateTask(
              requireTask(id),
              { status: "failed", error: "operator message handled" },
              "operator_message handled in loop interrupt test",
            )
          }
        })

        const first = runTaskLoop({
          taskID,
          trigger: { kind: "batch_complete", runID, summary: { passed: 0, failed: 0, total: 1 } },
          hooks: hooks(),
        })

        await new Promise((resolve) => setTimeout(resolve, 50))

        const startedAt = Date.now()
        interruptTaskLoop(taskID, "operator message")
        await runTaskLoop({
          taskID,
          trigger: { kind: "operator_message", message: "重新评估并继续。" } as any,
          hooks: hooks(),
        })
        const elapsedMs = Date.now() - startedAt

        await first

        expect(seen).toEqual(["batch_complete", "operator_message"])
        expect(elapsedMs).toBeLessThan(1_000)
      },
    })
  })

  test("operator_message can re-enter a failed task through the loop shell", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "Terminal operator message test" })
        const now = Date.now()
        const taskID = `tsk_terminal_operator_${now}`
        const seen: string[] = []

        Database.use((db) => {
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: session.id,
            source: "test",
            title: "Terminal operator message task",
            request: "Allow operator message to re-enter terminal tasks",
            status: "failed",
            priority: "normal",
            error: "initial failure",
            time_created: now,
            time_updated: now,
          }).run()
        })

        spyOn(Orchestrator, "processTask").mockImplementation(async (_id, trigger: any) => {
          seen.push(trigger.kind)
        })

        await runTaskLoop({
          taskID,
          trigger: { kind: "operator_message", message: "重新评估失败原因并继续。" },
          hooks: hooks(),
        })

        expect(seen).toEqual(["operator_message"])
      },
    })
  })
})