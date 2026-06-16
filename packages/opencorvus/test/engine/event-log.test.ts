import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import { EngineEventLog } from "../../src/engine/event-log"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

describe("engine event log", () => {
  afterEach(async () => {
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
})
