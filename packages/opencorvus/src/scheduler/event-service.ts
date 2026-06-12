import { Bus } from "@/bus"
import { Instance, lazyInstanceState } from "@/project/instance"
import { Database, and, eq } from "@/storage/db"
import { Log } from "@/util/log"
import { SessionWake } from "@/session"
import { Wildcard } from "@/util/wildcard"
import { Identifier } from "@/id/id"
import { EventJobTable } from "./event.sql"

type Match = Record<string, string | number | boolean>

export type EventJobView = {
  id: string
  name: string
  eventType: string
  match: Match
  prompt: string
  enabled: boolean
  oneShot: boolean
  cooldownMs: number
  lastRun: number | null
  lastEvent: string | null
}

export type CreateEventJobInput = {
  name: string
  eventType: string
  match?: Match
  prompt: string
  projectId: string
  sessionId?: string
  oneShot?: boolean
  cooldownMs?: number
}

export namespace EventService {
  const log = Log.create({ service: "event-service" })

  const state = lazyInstanceState(
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

  export function list(projectID: string): EventJobView[] {
    const rows = Database.use((db) =>
      db.select().from(EventJobTable).where(eq(EventJobTable.project_id, projectID)).all(),
    )
    return rows.map((j) => ({
      id: j.id,
      name: j.name,
      eventType: j.event_type,
      match: j.match_json ?? {},
      prompt: j.prompt,
      enabled: j.enabled,
      oneShot: j.one_shot,
      cooldownMs: j.cooldown_ms,
      lastRun: j.last_run,
      lastEvent: j.last_event ?? null,
    }))
  }

  export function create(input: CreateEventJobInput): { id: string; name: string; eventType: string } {
    const id = Identifier.ascending("cron")
    Database.use((db) =>
      db
        .insert(EventJobTable)
        .values({
          id,
          project_id: input.projectId,
          session_id: input.sessionId,
          name: input.name,
          event_type: input.eventType,
          match_json: input.match,
          prompt: input.prompt,
          enabled: true,
          one_shot: input.oneShot ?? false,
          cooldown_ms: input.cooldownMs ?? 0,
        })
        .run(),
    )
    return { id, name: input.name, eventType: input.eventType }
  }

  export function remove(id: string, projectID: string): void {
    Database.use((db) =>
      db
        .delete(EventJobTable)
        .where(and(eq(EventJobTable.id, id), eq(EventJobTable.project_id, projectID)))
        .run(),
    )
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

    const pending: Promise<void>[] = []
    for (const job of jobs) {
      if (!Wildcard.match(event.type, job.event_type)) continue
      if (!ok(event, job.match_json ?? {})) continue
      if (!ready(job, now)) continue
      if (state().running.has(job.id)) continue

      state().running.add(job.id)
      pending.push(
        run(job, event.type, now)
          .catch((error) => {
            log.error("event job execution failed", {
              jobId: job.id,
              name: job.name,
              event: event.type,
              error: error instanceof Error ? error.message : String(error),
            })
          })
          .finally(() => {
            state().running.delete(job.id)
          }),
      )
    }

    await Promise.allSettled(pending)
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
    const fireID = Identifier.ascending("call")
    const sessionID = await SessionWake.wake({
      sessionID: job.session_id ?? undefined,
      prompt: job.prompt,
      agent: job.agent === "default" ? undefined : job.agent,
      reason: {
        source: "scheduler.event",
        jobID: job.id,
        jobName: job.name,
        fireID,
        eventType: type,
        oneShot: job.one_shot,
      },
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
      fireID,
      name: job.name,
      event: type,
      sessionID,
      oneShot: job.one_shot,
    })
  }
}
