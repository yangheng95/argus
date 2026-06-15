import { afterEach, describe, expect, test } from "bun:test"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { ensureMissionSession } from "../../src/mission/session"
import { Instance } from "../../src/project/instance"
import { Database, eq } from "../../src/storage/db"
import { EngineService } from "../../src/task-api"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

Log.init({ print: false })

describe("mission task title format", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("formats mission-created task titles inside EngineService task creation", async () => {
    await using tmp = await tmpdir({ git: true, config: { model: "test/model" } })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await ensureMissionSession({ missionID: "title-format", defaultCwd: tmp.path })

        const firstTaskID = await EngineService.createTask({
          source: "mission",
          title: "Implement settings route",
          request: "Implement settings route.\n\n## Original user input\n\"ship it\"",
          queue: true,
          metadata: {
            actor: "mission",
            mission: { id: session.missionID, session_id: session.id },
          },
        })
        const secondTaskID = await EngineService.createTask({
          source: "mission",
          title: "Verify delivery evidence",
          request: "Verify delivery evidence.\n\n## Original user input\n\"ship it\"",
          queue: true,
          metadata: {
            actor: "mission",
            mission: { id: session.missionID, session_id: session.id },
          },
        })

        const first = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, firstTaskID)).get(),
        )
        const second = Database.use((db) =>
          db.select().from(EngineTaskTable).where(eq(EngineTaskTable.id, secondTaskID)).get(),
        )

        expect(first?.title).toBe("Phase 01: Implement settings route")
        expect(second?.title).toBe("Phase 02: Verify delivery evidence")
      },
    })
  }, 20_000)

  test("rejects mission task creation without semantic title", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const session = await ensureMissionSession({ missionID: "title-required", defaultCwd: tmp.path })

        await expect(
          EngineService.createTask({
            source: "mission",
            request: "Missing semantic title.\n\n## Original user input\n\"ship it\"",
            queue: true,
            metadata: {
              actor: "mission",
              mission: { id: session.missionID, session_id: session.id },
            },
          }),
        ).rejects.toThrow("Mission task creation requires title")
      },
    })
  }, 20_000)
})
