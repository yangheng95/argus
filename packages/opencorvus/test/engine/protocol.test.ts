import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Identifier } from "../../src/id/id"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Event } from "../../src/engine/model"
import { EngineProtocol } from "../../src/engine/protocol"
import { EngineService } from "@/task-api"
import { ProtocolStore } from "../../src/protocol/store"
import { findTask } from "../../src/engine/store"
import { updateTask } from "../../src/engine/state"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { ensureTaskMessageProtocolBridge } from "../../src/orchestrator/protocol/message-bridge"
import { SessionStatus } from "../../src/session/status"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let projectID = ""
let taskID = ""
let tmp: Awaited<ReturnType<typeof tmpdir>>

function seedTask() {
  const now = Date.now()
  Database.use((db) =>
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: process.cwd(),
      name: "Protocol Test",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EngineTaskTable).values({
      id: taskID,
      project_id: projectID,
      source: "test",
      title: "Protocol task",
      request: "Verify protocol persistence",
      priority: "normal",
      time_created: now,
      time_updated: now,
    }).run(),
  )
}

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir()
  projectID = `project_protocol_${Date.now()}`
  taskID = `tsk_${Date.now().toString(16)}ProtocolTest`
  seedTask()
})

afterEach(async () => {
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

describe("orchestrator protocol", () => {
  test("persists emitted control-plane events in task order", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await EngineProtocol.emit(Event.TaskCreated, {
          taskID,
          status: "queued",
          summary: "Task created",
        }, { source: "test.protocol" })

        await EngineProtocol.emit(Event.TaskUpdated, {
          taskID,
          status: "active",
          summary: "Task started",
        }, { source: "test.protocol" })

        const events = await EngineService.listProtocolEvents(taskID)
        expect(events).toHaveLength(2)
        expect(events.map((item) => item.sequence)).toEqual([1, 2])
        expect(events.map((item) => item.type)).toEqual([
          "task.created",
          "task.updated",
        ])
        expect(events.map((item) => item.source)).toEqual([
          "test.protocol",
          "test.protocol",
        ])
        expect(events[1]?.payload).toMatchObject({
          taskID,
          status: "active",
          summary: "Task started",
        })
      },
    })
  })

  test("records protocol messages for state-driven updates", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const row = findTask(taskID)
        if (!row) throw new Error("missing seeded task")

        await updateTask(row, {
          status: "failed",
          error: "something went wrong",
        }, "Task failed")

        let events = await EngineService.listProtocolEvents(taskID)
        for (const _ of Array.from({ length: 20 })) {
          if (events.length > 0) break
          await Bun.sleep(20)
          events = await EngineService.listProtocolEvents(taskID)
        }
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: "task.updated",
          source: "state.task",
          summary: "Task failed",
          sequence: 1,
        })

        // Phase-6-f-2: task.status column deleted; derive status from
        // time_completed + error per engine/task-status.ts.
        const stored = findTask(taskID)
        const { deriveTaskStatus } = await import("../../src/engine/task-status")
        expect(stored ? deriveTaskStatus(stored) : undefined).toBe("failed")
      },
    })
  })

  test("bridges root and child session message events into task protocol events", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureTaskMessageProtocolBridge()

        const now = Date.now()
        // Authoritative session role lives in `session.kind`; bridge reads
        // it via sessionRole() = SELECT kind. No registry write needed.
        const root = await Session.create({ kind: "root", title: "Task root" })
        const child = await Session.create({ kind: "evaluator", parentID: root.id, title: "Judge child" })
        Database.use((db) =>
          db.update(EngineTaskTable)
            .set({
              session_id: root.id,
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )

        const liveEvents: Array<{
          type: string
          sessionID?: string
          payload?: Record<string, unknown>
        }> = []
        const stop = ProtocolStore.subscribeEvents((event) => {
          liveEvents.push({
            type: event.type,
            sessionID: event.sessionID,
            payload: event.payload,
          })
        }, { aggregate: "task", taskID })

        const rootMessageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: rootMessageID,
          sessionID: root.id,
          role: "user",
          time: { created: now },
          agent: "planner",
          model: { providerID: "test", modelID: "test" },
        } satisfies Message.User)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          sessionID: root.id,
          messageID: rootMessageID,
          type: "text",
          text: "planner output",
        } satisfies Message.TextPart)

        const childMessageID = Identifier.ascending("message")
        await Session.updateMessage({
          id: childMessageID,
          sessionID: child.id,
          role: "user",
          time: { created: now + 2 },
          agent: "judge",
          model: { providerID: "test", modelID: "test" },
        } satisfies Message.User)
        await Bus.publish(Message.Event.PartDelta, {
          sessionID: child.id,
          messageID: childMessageID,
          partID: Identifier.ascending("part"),
          field: "text",
          delta: "judge delta",
        })

        for (const _ of Array.from({ length: 25 })) {
          if (
            liveEvents.some((item) => item.type === "message.updated" && item.sessionID === root.id) &&
            liveEvents.some((item) => item.type === "message.part.updated" && item.sessionID === root.id)
          ) break
          await Bun.sleep(20)
        }
        stop()

        const rootMessage = liveEvents.find((item) => item.type === "message.updated" && item.sessionID === root.id)
        const rootPart = liveEvents.find((item) => item.type === "message.part.updated" && item.sessionID === root.id)
        // message.* events are live-only; reconnect hydrates from message/part tables.
        expect(rootMessage).toBeTruthy()
        expect(rootPart).toBeTruthy()
        expect(rootMessage?.payload).toMatchObject({ channel: "main", resolvedRole: "user" })
        expect(rootPart?.payload).toMatchObject({ channel: "main", resolvedRole: "user" })
        const persisted = await EngineService.listProtocolEvents(taskID)
        expect(persisted.filter((item) => item.type.startsWith("message."))).toEqual([])
      },
    })
  })

  test("bridges session terminal status without message role metadata", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureTaskMessageProtocolBridge()

        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "Task root" })
        const requirements = await Session.create({
          kind: "requirements",
          parentID: root.id,
          title: "Requirements",
        })
        Database.use((db) =>
          db.update(EngineTaskTable)
            .set({
              session_id: root.id,
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )

        SessionStatus.set(requirements.id, { type: "terminal", reason: "completed" })

        let events = await EngineService.listProtocolEvents(taskID)
        for (const _ of Array.from({ length: 25 })) {
          if (events.some((item) => item.type === "session.status" && item.sessionID === requirements.id)) break
          await Bun.sleep(20)
          events = await EngineService.listProtocolEvents(taskID)
        }

        const statusEvent = events.find((item) => item.type === "session.status" && item.sessionID === requirements.id)
        expect(statusEvent).toBeTruthy()
        expect(statusEvent?.payload).toMatchObject({
          sessionID: requirements.id,
          channel: "requirements",
          resolvedRole: "requirements",
          parentSessionID: root.id,
          status: {
            type: "terminal",
            reason: "completed",
          },
        })
      },
    })
  })

  test("preserves saveMessage root user part events instead of dropping them", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureTaskMessageProtocolBridge()

        const now = Date.now()
        const root = await Session.create({ kind: "root", title: "Task root" })
        Database.use((db) =>
          db.update(EngineTaskTable)
            .set({
              session_id: root.id,
              time_updated: now,
            })
            .where(eq(EngineTaskTable.id, taskID))
            .run(),
        )

        const rootMessageID = Identifier.ascending("message")
        const rootPartID = Identifier.ascending("part")
        const rootMessage = {
          id: rootMessageID,
          sessionID: root.id,
          role: "user" as const,
          time: { created: now },
          agent: "planner",
          model: { providerID: "test", modelID: "test" },
        } satisfies Message.User

        const liveEvents: Array<{
          type: string
          sessionID?: string
          payload?: Record<string, any>
        }> = []
        const stop = ProtocolStore.subscribeEvents((event) => {
          liveEvents.push({
            type: event.type,
            sessionID: event.sessionID,
            payload: event.payload as Record<string, any> | undefined,
          })
        }, { aggregate: "task", taskID })

        await Session.saveMessage(rootMessage)
        await Session.updatePart({
          id: rootPartID,
          sessionID: root.id,
          messageID: rootMessageID,
          type: "text",
          text: "root prompt before message.updated",
        } satisfies Message.TextPart)
        await Session.updateMessage(rootMessage)

        for (const _ of Array.from({ length: 25 })) {
          if (
            liveEvents.some((item) => item.type === "message.part.updated" && item.sessionID === root.id) &&
            liveEvents.some((item) => item.type === "message.updated" && item.sessionID === root.id)
          ) break
          await Bun.sleep(20)
        }
        stop()

        const rootEvents = liveEvents.filter((item) => item.sessionID === root.id)
        expect(rootEvents.map((item) => item.type)).toEqual([
          "message.part.updated",
          "message.updated",
        ])

        const partEvent = rootEvents[0]
        expect(partEvent?.payload).toMatchObject({
          resolvedRole: "user",
          channel: "main",
          part: {
            resolvedRole: "user",
            channel: "main",
            messageID: rootMessageID,
          },
        })
      },
    })
  })
})
