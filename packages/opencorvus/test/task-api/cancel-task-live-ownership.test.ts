import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import {
  createOrchestratorToolOwnershipPayload,
  insertOrchestratorToolOwnershipArtifact,
  listLiveOrchestratorToolOwnership,
} from "../../src/engine/tool-ownership"
import { createAgentCoordinationRequest, findAgentCoordinationRequest } from "../../src/engine/agent-coordination"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { TaskQueueTable } from "../../src/scheduler/task-queue.sql"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { SessionPrompt } from "../../src/session/prompt"
import { SessionPromptState } from "../../src/session/prompt/state"
import { SessionStatus } from "../../src/session/status"
import { Database, eq } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

afterEach(async () => {
  mock.restore()
  await Instance.disposeAll()
  await resetDatabase()
})

describe("cancelTask live orchestrator ownership cleanup", () => {
  test("closes owned tool execution without ambient Instance context", async () => {
    await using tmp = await tmpdir({ git: true })
    const now = Date.now()
    const taskID = Identifier.ascending("task")
    let messageID = ""
    let partID = ""
    let childID = ""
    let queueTaskID = ""
    let coordinationRequestID = ""
    let descendantID = ""
    let descendantAbort: AbortSignal | undefined

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ kind: "root", title: "cancel root" })
        const orchestrator = await Session.create({
          kind: "orchestrator",
          parentID: root.id,
          title: "cancel orchestrator",
        })
        const child = await Session.create({
          kind: "frontend-research",
          title: "cancel child",
        })
        childID = child.id
        queueTaskID = Identifier.ascending("task")
        const descendant = await Session.create({
          kind: "frontend-research",
          parentID: child.id,
          title: "cancel descendant",
        })
        descendantID = descendant.id
        descendantAbort = SessionPromptState.start(descendant.id, tmp.path)
        expect(descendantAbort).toBeDefined()
        SessionStatus.set(descendant.id, { type: "streaming" }, { publish: false })
        messageID = Identifier.ascending("message")
        partID = Identifier.ascending("part")

        await Session.updateMessage({
          id: messageID,
          sessionID: orchestrator.id,
          role: "assistant",
          time: { created: now },
          parentID: Identifier.ascending("message"),
          agent: "orchestrator",
          providerID: "test",
          modelID: "model",
          path: { cwd: tmp.path, root: tmp.path },
          cost: 0,
          tokens: {
            input: 0,
            output: 0,
            reasoning: 0,
            total: 0,
            cache: { read: 0, write: 0 },
          },
        })
        await Session.updatePart({
          id: partID,
          messageID,
          sessionID: orchestrator.id,
          type: "tool",
          callID: "call_cancel_live_ownership",
          tool: "frontend_research",
          state: {
            status: "running",
            input: {},
            time: { start: now },
          },
        })

        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              session_id: root.id,
              source: "test",
              title: "cancel live ownership",
              request: "cancel live ownership",
              priority: "normal",
              time_started: now,
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const ownership = createOrchestratorToolOwnershipPayload({
          taskID,
          orchestratorSessionID: orchestrator.id,
          orchestratorMessageID: messageID,
          toolCallID: "call_cancel_live_ownership",
          toolPartID: partID,
          childSessionID: childID,
          toolName: "build",
          scope: "task",
          now,
        })
        insertOrchestratorToolOwnershipArtifact({
          taskID,
          label: "tool-ownership-start",
          payload: ownership,
          now,
        })
        Database.use((db) =>
          db
            .insert(TaskQueueTable)
            .values({
              id: queueTaskID,
              session_id: childID,
              prompt: "queued detached child prompt",
              priority: "normal",
              status: "queued",
              source: "test",
              metadata: {
                kind: "session_prompt",
                input: { parts: [{ type: "text", text: "queued detached child prompt" }] },
              },
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
        const request = await createAgentCoordinationRequest({
          taskID,
          sessionID: childID,
          agent: "frontend-research",
          messageID: Identifier.ascending("message"),
          summary: "child needs cancellation",
          details: "task cancellation must cancel pending worker coordination",
          blocking: true,
          requestedDecision: "cancel",
        })
        coordinationRequestID = request.payload.request_id
      },
    })

    expect(Instance.current()).toBeUndefined()
    expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(1)

    const cancelled: string[] = []
    spyOn(SessionPrompt, "cancel").mockImplementation((sessionID, directory) => {
      const result = SessionPromptState.cancel(sessionID, directory)
      if (result) cancelled.push(sessionID)
      if (sessionID === descendantID && descendantAbort) {
        queueMicrotask(() => SessionPromptState.finish(sessionID, descendantAbort!, directory))
      }
      return result
    })

    await EngineService.cancelTask(taskID)

    expect(cancelled).toContain(descendantID)
    expect(SessionPromptState.isActive(descendantID, tmp.path)).toBe(false)
    expect(listLiveOrchestratorToolOwnership(taskID)).toHaveLength(0)
    const queueRow = Database.use((db) =>
      db.select().from(TaskQueueTable).where(eq(TaskQueueTable.id, queueTaskID)).get(),
    )
    expect(queueRow?.status).toBe("failed")
    expect(queueRow?.error_message).toBe("task cancelled")
    expect(findAgentCoordinationRequest({ taskID, requestID: coordinationRequestID })?.payload.status).toBe("cancelled")
    const part = (await Message.parts(messageID)).find((item) => item.id === partID)
    expect(part?.type).toBe("tool")
    if (part?.type !== "tool") throw new Error("expected tool part")
    expect(part.state.status).toBe("error")
    if (part.state.status !== "error") throw new Error("expected errored tool part")
    expect(part.state.failure.message).toBe("task cancelled")
    expect(part.state.failure.originSite).toBe("task-api.cancel-task")

    const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
    expect(task?.time_completed).toBeNumber()
    expect(task?.error).toBe("task cancelled")
    const lifecycleReport = createDecisionLog(taskID).readByKey("agent_lifecycle_report")
    expect(lifecycleReport).toBeDefined()
    const lifecycleValue = JSON.parse(lifecycleReport!.value) as {
      sessionIDs: string[]
      queuedPromptCancellations: number
      pendingCoordinationRequestsCancelled: number
    }
    expect(lifecycleValue.sessionIDs).toContain(childID)
    expect(lifecycleValue.queuedPromptCancellations).toBe(1)
    expect(lifecycleValue.pendingCoordinationRequestsCancelled).toBe(1)
  })
})
