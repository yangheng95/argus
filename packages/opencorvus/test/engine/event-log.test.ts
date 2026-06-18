import { afterEach, describe, expect, test } from "bun:test"
import { existsSync, readFileSync } from "node:fs"
import path from "path"
import { EngineEventLog } from "../../src/engine/event-log"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Event } from "../../src/engine/model"
import { EngineProtocol } from "../../src/engine/protocol"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("engine event log", () => {
  afterEach(async () => {
    EngineEventLog.disposeForTest()
    await resetDatabase()
  })

  test("resolves task log paths from the task project without instance context", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_event_log_no_instance_context"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "event log task",
              request: "event log task",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
      },
    })

    expect(Instance.current()).toBeUndefined()

    const paths = EngineEventLog.eventLogPathsForTask(taskID)
    const runtimeRoot = path.join(tmp.path, ...ProjectRuntimePaths.relativeRuntimeRoot().split("/"))

    expect(paths.ndjson.startsWith(runtimeRoot)).toBe(true)
    expect(paths.timeline.startsWith(runtimeRoot)).toBe(true)
    expect(paths.ndjson.endsWith(path.join("logs", "events.ndjson"))).toBe(true)
    expect(paths.timeline.endsWith(path.join("logs", "timeline.log"))).toBe(true)
  })

  test("writes current protocol task events to task runtime log files", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = "tsk_event_log_protocol_emit"

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: Instance.project.id,
              source: "test",
              title: "event log task",
              request: "event log task",
              kind: "workflow",
              priority: "normal",
              time_created: now,
              time_updated: now,
            })
            .run(),
        )
      },
    })

    EngineEventLog.init()
    await EngineProtocol.emit(Event.TaskCreated, {
      taskID,
      status: "queued",
      summary: "Task created for event log",
    })

    const paths = EngineEventLog.eventLogPathsForTask(taskID)
    const deadline = Date.now() + 2_500
    while (!existsSync(paths.ndjson) && Date.now() < deadline) {
      await Bun.sleep(25)
    }

    const ndjson = readFileSync(paths.ndjson, "utf8")
    const timeline = readFileSync(paths.timeline, "utf8")

    expect(ndjson).toContain('"type":"task.created"')
    expect(ndjson).toContain('"summary":"Task created for event log"')
    expect(timeline).toContain("TASK created")
    expect(timeline).toContain(taskID)
  })
})
