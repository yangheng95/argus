import { describe, expect, test } from "bun:test"
import { ScheduleTool } from "../../src/tool/schedule"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { Database, eq } from "../../src/storage/db"
import { CronJobTable } from "../../src/scheduler/cron.sql"
import { EventJobTable } from "../../src/scheduler/event.sql"

const ctx = {
  sessionID: "test",
  messageID: "msg",
  callID: "call",
  agent: "build",
  abort: AbortSignal.any([]),
  messages: [],
  metadata: () => {},
  ask: async () => {},
}

describe("tool.schedule", () => {
  test("cancel only affects jobs in the current project", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    const id = "crn_cross_" + Math.random().toString(36).slice(2)

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              name: "other-project",
              expression: "1m",
              prompt: "run",
              enabled: true,
              one_shot: true,
              next_run: Date.now() + 60_000,
            })
            .run(),
        )
      },
    })

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        const tool = await ScheduleTool.init()
        const out = await tool.execute({ action: "cancel", jobId: id }, ctx)
        expect(out.title).toBe("Not found")
      },
    })

    const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
    expect(row?.id).toBe(id)
  })

  test("create_event/list_event/cancel_event lifecycle", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const tool = await ScheduleTool.init()
        const created = await tool.execute(
          {
            action: "create_event",
            name: "on-init",
            eventType: "command.*",
            prompt: "run",
            match: { "properties.name": "init" },
            cooldownMs: 100,
          },
          ctx,
        )
        const createPayload = JSON.parse(created.output) as { jobId: string }
        expect(createPayload.jobId.startsWith("crn_")).toBe(true)

        const listed = await tool.execute({ action: "list_event" }, ctx)
        const listPayload = JSON.parse(listed.output) as { jobs: { id: string }[] }
        expect(listPayload.jobs.some((j) => j.id === createPayload.jobId)).toBe(true)

        const cancelled = await tool.execute({ action: "cancel_event", jobId: createPayload.jobId }, ctx)
        expect(cancelled.title).toContain("Cancelled")

        const row = Database.use((db) =>
          db.select().from(EventJobTable).where(eq(EventJobTable.id, createPayload.jobId)).get(),
        )
        expect(row).toBeUndefined()
      },
    })
  })
})
