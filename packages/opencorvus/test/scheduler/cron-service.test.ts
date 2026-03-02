import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { CronService } from "../../src/scheduler/cron-service"
import { CronJobTable } from "../../src/scheduler/cron.sql"
import { Database, eq } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"
import { SessionWake } from "../../src/session/wake"

async function waitUntil(check: () => boolean, timeout = 2000) {
  const end = Date.now() + timeout
  while (Date.now() < end) {
    if (check()) return
    await Bun.sleep(10)
  }
  throw new Error("timed out")
}

describe("scheduler.cron-service", () => {
  afterEach(async () => {
    mock.restore()
    await Instance.disposeAll()
  })

  test("one-shot job is not lost on wake failure and is disabled after a later success", async () => {
    await using tmp = await tmpdir({ git: true })
    const wake = spyOn(SessionWake, "wake")
    wake.mockImplementationOnce(async () => {
      throw new Error("wake failed")
    })
    wake.mockResolvedValue("ses_mock")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = "crn_one_shot_" + Math.random().toString(36).slice(2)
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              name: "oneshot",
              expression: "1m",
              prompt: "hello",
              enabled: true,
              one_shot: true,
              next_run: now - 1000,
            })
            .run(),
        )

        await CronService.runNow()

        const first = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
        expect(first?.enabled).toBe(true)
        expect(first?.one_shot).toBe(true)
        expect(first?.failure_count).toBe(1)
        expect((first?.last_run ?? null) === null).toBe(true)

        Database.use((db) =>
          db
            .update(CronJobTable)
            .set({ next_run: Date.now() - 1000 })
            .where(eq(CronJobTable.id, id))
            .run(),
        )
        await CronService.runNow()

        const second = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
        expect(second?.enabled).toBe(false)
        expect((second?.last_run ?? 0) > 0).toBe(true)
        expect(second?.failure_count).toBe(0)
        expect(wake).toHaveBeenCalledTimes(2)
      },
    })
  })

  test("poll only processes cron jobs for the current project", async () => {
    await using one = await tmpdir({ git: true })
    await using two = await tmpdir({ git: true })
    const id = "crn_scope_" + Math.random().toString(36).slice(2)
    const wake = spyOn(SessionWake, "wake").mockResolvedValue("ses_mock")

    await Instance.provide({
      directory: two.path,
      fn: async () => {
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              name: "other-project",
              expression: "1m",
              prompt: "hello",
              enabled: true,
              one_shot: false,
              next_run: now - 1000,
            })
            .run(),
        )
      },
    })

    await Instance.provide({
      directory: one.path,
      fn: async () => {
        await CronService.runNow()
      },
    })

    const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
    expect(wake).toHaveBeenCalledTimes(0)
    expect((row?.last_run ?? null) === null).toBe(true)
  })

  test("reentry guard prevents overlapping poll runs", async () => {
    await using tmp = await tmpdir({ git: true })

    let resolve = (_value: string) => {}
    const gate = new Promise<string>((r) => {
      resolve = r
    })
    const wake = spyOn(SessionWake, "wake").mockImplementation(async () => gate)

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const id = "crn_reentry_" + Math.random().toString(36).slice(2)
        const now = Date.now()
        Database.use((db) =>
          db
            .insert(CronJobTable)
            .values({
              id,
              project_id: Instance.project.id,
              name: "reentry",
              expression: "*/5 * * * *",
              prompt: "hello",
              enabled: true,
              one_shot: false,
              next_run: now - 1000,
            })
            .run(),
        )

        const pending = [CronService.runNow(), CronService.runNow(), CronService.runNow()]
        await waitUntil(() => wake.mock.calls.length === 1)
        resolve("ses_gate")
        await Promise.all(pending)

        const row = Database.use((db) => db.select().from(CronJobTable).where(eq(CronJobTable.id, id)).get())
        expect((row?.last_run ?? 0) > 0).toBe(true)
      },
    })

    expect(wake).toHaveBeenCalledTimes(1)
  })
})
