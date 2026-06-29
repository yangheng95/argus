import { afterEach, describe, expect, test } from "bun:test"
import { AgentRoleContract, type AgentRoleID } from "../../src/agent/role-contract"
import { WorkerTurnDescriptor } from "../../src/agent/worker-turn-descriptor"
import {
  AgentCoordinationPendingConflictError,
  createAgentCoordinationRequest,
  createAgentCoordinationResponse,
  createOperatorSteerCoordinationRequest,
  findAgentCoordinationRequest,
  listAgentCoordinationActions,
  listAgentCoordinationResponses,
  listPendingAgentCoordinationRequests,
} from "../../src/engine/agent-coordination"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import {
  createOrchestratorToolOwnershipPayload,
  insertOrchestratorToolOwnershipArtifact,
} from "../../src/engine/tool-ownership"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProtocolEventTable } from "../../src/protocol/protocol.sql"
import { Server } from "../../src/server/server"
import { Session } from "../../src/session"
import { SessionPrompt } from "../../src/session/prompt"
import type { SessionKind } from "../../src/session/session.sql"
import { sessionLifecycleOrderKey } from "../../src/session/status"
import { Database, and, eq } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

type OperatorSteerTargetKind = Extract<AgentRoleID, SessionKind>
const OPERATOR_STEER_TARGET_KINDS = AgentRoleContract.agentOwnedTaskWorkerIDs() as OperatorSteerTargetKind[]
const OPERATOR_STEER_TARGET_KIND_BATCHES = [
  OPERATOR_STEER_TARGET_KINDS.slice(0, 6),
  OPERATOR_STEER_TARGET_KINDS.slice(6),
] as const

describe("task session operator steer route", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  function seedTask(input: { taskID: string; rootID: string; now: number; active?: boolean }) {
    Database.use((db) =>
      db
        .insert(EngineTaskTable)
        .values({
          id: input.taskID,
          project_id: Instance.project.id,
          session_id: input.rootID,
          source: "panel",
          title: "operator steer",
          request: "operator steer",
          kind: "workflow",
          priority: "normal",
          time_created: input.now,
          time_updated: input.now,
          time_started: input.active === false ? null : input.now,
        })
        .run(),
    )
  }

  function seedLiveOwner(input: { taskID: string; rootID: string; childID: string; now: number }) {
    const payload = createOrchestratorToolOwnershipPayload({
      taskID: input.taskID,
      orchestratorSessionID: input.rootID,
      orchestratorMessageID: `msg_operator_steer_owner_${input.childID}_${input.now}`,
      toolPartID: `prt_operator_steer_owner_${input.childID}_${input.now}`,
      toolCallID: `cal_operator_steer_owner_${input.childID}_${input.now}`,
      childSessionID: input.childID,
      scope: "task",
      now: input.now,
    })
    insertOrchestratorToolOwnershipArtifact({
      taskID: input.taskID,
      label: "operator-steer-live-owner",
      payload,
      now: input.now,
    })
  }

  async function postSteer(input: { taskID: string; sessionID: string; directory: string; message?: string }) {
    return Server.App().request(
      `/task/${input.taskID}/session/${encodeURIComponent(input.sessionID)}/operator-steer`,
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-opencorvus-directory": input.directory,
        },
        body: JSON.stringify({ message: input.message ?? "Please continue with the corrected constraint." }),
      },
    )
  }

  function queuedCoordinationWakes(taskID: string) {
    return Database.use((db) =>
      db
        .select()
        .from(EngineArtifactTable)
        .where(and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "queued_operator_wake")))
        .all(),
    )
  }

  function installRuntimeContract(input: { taskID: string; sessionID: string; kind: OperatorSteerTargetKind }) {
    const descriptor = WorkerTurnDescriptor.create({
      sessionID: input.sessionID,
      payload: {
        agent: input.kind,
        roleContractID: input.kind,
        model: { providerID: "test-provider", modelID: "test-model" },
        prompt: { rawSystemPrompt: false },
        tools: { enabled: ["request_orchestrator_decision"] },
        output: { format: "text", resultMode: "reply" },
        workflow: {
          taskID: input.taskID,
          sessionKind: input.kind,
        },
      },
    })
    SessionPrompt.setSessionRuntimeContract(input.sessionID, {
      identity: {
        sessionID: input.sessionID,
        agentKind: input.kind,
        contractKind: "stage-attempt",
        workerTurnDescriptorID: descriptor.id,
        workerTurnDescriptorHash: descriptor.hash,
        installedAt: Date.now(),
      },
      tools: {
        request_orchestrator_decision: {} as never,
      },
      structuredOutputGuard: () => undefined,
    })
  }

  test("accepted build steer creates one operator coordination request without root or child message fallback", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "operator steer root" })
        const build = await Session.create({ kind: "build", parentID: root.id, title: "operator steer build" })
        seedTask({ taskID, rootID: root.id, now, active: true })
        seedLiveOwner({ taskID, rootID: root.id, childID: build.id, now })

        const rootMessagesBefore = await Session.messages({ sessionID: root.id })
        const childMessagesBefore = await Session.messages({ sessionID: build.id })

        const response = await postSteer({
          taskID,
          sessionID: build.id,
          directory: tmp.path,
          message: "Use the new API contract and do not write a root message.",
        })

        expect(response.status).toBe(202)
        const body = (await response.json()) as {
          task_id?: string
          session_id?: string
          request_id?: string
          wake_status?: string
        }
        expect(body).toMatchObject({
          task_id: taskID,
          session_id: build.id,
          wake_status: "queued",
        })
        expect(body.request_id).toMatch(/^art_/)

        const pending = listPendingAgentCoordinationRequests(taskID)
        expect(pending).toHaveLength(1)
        expect(pending[0]!.payload).toMatchObject({
          request_id: body.request_id,
          task_id: taskID,
          session_id: build.id,
          agent: "build",
          origin: "operator_steer",
          operator_steer_id: body.request_id,
          operator_message: "Use the new API contract and do not write a root message.",
          requested_decision: "operator_steer",
          status: "pending",
        })
        expect(pending[0]!.payload.message_id).toBeUndefined()

        expect(await Session.messages({ sessionID: root.id })).toHaveLength(rootMessagesBefore.length)
        expect(await Session.messages({ sessionID: build.id })).toHaveLength(childMessagesBefore.length)

        const wakes = queuedCoordinationWakes(taskID).filter(
          (wake) =>
            (wake.payload as { source_kind?: string; request_id?: string }).source_kind === "coordination_request" &&
            (wake.payload as { request_id?: string }).request_id === body.request_id,
        )
        expect(wakes).toHaveLength(1)
        expect(wakes[0]!.payload).toMatchObject({
          source_kind: "coordination_request",
          request_id: body.request_id,
          task_id: taskID,
        })
      },
    })
  })

  async function expectKindsUseOperatorSteerSemanticEntry(kinds: readonly OperatorSteerTargetKind[]) {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "operator steer coverage root" })
        seedTask({ taskID, rootID: root.id, now, active: true })

        const requestIDs: string[] = []
        const wakeStatuses: string[] = []
        const dispatchEvents: unknown[] = []
        for (const [index, kind] of kinds.entries()) {
          const session = await Session.create({ kind, parentID: root.id, title: `${kind} operator steer target` })
          installRuntimeContract({ taskID, sessionID: session.id, kind })

          const body = await EngineService.operatorSteerAgentSession(
            taskID,
            session.id,
            { message: `Targeted operator steer for ${kind}` },
            async (event) => {
              dispatchEvents.push(event)
              return "queued" as const
            },
          )
          expect(body.session_id).toBe(session.id)
          expect(body.request_id).toMatch(/^art_/)
          expect(body.wake_status).toBe("queued")
          requestIDs.push(body.request_id!)
          wakeStatuses.push(body.wake_status!)
        }

        const pending = listPendingAgentCoordinationRequests(taskID)
        expect(pending).toHaveLength(kinds.length)
        const pendingByID = new Map(pending.map((request) => [request.payload.request_id, request]))
        for (const [index, kind] of kinds.entries()) {
          const request = pendingByID.get(requestIDs[index]!)
          expect(request?.payload).toMatchObject({
            task_id: taskID,
            agent: kind,
            origin: "operator_steer",
            operator_steer_id: requestIDs[index],
            operator_message: `Targeted operator steer for ${kind}`,
            requested_decision: "operator_steer",
            status: "pending",
          })
          expect(request?.payload.message_id).toBeUndefined()
        }
        expect(wakeStatuses).toHaveLength(kinds.length)
        expect(dispatchEvents).toHaveLength(kinds.length)
        for (const [index, event] of dispatchEvents.entries()) {
          expect(event).toMatchObject({
            taskID,
            event: {
              coordinationRequest: { requestID: requestIDs[index] },
            },
          })
          expect((event as { event?: { note?: unknown } }).event).not.toHaveProperty("note")
        }
      },
    })
  }

  for (const [index, kinds] of OPERATOR_STEER_TARGET_KIND_BATCHES.entries()) {
    test(`current sub-agent kind batch ${index + 1} uses the same operator steer semantic entry`, async () => {
      await expectKindsUseOperatorSteerSemanticEntry(kinds)
    })
  }

  test("operator-origin request is consumable by the coordination response and action chain", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "operator response root" })
        const architect = await Session.create({ kind: "architect", parentID: root.id, title: "architect target" })
        seedTask({ taskID, rootID: root.id, now, active: true })
        seedLiveOwner({ taskID, rootID: root.id, childID: architect.id, now })
        installRuntimeContract({ taskID, sessionID: architect.id, kind: "architect" })

        const steer = await postSteer({
          taskID,
          sessionID: architect.id,
          directory: tmp.path,
          message: "Stop this architect attempt and redispatch visibly.",
        })
        expect(steer.status).toBe(202)
        const steerBody = (await steer.json()) as { request_id?: string }
        expect(steerBody.request_id).toMatch(/^art_/)

        const response = await createAgentCoordinationResponse({
          taskID,
          requestID: steerBody.request_id!,
          orchestratorSessionID: root.id,
          orchestratorMessageID: "msg_operator_steer_response",
          orchestratorToolCallID: "call_operator_steer_response",
          orchestratorToolPartID: "part_operator_steer_response",
          decision: "cancel_worker",
          reason: "Operator steer requires visible orchestrator-owned cancellation.",
          now: now + 10,
        })

        expect(findAgentCoordinationRequest({ taskID, requestID: steerBody.request_id! })?.payload).toMatchObject({
          request_id: steerBody.request_id,
          origin: "operator_steer",
          operator_message: "Stop this architect attempt and redispatch visibly.",
          status: "responded",
          response_id: response.payload.response_id,
        })
        expect(listAgentCoordinationResponses(taskID).map((row) => row.payload)).toContainEqual(
          expect.objectContaining({
            request_id: steerBody.request_id,
            decision: "cancel_worker",
            reason: "Operator steer requires visible orchestrator-owned cancellation.",
          }),
        )
        expect(listAgentCoordinationActions(taskID).map((row) => row.payload)).toContainEqual(
          expect.objectContaining({
            request_id: steerBody.request_id,
            decision: "cancel_worker",
            action: "cancel_worker",
            target_session_id: architect.id,
            target_agent: "architect",
            status: "pending",
          }),
        )
      },
    })
  })

  test("pending coordination rejects operator steer without creating a duplicate request", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "pending steer root" })
        const worker = await Session.create({ kind: "requirements", parentID: root.id, title: "pending steer worker" })
        seedTask({ taskID, rootID: root.id, now, active: false })
        const existing = await createAgentCoordinationRequest({
          taskID,
          sessionID: worker.id,
          agent: "requirements",
          messageID: "msg_existing_pending_operator_steer",
          summary: "Existing request",
          details: "The worker already asked for a decision.",
          blocking: true,
          requestedDecision: "continue",
          now,
        })

        const response = await postSteer({ taskID, sessionID: worker.id, directory: tmp.path })

        expect(response.status).toBe(409)
        const body = (await response.json()) as { name?: string; data?: { requestIDs?: string[] } }
        expect(body.name).toBe("AgentSessionPendingCoordinationError")
        expect(body.data?.requestIDs).toEqual([existing.payload.request_id])
        await expect(
          createOperatorSteerCoordinationRequest({
            taskID,
            sessionID: worker.id,
            agent: "requirements",
            operatorMessage: "Concurrent operator steer should not create a duplicate pending request.",
          }),
        ).rejects.toBeInstanceOf(AgentCoordinationPendingConflictError)
        expect(listPendingAgentCoordinationRequests(taskID).map((request) => request.payload.request_id)).toEqual([
          existing.payload.request_id,
        ])
        expect(queuedCoordinationWakes(taskID)).toHaveLength(0)
      },
    })
  })

  test("operator steer request body rejects hidden target fields before writing artifacts", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "strict steer root" })
        const worker = await Session.create({ kind: "requirements", parentID: root.id, title: "strict worker" })
        seedTask({ taskID, rootID: root.id, now, active: false })

        const response = await Server.App().request(
          `/task/${taskID}/session/${encodeURIComponent(worker.id)}/operator-steer`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "x-opencorvus-directory": tmp.path,
            },
            body: JSON.stringify({
              message: "This must not hide legacy target fields.",
              target: { kind: "build_session", sessionID: worker.id },
              source: "overlay_build_steer",
            }),
          },
        )

        expect(response.status).toBe(400)
        expect(await response.json()).toMatchObject({
          success: false,
          error: [expect.objectContaining({ code: "unrecognized_keys", keys: ["target", "source"] })],
        })
        expect(listPendingAgentCoordinationRequests(taskID)).toHaveLength(0)
        expect(queuedCoordinationWakes(taskID)).toHaveLength(0)
      },
    })
  })

  test("dispatch failure cancels operator request and discards persisted coordination wake", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "dispatch failure root" })
        const worker = await Session.create({ kind: "requirements", parentID: root.id, title: "dispatch failure worker" })
        seedTask({ taskID, rootID: root.id, now, active: false })

        await expect(
          EngineService.operatorSteerAgentSession(
            taskID,
            worker.id,
            { message: "Record and then fail the wake path." },
            async (dispatchInput) => {
              const requestID = dispatchInput.event?.coordinationRequest?.requestID
              expect(requestID).toMatch(/^art_/)
              Database.use((db) =>
                db
                  .insert(EngineArtifactTable)
                  .values({
                    id: Identifier.ascending("artifact"),
                    task_id: taskID,
                    run_id: null,
                    goal_run_id: null,
                    acceptance_id: null,
                    kind: "queued_operator_wake",
                    label: "pending",
                    payload: {
                      wake_id: requestID,
                      task_id: taskID,
                      request_id: requestID,
                      source_kind: "coordination_request",
                      event: dispatchInput.event,
                      time_queued: now,
                      queued_by_process_id: process.pid,
                    },
                    time_created: now,
                    time_updated: now,
                  })
                  .run(),
              )
              throw new Error("advanceQueue failed after wake persisted")
            },
          ),
        ).rejects.toThrow("advanceQueue failed after wake persisted")

        const requests = Database.use((db) =>
          db
            .select()
            .from(EngineArtifactTable)
            .where(
              and(eq(EngineArtifactTable.task_id, taskID), eq(EngineArtifactTable.kind, "agent_coordination_request")),
            )
            .all(),
        )
        expect(requests).toHaveLength(1)
        expect(requests[0]!.label).toBe("cancelled")
        expect(requests[0]!.payload).toMatchObject({
          status: "cancelled",
          cancel_reason: expect.stringContaining("advanceQueue failed after wake persisted"),
        })
        expect(listPendingAgentCoordinationRequests(taskID)).toHaveLength(0)
        expect(queuedCoordinationWakes(taskID)).toContainEqual(
          expect.objectContaining({
            label: "discarded",
            payload: expect.objectContaining({ source_kind: "coordination_request" }),
          }),
        )
      },
    })
  })

  test("persisted terminal target rejects operator steer without writing coordination artifacts", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "terminal steer root" })
        const worker = await Session.create({ kind: "requirements", parentID: root.id, title: "terminal worker" })
        seedTask({ taskID, rootID: root.id, now, active: false })
        const orderKey = sessionLifecycleOrderKey(worker.id)
        Database.use((db) =>
          db
            .insert(ProtocolEventTable)
            .values({
              id: Identifier.ascending("protocol_event"),
              kind: "event",
              type: "session.status",
              aggregate_type: "session",
              aggregate_id: worker.id,
              task_id: taskID,
              session_id: worker.id,
              source: "session",
              target: "task",
              seq: 1,
              order_key: orderKey,
              emitted_at: now + 1,
              payload: {
                sessionID: worker.id,
                orderKey,
                status: { type: "terminal", reason: "completed" },
              },
              time_created: now + 1,
              time_updated: now + 1,
            })
            .run(),
        )

        const response = await postSteer({ taskID, sessionID: worker.id, directory: tmp.path })

        expect(response.status).toBe(410)
        expect(await response.json()).toMatchObject({
          name: "SessionRuntimeContractMissingError",
          data: {
            sessionID: worker.id,
            agentKind: "requirements",
            reason: "terminal_satisfied",
          },
        })
        expect(listPendingAgentCoordinationRequests(taskID)).toHaveLength(0)
        expect(queuedCoordinationWakes(taskID)).toHaveLength(0)
      },
    })
  })

  test("root and invalid-kind sessions fail before writing coordination artifacts", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const taskID = Identifier.ascending("task")
        const root = await Session.create({ kind: "root", title: "invalid steer root" })
        const executor = await Session.create({ kind: "executor", parentID: root.id, title: "executor" })
        seedTask({ taskID, rootID: root.id, now, active: false })

        const rootResponse = await postSteer({ taskID, sessionID: root.id, directory: tmp.path })
        expect(rootResponse.status).toBe(400)
        expect(await rootResponse.json()).toMatchObject({
          name: "OperatorSteerTargetError",
          data: { reason: "task_root", taskID, sessionID: root.id },
        })

        const executorResponse = await postSteer({ taskID, sessionID: executor.id, directory: tmp.path })
        expect(executorResponse.status).toBe(400)
        expect(await executorResponse.json()).toMatchObject({
          name: "OperatorSteerTargetError",
          data: { reason: "invalid_kind", taskID, sessionID: executor.id },
        })

        expect(listPendingAgentCoordinationRequests(taskID)).toHaveLength(0)
        expect(queuedCoordinationWakes(taskID)).toHaveLength(0)
      },
    })
  })

  test("foreign sessions fail before writing coordination artifacts", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test-provider/test-model" } })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const firstTaskID = Identifier.ascending("task")
        const secondTaskID = Identifier.ascending("task")
        const firstRoot = await Session.create({ kind: "root", title: "first root" })
        const secondRoot = await Session.create({ kind: "root", title: "second root" })
        const foreignWorker = await Session.create({
          kind: "frontend-research",
          parentID: firstRoot.id,
          title: "foreign worker",
        })
        seedTask({ taskID: firstTaskID, rootID: firstRoot.id, now, active: false })
        seedTask({ taskID: secondTaskID, rootID: secondRoot.id, now, active: false })

        const foreignResponse = await postSteer({ taskID: secondTaskID, sessionID: foreignWorker.id, directory: tmp.path })
        expect(foreignResponse.status).toBe(400)
        expect(await foreignResponse.json()).toMatchObject({
          name: "OperatorSteerTargetError",
          data: { reason: "foreign_task", taskID: secondTaskID, sessionID: foreignWorker.id },
        })

        expect(listPendingAgentCoordinationRequests(firstTaskID)).toHaveLength(0)
        expect(listPendingAgentCoordinationRequests(secondTaskID)).toHaveLength(0)
        expect(queuedCoordinationWakes(firstTaskID)).toHaveLength(0)
        expect(queuedCoordinationWakes(secondTaskID)).toHaveLength(0)
      },
    })
  })
})
