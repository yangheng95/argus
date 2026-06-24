import { afterEach, expect, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import {
  findAgentCoordinationRequest,
  listAgentCoordinationRequests,
  listPendingAgentCoordinationRequests,
} from "../../src/engine/agent-coordination"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database } from "../../src/storage/db"
import { executeRequestOrchestratorDecision } from "../../src/tool/request-orchestrator-decision"
import type { Tool } from "../../src/tool/tool"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
})

function toolContext(input: { taskID: string; sessionID: string; agent?: string }): Tool.Context {
  return {
    sessionID: input.sessionID,
    messageID: Identifier.ascending("message"),
    agent: input.agent ?? "frontend-research",
    abort: new AbortController().signal,
    extra: { taskID: input.taskID },
    messages: [],
    metadata: () => {},
    ask: async () => {},
  }
}

async function seedTaskWorker() {
  const now = Date.now()
  const taskID = Identifier.ascending("task")
  const root = await Session.create({ kind: "root", title: "request orchestrator root" })
  const worker = await Session.create({
    kind: "frontend-research",
    parentID: root.id,
    title: "request orchestrator worker",
  })
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        session_id: root.id,
        source: "test",
        title: "request orchestrator decision",
        request: "worker asks the orchestrator for a decision",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      } as any)
      .run(),
  )
  return { taskID, workerID: worker.id }
}

test("request_orchestrator_decision records request and reports accepted wake result", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { taskID, workerID } = await seedTaskWorker()
      const result = await executeRequestOrchestratorDecision(
        {
          summary: "Need routing",
          details: "Worker needs scheduler guidance.",
          blocking: true,
          requested_decision: "continue or redispatch",
        },
        toolContext({ taskID, sessionID: workerID }),
        async () => "queued",
      )

      const output = JSON.parse(result.output) as { request_id: string; orchestrator_wake: string }
      expect(output.orchestrator_wake).toBe("queued")
      expect(findAgentCoordinationRequest({ taskID, requestID: output.request_id })?.payload.status).toBe("pending")
    },
  })
})

test("request_orchestrator_decision cancels the pending request when orchestrator wake is ignored", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { taskID, workerID } = await seedTaskWorker()
      await expect(
        executeRequestOrchestratorDecision(
          {
            summary: "Need routing",
            details: "Worker needs scheduler guidance.",
            blocking: true,
            requested_decision: "continue or redispatch",
          },
          toolContext({ taskID, sessionID: workerID }),
          async () => "ignored",
        ),
      ).rejects.toThrow(/wake was ignored/)

      expect(listPendingAgentCoordinationRequests(taskID)).toHaveLength(0)
      expect(listAgentCoordinationRequests(taskID).map((row) => row.payload.status)).toEqual(["cancelled"])
    },
  })
})
