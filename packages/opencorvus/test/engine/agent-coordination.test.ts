import { afterEach, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import {
  createAgentCoordinationRequest,
  createAgentCoordinationResponse,
  findAgentCoordinationRequest,
  listPendingAgentCoordinationRequests,
} from "../../src/engine/agent-coordination"
import { describeTask, renderTaskDescription } from "../../src/engine/describe"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import { Session } from "../../src/session"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await resetDatabase()
})

function seedTask(taskID: string, now: number) {
  Database.use((db) => {
    db.insert(EngineTaskTable)
      .values({
        id: taskID,
        project_id: Instance.project.id,
        source: "test",
        title: "Agent coordination",
        request: "worker asks the orchestrator for a scheduling decision",
        kind: "workflow",
        priority: "normal",
        time_created: now,
        time_updated: now,
        time_started: now,
      } as any)
      .run()
  })
}

describe("agent coordination artifacts", () => {
  test("request rejects sessions owned by a different task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const firstTaskID = Identifier.ascending("task")
        const secondTaskID = Identifier.ascending("task")
        seedTask(firstTaskID, now)
        seedTask(secondTaskID, now)
        const firstRoot = await Session.create({ kind: "root", title: "first task root" })
        const secondRoot = await Session.create({ kind: "root", title: "second task root" })
        const worker = await Session.create({
          kind: "frontend-research",
          parentID: firstRoot.id,
          title: "first task worker",
        })
        Database.use((db) => {
          db.update(EngineTaskTable).set({ session_id: firstRoot.id }).where(eq(EngineTaskTable.id, firstTaskID)).run()
          db.update(EngineTaskTable).set({ session_id: secondRoot.id }).where(eq(EngineTaskTable.id, secondTaskID)).run()
        })

        expect(() =>
          createAgentCoordinationRequest({
            taskID: secondTaskID,
            sessionID: worker.id,
            agent: "frontend-research",
            messageID: "msg_wrong_task",
            summary: "Wrong task",
            details: "This session belongs to a different task.",
            blocking: true,
            requestedDecision: "continue",
          }),
        ).toThrow(/belongs to task/)
      },
    })
  })

  test("request persists, emits a visible event, and appears in task description", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        seedTask(taskID, now)
        const root = await Session.create({ kind: "root", title: "coordination root" })
        const worker = await Session.create({
          kind: "frontend-research",
          parentID: root.id,
          title: "coordination worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: root.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )

        const request = createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "frontend-research",
          messageID: "msg_worker_coordination",
          summary: "Need orchestrator routing",
          details: "The evidence conflicts with the goal contract.",
          blocking: true,
          requestedDecision: "choose continue or redispatch",
          evidenceRefs: ["artifact:brief"],
          severity: "blocked",
          now,
        })

        expect(request.payload.status).toBe("pending")
        expect(listPendingAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([
          request.payload.request_id,
        ])
        expect(() =>
          createAgentCoordinationRequest({
            taskID,
            sessionID: worker.id,
            agent: "frontend-research",
            messageID: "msg_worker_coordination_2",
            summary: "Duplicate",
            details: "same worker",
            blocking: true,
            requestedDecision: "answer",
          }),
        ).toThrow(/already pending/)

        const desc = await describeTask(taskID)
        expect(desc.pending_agent_coordination?.[0]?.request_id).toBe(request.payload.request_id)
        const rendered = renderTaskDescription(desc)
        expect(rendered).toContain("Pending agent coordination requests")
        expect(rendered).toContain("respond_agent_coordination")
        expect(rendered).toContain("Need orchestrator routing")

        await new Promise((resolve) => setTimeout(resolve, 0))
        const event = ProtocolStore.listTaskEvents(taskID).find((row) => row.type === "agent.coordination.requested")
        expect(event?.sessionID).toBe(worker.id)
        expect(event?.target).toBe("orchestrator")
      },
    })
  })

  test("response consumes exactly one pending request and emits a response event", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        seedTask(taskID, now)
        const root = await Session.create({ kind: "root", title: "coordination response root" })
        const worker = await Session.create({
          kind: "architect",
          parentID: root.id,
          title: "coordination response worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: root.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "architect",
          messageID: "msg_worker_response",
          summary: "Need decision",
          details: "The current contract is ambiguous.",
          blocking: true,
          requestedDecision: "continue",
          now,
        })

        const response = createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          orchestratorSessionID: "ses_orchestrator_response",
          orchestratorMessageID: "msg_orchestrator_response",
          decision: "redispatch",
          reason: "The worker needs a fresh visible architect pass.",
          message: "Call architect again with the corrected scope.",
          now: now + 1,
        })

        expect(response.payload.decision).toBe("redispatch")
        expect(() =>
          createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            orchestratorSessionID: "ses_orchestrator_response_2",
            orchestratorMessageID: "msg_orchestrator_response_2",
            decision: "fail_task",
            reason: "A second response must not consume the same request.",
            now: now + 2,
          }),
        ).toThrow(/responded|claimed/)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        expect(listPendingAgentCoordinationRequests(taskID)).toHaveLength(0)
        const responseRows = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(eq(EngineArtifactTable.kind, "agent_coordination_response"))
            .all(),
        )
        expect(responseRows.map((row) => row.id)).toEqual([response.artifactID])

        await new Promise((resolve) => setTimeout(resolve, 0))
        const event = ProtocolStore.listTaskEvents(taskID).find((row) => row.type === "agent.coordination.responded")
        expect(event?.sessionID).toBe(worker.id)
        expect(event?.target).toBe("architect")
      },
    })
  })
})
