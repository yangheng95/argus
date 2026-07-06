import { afterEach, describe, expect, spyOn, test } from "bun:test"
import { Database, and, eq } from "../../src/storage/db"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import {
  AgentCoordinationPendingConflictError,
  completeAgentCoordinationAction,
  createAgentCoordinationRequest,
  createOperatorSteerCoordinationRequest,
  createAgentCoordinationResponse,
  failAgentCoordinationAction,
  findAgentCoordinationAction,
  findAgentCoordinationRequest,
  findAgentCoordinationResponse,
  listAgentCoordinationActions,
  listAgentCoordinationRequests,
  listAgentCoordinationResponses,
  listPendingAgentCoordinationRequests,
  recordAgentCoordinationActionProgress,
} from "../../src/engine/agent-coordination"
import { describeTask, renderTaskDescription } from "../../src/engine/describe"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProtocolStore } from "../../src/protocol/store"
import { Session } from "../../src/session"
import {
  createOrchestratorToolOwnershipPayload,
  insertOrchestratorToolOwnershipArtifact,
  listLiveOrchestratorToolOwnership,
} from "../../src/engine/tool-ownership"
import { WorkflowRegistry } from "../../src/engine/workflow"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  await Instance.disposeAll()
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

function coordinationResponseAudit(label: string) {
  return {
    orchestratorSessionID: `ses_orchestrator_${label}`,
    orchestratorMessageID: `msg_orchestrator_${label}`,
    orchestratorToolCallID: `cal_orchestrator_${label}`,
    orchestratorToolPartID: `prt_orchestrator_${label}`,
  }
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
          db.update(EngineTaskTable)
            .set({ session_id: secondRoot.id })
            .where(eq(EngineTaskTable.id, secondTaskID))
            .run()
        })

        await expect(
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
        ).rejects.toThrow(/belongs to task/)
      },
    })
  })

  test("request and response accept a live tool ownership session outside the task session tree", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        seedTask(taskID, now)
        const taskRoot = await Session.create({ kind: "root", title: "live ownership task root" })
        const detachedRoot = await Session.create({ kind: "root", title: "live ownership detached root" })
        const worker = await Session.create({
          kind: "assistant",
          parentID: detachedRoot.id,
          title: "live ownership detached worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: taskRoot.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const ownershipPayload = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: taskRoot.id,
          orchestratorMessageID: "msg_live_ownership_orchestrator",
          toolPartID: "prt_live_ownership_build",
          toolCallID: "cal_live_ownership_build",
          childSessionID: worker.id,
          scope: "task",
          now,
        })
        const ownershipArtifactID = insertOrchestratorToolOwnershipArtifact({
          taskID,
          label: "tool-ownership-live-test",
          payload: ownershipPayload,
          now,
        })
        expect(listLiveOrchestratorToolOwnership(taskID).map((row) => row.payload.child_session_id)).toEqual([
          worker.id,
        ])

        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "coding",
          messageID: "msg_worker_live_ownership_coordination",
          summary: "Need scheduler action from live ownership",
          details: "The worker is detached from the task root but owned by the live build tool.",
          blocking: true,
          requestedDecision: "continue this live-owned worker",
          severity: "blocked",
          now: now + 1,
        })

        expect(request.payload.status).toBe("pending")
        expect(request.payload).toMatchObject({
          session_ownership_source: "live_tool_ownership",
          tool_ownership_id: ownershipPayload.ownership_id,
          tool_ownership_artifact_id: ownershipArtifactID,
        })
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          ...coordinationResponseAudit("live_ownership"),
          decision: "continue",
          reason: "The live tool ownership row is the durable task-owned agent handle.",
          message: "Continue under live tool ownership.",
          now: now + 2,
        })
        expect(response.payload.decision).toBe("continue")
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        expect(listAgentCoordinationActions(taskID).map((row) => row.payload)).toEqual([
          expect.objectContaining({
            request_id: request.payload.request_id,
            response_id: response.payload.response_id,
            action: "continue_worker",
            status: "pending",
            target_session_id: worker.id,
            target_agent: "coding",
          }),
        ])
      },
    })
  })

  test("request rejects live ownership sessions recorded for another task", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const owningTaskID = Identifier.ascending("task")
        const otherTaskID = Identifier.ascending("task")
        seedTask(owningTaskID, now)
        seedTask(otherTaskID, now)
        const owningTaskRoot = await Session.create({ kind: "root", title: "owning live task root" })
        const otherTaskRoot = await Session.create({ kind: "root", title: "other live task root" })
        const detachedRoot = await Session.create({ kind: "root", title: "cross task live ownership detached root" })
        const worker = await Session.create({
          kind: "assistant",
          parentID: detachedRoot.id,
          title: "cross task live-owned worker",
        })
        Database.use((db) => {
          db.update(EngineTaskTable)
            .set({ session_id: owningTaskRoot.id })
            .where(eq(EngineTaskTable.id, owningTaskID))
            .run()
          db.update(EngineTaskTable)
            .set({ session_id: otherTaskRoot.id })
            .where(eq(EngineTaskTable.id, otherTaskID))
            .run()
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID: owningTaskID,
          label: "tool-ownership-cross-task-test",
          now,
          payload: createOrchestratorToolOwnershipPayload({
            taskID: owningTaskID,
            orchestratorSessionID: owningTaskRoot.id,
            orchestratorMessageID: "msg_cross_task_orchestrator",
            toolPartID: "prt_cross_task_build",
            toolCallID: "cal_cross_task_build",
            childSessionID: worker.id,
            scope: "task",
            now,
          }),
        })

        await expect(
          createAgentCoordinationRequest({
            taskID: otherTaskID,
            sessionID: worker.id,
            agent: "coding",
            messageID: "msg_cross_task_live_ownership",
            summary: "Wrong task live ownership",
            details: "A live ownership row from another task must not authorize this request.",
            blocking: true,
            requestedDecision: "continue",
          }),
        ).rejects.toThrow(/not owned by task/)
        expect(listAgentCoordinationRequests(otherTaskID)).toEqual([])
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

        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "frontend-research",
          messageID: "msg_worker_coordination",
          summary: "Need orchestrator routing",
          details: "The evidence conflicts with the goal contract.",
          blocking: true,
          requestedDecision: "choose continue or rerun the stage",
          evidenceRefs: ["artifact:brief"],
          severity: "blocked",
          now,
        })

        expect(request.payload.status).toBe("pending")
        expect(request.payload.session_ownership_source).toBe("task_session_tree")
        expect(listPendingAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([
          request.payload.request_id,
        ])
        const replay = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "frontend-research",
          messageID: "msg_worker_coordination",
          summary: "Need orchestrator routing",
          details: "The evidence conflicts with the goal contract.",
          blocking: true,
          requestedDecision: "choose continue or rerun the stage",
          evidenceRefs: ["artifact:brief"],
          severity: "blocked",
          now: now + 1,
        })
        expect(replay.payload.request_id).toBe(request.payload.request_id)
        expect(replay.createdNow).toBe(false)

        await expect(
          createAgentCoordinationRequest({
            taskID,
            sessionID: worker.id,
            agent: "frontend-research",
            messageID: "msg_worker_coordination",
            summary: "Conflicting replay",
            details: "The evidence conflicts with the goal contract.",
            blocking: true,
            requestedDecision: "choose continue or rerun the stage",
            evidenceRefs: ["artifact:brief"],
            severity: "blocked",
          }),
        ).rejects.toThrow(/conflicts with existing request/)

        const second = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "frontend-research",
          messageID: "msg_worker_coordination_2",
          summary: "Second request",
          details: "A distinct worker message may create another mailbox entry.",
          blocking: true,
          requestedDecision: "answer",
          now: now + 2,
        })
        expect(second.payload.request_id).not.toBe(request.payload.request_id)
        expect(
          listPendingAgentCoordinationRequests(taskID)
            .map((row) => row.payload.request_id)
            .sort(),
        ).toEqual([request.payload.request_id, second.payload.request_id].sort())

        const sameMessageDifferentCall = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "frontend-research",
          messageID: "msg_worker_coordination",
          callID: "call_second_tool",
          summary: "Same message second tool call",
          details: "A distinct tool call inside the same assistant message gets its own request.",
          blocking: true,
          requestedDecision: "answer",
          now: now + 3,
        })
        expect(sameMessageDifferentCall.payload.request_id).not.toBe(request.payload.request_id)
        expect(sameMessageDifferentCall.payload.tool_call_id).toBe("call_second_tool")

        const desc = await describeTask(taskID)
        expect(desc.pending_agent_coordination?.map((item) => item.request_id).sort()).toEqual(
          [request.payload.request_id, second.payload.request_id, sameMessageDifferentCall.payload.request_id].sort(),
        )
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

  test("operator steer request helper records one operator-origin request and rejects duplicate pending steer", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const operatorSteerID = Identifier.ascending("artifact")
        seedTask(taskID, now)
        const root = await Session.create({ kind: "root", title: "operator steer helper root" })
        const worker = await Session.create({
          kind: "requirements",
          parentID: root.id,
          title: "operator steer helper worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: root.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )

        const request = await createOperatorSteerCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "requirements",
          operatorMessage: "Operator asks the requirements agent to keep the contract strict.",
          operatorSteerID,
          now,
        })

        expect(request.artifactID).toBe(operatorSteerID)
        expect(request.createdNow).toBe(true)
        expect(request.payload).toMatchObject({
          request_id: operatorSteerID,
          task_id: taskID,
          session_id: worker.id,
          agent: "requirements",
          origin: "operator_steer",
          operator_steer_id: operatorSteerID,
          operator_message: "Operator asks the requirements agent to keep the contract strict.",
          requested_decision: "operator_steer",
          summary: `Operator steer for requirements session ${worker.id}`,
          details: "Operator asks the requirements agent to keep the contract strict.",
          blocking: true,
          severity: "blocked",
          status: "pending",
          session_ownership_source: "task_session_tree",
        })
        expect(request.payload.message_id).toBeUndefined()
        expect(request.payload.tool_call_id).toBeUndefined()
        expect(listPendingAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([
          operatorSteerID,
        ])

        const replay = await createOperatorSteerCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "requirements",
          operatorMessage: "Operator asks the requirements agent to keep the contract strict.",
          operatorSteerID,
          now: now + 1,
        })
        expect(replay.artifactID).toBe(operatorSteerID)
        expect(replay.createdNow).toBe(false)
        expect(listAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([operatorSteerID])

        await expect(
          createOperatorSteerCoordinationRequest({
            taskID,
            sessionID: worker.id,
            agent: "requirements",
            operatorMessage: "Conflicting replay must not rewrite the operator steer payload.",
            operatorSteerID,
            now: now + 2,
          }),
        ).rejects.toThrow(/conflicts with existing request.*operator_message/)

        await expect(
          createOperatorSteerCoordinationRequest({
            taskID,
            sessionID: worker.id,
            agent: "requirements",
            operatorMessage: "A second pending operator steer must wait for the first response.",
            operatorSteerID: Identifier.ascending("artifact"),
            now: now + 3,
          }),
        ).rejects.toBeInstanceOf(AgentCoordinationPendingConflictError)
        expect(listAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([operatorSteerID])

        await new Promise((resolve) => setTimeout(resolve, 0))
        const event = ProtocolStore.listTaskEvents(taskID).find((row) => row.type === "agent.coordination.requested")
        expect(event?.sessionID).toBe(worker.id)
        expect(event?.target).toBe("orchestrator")
        expect(event?.payload).toMatchObject({
          taskID,
          requestID: operatorSteerID,
          sessionID: worker.id,
          agent: "requirements",
          blocking: true,
          severity: "blocked",
        })
      },
    })
  })

  test("request replay fails loudly when the same invocation already has duplicate artifacts", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        seedTask(taskID, now)
        const root = await Session.create({ kind: "root", title: "coordination duplicate root" })
        const worker = await Session.create({
          kind: "frontend-research",
          parentID: root.id,
          title: "coordination duplicate worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: root.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const first = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "frontend-research",
          messageID: "msg_duplicate_invocation",
          callID: "call_duplicate_invocation",
          summary: "Need orchestrator routing",
          details: "The evidence conflicts with the goal contract.",
          blocking: true,
          requestedDecision: "choose continue or rerun the stage",
          now,
        })
        const duplicateID = Identifier.ascending("artifact")
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: duplicateID,
              task_id: taskID,
              run_id: null,
              goal_run_id: null,
              acceptance_id: null,
              kind: "agent_coordination_request",
              label: "pending",
              payload: {
                ...first.payload,
                request_id: duplicateID,
                created_at: now + 1,
              },
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run(),
        )

        await expect(
          createAgentCoordinationRequest({
            taskID,
            sessionID: worker.id,
            agent: "frontend-research",
            messageID: "msg_duplicate_invocation",
            callID: "call_duplicate_invocation",
            summary: "Need orchestrator routing",
            details: "The evidence conflicts with the goal contract.",
            blocking: true,
            requestedDecision: "choose continue or rerun the stage",
          }),
        ).rejects.toThrow(/has 2 persisted requests/)
        expect(
          listAgentCoordinationRequests(taskID)
            .map((row) => row.payload.request_id)
            .sort(),
        ).toEqual([first.payload.request_id, duplicateID].sort())
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
        const request = await createAgentCoordinationRequest({
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

        const audit = coordinationResponseAudit("response")
        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          ...audit,
          decision: "continue",
          reason: "The worker can continue under the clarified contract.",
          message: "Continue with the corrected scope.",
          now: now + 1,
        })

        expect(response.payload.decision).toBe("continue")
        expect(response.payload).toMatchObject({
          orchestrator_session_id: audit.orchestratorSessionID,
          orchestrator_message_id: audit.orchestratorMessageID,
          orchestrator_tool_call_id: audit.orchestratorToolCallID,
          orchestrator_tool_part_id: audit.orchestratorToolPartID,
        })
        const replay = await createAgentCoordinationResponse({
          taskID,
          requestID: request.payload.request_id,
          ...audit,
          decision: "continue",
          reason: "The worker can continue under the clarified contract.",
          message: "Continue with the corrected scope.",
          now: now + 2,
        })
        expect(replay.artifactID).toBe(response.artifactID)
        expect(replay.payload.action_id).toBe(response.payload.action_id)
        expect(replay.createdNow).toBe(false)
        await expect(
          createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            ...coordinationResponseAudit("response_2"),
            decision: "fail_task",
            reason: "A second response must not consume the same request.",
            now: now + 2,
          }),
        ).rejects.toThrow(/responded|claimed|replay mismatch/)
        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
          "responded",
        )
        expect(listPendingAgentCoordinationRequests(taskID)).toHaveLength(0)
        const responseRows = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_response")),
            )
            .all(),
        )
        expect(responseRows.map((row) => row.id)).toEqual([response.artifactID])
        expect(listAgentCoordinationResponses(taskID).map((row) => row.artifactID)).toEqual([response.artifactID])
        expect(findAgentCoordinationResponse({ taskID, responseID: response.artifactID })?.payload).toMatchObject({
          response_id: response.artifactID,
          action_id: response.payload.action_id,
          orchestrator_tool_call_id: audit.orchestratorToolCallID,
          orchestrator_tool_part_id: audit.orchestratorToolPartID,
        })
        const actionRows = listAgentCoordinationActions(taskID)
        expect(actionRows).toHaveLength(1)
        expect(actionRows[0]?.payload).toMatchObject({
          action_id: response.payload.action_id,
          request_id: request.payload.request_id,
          response_id: response.artifactID,
          action: "continue_worker",
          decision: "continue",
          status: "pending",
          target_session_id: worker.id,
          target_agent: "architect",
        })
        expect(findAgentCoordinationAction({ taskID, actionID: response.payload.action_id })?.artifactID).toBe(
          response.payload.action_id,
        )
        const completed = await completeAgentCoordinationAction({
          taskID,
          actionID: response.payload.action_id,
          result: { resumed: true },
          summary: "continue action explicitly closed in test",
          now: now + 2,
        })
        expect(completed.payload.status).toBe("completed")
        expect(completed.payload.completed_at).toBe(now + 2)
        expect(completed.payload.result).toEqual({ resumed: true })
        await expect(
          completeAgentCoordinationAction({
            taskID,
            actionID: response.payload.action_id,
            summary: "second close must fail",
            now: now + 3,
          }),
        ).rejects.toThrow(/completed/)

        await new Promise((resolve) => setTimeout(resolve, 0))
        const event = ProtocolStore.listTaskEvents(taskID).find((row) => row.type === "agent.coordination.responded")
        expect(event?.sessionID).toBe(worker.id)
        expect(event?.target).toBe("architect")
        const actionEvents = ProtocolStore.listTaskEvents(taskID).filter(
          (row) => row.type === "agent.coordination.action",
        )
        expect(actionEvents.map((row) => row.payload?.status)).toEqual(["pending", "completed"])
        expect(actionEvents[0]?.sessionID).toBe(worker.id)
        expect(actionEvents[0]?.target).toBe("architect")
        expect(actionEvents[0]?.causationID).toBe(response.payload.action_id)
      },
    })
  })

  test("response claim rolls back when protocol action visibility cannot be written", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        seedTask(taskID, now)
        const root = await Session.create({ kind: "root", title: "coordination response rollback root" })
        const worker = await Session.create({
          kind: "architect",
          parentID: root.id,
          title: "coordination response rollback worker",
        })
        Database.use((db) =>
          db.update(EngineTaskTable).set({ session_id: root.id }).where(eq(EngineTaskTable.id, taskID)).run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "architect",
          messageID: "msg_worker_response_rollback",
          summary: "Need decision",
          details: "The current contract is ambiguous.",
          blocking: true,
          requestedDecision: "continue",
          now,
        })

        const appendEventInTransaction = ProtocolStore.appendEventInTransaction
        const appendSpy = spyOn(ProtocolStore, "appendEventInTransaction").mockImplementation((input) => {
          if (input.type === "agent.coordination.action") {
            throw new Error("protocol action append failed")
          }
          return appendEventInTransaction(input)
        })
        try {
          await expect(
            createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...coordinationResponseAudit("response_rollback"),
              decision: "continue",
              reason: "The worker can continue under the clarified contract.",
              message: "Continue with the corrected scope.",
              now: now + 1,
            }),
          ).rejects.toThrow("protocol action append failed")
        } finally {
          appendSpy.mockRestore()
        }

        expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload).toMatchObject({
          status: "pending",
        })
        expect(listAgentCoordinationResponses(taskID)).toEqual([])
        expect(listAgentCoordinationActions(taskID)).toEqual([])
        expect(ProtocolStore.listTaskEvents(taskID).map((event) => event.type)).toEqual([
          "agent.coordination.requested",
        ])
      },
    })
  })

  test(
    "response helper rejects redispatch until a concrete workflow tool binding exists",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const now = Date.now()
          const taskID = Identifier.ascending("task")
          seedTask(taskID, now)
          const root = await Session.create({ kind: "root", title: "coordination redispatch root" })
          const worker = await Session.create({
            kind: "architect",
            parentID: root.id,
            title: "coordination redispatch worker",
          })
          Database.use((db) =>
            db.update(EngineTaskTable).set({ session_id: root.id }).where(eq(EngineTaskTable.id, taskID)).run(),
          )
          const request = await createAgentCoordinationRequest({
            taskID,
            sessionID: worker.id,
            agent: "architect",
            messageID: "msg_worker_redispatch",
            summary: "Need redispatch",
            details: "The worker asks for a fresh workflow tool action.",
            blocking: true,
            requestedDecision: "evaluate scheduler-owned stage rerun",
            now,
          })

          await expect(
            createAgentCoordinationResponse({
              taskID,
              requestID: request.payload.request_id,
              ...coordinationResponseAudit("redispatch_rejected"),
              decision: "redispatch",
              reason: "Redispatch must not create a weak action.",
              now: now + 1,
            }),
          ).rejects.toThrow(/concrete scheduler workflow binding/)
          expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
            "pending",
          )
          expect(listAgentCoordinationActions(taskID)).toHaveLength(0)
          const response = await createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            ...coordinationResponseAudit("redispatch_accepted"),
            decision: "redispatch",
            reason: "Redispatch uses the current workflow declaration.",
            redispatchWorkflow: WorkflowRegistry.resolveSync("pipeline"),
            now: now + 2,
          })
          expect(listAgentCoordinationActions(taskID).map((row) => row.payload)).toEqual([
            expect.objectContaining({
              action: "redispatch_worker",
              response_id: response.payload.response_id,
              result: {
                redispatch_binding: {
                  workflow_tool_name: "architect",
                  stage: "architect",
                  target_kind: "architect",
                },
              },
            }),
          ])
        },
      })
    },
    { timeout: 15_000 },
  )

  test(
    "redispatch action updates reject legacy top-level binding fields at the write boundary",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const now = Date.now()
          const taskID = Identifier.ascending("task")
          seedTask(taskID, now)
          const root = await Session.create({ kind: "root", title: "coordination redispatch write guard root" })
          const worker = await Session.create({
            kind: "architect",
            parentID: root.id,
            title: "coordination redispatch write guard worker",
          })
          Database.use((db) =>
            db.update(EngineTaskTable).set({ session_id: root.id }).where(eq(EngineTaskTable.id, taskID)).run(),
          )
          const request = await createAgentCoordinationRequest({
            taskID,
            sessionID: worker.id,
            agent: "architect",
            messageID: "msg_worker_redispatch_write_guard",
            summary: "Need redispatch",
            details: "The worker asks for a fresh workflow tool action.",
            blocking: true,
            requestedDecision: "evaluate scheduler-owned stage rerun",
            now,
          })
          const response = await createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            ...coordinationResponseAudit("redispatch_write_guard"),
            decision: "redispatch",
            reason: "Redispatch uses the current workflow declaration.",
            redispatchWorkflow: WorkflowRegistry.resolveSync("pipeline"),
            now: now + 1,
          })

          await expect(
            recordAgentCoordinationActionProgress({
              taskID,
              actionID: response.payload.action_id,
              result: { workflow_tool_name: "architect" },
              summary: "old top-level workflow tool progress must not persist",
              now: now + 2,
            }),
          ).rejects.toThrow(/Malformed agent coordination action payload/)
          await expect(
            completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: { stage: "architect", target_kind: "architect" },
              summary: "old top-level stage completion must not persist",
              now: now + 3,
            }),
          ).rejects.toThrow(/Malformed agent coordination action payload/)
          await expect(
            recordAgentCoordinationActionProgress({
              taskID,
              actionID: response.payload.action_id,
              result: {
                redispatch_binding: {
                  workflow_tool_name: "requirements",
                  stage: "architect",
                  target_kind: "architect",
                },
              },
              summary: "nested redispatch binding progress must not replace the scheduler binding",
              now: now + 4,
            }),
          ).rejects.toThrow(/cannot replace scheduler-derived redispatch_binding/)
          await expect(
            completeAgentCoordinationAction({
              taskID,
              actionID: response.payload.action_id,
              result: {
                redispatch_binding: {
                  workflow_tool_name: "requirements",
                  stage: "architect",
                  target_kind: "architect",
                },
              },
              summary: "nested redispatch binding completion must not replace the scheduler binding",
              now: now + 5,
            }),
          ).rejects.toThrow(/cannot replace scheduler-derived redispatch_binding/)

          const completed = await completeAgentCoordinationAction({
            taskID,
            actionID: response.payload.action_id,
            result: { dispatched: true },
            summary: "redispatch action closed with nested binding preserved",
            now: now + 6,
          })
          expect(completed.payload.result).toEqual({
            redispatch_binding: {
              workflow_tool_name: "architect",
              stage: "architect",
              target_kind: "architect",
            },
            dispatched: true,
          })
        },
      })
    },
    { timeout: 15_000 },
  )

  test(
    "failed action reopens the request and preserves progress evidence",
    async () => {
      await using tmp = await tmpdir({ git: true })
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const now = Date.now()
          const taskID = Identifier.ascending("task")
          seedTask(taskID, now)
          const root = await Session.create({ kind: "root", title: "coordination failure root" })
          const worker = await Session.create({
            kind: "assistant",
            parentID: root.id,
            title: "coordination failure worker",
          })
          Database.use((db) =>
            db.update(EngineTaskTable).set({ session_id: root.id }).where(eq(EngineTaskTable.id, taskID)).run(),
          )
          const request = await createAgentCoordinationRequest({
            taskID,
            sessionID: worker.id,
            agent: "coding",
            messageID: "msg_worker_failed_action",
            summary: "Need continuation",
            details: "The worker asks for a recoverable action.",
            blocking: true,
            requestedDecision: "continue",
            now,
          })
          const response = await createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            ...coordinationResponseAudit("failed_action"),
            decision: "continue",
            reason: "Try continuation.",
            now: now + 1,
          })
          const progress = await recordAgentCoordinationActionProgress({
            taskID,
            actionID: response.payload.action_id,
            result: { worker_message_id: "msg_worker_visible" },
            summary: "continue_worker message appended",
            now: now + 2,
          })
          expect(progress.payload.status).toBe("pending")
          expect(progress.payload.result).toEqual({ worker_message_id: "msg_worker_visible" })

          const failed = await failAgentCoordinationAction({
            taskID,
            actionID: response.payload.action_id,
            error: new Error("loop failed after visible message"),
            result: { session_id: worker.id },
            summary: "continue_worker failed",
            now: now + 3,
          })
          expect(failed.payload.status).toBe("failed")
          expect(failed.payload.result).toEqual({
            worker_message_id: "msg_worker_visible",
            session_id: worker.id,
          })
          const reopened = findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload
          expect(reopened).toMatchObject({
            status: "pending",
            last_failed_response_id: response.payload.response_id,
            last_failed_action_id: response.payload.action_id,
            last_action_error: "loop failed after visible message",
            last_action_failed_at: now + 3,
          })
          expect(reopened?.response_id).toBeUndefined()
          expect(reopened?.responded_at).toBeUndefined()
          expect(listPendingAgentCoordinationRequests(taskID).map((row) => row.payload.request_id)).toEqual([
            request.payload.request_id,
          ])
          expect(renderTaskDescription(await describeTask(taskID))).toContain("last_failed_action")

          const replay = await createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            ...coordinationResponseAudit("failed_action"),
            decision: "continue",
            reason: "Try continuation.",
            now: now + 4,
          })
          expect(replay.createdNow).toBe(false)
          expect(replay.payload.response_id).toBe(response.payload.response_id)
          expect(replay.payload.action_id).toBe(response.payload.action_id)
          expect(findAgentCoordinationAction({ taskID, actionID: replay.payload.action_id })?.payload.status).toBe(
            "failed",
          )
          expect(listAgentCoordinationResponses(taskID).map((row) => row.payload.response_id)).toEqual([
            response.payload.response_id,
          ])
          expect(listAgentCoordinationActions(taskID).map((row) => row.payload.action_id)).toEqual([
            response.payload.action_id,
          ])

          const retry = await createAgentCoordinationResponse({
            taskID,
            requestID: request.payload.request_id,
            ...coordinationResponseAudit("retry"),
            decision: "cancel_worker",
            reason: "Retry with a different visible action.",
            now: now + 5,
          })
          expect(retry.payload.response_id).not.toBe(response.payload.response_id)
          expect(findAgentCoordinationRequest({ taskID, requestID: request.payload.request_id })?.payload.status).toBe(
            "responded",
          )
        },
      })
    },
    { timeout: 15_000 },
  )

  test("malformed request artifacts fail loudly instead of disappearing from the mailbox", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        seedTask(taskID, now)
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: Identifier.ascending("artifact"),
              task_id: taskID,
              run_id: null,
              goal_run_id: null,
              acceptance_id: null,
              kind: "agent_coordination_request",
              label: "pending",
              payload: {
                request_id: "not-enough-fields",
              },
              time_created: now,
              time_updated: now,
            } as any)
            .run(),
        )

        expect(() => listPendingAgentCoordinationRequests(taskID)).toThrow(
          /Malformed agent coordination request artifact/,
        )
      },
    })
  })

  test("malformed response artifacts fail loudly from mailbox reads and task description", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        seedTask(taskID, now)
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: Identifier.ascending("artifact"),
              task_id: taskID,
              run_id: null,
              goal_run_id: null,
              acceptance_id: null,
              kind: "agent_coordination_response",
              label: "continue",
              payload: {
                response_id: "not-enough-fields",
              },
              time_created: now,
              time_updated: now,
            } as any)
            .run(),
        )

        expect(() => listAgentCoordinationResponses(taskID)).toThrow(/Malformed agent coordination response artifact/)
        await expect(describeTask(taskID)).rejects.toThrow(/Malformed agent coordination response artifact/)
      },
    })
  })

  test("malformed action artifacts without orchestrator tool proof fail loudly", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        seedTask(taskID, now)
        const actionID = Identifier.ascending("action")
        Database.use((db) =>
          db
            .insert(EngineArtifactTable)
            .values({
              id: actionID,
              task_id: taskID,
              run_id: null,
              goal_run_id: null,
              acceptance_id: null,
              kind: "agent_coordination_action",
              label: "pending",
              payload: {
                action_id: actionID,
                request_id: Identifier.ascending("request"),
                response_id: Identifier.ascending("response"),
                task_id: taskID,
                orchestrator_session_id: Identifier.ascending("session"),
                orchestrator_message_id: Identifier.ascending("message"),
                decision: "continue",
                action: "continue_worker",
                target_session_id: Identifier.ascending("session"),
                target_agent: "architect",
                reason: "Weak persisted actions must not survive replay without exact tool-call provenance.",
                status: "pending",
                created_at: now,
              },
              time_created: now,
              time_updated: now,
            } as any)
            .run(),
        )

        expect(() => listAgentCoordinationActions(taskID)).toThrow(/Malformed agent coordination action artifact/)
      },
    })
  })
})
