import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineGoalRunTable, EngineGoalTable, EnginePlanNodeTable, EnginePlanVersionTable, EngineRunTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { listQueuedGoalRunsForRun } from "../../src/engine"
import { EngineService } from "../../src/task-api"
import { Orchestrator } from "../../src/orchestrator/agent"
import { AgentRuntime } from "../../src/agent/runtime/runtime"
import * as AgentModel from "../../src/agent/model"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"

describe("orchestrator decision entry", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir()
  })

  afterEach(async () => {
    mock.restore()
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("retry trigger still reaches the runtime when active goal runs exist", async () => {
    const now = Date.now()
    const projectID = `project_gate_${now}`
    const taskID = `tsk_gate_${now}`
    const runID = `run_gate_${now}`
    const goalID = `goal_gate_${now}`
    const goalRunID = `goalrun_gate_${now}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "Retry session" })
        const resolveModel = spyOn(AgentModel, "resolveAgentModel").mockResolvedValue({
          id: "test/mock",
          providerID: "test",
          modelID: "mock",
        } as any)
        const runtime = spyOn(AgentRuntime, "run").mockResolvedValue({
          text: "",
          steps: [],
          finishReason: "stop",
          toolCallCount: 0,
          failures: { count: 0, items: [] },
        })

        Database.use((db) => {
          db.insert(ProjectTable).values({
            id: projectID,
            worktree: process.cwd(),
            name: "Decision entry test",
            sandboxes: "[]",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: projectID,
            session_id: session.id,
            source: "test",
            title: "Decision task",
            request: "Verify retry trigger still reaches runtime with active goal runs",
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
            phase: "execute",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineGoalTable).values({
            id: goalID,
            task_id: taskID,
            title: "Still running goal",
            slug: "still-running-goal",
            objective: "Keep one active goal run so this test proves processTask itself no longer suppresses retry.",
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

        await Orchestrator.processTask(taskID, { kind: "retry" })

        expect(resolveModel).toHaveBeenCalled()
        expect(runtime).toHaveBeenCalledTimes(1)

        const events = await EngineService.listProtocolEvents(taskID)
        expect(events.find((event) => event.type === "task.waiting")).toBeUndefined()
      },
    })
  })

  test("operator_message reaches the runtime while goals are active", async () => {
    const now = Date.now()
    const projectID = `project_operator_${now}`
    const taskID = `tsk_operator_${now}`
    const runID = `run_operator_${now}`
    const goalID = `goal_operator_${now}`
    const goalRunID = `goalrun_operator_${now}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "Operator session" })
        const resolveModel = spyOn(AgentModel, "resolveAgentModel").mockResolvedValue({
          id: "test/mock",
          providerID: "test",
          modelID: "mock",
        } as any)
        const runtime = spyOn(AgentRuntime, "run").mockResolvedValue({
          text: "",
          steps: [],
          finishReason: "stop",
          toolCallCount: 0,
          failures: { count: 0, items: [] },
        })

        Database.use((db) => {
          db.insert(ProjectTable).values({
            id: projectID,
            worktree: process.cwd(),
            name: "Operator gate bypass test",
            sandboxes: "[]",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: projectID,
            session_id: session.id,
            source: "test",
            title: "Operator gate task",
            request: "Verify operator message bypasses dispatch gate",
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
            phase: "execute",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineGoalTable).values({
            id: goalID,
            task_id: taskID,
            title: "Still running goal",
            slug: "still-running-goal",
            objective: "Keep one active goal run so normal triggers would be gated.",
            acceptance_specs: [],
            owned_paths: ["src/operator.ts"],
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

        await Orchestrator.processTask(taskID, {
          kind: "operator_message",
          message: "先停一下，重新判断当前策略。",
        })

        expect(resolveModel).toHaveBeenCalled()
        expect(runtime).toHaveBeenCalledTimes(1)
        const input = runtime.mock.calls[0]?.[0] as {
          messages: Array<{ role: string; content: string | Array<{ type: string; text?: string }> }>
        }
        const content = input.messages[0]?.content
        const text = typeof content === "string"
          ? content
          : Array.isArray(content)
            ? content.map((item) => item.text ?? "").join("\n")
            : ""
        expect(text).toContain("先停一下，重新判断当前策略。")

        const events = await EngineService.listProtocolEvents(taskID)
        expect(events.find((event) => event.type === "task.waiting")).toBeUndefined()
      },
    })
  })

  test("operator_message can drive cancel_task through orchestrator tools", async () => {
    const now = Date.now()
    const projectID = `project_operator_cancel_${now}`
    const taskID = `tsk_operator_cancel_${now}`
    const runID = `run_operator_cancel_${now}`
    const goalID = `goal_operator_cancel_${now}`
    const goalRunID = `goalrun_operator_cancel_${now}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "Operator cancel session" })
        spyOn(AgentModel, "resolveAgentModel").mockResolvedValue({
          id: "test/mock",
          providerID: "test",
          modelID: "mock",
        } as any)
        const runtime = spyOn(AgentRuntime, "run").mockImplementation(async (input: any) => {
          await input.tools.cancel_task.execute({ reason: "user explicitly asked to stop" }, {} as any)
          return {
            text: "",
            steps: [{ toolCalls: [{ toolName: "cancel_task" }] }],
            finishReason: "tool-calls",
            toolCallCount: 1,
            failures: { count: 0, items: [] },
          }
        })

        Database.use((db) => {
          db.insert(ProjectTable).values({
            id: projectID,
            worktree: process.cwd(),
            name: "Operator cancel test",
            sandboxes: "[]",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: projectID,
            session_id: session.id,
            source: "test",
            title: "Operator cancel task",
            request: "Verify operator message can cancel",
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
            phase: "execute",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineGoalTable).values({
            id: goalID,
            task_id: taskID,
            title: "Cancelable goal",
            slug: "cancelable-goal",
            objective: "Provide live execution state for cancel_task.",
            acceptance_specs: [],
            owned_paths: ["src/cancel.ts"],
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

        await Orchestrator.processTask(taskID, {
          kind: "operator_message",
          message: "停掉当前任务。",
        })

        expect(runtime).toHaveBeenCalledTimes(1)
        const task = await EngineService.getTask(taskID)
        expect(task.status).toBe("cancelled")
      },
    })
  })

  test("retry trigger defers dispatch stop until step finish", async () => {
    const now = Date.now()
    const projectID = `project_dispatch_stop_${now}`
    const taskID = `tsk_dispatch_stop_${now}`
    const runID = `run_dispatch_stop_${now}`
    const planID = `plan_dispatch_stop_${now}`
    const queuedGoalID = `goal_dispatch_stop_${now}`
    const queuedNodeID = `node_dispatch_stop_${now}`

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await Session.create({ kind: "root", title: "Dispatch stop session" })
        spyOn(AgentModel, "resolveAgentModel").mockResolvedValue({
          id: "test/mock",
          providerID: "test",
          modelID: "mock",
        } as any)

        const runtime = spyOn(AgentRuntime, "run").mockImplementation(async (input: any) => {
          const result = await input.tools.dispatch_goal.execute({ goalIDs: [queuedGoalID] }, {} as any)
          expect(result).toContain(queuedGoalID)
          expect(input.signal.aborted).toBe(false)
          await input.onStepFinish?.({ toolCalls: [{ toolName: "dispatch_goal" }] })
          expect(input.signal.aborted).toBe(true)
          return {
            text: "",
            steps: [{ toolCalls: [{ toolName: "dispatch_goal" }] }],
            finishReason: "tool-calls",
            toolCallCount: 1,
            failures: { count: 0, items: [] },
          }
        })

        Database.use((db) => {
          db.insert(ProjectTable).values({
            id: projectID,
            worktree: process.cwd(),
            name: "Dispatch stop integration test",
            sandboxes: "[]",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineTaskTable).values({
            id: taskID,
            project_id: projectID,
            session_id: session.id,
            source: "test",
            title: "Dispatch stop task",
            request: "Verify dispatch stop timing through processTask",
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
            summary: "Dispatch stop test plan",
            prompt: "Dispatch stop test prompt",
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineGoalTable).values({
            id: queuedGoalID,
            task_id: taskID,
            plan_version_id: planID,
            title: "Queued dispatch goal",
            slug: "queued-dispatch-goal",
            objective: "Verify retry-triggered dispatch persists as queued goal_run.",
            acceptance_specs: [],
            owned_paths: ["src/dispatch-stop.ts"],
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
            id: queuedNodeID,
            task_id: taskID,
            plan_version_id: planID,
            kind: "goal",
            goal_id: queuedGoalID,
            title: "Queued dispatch goal",
            brief: "Queue dispatch stop test goal",
            order_index: 0,
            time_created: now,
            time_updated: now,
          }).run()
          db.insert(EngineRunTable).values({
            id: runID,
            task_id: taskID,
            session_id: session.id,
            plan_version_id: planID,
            executor: "opencode",
            status: "running",
            phase: "execute",
            time_created: now,
            time_updated: now,
          }).run()
        })

        await Orchestrator.processTask(taskID, { kind: "retry" })

        expect(runtime).toHaveBeenCalledTimes(1)
        expect(listQueuedGoalRunsForRun(runID).map((goalRun) => goalRun.goal_id)).toEqual([queuedGoalID])
        const task = await EngineService.getTask(taskID)
        expect(task.error).toBeUndefined()
      },
    })
  })
})
