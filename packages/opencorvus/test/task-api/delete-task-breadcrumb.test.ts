import { afterEach, describe, expect, test } from "bun:test"
import { createDecisionLog } from "../../src/decision-log"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Session } from "../../src/session"
import { SessionTable } from "../../src/session/session.sql"
import { Database, eq } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

function taskRow(taskID: string) {
  return Database.use((db) => db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, taskID)).get())
}

function sessionRow(sessionID: string) {
  return Database.use((db) => db.select().from(SessionTable).where(eq(SessionTable.id, sessionID)).get())
}

async function createActiveTask(directory: string, request: string) {
  let taskID = ""
  let sessionID = ""
  await Instance.provide({
    directory,
    fn: async () => {
      const root = await Session.create({ kind: "root", title: request })
      sessionID = root.id
      taskID = Identifier.ascending("task")
      const now = Date.now()
      Database.use((db) =>
        db
          .insert(EngineTaskTable)
          .values({
            id: taskID,
            project_id: Instance.project.id,
            session_id: sessionID,
            source: "test",
            title: request,
            request,
            priority: "normal",
            time_started: now,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
    },
  })
  return { taskID, sessionID }
}

describe("task physical delete breadcrumbs", () => {
  afterEach(async () => {
    await Instance.disposeAll()
    await resetDatabase()
  })

  test("deleteTask writes task-runtime breadcrumbs before physically deleting the task row", async () => {
    await using tmp = await tmpdir({ git: true })
    const { taskID, sessionID } = await createActiveTask(tmp.path, "delete breadcrumb")
    const decisionLogPath = ProjectRuntimePaths.decisionLogPaths(tmp.path, taskID).absolute
    const eventPaths = ProjectRuntimePaths.eventLogPath(tmp.path, taskID)

    await EngineService.cancelTask(taskID)
    await EngineService.deleteTask(taskID)

    expect(taskRow(taskID)).toBeUndefined()
    expect(sessionRow(sessionID)).toBeUndefined()

    const entry = createDecisionLog(taskID).readByKey("task_physical_delete_breadcrumb")
    expect(entry).toBeDefined()
    const payload = JSON.parse(entry!.value) as {
      origin: string
      statusBeforeDelete: string
      sessionID: string
    }
    expect(payload.origin).toBe("EngineService.deleteTask")
    expect(payload.statusBeforeDelete).toBe("cancelled")
    expect(payload.sessionID).toBe(sessionID)

    const decisionLog = await Bun.file(decisionLogPath).text()
    expect(decisionLog).toContain("task_physical_delete_breadcrumb")
    expect(decisionLog).toContain("EngineService.deleteTask")

    const timeline = await Bun.file(eventPaths.timeline).text()
    expect(timeline).toContain("physical_delete_pending")
    expect(timeline).toContain("EngineService.deleteTask")
    expect(timeline).toContain(taskID)

    const events = await Bun.file(eventPaths.ndjson).text()
    expect(events).toContain("task.physical_delete_pending")
    expect(events).toContain("EngineService.deleteTask")
  })

  test("deleteSession deleteTasks writes task-runtime breadcrumbs before deleting task rows", async () => {
    await using tmp = await tmpdir({ git: true })
    const { taskID, sessionID } = await createActiveTask(tmp.path, "delete session breadcrumb")
    const decisionLogPath = ProjectRuntimePaths.decisionLogPaths(tmp.path, taskID).absolute
    const eventPaths = ProjectRuntimePaths.eventLogPath(tmp.path, taskID)

    await EngineService.cancelTask(taskID)
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await EngineService.deleteSession(sessionID, { deleteTasks: true })
      },
    })

    expect(taskRow(taskID)).toBeUndefined()
    expect(sessionRow(sessionID)).toBeUndefined()

    const entry = createDecisionLog(taskID).readByKey("task_physical_delete_breadcrumb")
    expect(entry).toBeDefined()
    const payload = JSON.parse(entry!.value) as {
      origin: string
      rootSessionID: string
      sessionIDs: string[]
      statusBeforeDelete: string
    }
    expect(payload.origin).toBe("EngineService.deleteSession.deleteTasks")
    expect(payload.rootSessionID).toBe(sessionID)
    expect(payload.sessionIDs).toContain(sessionID)
    expect(payload.statusBeforeDelete).toBe("cancelled")

    const decisionLog = await Bun.file(decisionLogPath).text()
    expect(decisionLog).toContain("task_physical_delete_breadcrumb")
    expect(decisionLog).toContain("EngineService.deleteSession.deleteTasks")

    const timeline = await Bun.file(eventPaths.timeline).text()
    expect(timeline).toContain("physical_delete_pending")
    expect(timeline).toContain("EngineService.deleteSession.deleteTasks")

    const events = await Bun.file(eventPaths.ndjson).text()
    expect(events).toContain("task.physical_delete_pending")
    expect(events).toContain("EngineService.deleteSession.deleteTasks")
  })
})
