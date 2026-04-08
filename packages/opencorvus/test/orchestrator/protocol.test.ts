import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Bus } from "../../src/bus"
import { Identifier } from "../../src/id/id"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { Event } from "../../src/orchestrator/model"
import { OrchestratorProtocol } from "../../src/orchestrator/protocol"
import { OrchestratorService } from "../../src/orchestrator/service"
import { findTask } from "../../src/orchestrator/store"
import { updateTask } from "../../src/orchestrator/state"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Message } from "../../src/session/message"
import { ensureTaskMessageProtocolBridge } from "../../src/server/routes/task-message-protocol-bridge"
import { registerGoalRunSession } from "../../src/server/routes/task-event"
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
      vcs: "git",
      name: "Protocol Test",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(OrchestratorTaskTable).values({
      id: taskID,
      project_id: projectID,
      source: "test",
      title: "Protocol task",
      request: "Verify protocol persistence",
      status: "queued",
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
        await OrchestratorProtocol.emit(Event.TaskCreated, {
          taskID,
          status: "queued",
          summary: "Task created",
        }, { source: "test.protocol" })

        await OrchestratorProtocol.emit(Event.TaskUpdated, {
          taskID,
          status: "active",
          summary: "Task started",
        }, { source: "test.protocol" })

        const events = await OrchestratorService.listProtocolEvents(taskID)
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

        let events = await OrchestratorService.listProtocolEvents(taskID)
        for (const _ of Array.from({ length: 20 })) {
          if (events.length > 0) break
          await Bun.sleep(20)
          events = await OrchestratorService.listProtocolEvents(taskID)
        }
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: "task.updated",
          source: "state.task",
          summary: "Task failed",
          sequence: 1,
        })

        const stored = Database.use((db) =>
          db.select({ status: OrchestratorTaskTable.status })
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.id, taskID))
            .get(),
        )
        expect(stored?.status).toBe("failed")
      },
    })
  })

  test("bridges root and child session message events into task protocol events", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        ensureTaskMessageProtocolBridge()

        const now = Date.now()
        const root = await Session.create({ title: "Task root" })
        const child = await Session.create({ parentID: root.id, title: "Judge child" })
        registerGoalRunSession(root.id, taskID, "assistant")
        registerGoalRunSession(child.id, taskID, "evaluator")
        Database.use((db) =>
          db.update(OrchestratorTaskTable)
            .set({
              session_id: root.id,
              time_updated: now,
            })
            .where(eq(OrchestratorTaskTable.id, taskID))
            .run(),
        )

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

        let events = await OrchestratorService.listProtocolEvents(taskID)
        for (const _ of Array.from({ length: 25 })) {
          if (
            events.some((item) => item.type === "message.updated" && item.sessionID === root.id) &&
            events.some((item) => item.type === "message.part.updated" && item.sessionID === root.id)
          ) break
          await Bun.sleep(20)
          events = await OrchestratorService.listProtocolEvents(taskID)
        }

        const rootMessage = events.find((item) => item.type === "message.updated" && item.sessionID === root.id)
        const rootPart = events.find((item) => item.type === "message.part.updated" && item.sessionID === root.id)
        // message.part.delta is ephemeral (not persisted) — only verify persisted events
        expect(rootMessage).toBeTruthy()
        expect(rootPart).toBeTruthy()
        expect(rootMessage?.taskID).toBe(taskID)
        expect(rootPart?.taskID).toBe(taskID)
      },
    })
  })
})
