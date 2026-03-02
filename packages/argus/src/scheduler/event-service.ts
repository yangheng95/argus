import { Bus } from "@/bus"
import { Instance } from "@/project/instance"
import { Database, and, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { SessionWake } from "@/session/wake"
import { Wildcard } from "@/util/wildcard"
import { EventJobTable } from "./event.sql"

type Match = Record<string, string | number | boolean>

export namespace EventService {
  const log = Log.create({ service: "event-service" })

  const state = Instance.state(
    () => ({
      unsub: undefined as undefined | (() => void),
      running: new Set<string>(),
    }),
    async (s) => {
      s.unsub?.()
      s.running.clear()
      s.unsub = undefined
    },
  )

  export function init() {
    const s = state()
    if (s.unsub) return
    s.unsub = Bus.subscribeAll(async (event) => {
      await on(event)
    })
    log.info("event service initialized")
  }

  async function on(event: { type: string; properties: unknown }) {
    if (event.type === "server.instance.disposed") return

    const now = Date.now()
    const jobs = Database.use((db) =>
      db
        .select()
        .from(EventJobTable)
        .where(and(eq(EventJobTable.project_id, Instance.project.id), eq(EventJobTable.enabled, true)))
        .all(),
    )

    for (const job of jobs) {
      if (!Wildcard.match(event.type, job.event_type)) continue
      if (!ok(event, job.match_json ?? {})) continue
      if (!ready(job, now)) continue
      if (state().running.has(job.id)) continue

      state().running.add(job.id)
      await run(job, event.type, now).finally(() => {
        state().running.delete(job.id)
      })
    }
  }

  function ready(job: typeof EventJobTable.$inferSelect, now: number) {
    if (!job.last_run) return true
    return now - job.last_run >= job.cooldown_ms
  }

  function ok(event: { type: string; properties: unknown }, match: Match) {
    for (const [k, v] of Object.entries(match)) {
      const got = pick({ type: event.type, properties: event.properties }, k)
      if (got !== v) return false
    }
    return true
  }

  function pick(input: unknown, key: string): unknown {
    const parts = key.split(".").filter(Boolean)
    let cur: unknown = input
    for (const part of parts) {
      if (!cur || typeof cur !== "object") return undefined
      cur = (cur as Record<string, unknown>)[part]
    }
    return cur
  }

  async function run(job: typeof EventJobTable.$inferSelect, type: string, now: number) {
    const sessionID = await SessionWake.wake({
      sessionID: job.session_id ?? undefined,
      prompt: job.prompt,
      agent: job.agent === "default" ? undefined : job.agent,
    })

    Database.use((db) =>
      db
        .update(EventJobTable)
        .set({
          last_run: now,
          last_event: type,
          enabled: job.one_shot ? false : true,
        })
        .where(eq(EventJobTable.id, job.id))
        .run(),
    )

    log.info("event job triggered session wake", {
      jobId: job.id,
      name: job.name,
      event: type,
      sessionID,
      oneShot: job.one_shot,
    })
  }
}
