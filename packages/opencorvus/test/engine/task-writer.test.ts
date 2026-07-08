import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import {
  deleteEngineTask,
  deleteEngineTasksForProjectSessions,
  insertEngineTask,
  mergeEngineTaskMetadata,
  setEngineTaskBudget,
  setEngineTaskMetadata,
  setEngineTaskTitle,
  touchEngineTask,
} from "../../src/engine/task"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let tmp: Awaited<ReturnType<typeof tmpdir>>
let taskID = ""

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "task writer" })
      taskID = Identifier.ascending("task")
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: root.id,
            source: "test",
            title: "task writer",
            request: "Verify task writer.",
            priority: "normal",
            metadata: { existing: true },
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
    },
  })
})

afterEach(async () => {
  await Instance.disposeAll()
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

describe("engine task writer", () => {
  test("inserts task creation rows through the task writer", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const root = await Session.create({ kind: "root", title: "insert task writer" })
        const insertedTaskID = Identifier.ascending("task")
        const now = Date.now()

        Database.transaction((db) =>
          insertEngineTask(db, {
            taskID: insertedTaskID,
            projectID: Instance.project.id,
            sessionID: root.id,
            requestID: "req_task_writer_insert",
            source: "api",
            title: "insert task writer",
            request: "Verify task insertion.",
            attachments: [{ sha: "sha_task_writer", url: "blob://task-writer", mime: "text/plain", size: 4 }],
            executor: "codex",
            kind: "workflow",
            priority: "high",
            queueOrder: 1_000_000_000_123,
            budget: { tokens: 1000 },
            metadata: { inserted: true },
            timeStarted: null,
            timeCreated: now,
            timeUpdated: now + 1,
          }),
        )

        const row = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, insertedTaskID)).get(),
        )
        expect(row).toMatchObject({
          id: insertedTaskID,
          project_id: Instance.project.id,
          session_id: root.id,
          request_id: "req_task_writer_insert",
          source: "api",
          title: "insert task writer",
          request: "Verify task insertion.",
          attachments: [{ sha: "sha_task_writer", url: "blob://task-writer", mime: "text/plain", size: 4 }],
          executor: "codex",
          kind: "workflow",
          priority: "high",
          queue_order: 1_000_000_000_123,
          budget: { tokens: 1000 },
          metadata: { inserted: true },
          time_started: null,
          time_created: now,
          time_updated: now + 1,
        })
      },
    })
  })

  test("touches task timestamps and merges metadata patches", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        Database.transaction((db) => touchEngineTask(db, { taskID, timeUpdated: now + 1 }))
        let row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row).toMatchObject({
          id: taskID,
          metadata: { existing: true },
          time_updated: now + 1,
        })

        const metadata = Database.transaction((db) =>
          mergeEngineTaskMetadata(db, {
            taskID,
            metadata: { architect_fidelity: { sourceCoverage: ["REQ-1"] } },
            timeUpdated: now + 2,
          }),
        )
        expect(metadata).toEqual({
          existing: true,
          architect_fidelity: { sourceCoverage: ["REQ-1"] },
        })
        row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row).toMatchObject({
          id: taskID,
          metadata,
          time_updated: now + 2,
        })

        Database.transaction((db) =>
          setEngineTaskMetadata(db, {
            taskID,
            metadata: { checks: { lint: false } },
            timeUpdated: now + 3,
          }),
        )
        row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row).toMatchObject({
          id: taskID,
          metadata: { checks: { lint: false } },
          time_updated: now + 3,
        })
      },
    })
  })

  test("updates task editable fields and deletes task rows through the task writer", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        Database.transaction((db) => {
          setEngineTaskTitle(db, { taskID, title: "renamed task writer" })
          setEngineTaskBudget(db, { taskID, budget: { tokens: 2500 } })
        })
        let row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row).toMatchObject({
          id: taskID,
          title: "renamed task writer",
          budget: { tokens: 2500 },
        })

        Database.transaction((db) => deleteEngineTask(db, { taskID }))
        row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row).toBeUndefined()
      },
    })
  })

  test("deletes task rows for a project session set through the task writer", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const firstRoot = await Session.create({ kind: "root", title: "batch delete first" })
        const secondRoot = await Session.create({ kind: "root", title: "batch delete second" })
        const firstTaskID = Identifier.ascending("task")
        const secondTaskID = Identifier.ascending("task")
        const now = Date.now()
        Database.transaction((db) => {
          for (const item of [
            { taskID: firstTaskID, sessionID: firstRoot.id },
            { taskID: secondTaskID, sessionID: secondRoot.id },
          ]) {
            insertEngineTask(db, {
              taskID: item.taskID,
              projectID: Instance.project.id,
              sessionID: item.sessionID,
              source: "test",
              title: "batch delete task writer",
              request: "Verify batch task deletion.",
              executor: "codex",
              kind: "workflow",
              priority: "normal",
              queueOrder: now,
              metadata: {},
              timeStarted: null,
              timeCreated: now,
              timeUpdated: now,
            })
          }
          deleteEngineTasksForProjectSessions(db, { projectID: Instance.project.id, sessionIDs: [firstRoot.id] })
        })
        const first = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, firstTaskID)).get())
        const second = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, secondTaskID)).get(),
        )
        expect(first).toBeUndefined()
        expect(second).toMatchObject({ id: secondTaskID, session_id: secondRoot.id })
      },
    })
  })
})
