import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EnginePlanNodeTable,
  EnginePlanVersionTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { listQueuedGoalRunsForRun, requireRun, requireTask } from "../../src/engine"
import { createWorkflowState, WorkflowRegistry } from "../../src/engine/workflow"
import { createOrchestratorTools } from "../../src/orchestrator/tools"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
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
      // Phase-6-e: run rows live in engine_artifact (kind="run").
      db.insert(EngineArtifactTable).values({
        id: runID,
        task_id: taskID,
        run_id: runID,
        kind: "run",
        label: "run-running",
        payload: {
          plan_version_id: planID,
          session_id: null,
          executor: "opencode",
          status: "running",
          phase: "execute",
          blocking_reason: null,
          error: null,
          retry_count: 0,
          executor_ref: null,
          metadata: null,
          time_started: now,
          time_completed: null,
        },
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

  test("exec_goal creates or activates a run and queues a single goal", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_exec_${stamp}`
    const taskID = `tsk_exec_${stamp}`
    const goalID = `goal_exec_${stamp}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "Exec goal test" })

        Database.use((db) => {
          db.insert(ProjectTable).values({
            id: projectID,
            worktree: process.cwd(),
            name: "Exec tools test",
            sandboxes: "[]",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: projectID,
            session_id: session.id,
            source: "test",
            title: "Exec goal task",
            request: "Verify exec_goal bootstraps a run and queues the goal",
            status: "active",
            priority: "normal",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineGoalTable).values({
            id: goalID,
            task_id: taskID,
            title: "Exec goal",
            slug: "exec-goal",
            objective: "Verify exec_goal creates a run and durable queued goal_run.",
            acceptance_specs: [],
            owned_paths: ["src/exec-goal.ts"],
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
        })

        const { tools, stopSignal, finalizeDeferredStop } = createOrchestratorTools({
          taskID,
          agentSessionID: "ses_exec_goal_test",
          signal: new AbortController().signal,
        })

        const result = await tools.exec_goal.execute({ goalID }, {} as any)

        const task = requireTask(taskID)
        const { findActiveRunForTask } = await import("../../src/engine/store")
        const runID = findActiveRunForTask(task.id)!.id
        expect(result).toContain(`Goal "Exec goal" (${goalID}) queued for execution via run ${runID}.`)
        expect(runID).toBeTruthy()
        expect(requireRun(runID).status).toBe("running")
        expect(listQueuedGoalRunsForRun(runID).map((goalRun) => goalRun.goal_id)).toEqual([goalID])
        expect(stopSignal.aborted).toBe(false)
        expect(finalizeDeferredStop()).toBe("exec_goal")
        expect(stopSignal.aborted).toBe(true)
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

  test("task-level build switches a pre-execution pipeline task to direct workflow", async () => {
    const now = Date.now()
    const stamp = now.toString(16)
    const projectID = `project_build_${stamp}`
    const taskID = `tsk_build_${stamp}`
    const pipeline = WorkflowRegistry.resolveSync("pipeline")!
    const workflowState = createWorkflowState(pipeline)
    workflowState.taskSteps.design_analysis = { status: "completed", startedAt: now - 4_000, completedAt: now - 3_000 }
    workflowState.taskSteps.requirements = { status: "completed", startedAt: now - 2_000, completedAt: now - 1_000 }
    workflowState.currentStepID = "architect"

    Database.use((db) => {
      db.insert(ProjectTable).values({
        id: projectID,
        worktree: process.cwd(),
        name: "Build workflow switch test",
        sandboxes: "[]",
        time_created: now,
        time_updated: now,
      }).run()
      db.insert(EngineTaskTable).values({
        id: taskID,
        project_id: projectID,
        source: "test",
        title: "Build workflow switch task",
        request: "Verify task-level build switches workflow when pipeline has not decomposed into goals yet",
        status: "active",
        priority: "normal",
        time_created: now,
        time_updated: now,
      }).run()
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const parent = await Session.create({ kind: "root", title: "build workflow test" })
        spyOn(SessionPrompt, "prompt").mockResolvedValue({
          parts: [{ type: "text", text: "Build succeeded." }],
        } as any)

        // Phase-6-f-3-bis-b: workflow_state is no longer persisted. The
        // switch-to-direct happens in-memory on the passed `workflowState`
        // and is reflected via EngineEvent.WorkflowSelected; we assert the
        // mutation on the shared reference rather than on a DB row.
        const { tools } = createOrchestratorTools({
          taskID,
          agentSessionID: parent.id,
          signal: new AbortController().signal,
          workflow: pipeline,
          workflowState,
        })

        const result = await tools.build.execute({
          request: "Implement the page directly.",
          reason: "Pipeline preconditions failed before architect, so direct build is required.",
        }, {} as any)

        expect(result).toContain("Build agent finished")
        expect(workflowState.workflowID).toBe("direct")
        expect(workflowState.taskSteps.build?.status).toBe("completed")
        expect(workflowState.taskSteps.deliver?.status).toBe("pending")
        expect(workflowState.currentStepID).toBe("deliver")
        expect(workflowState.taskSteps.architect).toBeUndefined()
      },
    })
  })
})