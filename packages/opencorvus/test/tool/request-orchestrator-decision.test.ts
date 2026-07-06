import { afterEach, expect, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import {
  createAgentCoordinationRequest,
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

function toolContext(input: {
  taskID: string
  sessionID: string
  agent?: string
  messageID?: string
  callID?: string
}): Tool.Context {
  return {
    sessionID: input.sessionID,
    messageID: input.messageID ?? Identifier.ascending("message"),
    callID: input.callID,
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
          requested_decision: "continue or rerun the stage",
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

test("request_orchestrator_decision replays the same message without duplicate orchestrator wake", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { taskID, workerID } = await seedTaskWorker()
      const messageID = Identifier.ascending("message")
      let dispatchCalls = 0
      const dispatch = async () => {
        dispatchCalls += 1
        return "queued" as const
      }
      const params = {
        summary: "Need routing",
        details: "Worker needs scheduler guidance.",
        blocking: true,
        requested_decision: "continue or rerun the stage",
      }

      const first = await executeRequestOrchestratorDecision(
        params,
        toolContext({ taskID, sessionID: workerID, messageID }),
        dispatch,
      )
      const second = await executeRequestOrchestratorDecision(
        params,
        toolContext({ taskID, sessionID: workerID, messageID }),
        dispatch,
      )

      const firstOutput = JSON.parse(first.output) as { request_id: string; orchestrator_wake: string }
      const secondOutput = JSON.parse(second.output) as {
        request_id: string
        orchestrator_wake: string
        replayed?: boolean
      }
      expect(secondOutput.request_id).toBe(firstOutput.request_id)
      expect(secondOutput.replayed).toBe(true)
      expect(secondOutput.orchestrator_wake).toBe("not_dispatched")
      expect(dispatchCalls).toBe(1)
      expect(listPendingAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([
        firstOutput.request_id,
      ])
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
            requested_decision: "continue or rerun the stage",
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

test("request_orchestrator_decision rejects redispatch as a requested decision literal", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { taskID, workerID } = await seedTaskWorker()

      await expect(
        executeRequestOrchestratorDecision(
          {
            summary: "Need routing",
            details: "Worker must describe evidence and ask for orchestration judgment, not name the response action.",
            blocking: true,
            requested_decision: "redispatch",
          },
          toolContext({ taskID, sessionID: workerID }),
          async () => "queued",
        ),
      ).rejects.toThrow(/must describe the scheduling question/)

      expect(listAgentCoordinationRequests(taskID)).toHaveLength(0)
    },
  })
})

test("request_orchestrator_decision wake failure only cancels the request it created", async () => {
  await using tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const { taskID, workerID } = await seedTaskWorker()
      const existing = await createAgentCoordinationRequest({
        taskID,
        sessionID: workerID,
        agent: "frontend-research",
        messageID: Identifier.ascending("message"),
        summary: "Existing request",
        details: "This pending request must not be cancelled by another wake failure.",
        blocking: true,
        requestedDecision: "continue",
      })

      await expect(
        executeRequestOrchestratorDecision(
          {
            summary: "Second request",
            details: "Only this request should be cancelled when wake fails.",
            blocking: true,
            requested_decision: "ask_user",
          },
          toolContext({ taskID, sessionID: workerID, messageID: Identifier.ascending("message") }),
          async () => "ignored",
        ),
      ).rejects.toThrow(/wake was ignored/)

      const requests = listAgentCoordinationRequests(taskID)
      expect(requests).toHaveLength(2)
      expect(findAgentCoordinationRequest({ taskID, requestID: existing.payload.request_id })?.payload.status).toBe(
        "pending",
      )
      expect(listPendingAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([
        existing.payload.request_id,
      ])
      const cancelled = requests.find((row) => row.payload.request_id !== existing.payload.request_id)
      expect(cancelled?.payload.status).toBe("cancelled")
      expect(cancelled?.payload.cancel_reason).toBe("orchestrator wake ignored")
    },
  })
})
