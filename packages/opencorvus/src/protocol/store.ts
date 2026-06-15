import { Identifier } from "@/id/id"
import { Database, and, asc, desc, eq, gt, lte } from "@/storage/db"
import { Channel } from "@/util/channel"
import { withKeyedLock } from "@/util/lock"
import { Log } from "@/util/log"
import { ProtocolEventTable } from "./protocol.sql"
import type { ProtocolAggregate, ProtocolKind } from "./schema"

const eventLocks = new Map<string, Promise<void>>()
const log = Log.create({ service: "protocol.store" })

type Payload = Record<string, unknown>
export type TaskLiveReplayResult = { expired: false; events: EventView[] } | { expired: true; event: EventView }

type EventInput = {
  kind: ProtocolKind
  type: string
  aggregate: ProtocolAggregate
  aggregate_id: string
  task_id?: string | null
  run_id?: string | null
  goal_run_id?: string | null
  session_id?: string | null
  interaction_id?: string | null
  stream_id?: string | null
  source: string
  target?: string | null
  causation_id?: string | null
  correlation_id?: string | null
  reply_to?: string | null
  deadline_ms?: number | null
  emitted_at?: number
  payload?: Payload | null
  seq?: number
}

type EventRow = typeof ProtocolEventTable.$inferSelect
type EventView = ReturnType<typeof eventView>
type EventFilter = {
  aggregate?: ProtocolAggregate
  taskID?: string
  runID?: string
  sessionID?: string
  interactionID?: string
  types?: string[]
}
type EventSubscription = {
  filter?: EventFilter
  dispatch(event: EventView): boolean
  close(): void
}

// ── Global subscription registry ──
// Subscriptions MUST be global (not per-Instance) because:
// 1. Database is a global singleton — events from any Instance land in the same DB.
// 2. SSE handlers register subscriptions from one Instance context, but events may
//    be written from a different Instance context (e.g. cross-Instance bridge in
//    task-message-protocol-bridge writes events in hostDirectory context while the
//    SSE client connected from a different directory).
// 3. matchesEvent() already filters by taskID/runID/sessionID — Instance-level
//    isolation is redundant and causes real-time events to be silently dropped
//    when the writer and reader are in different Instance contexts.
const globalSubscriptions = new Set<EventSubscription>()
const TASK_LIVE_REPLAY_MAX_EVENTS = 4096
const TASK_LIVE_REPLAY_MAX_AGE_MS = 30_000
const TASK_LIVE_REPLAY_SWEEP_MS = 10_000
const TASK_LIVE_EPOCH = Date.now()
const taskLiveSequences = new Map<string, number>()
const taskLiveReplayEvents = new Map<string, EventView[]>()
const taskLiveRetentionFloors = new Map<string, number>()
let taskLiveReplaySweepStarted = false
const TASK_TERMINAL_EVENT_TYPES = new Set(["task.completed", "task.failed", "task.cancelled"])

function eventKey(input: { aggregate: ProtocolAggregate; aggregate_id: string }) {
  return `${input.aggregate}:${input.aggregate_id}`
}

function payloadText(payload: Payload | null, key: string) {
  const value = payload?.[key]
  return typeof value === "string" && value ? value : undefined
}

function matchesEvent(event: EventView, filter?: EventFilter) {
  if (!filter) return true
  if (filter.aggregate && event.aggregate !== filter.aggregate) return false
  if (filter.taskID && event.taskID !== filter.taskID) return false
  if (filter.runID && event.runID !== filter.runID) return false
  if (filter.sessionID && event.sessionID !== filter.sessionID) return false
  if (filter.interactionID && event.interactionID !== filter.interactionID) return false
  if (filter.types && !filter.types.includes(event.type)) return false
  return true
}

function dispatchEvent(event: EventView) {
  for (const subscription of globalSubscriptions) {
    if (!matchesEvent(event, subscription.filter)) continue
    subscription.dispatch(event)
  }
}

function eventView(row: EventRow) {
  return {
    id: row.id,
    kind: row.kind,
    type: row.type,
    aggregate: row.aggregate_type,
    aggregateID: row.aggregate_id,
    taskID: row.task_id ?? undefined,
    runID: row.run_id ?? undefined,
    goalRunID: row.goal_run_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    interactionID: row.interaction_id ?? undefined,
    executorSessionID: payloadText(row.payload, "executorSessionID") ?? payloadText(row.payload, "executor_session_id"),
    streamID: row.stream_id ?? undefined,
    source: row.source,
    target: row.target ?? undefined,
    causationID: row.causation_id ?? undefined,
    correlationID: row.correlation_id ?? undefined,
    replyTo: row.reply_to ?? undefined,
    sequence: row.seq,
    liveSequence: undefined as number | undefined,
    liveEpoch: undefined as number | undefined,
    deadlineMs: row.deadline_ms ?? undefined,
    summary: payloadText(row.payload, "summary") ?? row.type,
    payload: row.payload ?? undefined,
    time: {
      emitted: row.emitted_at,
      created: row.time_created,
      updated: row.time_updated,
    },
  }
}

function eventLiveReplayKey(event: EventView): string {
  const payload = event.payload ?? {}
  if (event.type === "message.part.delta") {
    const partID = typeof payload.partID === "string" ? payload.partID : ""
    const messageID = typeof payload.messageID === "string" ? payload.messageID : ""
    const sessionID = typeof payload.sessionID === "string" ? payload.sessionID : (event.sessionID ?? "")
    const field = typeof payload.field === "string" ? payload.field : ""
    return `${event.taskID ?? ""}|${sessionID}|${messageID}|${partID}|${field}`
  }
  const part = payload.part && typeof payload.part === "object" ? (payload.part as Record<string, unknown>) : undefined
  const partID = typeof part?.id === "string" ? part.id : typeof payload.partID === "string" ? payload.partID : ""
  const messageID =
    typeof part?.messageID === "string"
      ? part.messageID
      : typeof payload.messageID === "string"
        ? payload.messageID
        : ""
  const sessionID =
    typeof part?.sessionID === "string"
      ? part.sessionID
      : typeof payload.sessionID === "string"
        ? payload.sessionID
        : (event.sessionID ?? "")
  return `${event.taskID ?? ""}|${sessionID}|${messageID}|${partID}|`
}

function markLiveReplayFloor(taskID: string, sequence: number) {
  if (sequence <= 0) return
  taskLiveRetentionFloors.set(taskID, Math.max(taskLiveRetentionFloors.get(taskID) ?? 0, sequence))
}

function trimTaskLiveReplay(taskID: string, now: number) {
  const events = taskLiveReplayEvents.get(taskID)
  if (!events?.length) return
  const minTime = now - TASK_LIVE_REPLAY_MAX_AGE_MS
  while (events.length > 0 && (events.length > TASK_LIVE_REPLAY_MAX_EVENTS || events[0]!.time.emitted < minTime)) {
    markLiveReplayFloor(taskID, events.shift()!.liveSequence ?? 0)
  }
  if (events.length === 0) taskLiveReplayEvents.delete(taskID)
}

function compactTaskLiveReplay(now: number) {
  for (const taskID of [...taskLiveReplayEvents.keys()]) {
    trimTaskLiveReplay(taskID, now)
  }
}

function clearTaskLiveReplay(taskID: string) {
  taskLiveReplayEvents.delete(taskID)
  taskLiveSequences.delete(taskID)
  taskLiveRetentionFloors.delete(taskID)
}

function ensureTaskLiveReplaySweep() {
  if (taskLiveReplaySweepStarted) return
  taskLiveReplaySweepStarted = true
  const timer = setInterval(() => compactTaskLiveReplay(Date.now()), TASK_LIVE_REPLAY_SWEEP_MS)
  const unrefTimer = timer as { unref?: () => void }
  unrefTimer.unref?.()
}

function partUpdatedClosed(payload: Payload | undefined): boolean {
  const part = payload?.part && typeof payload.part === "object" ? (payload.part as Record<string, any>) : undefined
  if (!part) return false
  if ((part.type === "text" || part.type === "reasoning") && typeof part.time?.end === "number") return true
  if (part.type === "tool" && part.state?.status && part.state.status !== "pending") return true
  return false
}

function pruneLiveReplayEvents(taskID: string, predicate: (event: EventView) => boolean) {
  const events = taskLiveReplayEvents.get(taskID)
  if (!events?.length) return
  const next = events.filter((event) => !predicate(event))
  if (next.length === 0) taskLiveReplayEvents.delete(taskID)
  else if (next.length !== events.length) taskLiveReplayEvents.set(taskID, next)
}

function pruneClosedLiveDeltas(taskID: string, event: EventView) {
  if (event.type === "message.part.updated" && partUpdatedClosed(event.payload)) {
    const closedKey = eventLiveReplayKey(event)
    pruneLiveReplayEvents(
      taskID,
      (candidate) => candidate.type === "message.part.delta" && eventLiveReplayKey(candidate).startsWith(closedKey),
    )
    return
  }
  if (event.type === "message.part.removed") {
    const removedKey = eventLiveReplayKey(event)
    pruneLiveReplayEvents(taskID, (candidate) => eventLiveReplayKey(candidate).startsWith(removedKey))
    return
  }
  if (event.type === "message.removed") {
    const payload = event.payload ?? {}
    const messageID =
      typeof payload.messageID === "string"
        ? payload.messageID
        : typeof payload.info === "object" &&
            payload.info &&
            typeof (payload.info as Record<string, unknown>).id === "string"
          ? String((payload.info as Record<string, unknown>).id)
          : ""
    const sessionID = typeof payload.sessionID === "string" ? payload.sessionID : (event.sessionID ?? "")
    pruneLiveReplayEvents(taskID, (candidate) => {
      const candidatePayload = candidate.payload ?? {}
      const candidatePart =
        candidatePayload.part && typeof candidatePayload.part === "object"
          ? (candidatePayload.part as Record<string, unknown>)
          : undefined
      const candidateMessageID =
        typeof candidatePart?.messageID === "string"
          ? candidatePart.messageID
          : typeof candidatePayload.messageID === "string"
            ? candidatePayload.messageID
            : ""
      const candidateSessionID =
        typeof candidatePart?.sessionID === "string"
          ? candidatePart.sessionID
          : typeof candidatePayload.sessionID === "string"
            ? candidatePayload.sessionID
            : (candidate.sessionID ?? "")
      return candidateSessionID === sessionID && candidateMessageID === messageID
    })
  }
}

function taskLiveReplayExpiredEvent(taskID: string, reason: string): EventView {
  const now = Date.now()
  return {
    id: `live-replay-expired-${now}-${Math.random().toString(36).slice(2, 8)}`,
    kind: "event",
    type: "task.live_replay_expired",
    aggregate: "task",
    aggregateID: taskID,
    taskID,
    runID: undefined,
    goalRunID: undefined,
    sessionID: undefined,
    interactionID: undefined,
    executorSessionID: undefined,
    streamID: undefined,
    source: "protocol.live-replay",
    target: undefined,
    causationID: undefined,
    correlationID: undefined,
    replyTo: undefined,
    sequence: 0,
    liveSequence: undefined,
    liveEpoch: undefined,
    deadlineMs: undefined,
    summary: reason,
    payload: {
      taskID,
      reason,
      liveEpoch: TASK_LIVE_EPOCH,
    },
    time: { emitted: now, created: now, updated: now },
  }
}

export namespace ProtocolStore {
  export async function appendEvent(input: EventInput) {
    const now = input.emitted_at ?? Date.now()
    const insert = (seq: number) => {
      const id = Identifier.ascending("protocol_event")
      Database.use((db) =>
        db
          .insert(ProtocolEventTable)
          .values({
            id,
            kind: input.kind,
            type: input.type,
            aggregate_type: input.aggregate,
            aggregate_id: input.aggregate_id,
            task_id: input.task_id ?? null,
            run_id: input.run_id ?? null,
            goal_run_id: input.goal_run_id ?? null,
            session_id: input.session_id ?? null,
            interaction_id: input.interaction_id ?? null,
            stream_id: input.stream_id ?? null,
            source: input.source,
            target: input.target ?? null,
            causation_id: input.causation_id ?? null,
            correlation_id: input.correlation_id ?? null,
            reply_to: input.reply_to ?? null,
            seq,
            deadline_ms: input.deadline_ms ?? null,
            emitted_at: now,
            payload: input.payload ?? null,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
      const event = eventView({
        id,
        kind: input.kind,
        type: input.type,
        aggregate_type: input.aggregate,
        aggregate_id: input.aggregate_id,
        task_id: input.task_id ?? null,
        run_id: input.run_id ?? null,
        goal_run_id: input.goal_run_id ?? null,
        session_id: input.session_id ?? null,
        interaction_id: input.interaction_id ?? null,
        stream_id: input.stream_id ?? null,
        source: input.source,
        target: input.target ?? null,
        causation_id: input.causation_id ?? null,
        correlation_id: input.correlation_id ?? null,
        reply_to: input.reply_to ?? null,
        seq,
        deadline_ms: input.deadline_ms ?? null,
        emitted_at: now,
        payload: input.payload ?? null,
        time_created: now,
        time_updated: now,
      })
      dispatchEvent(event)
      if (input.aggregate === "task" && TASK_TERMINAL_EVENT_TYPES.has(input.type)) {
        clearTaskLiveReplay(input.aggregate_id)
      }
      return event
    }

    if (typeof input.seq === "number" && input.seq > 0) {
      return insert(input.seq)
    }

    return withKeyedLock(eventLocks, eventKey(input), async () =>
      insert(nextAggregateSequence(input.aggregate, input.aggregate_id)),
    )
  }

  export function listTaskEventsAfter(taskID: string, sequence: number, opts?: { until?: number; limit?: number }) {
    const conditions = [
      eq(ProtocolEventTable.aggregate_type, "task"),
      eq(ProtocolEventTable.task_id, taskID),
      gt(ProtocolEventTable.seq, sequence),
    ]
    if (typeof opts?.until === "number") {
      conditions.push(lte(ProtocolEventTable.seq, opts.until))
    }
    return Database.use((db) => {
      const query = db
        .select()
        .from(ProtocolEventTable)
        .where(and(...conditions))
        .orderBy(asc(ProtocolEventTable.seq), asc(ProtocolEventTable.id))
      return typeof opts?.limit === "number" ? query.limit(opts.limit).all() : query.all()
    }).map(eventView)
  }

  export function listTaskEvents(taskID: string) {
    return listTaskEventsAfter(taskID, 0)
  }

  export function latestTaskSequence(taskID: string) {
    const row = Database.use((db) =>
      db
        .select({ seq: ProtocolEventTable.seq })
        .from(ProtocolEventTable)
        .where(and(eq(ProtocolEventTable.aggregate_type, "task"), eq(ProtocolEventTable.task_id, taskID)))
        .orderBy(desc(ProtocolEventTable.seq))
        .get(),
    )
    return row?.seq ?? 0
  }

  export function currentTaskLiveEpoch() {
    return TASK_LIVE_EPOCH
  }

  export function listTaskLiveEventsAfter(
    taskID: string,
    liveSequence: number,
    opts?: { liveEpoch?: number },
  ): TaskLiveReplayResult {
    compactTaskLiveReplay(Date.now())
    const after = Math.max(0, Math.floor(Number(liveSequence) || 0))
    if (typeof opts?.liveEpoch === "number" && opts.liveEpoch !== TASK_LIVE_EPOCH) {
      return {
        expired: true,
        event: taskLiveReplayExpiredEvent(taskID, "selected task live replay epoch changed"),
      }
    }
    const floor = taskLiveRetentionFloors.get(taskID) ?? 0
    if (floor > 0 && after < floor) {
      return {
        expired: true,
        event: taskLiveReplayExpiredEvent(taskID, "selected task live replay retention expired"),
      }
    }
    const events = taskLiveReplayEvents.get(taskID) ?? []
    return {
      expired: false,
      events: events.filter((event) => (event.liveSequence ?? 0) > after),
    }
  }

  export function subscribeEvents(callback: (event: EventView) => void | Promise<void>, filter?: EventFilter) {
    const events = new Channel<EventView>()
    const controller = new AbortController()
    const subscription: EventSubscription = {
      filter,
      dispatch(event) {
        return events.send(event)
      },
      close() {
        events.close()
        controller.abort()
      },
    }
    globalSubscriptions.add(subscription)
    void (async () => {
      for await (const event of events) {
        if (controller.signal.aborted) break
        await Promise.resolve(callback(event)).catch((error) => {
          log.warn("protocol subscriber failed", {
            aggregate: event.aggregate,
            type: event.type,
            error: error instanceof Error ? error.message : String(error),
          })
        })
      }
    })()
    return () => {
      if (!globalSubscriptions.delete(subscription)) return
      subscription.close()
    }
  }

  /**
   * Push an event through live subscriptions WITHOUT writing to DB.
   * Used for events whose source of truth lives in another table — clients
   * see them live via SSE; on reconnect they hydrate from the canonical
   * store (message/part tables for `message.*` events) instead of replaying
   * an event log. Avoids the 双源 footgun where the same content is held in
   * two places (rule 23) and prevents `protocol_event.payload` blowing up
   * by re-snapshotting full message state on every update.
   */
  export function dispatchEphemeral(input: {
    type: string
    aggregate: ProtocolAggregate
    taskID?: string
    runID?: string
    sessionID?: string
    source: string
    payload?: Payload | null
  }) {
    const now = Date.now()
    const taskID = input.aggregate === "task" ? input.taskID : undefined
    const aggregateID = input.aggregate === "task" ? taskID : input.sessionID
    const liveSequence = taskID ? (taskLiveSequences.get(taskID) ?? 0) + 1 : undefined
    if (taskID && liveSequence !== undefined) taskLiveSequences.set(taskID, liveSequence)
    const event: EventView = {
      id: `ephemeral-${now}-${Math.random().toString(36).slice(2, 8)}`,
      kind: "event",
      type: input.type,
      aggregate: input.aggregate,
      aggregateID: aggregateID ?? "",
      taskID,
      runID: input.runID,
      goalRunID: undefined,
      sessionID: input.sessionID,
      interactionID: undefined,
      executorSessionID: undefined,
      streamID: undefined,
      source: input.source,
      target: undefined,
      causationID: undefined,
      correlationID: undefined,
      replyTo: undefined,
      sequence: 0,
      liveSequence,
      liveEpoch: taskID ? TASK_LIVE_EPOCH : undefined,
      deadlineMs: undefined,
      summary: payloadText(input.payload ?? null, "summary") ?? input.type,
      payload: input.payload ?? undefined,
      time: { emitted: now, created: now, updated: now },
    }
    if (taskID) {
      ensureTaskLiveReplaySweep()
      pruneClosedLiveDeltas(taskID, event)
      const events = taskLiveReplayEvents.get(taskID) ?? []
      events.push(event)
      taskLiveReplayEvents.set(taskID, events)
      compactTaskLiveReplay(now)
    }
    dispatchEvent(event)
  }

  export function compactLiveReplay(now = Date.now()) {
    compactTaskLiveReplay(now)
  }

  export function liveReplayStats() {
    let events = 0
    for (const list of taskLiveReplayEvents.values()) events += list.length
    return {
      tasks: taskLiveReplayEvents.size,
      events,
      sequenceTasks: taskLiveSequences.size,
      retentionFloorTasks: taskLiveRetentionFloors.size,
      subscriptions: globalSubscriptions.size,
    }
  }
}

function nextAggregateSequence(aggregate: ProtocolAggregate, aggregateID: string) {
  const row = Database.use((db) =>
    db
      .select({ seq: ProtocolEventTable.seq })
      .from(ProtocolEventTable)
      .where(and(eq(ProtocolEventTable.aggregate_type, aggregate), eq(ProtocolEventTable.aggregate_id, aggregateID)))
      .orderBy(desc(ProtocolEventTable.seq))
      .get(),
  )
  return (row?.seq ?? 0) + 1
}
