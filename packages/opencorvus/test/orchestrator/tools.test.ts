import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineGoalTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineRunTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { listQueuedGoalRunsForRun, requireRun, requireTask } from "../../src/engine"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("orchestrator deferred stop", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("dispatch_goal defers stop abort until the current step is finalized", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_tools_${stamp}`
    const taskID = `tsk_tools_${stamp}`
    const planID = `plan_tools_${stamp}`
    const runID = `run_tools_${stamp}`
    const goalID = `goal_tools_${stamp}`
    const nodeID = `node_tools_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Tools test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Deferred stop task",
        request: "Verify dispatch stop timing",
        status: "active",
        priority: "normal",
        active_run_id: runID,
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EnginePlanVersionTable).values({
        id: planID,
        task_id: taskID,
        version: 1,
        status: "active",
        summary: "Test plan",
        prompt: "Test prompt",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineRunTable).values({
        id: runID,
        task_id: taskID,
        plan_version_id: planID,
        executor: "opencode",
        status: "running",
        phase: "execute",
        retry_count: 0,
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineGoalTable).values({
        id: goalID,
        task_id: taskID,
        plan_version_id: planID,
        title: "Dispatch goal",
        slug: "dispatch-goal",
        objective: "Verify dispatch_goal creates a durable queued goal_run.",
        acceptance_specs: [],
        owned_paths: ["src/tools.ts"],
        depends_on: [],
        exports: [],
        imports: [],
        kind: "feature",
        requirement_ids: [],
        priority: "blocking",
        source: "spec",
        status: "pending",
        order_index: 0,
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EnginePlanNodeTable).values({
        id: nodeID,
        task_id: taskID,
        plan_version_id: planID,
        kind: "goal",
        goal_id: goalID,
        title: "Dispatch goal",
        brief: "Verify queued goal_run creation",
        order_index: 0,
        time_created: now,
        time_updated: now,
      }).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { tools, stopSignal, finalizeDeferredStop } = createOrchestratorTools({
          taskID,
          agentSessionID: "ses_tools_test",
          signal: new AbortController().signal,
        })

        expect(stopSignal.aborted).toBe(false)

        const result = await tools.dispatch_goal.execute({ goalIDs: [goalID] }, {} as any)

        expect(result).toContain(`Dispatched 1 goal(s): ${goalID}.`)
        expect(listQueuedGoalRunsForRun(runID).map((goalRun) => goalRun.goal_id)).toEqual([goalID])
        expect(stopSignal.aborted).toBe(false)
        expect(finalizeDeferredStop()).toBe("dispatch_goal")
        expect(stopSignal.aborted).toBe(true)
        expect(finalizeDeferredStop()).toBeUndefined()
      },
    })
  })

  test("submit_execution defers stop abort until the current step is finalized", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_submit_${stamp}`
    const taskID = `tsk_submit_${stamp}`
    const planID = `plan_submit_${stamp}`
    const runID = `run_submit_${stamp}`

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Submit tools test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Deferred submit stop task",
        request: "Verify submit stop timing",
        status: "queued",
        priority: "normal",
        active_run_id: runID,
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EnginePlanVersionTable).values({
        id: planID,
        task_id: taskID,
        version: 1,
        status: "active",
        summary: "Submit test plan",
        prompt: "Submit test prompt",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineRunTable).values({
        id: runID,
        task_id: taskID,
        plan_version_id: planID,
        executor: "opencode",
        status: "queued",
        phase: "execute",
        retry_count: 0,
        time_created: now,
        time_updated: now,
      }).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const { tools, stopSignal, finalizeDeferredStop } = createOrchestratorTools({
          taskID,
          agentSessionID: "ses_submit_tools_test",
          signal: new AbortController().signal,
        })

        expect(stopSignal.aborted).toBe(false)

        const result = await tools.submit_execution.execute({ runID }, {} as any)

        expect(result).toContain(`Run ${runID} activated but no pending goals to dispatch. STOP HERE.`)
        expect(stopSignal.aborted).toBe(false)
        expect(requireTask(taskID).status).toBe("active")
        expect(requireRun(runID).status).toBe("running")
        expect(finalizeDeferredStop()).toBe("submit_execution")
        expect(stopSignal.aborted).toBe(true)
        expect(finalizeDeferredStop()).toBeUndefined()
      },
    })
  })
})