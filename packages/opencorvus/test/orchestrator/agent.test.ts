import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineGoalRunTable, EngineGoalTable, EngineRunTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { EngineService } from "../../src/task-api"
import { Orchestrator } from "../../src/orchestrator/agent"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"

describe("orchestrator dispatch gate", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("emits task.waiting when dispatch is suppressed by active goal runs", async () => {
    const now = Date.now()
    const projectID = `project_gate_${now}`
    const taskID = `tsk_gate_${now}`
    const runID = `run_gate_${now}`
    const goalID = `goal_gate_${now}`
    const goalRunID = `goalrun_gate_${now}`

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        vcs: "git",
        name: "Dispatch gate test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Gate task",
        request: "Verify gate waiting event",
        status: "queued",
        priority: "normal",
        active_run_id: runID,
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineRunTable).values({
        id: runID,
        task_id: taskID,
        executor: "opencode",
        status: "running",
        phase: "execute",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineGoalTable).values({
        id: goalID,
        task_id: taskID,
        title: "Blocked build goal",
        objective: "Implement enough concrete code so the dispatch gate test can observe an active goal run without invoking the orchestrator runtime.",
        acceptance_specs: [],
        owned_paths: ["src/gate.ts"],
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
        time_started: now - 2_000,
        time_created: now - 2_000,
        time_updated: now - 2_000,
      }).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await Orchestrator.processTask(taskID, { kind: "retry" })
      },
    })

    const events = await EngineService.listProtocolEvents(taskID)
    const waiting = events.find((event) => event.type === "task.waiting")
    expect(waiting).toBeTruthy()
    expect(waiting?.payload).toMatchObject({
      taskID,
      runID,
      reason: "dispatch_gate_suppressed",
    })
    const payload = waiting?.payload as { waitingOn?: Array<{ goalRunID: string; goalID?: string; goalTitle: string; sinceMs: number }> } | undefined
    expect(payload?.waitingOn).toHaveLength(1)
    expect(payload?.waitingOn?.[0]).toMatchObject({
      goalRunID,
      goalID,
      goalTitle: "Blocked build goal",
    })
    expect(payload?.waitingOn?.[0]?.sinceMs).toBeGreaterThanOrEqual(2_000)
  })
})
