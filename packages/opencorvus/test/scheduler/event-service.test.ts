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
import { Session } from "../../src/session"

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

async function waitUntil(check: () => boolean, timeout = 2000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (check()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out")
}

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
        expect(wake.mock.calls[0]?.[0]?.reason).toMatchObject({
          source: "scheduler.event",
          jobID: id,
          jobName: "on-command",
          eventType: "test.event",
          oneShot: false,
        })
        expect(wake.mock.calls[0]?.[0]?.reason?.fireID).toMatch(/^cal_/)
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

  test("create rejects foreign sessions and remove reports only current-project rows", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    const foreignJobID = "evt_foreign_remove_" + Math.random().toString(36).slice(2)
    let oneProjectID = ""
    let twoProjectID = ""
    let twoSessionID = ""

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        oneProjectID = Instance.project.id
      },
    })

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        twoProjectID = Instance.project.id
        twoSessionID = (await Session.create({ kind: "assistant", title: "foreign event session" })).id
        Database.use((db) =>
          db
            .insert(EventJobTable)
            .values({
              id: foreignJobID,
              project_id: twoProjectID,
              session_id: twoSessionID,
              name: "foreign remove sentinel",
              event_type: "test.foreign",
              prompt: "foreign",
              enabled: true,
              one_shot: false,
              cooldown_ms: 0,
            })
            .run(),
        )
      },
    })

    expect(() =>
      EventService.create({
        name: "bad event session",
        eventType: "test.bad",
        prompt: "bad",
        projectId: oneProjectID,
        sessionId: twoSessionID,
      }),
    ).toThrow("Session not found")

    expect(EventService.remove(foreignJobID, oneProjectID)).toBe(false)
    expect(
      Database.use((db) => db.select().from(EventJobTable).where(eq(EventJobTable.id, foreignJobID)).get()),
    ).toBeDefined()
  }, 30_000)

  test("one failed job does not block other matching jobs", async () => {
    await using tmp = await tmpdir({ git: true })
    const wake = spyOn(SessionWake, "wake")
    wake.mockImplementationOnce(async () => {
      throw new Error("wake failed")
    })
    wake.mockResolvedValue("ses_evt_ok")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const idA = "crn_evt_a_" + Math.random().toString(36).slice(2)
        const idB = "crn_evt_b_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(EventJobTable)
            .values([
              {
                id: idA,
                project_id: Instance.project.id,
                name: "job-a",
                event_type: "test.event",
                prompt: "run a",
                enabled: true,
                one_shot: false,
                cooldown_ms: 0,
              },
              {
                id: idB,
                project_id: Instance.project.id,
                name: "job-b",
                event_type: "test.event",
                prompt: "run b",
                enabled: true,
                one_shot: false,
                cooldown_ms: 0,
              },
            ])
            .run(),
        )

        EventService.init()
        await Bus.publish(TestEvent, { value: "go" })

        const rows = Database.use((db) =>
          db.select().from(EventJobTable).where(eq(EventJobTable.project_id, Instance.project.id)).all(),
        )
        expect(wake).toHaveBeenCalledTimes(2)
        expect(rows.filter((row) => typeof row.last_run === "number").length).toBe(1)
      },
    })

    wake.mockRestore()
  })

  test("runs matching jobs in parallel without head-of-line blocking", async () => {
    await using tmp = await tmpdir({ git: true })
    let release = () => {}
    const gate = new Promise<string>((resolve) => {
      release = () => resolve("ses_evt_slow")
    })
    const wake = spyOn(SessionWake, "wake").mockImplementation(async (input) => {
      if (input.prompt === "slow") return gate
      return "ses_evt_fast"
    })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const idSlow = "crn_evt_slow_" + Math.random().toString(36).slice(2)
        const idFast = "crn_evt_fast_" + Math.random().toString(36).slice(2)
        Database.use((db) =>
          db
            .insert(EventJobTable)
            .values([
              {
                id: idSlow,
                project_id: Instance.project.id,
                name: "job-slow",
                event_type: "test.event",
                prompt: "slow",
                enabled: true,
                one_shot: false,
                cooldown_ms: 0,
              },
              {
                id: idFast,
                project_id: Instance.project.id,
                name: "job-fast",
                event_type: "test.event",
                prompt: "fast",
                enabled: true,
                one_shot: false,
                cooldown_ms: 0,
              },
            ])
            .run(),
        )

        EventService.init()
        const published = Bus.publish(TestEvent, { value: "go" })
        await waitUntil(() => wake.mock.calls.length === 2)
        release()
        await published

        const rows = Database.use((db) =>
          db.select().from(EventJobTable).where(eq(EventJobTable.project_id, Instance.project.id)).all(),
        )
        expect(rows.filter((row) => typeof row.last_run === "number").length).toBe(2)
      },
    })

    wake.mockRestore()
  })
})
