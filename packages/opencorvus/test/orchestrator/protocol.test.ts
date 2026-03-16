import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database, eq } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { OrchestratorTaskTable } from "../../src/orchestrator/orchestrator.sql"
import { Event } from "../../src/orchestrator/model"
import { OrchestratorProtocol } from "../../src/orchestrator/protocol"
import { OrchestratorService } from "../../src/orchestrator/service"
import { findTask } from "../../src/orchestrator/store"
import { updateTask } from "../../src/orchestrator/state"
import { Instance } from "../../src/project/instance"
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
          status: "running",
          summary: "Task started",
        }, { source: "test.protocol" })

        const events = await OrchestratorService.listProtocolEvents(taskID)
        expect(events).toHaveLength(2)
        expect(events.map((item) => item.sequence)).toEqual([1, 2])
        expect(events.map((item) => item.type)).toEqual([
          "orchestrator.task.created",
          "orchestrator.task.updated",
        ])
        expect(events.map((item) => item.source)).toEqual([
          "test.protocol",
          "test.protocol",
        ])
        expect(events[1]?.payload).toMatchObject({
          taskID,
          status: "running",
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
          status: "blocked",
          blocking_reason: "waiting",
        }, "Task blocked")

        let events = await OrchestratorService.listProtocolEvents(taskID)
        for (const _ of Array.from({ length: 20 })) {
          if (events.length > 0) break
          await Bun.sleep(20)
          events = await OrchestratorService.listProtocolEvents(taskID)
        }
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({
          type: "orchestrator.task.updated",
          source: "state.task",
          summary: "Task blocked",
          sequence: 1,
        })

        const stored = Database.use((db) =>
          db.select({ status: OrchestratorTaskTable.status })
            .from(OrchestratorTaskTable)
            .where(eq(OrchestratorTaskTable.id, taskID))
            .get(),
        )
        expect(stored?.status).toBe("blocked")
      },
    })
  })
})
