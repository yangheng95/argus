import { Identifier } from "@/id/id"
import { Instance } from "@/project/instance"
import { State } from "@/project/state"
import { Database, and, asc, desc, eq, gt } from "@/storage/db"
import { Channel } from "@/util/channel"
import { withKeyedLock } from "@/util/lock"
import { Log } from "@/util/log"
import { ProtocolEventTable, ProtocolStreamChunkTable } from "./protocol.sql"
import type { ProtocolAggregate, ProtocolKind, ProtocolStreamKind } from "./schema"

const eventLocks = new Map<string, Promise<void>>()
const streamLocks = new Map<string, Promise<void>>()
const log = Log.create({ service: "protocol.store" })

type Payload = Record<string, unknown>

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

type ChunkInput = {
  stream_id: string
  task_id?: string | null
  run_id?: string | null
  goal_run_id?: string | null
  session_id?: string | null
  kind: ProtocolStreamKind
  text: string
  payload?: Payload | null
  emitted_at?: number
  chunk_seq?: number
}

type EventRow = typeof ProtocolEventTable.$inferSelect
type ChunkRow = typeof ProtocolStreamChunkTable.$inferSelect
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

const live = State.create(
  () => {
    try {
      return Instance.directory
    } catch {
      return "__protocol_global__"
    }
  },
  () => ({
    subscriptions: new Set<EventSubscription>(),
  }),
  async (entry) => {
    for (const subscription of entry.subscriptions) subscription.close()
    entry.subscriptions.clear()
  },
)

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
  for (const subscription of live().subscriptions) {
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

function chunkView(row: ChunkRow) {
  return {
    id: row.id,
    streamID: row.stream_id,
    taskID: row.task_id ?? undefined,
    runID: row.run_id ?? undefined,
    goalRunID: row.goal_run_id ?? undefined,
    sessionID: row.session_id ?? undefined,
    kind: row.kind,
    chunkSequence: row.chunk_seq,
    text: row.text,
    payload: row.payload ?? undefined,
    time: {
      emitted: row.emitted_at,
      created: row.time_created,
      updated: row.time_updated,
    },
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
      return event
    }

    if (typeof input.seq === "number" && input.seq > 0) {
      return insert(input.seq)
    }

    return withKeyedLock(eventLocks, eventKey(input), async () => insert(nextAggregateSequence(input.aggregate, input.aggregate_id)))
  }

  export function listTaskEventsAfter(taskID: string, sequence: number) {
    return Database.use((db) =>
      db
        .select()
        .from(ProtocolEventTable)
        .where(and(
          eq(ProtocolEventTable.aggregate_type, "task"),
          eq(ProtocolEventTable.task_id, taskID),
          gt(ProtocolEventTable.seq, sequence),
        ))
        .orderBy(asc(ProtocolEventTable.seq), asc(ProtocolEventTable.id))
        .all(),
    ).map(eventView)
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
    live().subscriptions.add(subscription)
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
      if (!live().subscriptions.delete(subscription)) return
      subscription.close()
    }
  }

  export async function appendChunk(input: ChunkInput) {
    const now = input.emitted_at ?? Date.now()
    const insert = (chunkSeq: number) => {
      const id = Identifier.ascending("protocol_stream_chunk")
      Database.use((db) =>
        db
          .insert(ProtocolStreamChunkTable)
          .values({
            id,
            stream_id: input.stream_id,
            task_id: input.task_id ?? null,
            run_id: input.run_id ?? null,
            goal_run_id: input.goal_run_id ?? null,
            session_id: input.session_id ?? null,
            kind: input.kind,
            chunk_seq: chunkSeq,
            text: input.text,
            payload: input.payload ?? null,
            emitted_at: now,
            time_created: now,
            time_updated: now,
          })
          .run(),
      )
      return chunkView({
        id,
        stream_id: input.stream_id,
        task_id: input.task_id ?? null,
        run_id: input.run_id ?? null,
        goal_run_id: input.goal_run_id ?? null,
        session_id: input.session_id ?? null,
        kind: input.kind,
        chunk_seq: chunkSeq,
        text: input.text,
        payload: input.payload ?? null,
        emitted_at: now,
        time_created: now,
        time_updated: now,
      })
    }

    if (typeof input.chunk_seq === "number" && input.chunk_seq >= 0) {
      return insert(input.chunk_seq)
    }

    return withKeyedLock(streamLocks, input.stream_id, async () => insert(nextChunkSequence(input.stream_id)))
  }

  export function listChunksAfter(streamID: string, chunkSequence: number) {
    return Database.use((db) =>
      db
        .select()
        .from(ProtocolStreamChunkTable)
        .where(and(eq(ProtocolStreamChunkTable.stream_id, streamID), gt(ProtocolStreamChunkTable.chunk_seq, chunkSequence)))
        .orderBy(asc(ProtocolStreamChunkTable.chunk_seq), asc(ProtocolStreamChunkTable.id))
        .all(),
    ).map(chunkView)
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

function nextChunkSequence(streamID: string) {
  const row = Database.use((db) =>
    db
      .select({ chunk_seq: ProtocolStreamChunkTable.chunk_seq })
      .from(ProtocolStreamChunkTable)
      .where(eq(ProtocolStreamChunkTable.stream_id, streamID))
      .orderBy(desc(ProtocolStreamChunkTable.chunk_seq))
      .get(),
  )
  return (row?.chunk_seq ?? -1) + 1
}
