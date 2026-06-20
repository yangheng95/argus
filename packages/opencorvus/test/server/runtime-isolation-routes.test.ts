import { afterEach, describe, expect, mock, test } from "bun:test"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { ExecutorRegistry } from "../../src/executor/registry"
import { Identifier } from "../../src/id/id"
import { ProtocolStore } from "../../src/protocol/store"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { AgentTrace } from "../../src/trace"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

async function seedTask(directory: string, input?: { taskID?: string; sessionID?: string }) {
  const taskID = input?.taskID ?? Identifier.ascending("task")
  await Instance.provide({
    directory,
    fn: () => {
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: input?.sessionID,
            source: "test",
            title: "runtime isolation route task",
            request: "runtime isolation route task",
            priority: "normal",
            time_created: Date.now(),
            time_updated: Date.now(),
          })
          .run(),
      )
    },
  })
  return taskID
}

function seedRunArtifacts(input: { taskID: string; runID: string; goalRunID: string }) {
  const now = Date.now()
  Database.transaction((db) => {
    db.insert(EngineArtifactTable)
      .values({
        id: input.runID,
        task_id: input.taskID,
        run_id: input.runID,
        kind: "run",
        label: "run-running",
        payload: {
          executor: "opencorvus",
          status: "running",
          phase: "dispatch",
          time_started: now,
          time_completed: null,
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: input.runID,
        kind: "acceptance",
        label: "acceptance-candidate",
        acceptance_id: Identifier.ascending("acceptance"),
        payload: {
          status: "candidate",
          summary: "candidate acceptance",
          result: { summary: "candidate acceptance" },
        },
        time_created: now + 1,
        time_updated: now + 1,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: input.runID,
        kind: "verification-evidence",
        label: "evaluation",
        payload: {
          scope: "acceptance",
          status: "completed",
          verdict: "pass",
          summary: "evaluation",
          checks: [],
          time_completed: now + 2,
        },
        time_created: now + 2,
        time_updated: now + 2,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: input.goalRunID,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID,
        kind: "goal_run_attempt",
        label: "goal-run-running",
        payload: {
          goal_id: Identifier.ascending("goal"),
          status: "running",
        },
        time_created: now + 3,
        time_updated: now + 3,
      })
      .run()
    db.insert(EngineArtifactTable)
      .values({
        id: Identifier.ascending("artifact"),
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID,
        kind: "acceptance",
        label: "goal-run-acceptance",
        acceptance_id: Identifier.ascending("acceptance"),
        payload: {
          status: "candidate",
          summary: "goal run acceptance",
          result: { summary: "goal run acceptance" },
        },
        time_created: now + 4,
        time_updated: now + 4,
      })
      .run()
  })
}

describe("runtime isolation project-scoped routes", () => {
  afterEach(async () => {
    mock.restore()
    ExecutorRegistry.reset()
    await Instance.disposeAll()
    await resetDatabase()
  })

  test(
    "run and goal-run routes reject IDs owned by another project directory",
    async () => {
      await using first = await tmpdir({ git: true })
      await using second = await tmpdir({ git: true })
      const taskID = await seedTask(second.path)
      const runID = Identifier.ascending("run")
      const goalRunID = Identifier.uuid4First8()
      const abortRunID = Identifier.ascending("run")
      const abortGoalRunID = Identifier.uuid4First8()
      seedRunArtifacts({ taskID, runID, goalRunID })
      seedRunArtifacts({ taskID, runID: abortRunID, goalRunID: abortGoalRunID })
      let abortCalls = 0
      ExecutorRegistry.register("opencorvus", {
        start: async () => {
          throw new Error("route test must not start executor")
        },
        abort: async () => {
          abortCalls++
          return true
        },
      })

      const app = Server.App()
      const owningHeaders = { "x-opencorvus-directory": second.path }
      const owningRequests = [
        { path: `/run/${runID}`, method: "GET" },
        { path: `/run/${runID}/acceptance`, method: "GET" },
        { path: `/run/${runID}/artifacts`, method: "GET" },
        { path: `/run/${runID}/evaluations`, method: "GET" },
        { path: `/goal-run/${goalRunID}/acceptance`, method: "GET" },
      ] as const
      for (const request of owningRequests) {
        const response = await app.request(request.path, {
          method: request.method,
          headers: owningHeaders,
        })
        expect(response.status).toBe(200)
      }
      const owningAbort = await app.request(`/run/${abortRunID}/abort`, {
        method: "POST",
        headers: owningHeaders,
      })
      expect(owningAbort.status).toBe(200)
      expect(abortCalls).toBe(1)

      const headers = { "x-opencorvus-directory": first.path }
      const requests = [
        { path: `/run/${runID}`, method: "GET" },
        { path: `/run/${runID}/acceptance`, method: "GET" },
        { path: `/run/${runID}/artifacts`, method: "GET" },
        { path: `/run/${runID}/evaluations`, method: "GET" },
        { path: `/goal-run/${goalRunID}/acceptance`, method: "GET" },
        { path: `/run/${runID}/abort`, method: "POST" },
      ] as const

      for (const request of requests) {
        const response = await app.request(request.path, {
          method: request.method,
          headers,
        })
        expect(response.status).toBe(404)
      }
      expect(abortCalls).toBe(1)
    },
    { timeout: 20_000 },
  )

  test(
    "session trace route reads the owning project and rejects another project directory",
    async () => {
      await using first = await tmpdir({ git: true })
      await using second = await tmpdir({ git: true })
      let sessionID = ""
      let taskID = ""
      await Instance.provide({
        directory: second.path,
        fn: async () => {
          const session = await Session.create({ kind: "root", title: "other project trace" })
          sessionID = session.id
          taskID = await seedTask(second.path, { sessionID })
          AgentTrace.recordLLMRequest({
            sessionID,
            taskID,
            agentName: "orchestrator",
            agentMode: "task",
            model: { providerID: "test", modelID: "model" },
            system: ["system"],
            messages: [{ role: "user", content: "hi" }],
            tools: [],
          })
        },
      })
      const app = Server.App()

      const owning = await app.request(`/session/${sessionID}/trace`, {
        headers: { "x-opencorvus-directory": second.path },
      })
      expect(owning.status).toBe(200)
      const trace = (await owning.json()) as { events: Array<{ kind?: string; sessionID?: string }>; traceDir: string }
      expect(trace.traceDir).toBe(ProjectRuntimePaths.projectRuntimeRoot(second.path))
      expect(trace.events).toHaveLength(1)
      expect(trace.events[0]).toMatchObject({ kind: "llm_request", sessionID })

      const response = await app.request(`/session/${sessionID}/trace`, {
        headers: { "x-opencorvus-directory": first.path },
      })

      expect(response.status).toBe(404)
    },
    { timeout: 20_000 },
  )

  test(
    "task event stream opens for the owning project and rejects another project before opening SSE",
    async () => {
      await using first = await tmpdir({ git: true })
      await using second = await tmpdir({ git: true })
      const taskID = await seedTask(second.path)
      await ProtocolStore.appendEvent({
        kind: "event",
        type: "task.updated",
        aggregate: "task",
        aggregate_id: taskID,
        task_id: taskID,
        source: "runtime-isolation-route-test",
        payload: { taskID, status: "active", summary: "task event stream owning project" },
      })
      const app = Server.App()

      const owning = await app.request(`/task/${taskID}/events?after=0`, {
        headers: { "x-opencorvus-directory": second.path },
      })
      expect(owning.status).toBe(200)
      expect(owning.headers.get("content-type")).toContain("text/event-stream")
      await owning.body?.cancel()

      const response = await app.request(`/task/${taskID}/events`, {
        headers: { "x-opencorvus-directory": first.path },
      })

      expect(response.status).toBe(404)
    },
    { timeout: 20_000 },
  )
})
