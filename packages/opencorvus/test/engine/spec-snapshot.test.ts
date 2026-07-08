import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import {
  insertEngineSpecSnapshot,
  supersedeActiveEngineSpecSnapshotsForTask,
  supersedeEngineSpecSnapshot,
  updateEngineSpecSnapshotContent,
} from "../../src/engine/spec-snapshot"
import { EngineSpecSnapshotTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { findActiveSpecForTask } from "../../src/engine/store"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Session } from "../../src/session"
import { Database, eq } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

let tmp: Awaited<ReturnType<typeof tmpdir>>
let taskID = ""
let rootSessionID = ""

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir({ git: true })
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: "spec snapshot writer" })
      rootSessionID = root.id
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
            title: "spec snapshot writer",
            request: "Verify spec snapshot write boundary.",
            priority: "normal",
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

describe("engine spec snapshot writer", () => {
  test("creates, supersedes, and updates spec snapshots through the writer", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const createdAt = Date.now()
        const priorSpecID = Database.transaction((db) =>
          insertEngineSpecSnapshot(db, {
            taskID,
            version: 1,
            status: "ready",
            summary: "Requirements summary",
            content: "Requirements content",
            scope: "Requirement scope",
            outOfScope: "Outside scope",
            evidence: ["evidence-1"],
            metadata: { source: "test" },
            timeCreated: createdAt,
          }),
        )

        const newSpecID = Database.transaction((db) => {
          const id = insertEngineSpecSnapshot(db, {
            taskID,
            version: 2,
            status: "ready",
            summary: "Architect summary",
            content: "Architect content",
            scope: "Architect scope",
            timeCreated: createdAt + 1,
          })
          supersedeEngineSpecSnapshot(db, { id: priorSpecID, timeUpdated: createdAt + 2 })
          updateEngineSpecSnapshotContent(db, {
            id,
            content: "Architect remapped content",
            timeUpdated: createdAt + 3,
          })
          return id
        })

        const rows = Database.use((db) =>
          db
            .select()
            .from(EngineSpecSnapshotTable)
            .where(eq(EngineSpecSnapshotTable.task_id, taskID))
            .all()
            .sort((a, b) => a.version - b.version),
        )
        expect(rows).toHaveLength(2)
        expect(rows[0]).toMatchObject({
          id: priorSpecID,
          task_id: taskID,
          version: 1,
          status: "superseded",
          summary: "Requirements summary",
          content: "Requirements content",
          scope: "Requirement scope",
          out_of_scope: "Outside scope",
          evidence: ["evidence-1"],
          metadata: { source: "test" },
          time_created: createdAt,
          time_updated: createdAt + 2,
        })
        expect(rows[1]).toMatchObject({
          id: newSpecID,
          task_id: taskID,
          version: 2,
          status: "ready",
          summary: "Architect summary",
          content: "Architect remapped content",
          scope: "Architect scope",
          time_created: createdAt + 1,
          time_updated: createdAt + 3,
        })
        expect(findActiveSpecForTask(taskID)?.id).toBe(newSpecID)
      },
    })
  })

  test("supersedes all active snapshots for a task without touching other tasks", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const otherTaskID = Identifier.ascending("task")
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: otherTaskID,
              project_id: Instance.project.id,
              session_id: rootSessionID,
              source: "test",
              title: "other task",
              request: "Other task.",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )

        const readySpecID = Database.transaction((db) =>
          insertEngineSpecSnapshot(db, {
            taskID,
            version: 1,
            status: "ready",
            summary: "Ready",
            content: "Ready content",
            scope: "Ready scope",
            timeCreated: now,
          }),
        )
        const blockedSpecID = Database.transaction((db) =>
          insertEngineSpecSnapshot(db, {
            taskID,
            version: 2,
            status: "blocked",
            summary: "Blocked",
            content: "Blocked content",
            scope: "Blocked scope",
            timeCreated: now + 1,
          }),
        )
        const otherTaskSpecID = Database.transaction((db) =>
          insertEngineSpecSnapshot(db, {
            taskID: otherTaskID,
            version: 1,
            status: "ready",
            summary: "Other",
            content: "Other content",
            scope: "Other scope",
            timeCreated: now + 2,
          }),
        )

        Database.transaction((db) => supersedeActiveEngineSpecSnapshotsForTask(db, { taskID, timeUpdated: now + 3 }))

        const statuses = Database.use((db) =>
          db
            .select({
              id: EngineSpecSnapshotTable.id,
              status: EngineSpecSnapshotTable.status,
              timeUpdated: EngineSpecSnapshotTable.time_updated,
            })
            .from(EngineSpecSnapshotTable)
            .all(),
        )
        expect(statuses.find((row) => row.id === readySpecID)).toMatchObject({
          status: "superseded",
          timeUpdated: now + 3,
        })
        expect(statuses.find((row) => row.id === blockedSpecID)).toMatchObject({
          status: "superseded",
          timeUpdated: now + 3,
        })
        expect(statuses.find((row) => row.id === otherTaskSpecID)).toMatchObject({
          status: "ready",
          timeUpdated: now + 2,
        })
        expect(findActiveSpecForTask(taskID)).toBeUndefined()
        expect(findActiveSpecForTask(otherTaskID)?.id).toBe(otherTaskSpecID)
      },
    })
  })
})
