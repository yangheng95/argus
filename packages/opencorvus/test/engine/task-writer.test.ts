import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import {
  claimNextEngineTaskForCwd,
  claimQueuedEngineTaskForCwd,
  clearEngineTaskRewindCursor,
  deleteEngineTask,
  deleteEngineTasksForProjectSessions,
  insertEngineTask,
  mergeEngineTaskMetadata,
  setEngineTaskBudget,
  setEngineTaskMetadata,
  setEngineTaskQueueOrder,
  setEngineTaskRewindCursor,
  setEngineTaskTitle,
  touchEngineTask,
  updateEngineTaskState,
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

        const active = Database.transaction((db) =>
          updateEngineTaskState(db, {
            taskID,
            values: { time_started: now + 4 },
            timeUpdated: now + 4,
          }),
        )
        expect(active).toMatchObject({
          id: taskID,
          time_started: now + 4,
          time_updated: now + 4,
        })

        const terminal = Database.transaction((db) =>
          updateEngineTaskState(db, {
            taskID,
            values: { time_completed: now + 5, error: null },
            timeUpdated: now + 5,
            onlyWhenIncomplete: true,
          }),
        )
        expect(terminal).toMatchObject({
          id: taskID,
          time_completed: now + 5,
          time_updated: now + 5,
        })

        const ignored = Database.transaction((db) =>
          updateEngineTaskState(db, {
            taskID,
            values: { error: "late terminal update" },
            timeUpdated: now + 6,
            onlyWhenIncomplete: true,
          }),
        )
        expect(ignored).toBeUndefined()

        Database.transaction((db) =>
          setEngineTaskRewindCursor(db, {
            taskID,
            cursorTime: now + 7,
            anchorEventID: "evt_task_writer_rewind",
            rewindCount: 2,
            timeUpdated: now + 7,
          }),
        )
        row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row).toMatchObject({
          id: taskID,
          rewind_cursor_time: now + 7,
          rewind_cursor_event_id: "evt_task_writer_rewind",
          rewind_count: 2,
          time_updated: now + 7,
        })

        Database.transaction((db) => clearEngineTaskRewindCursor(db, { taskID, timeUpdated: now + 8 }))
        row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
        expect(row).toMatchObject({
          id: taskID,
          rewind_cursor_time: null,
          rewind_cursor_event_id: null,
          rewind_count: 2,
          time_updated: now + 8,
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

  test("updates queued task order and claims queued tasks through the task writer", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const firstRoot = await Session.create({ kind: "root", title: "claim first" })
        const secondRoot = await Session.create({ kind: "root", title: "claim second" })
        const firstTaskID = Identifier.ascending("task")
        const secondTaskID = Identifier.ascending("task")
        const now = Date.now()
        Database.transaction((db) => {
          deleteEngineTask(db, { taskID })
          insertEngineTask(db, {
            taskID: firstTaskID,
            projectID: Instance.project.id,
            sessionID: firstRoot.id,
            source: "test",
            title: "first claim task",
            request: "Verify queue claim.",
            executor: "codex",
            kind: "workflow",
            priority: "normal",
            queueOrder: 0,
            metadata: {},
            timeStarted: null,
            timeCreated: now,
            timeUpdated: now,
          })
          insertEngineTask(db, {
            taskID: secondTaskID,
            projectID: Instance.project.id,
            sessionID: secondRoot.id,
            source: "test",
            title: "second claim task",
            request: "Verify queue claim.",
            executor: "codex",
            kind: "workflow",
            priority: "normal",
            queueOrder: 1,
            metadata: {},
            timeStarted: null,
            timeCreated: now + 1,
            timeUpdated: now + 1,
          })
          setEngineTaskQueueOrder(db, { taskID: secondTaskID, queueOrder: 0, timeUpdated: now + 2 })
          setEngineTaskQueueOrder(db, { taskID: firstTaskID, queueOrder: 1, timeUpdated: now + 2 })
        })

        const firstClaim = Database.transaction((db) =>
          claimNextEngineTaskForCwd(db, { cwd: tmp.path, timeStarted: now + 3 }),
        )
        expect(firstClaim).toMatchObject({
          id: secondTaskID,
          time_started: now + 3,
          time_updated: now + 3,
        })

        const blockedClaim = Database.transaction((db) =>
          claimQueuedEngineTaskForCwd(db, { taskID: firstTaskID, cwd: tmp.path, timeStarted: now + 4 }),
        )
        expect(blockedClaim).toBeUndefined()
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
