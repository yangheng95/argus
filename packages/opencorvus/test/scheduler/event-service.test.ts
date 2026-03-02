import { afterEach, describe, expect, spyOn, test } from "bun:test"
import z from "zod"
import { EventService } from "../../src/scheduler/event-service"
import { EventJobTable } from "../../src/scheduler/event.sql"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionWake } from "../../src/session/wake"
import { Bus } from "../../src/bus"
import { BusEvent } from "../../src/bus/bus-event"

const TestEvent = BusEvent.define(
  "test.event",
  z.object({
    value: z.string(),
  }),
)

const TestOnce = BusEvent.define(
  "test.once",
  z.object({
    value: z.string(),
  }),
)

describe("scheduler.event-service", () => {
  afterEach(async () => {
    await Instance.disposeAll()
  })

  test("matches event type + property filter and respects cooldown", async () => {
    await using tmp = await tmpdir({ git: true })
    const wake = spyOn(SessionWake, "wake").mockResolvedValue("ses_evt")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = "crn_evt_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(EventJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              name: "on-command",
              event_type: "test.*",
              match_json: { "properties.value": "go" },
              prompt: "run",
              enabled: true,
              one_shot: false,
              cooldown_ms: 1000,
            })
            .run(),
        )

        EventService.init()
        await Bus.publish(TestEvent, { value: "stop" })
        await Bus.publish(TestEvent, { value: "go" })
        await Bus.publish(TestEvent, { value: "go" })

        const row = Database.use((db) => db.select().from(EventJobTable).where(eq(EventJobTable.id, id)).get())
        expect(wake).toHaveBeenCalledTimes(1)
        expect((row?.last_run ?? 0) > 0).toBe(true)
        expect(row?.last_event).toBe("test.event")
      },
    })

    wake.mockRestore()
  })

  test("one-shot event job disables itself after first match", async () => {
    await using tmp = await tmpdir({ git: true })
    const wake = spyOn(SessionWake, "wake").mockResolvedValue("ses_evt_once")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = "crn_evt_once_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(EventJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              name: "once",
              event_type: "test.once",
              prompt: "run once",
              enabled: true,
              one_shot: true,
              cooldown_ms: 0,
            })
            .run(),
        )

        EventService.init()
        await Bus.publish(TestOnce, { value: "a" })
        await Bus.publish(TestOnce, { value: "b" })

        const row = Database.use((db) => db.select().from(EventJobTable).where(eq(EventJobTable.id, id)).get())
        expect(wake).toHaveBeenCalledTimes(1)
        expect(row?.enabled).toBe(false)
        expect(row?.last_event).toBe("test.once")
      },
    })

    wake.mockRestore()
  })
})
