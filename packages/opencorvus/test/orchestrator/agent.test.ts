import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineGoalRunTable, EngineGoalTable, EnginePlanVersionTable, EngineRunTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { EngineService } from "../../src/task-api"
import { Orchestrator } from "../../src/orchestrator/agent"
import { AgentRuntime } from "../../src/agent/runtime/runtime"
import * as AgentModel from "../../src/agent/model"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { pullDispatch } from "../../src/orchestrator/dispatch-queue"

describe("orchestrator dispatch gate", () => {
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
        slug: "blocked-build-goal",
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

  test("operator_message bypasses the dispatch gate and reaches the runtime", async () => {
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
        expect(pullDispatch(taskID)).toEqual([queuedGoalID])
        const task = await EngineService.getTask(taskID)
        expect(task.error).toBeUndefined()
      },
    })
  })
})
