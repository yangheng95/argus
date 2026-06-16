import { $ } from "bun"
import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { persistQueuedTask } from "../../src/engine/pipeline"
import { TaskGlobalProjectBindingError } from "../../src/engine/task-project-error"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Session } from "../../src/session"
import { MessageTable, SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("task global project binding is forbidden", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("persistQueuedTask refuses project global before inserting a task row", () => {
    const taskID = Identifier.ascending("task")

    expect(() =>
      persistQueuedTask({
        taskID,
        sessionID: Identifier.ascending("session"),
        now: Date.now(),
        executor: "opencorvus",
        title: "bad task",
        request: "must not persist",
        metadata: {},
        projectID: "global",
        queue: true,
      }),
    ).toThrow(TaskGlobalProjectBindingError)

    const row = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
    expect(row).toBeUndefined()
  })

  test("createTask refuses a stale global active project before root session creation", async () => {
    await using tmp = await tmpdir()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        expect(Instance.project.id).toBe("global")
        spyOn(Project, "isGitRepo").mockReturnValue(true)

        await expect(
          EngineService.createTask({
            request: "must not create root session",
            source: "test",
          }),
        ).rejects.toThrow(TaskGlobalProjectBindingError)

        const sessions = Database.use((db) => db.select().from(SessionTable).all())
        expect(sessions).toHaveLength(0)
      },
    })
  })

  test("handleTaskMessage refuses legacy global task before appending attachments or messages", async () => {
    const legacy = await seedLegacyGlobalTask()

    await Instance.provide({
      directory: legacy.directory,
      fn: async () => {
        expect(Instance.project.id).not.toBe("global")
        await expect(
          EngineService.handleTaskMessage(legacy.taskID, {
            text: "retry",
            source: "test",
            attachments: [
              {
                data: Buffer.from("must not be written").toString("base64"),
                mime: "image/png",
                filename: "blocked.png",
              },
            ],
          }),
        ).rejects.toThrow(TaskGlobalProjectBindingError)
      },
    })

    const task = Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, legacy.taskID)).get())
    expect(task?.project_id).toBe("global")
    expect(task?.attachments ?? null).toBeNull()
    expect(messageCount(legacy.sessionID)).toBe(0)
  })

  test("injectMessage refuses legacy global task before appending a session message", async () => {
    const legacy = await seedLegacyGlobalTask()

    await Instance.provide({
      directory: legacy.directory,
      fn: async () => {
        expect(Instance.project.id).not.toBe("global")
        await expect(EngineService.injectMessage(legacy.taskID, "retry")).rejects.toThrow(
          TaskGlobalProjectBindingError,
        )
      },
    })

    expect(messageCount(legacy.sessionID)).toBe(0)
  })
})

async function seedLegacyGlobalTask(): Promise<{ directory: string; taskID: string; sessionID: string }> {
  await using tmp = await tmpdir()
  let taskID = ""
  let sessionID = ""

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(Instance.project.id).toBe("global")
      const session = await Session.create({ kind: "root", title: "legacy global task" })
      taskID = Identifier.ascending("task")
      sessionID = session.id
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: "global",
            session_id: session.id,
            source: "test",
            title: "legacy global task",
            request: "retry",
            executor: "opencorvus",
            priority: "normal",
            kind: "workflow",
            queue_order: 0,
            time_started: now,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
    },
  })

  await $`git init`.cwd(tmp.path).quiet()
  return { directory: tmp.path, taskID, sessionID }
}

function messageCount(sessionID: string): number {
  return Database.use((db) => db.select().from(MessageTable).where(eq(MessageTable.session_id, sessionID)).all()).length
}
