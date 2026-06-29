import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Instance } from "@/project/instance"
import { ProtocolStore } from "@/protocol/store"
import { SessionEvents } from "@/session/events"
import { Message } from "@/session/message"
import { SessionStatus, sessionLifecycleOrderKey } from "@/session/status"
import { TaskReport } from "@/tool/task-report"
import { Log } from "@/util/log"
import { Database, and, eq } from "@/storage/db"
import { MessageTable, PartTable, type SessionKind } from "@/session/session.sql"
import { taskIDForSession, taskSession, sessionRole, sessionGoalID, sessionParentID } from "../task-event"
import { timelineMessageOrderKey, timelinePartOrderKey } from "@/timeline/order"

const log = Log.create({ service: "task-message-protocol-bridge" })
let globalRelayInitialized = false
const initializedLocalDirectories = new Set<string>()
let crossInstanceBridgeQueue = Promise.resolve()

// ── Overlay rendering metadata ──
//
// `session.kind` is the authoritative source for "what is this session for".
// The overlay renders a card per kind; this module's job is to stamp the kind
// (and goalID / parentSessionID) onto every outgoing message event payload so
// the frontend can route without re-deriving anything.
//
// Routing metadata belongs to the event envelope and message info. It must not
// be copied into Message.Part: parts are a strict persisted protocol model.
// `orderKey` is part of that DTO projection, not overlay routing metadata.

/** Display channel — which card the overlay groups this message under.
 *  "main" is the top-level conversation; the rest mirror SessionKind values
 *  (minus "root", which is the task container, not a card). */
export type OverlayChannel = "main" | Exclude<SessionKind, "root">

/** What the message is rendered as. "user" marks human-authored input (root
 *  main channel only). Every other value aligns with a sub-agent kind and
 *  drives the overlay's bubble styling for that speaker. Crucially, when a
 *  child session records a `role: "user"` message, the author is NOT human
 *  — it is the orchestrator dispatching a brief to that sub-agent (goal
 *  contract, architect consensus, intent-bundle pointer, retry feedback,
 *  …). We therefore resolve to `"orchestrator"`, so the overlay renders it
 *  with orchestrator styling and does not mislead observers into thinking
 *  a human spoke. */
export type OverlayResolvedRole = "user" | OverlayChannel

type OverlayMessageInfo = {
  role?: string
  orderKey?: string
  extra?: Record<string, unknown>
}

function isOverlayDirectReply(info: OverlayMessageInfo): boolean {
  return info.extra?.overlay_direct_reply === true
}

/**
 * Compute overlay metadata for a message event.
 *
 * Contract (driven by `session.kind`):
 * - User on root → resolvedRole="user", channel="main" (top-level user bubble)
 * - User on sub-agent session → resolvedRole="orchestrator", channel=session.kind,
 *   unless `extra.overlay_direct_reply=true` marks a human overlay reply.
 *   Plain child-session user messages are engine-synthesized dispatch briefs:
 *   orchestrator authors them, and the card still lives under the sub-agent's
 *   phase/stage.
 * - Assistant on sub-agent session → resolvedRole=session.kind, channel=session.kind
 * - Assistant on root → invalid: root sessions only hold user-authored content
 *
 * Bridge enrichment never mutates `info.agent` to override the inner engine's
 * self-stamp — the engine's name is meaningless for routing; only session.kind
 * matters.
 */
export function overlayMeta(
  sessionID: string,
  rootSessionID: string,
  info: OverlayMessageInfo,
): { resolvedRole: OverlayResolvedRole; channel: OverlayChannel } {
  // No "assistant" fallback (rule: 一个萝卜一个坑). Every message MUST carry
  // an explicit role. Falling back silently routes role-less messages into
  // the generic assistant card and orphans the actual agent's stream — fix
  // the emitter, don't paper over it here.
  if (typeof info.role !== "string" || info.role.length === 0) {
    throw new Error(
      `overlayMeta: message on session ${sessionID} has no info.role. ` +
        `Every message emitter must set role explicitly (user / assistant). ` +
        `Find the upstream caller that constructed this message and add the role.`,
    )
  }
  const role = info.role

  const kind = sessionRole(sessionID)
  if (!kind) {
    throw new Error(
      `overlayMeta: session ${sessionID} has no kind in the DB. Every session ` +
        `must be created via Session.createNext({kind: ...}); a row missing kind ` +
        `means a code path bypassed createNext or the row was inserted directly.`,
    )
  }
  const parentID = sessionParentID(sessionID)
  const isRoot = (!!rootSessionID && sessionID === rootSessionID) || (!rootSessionID && kind === "root" && !parentID)

  if (isRoot) {
    if (role !== "user") {
      throw new Error(
        `overlayMeta: ${role} message on root session ${sessionID}. Root ` +
          `sessions only hold user-authored content; assistant output must be ` +
          `written to a child session with a non-root kind.`,
      )
    }
    return { resolvedRole: "user", channel: "main" }
  }

  if (kind === "root") {
    throw new Error(
      `overlayMeta: child session ${sessionID} has kind="root" (only the ` +
        `task's session_id should be a root). Probably a Session.createNext ` +
        `call passed kind="root" with a parentID.`,
    )
  }
  if (role === "user") {
    if (!parentID) return { resolvedRole: "user", channel: "main" }
    return { resolvedRole: isOverlayDirectReply(info) ? "user" : "orchestrator", channel: kind }
  }
  return { resolvedRole: kind, channel: kind }
}

function sessionFromProperties(properties: Record<string, unknown>) {
  if (typeof properties.sessionID === "string" && properties.sessionID) return properties.sessionID
  const info = properties.info
  if (info && typeof info === "object" && "sessionID" in info && typeof info.sessionID === "string") {
    return info.sessionID
  }
  const part = properties.part
  if (part && typeof part === "object" && "sessionID" in part && typeof part.sessionID === "string") {
    return part.sessionID
  }
  return ""
}

const messageInfoCache = new Map<string, { role: string; orderKey: string; extra?: Record<string, unknown> }>()

function rememberMessageInfo(
  messageID: string,
  info: { role: string; orderKey: string; extra?: Record<string, unknown> },
) {
  if (!messageID) return
  messageInfoCache.set(messageID, info)
  if (messageInfoCache.size > 500) {
    const first = messageInfoCache.keys().next().value
    if (first) messageInfoCache.delete(first)
  }
}

function cacheMessageInfo(properties: Record<string, unknown>) {
  const info = properties.info as any
  if (!info?.id) return
  if (typeof info.role !== "string" || info.role.length === 0) {
    throw new Error(
      `cacheMessageInfo: message ${info.id} missing info.role — every emitter ` +
      `must set role explicitly; no "assistant" fallback (一个萝卜一个坑).`,
    )
  }
  if (typeof info.orderKey !== "string" || info.orderKey.length === 0) {
    throw new Error(`cacheMessageInfo: message ${info.id} missing info.orderKey`)
  }
  rememberMessageInfo(info.id, {
    role: info.role,
    orderKey: info.orderKey,
    ...(info.extra && typeof info.extra === "object" ? { extra: info.extra as Record<string, unknown> } : {}),
  })
}

function readPersistedMessageInfo(
  messageID: string,
): { role: string; orderKey: string; extra?: Record<string, unknown> } | undefined {
  const row = Database.use((db) =>
    db
      .select({ data: MessageTable.data, timeCreated: MessageTable.time_created })
      .from(MessageTable)
      .where(eq(MessageTable.id, messageID))
      .get(),
  )
  if (!row) return undefined
  const role =
    row.data && typeof row.data === "object" && "role" in row.data
      ? (row.data as Record<string, unknown>).role
      : undefined
  if (typeof role !== "string" || !role) return undefined
  const extra =
    row.data && typeof row.data === "object" && "extra" in row.data
      ? (row.data as Record<string, unknown>).extra
      : undefined
  const info = {
    role,
    orderKey: timelineMessageOrderKey({
      info: {
        id: messageID,
        time: { created: row.timeCreated },
      },
    }),
    ...(extra && typeof extra === "object" ? { extra: extra as Record<string, unknown> } : {}),
  }
  rememberMessageInfo(messageID, info)
  return info
}

function partRecord(properties: Record<string, unknown>): Record<string, unknown> {
  const part = properties.part
  if (!part || typeof part !== "object" || Array.isArray(part)) {
    throw new Error("bridge: part event missing part while enriching event")
  }
  return part as Record<string, unknown>
}

function partOrderKeysForEvent(properties: Record<string, unknown>): { messageOrderKey: string; partOrderKey: string } {
  const part = partRecord(properties)
  const partID = typeof part.id === "string" ? part.id : ""
  const messageID = typeof part.messageID === "string" ? part.messageID : ""
  const sessionID = typeof part.sessionID === "string" ? part.sessionID : ""
  if (!partID || !messageID || !sessionID) {
    throw new Error("bridge: part event missing part id/messageID/sessionID while enriching event")
  }
  const rows = Database.use((db) => ({
    message: db
      .select({ timeCreated: MessageTable.time_created })
      .from(MessageTable)
      .where(and(eq(MessageTable.id, messageID), eq(MessageTable.session_id, sessionID)))
      .get(),
    part: db
      .select({ timeCreated: PartTable.time_created })
      .from(PartTable)
      .where(and(eq(PartTable.id, partID), eq(PartTable.message_id, messageID), eq(PartTable.session_id, sessionID)))
      .get(),
  }))
  if (!rows.message) throw new Error(`bridge: message ${messageID} missing persisted row while enriching part event`)
  if (!rows.part) throw new Error(`bridge: part ${partID} missing persisted row while enriching event`)
  const messageOrderKey = timelineMessageOrderKey({
    info: {
      id: messageID,
      time: { created: rows.message.timeCreated },
    },
  })
  const partOrderKey = timelinePartOrderKey({ id: partID, timeCreated: rows.part.timeCreated })
  const provided = part.orderKey
  if (typeof provided === "string" && provided.length > 0 && provided !== partOrderKey) {
    throw new Error(`bridge: part ${partID} orderKey drift between payload and persisted row`)
  }
  const eventOrderKey = properties.orderKey
  if (typeof eventOrderKey === "string" && eventOrderKey.length > 0 && eventOrderKey !== messageOrderKey) {
    throw new Error(`bridge: part event ${partID} orderKey drift between payload and owning message`)
  }
  return { messageOrderKey, partOrderKey }
}

function infoForEvent(properties: Record<string, unknown>): {
  role: string
  orderKey: string
  extra?: Record<string, unknown>
} {
  const info = properties.info as any
  if (info && typeof info === "object" && info.role) {
    if (typeof info.orderKey !== "string" || info.orderKey.length === 0) {
      throw new Error(`bridge: message ${String(info.id || "<unknown>")} missing info.orderKey`)
    }
    return {
      role: String(info.role),
      orderKey: info.orderKey,
      ...(info.extra && typeof info.extra === "object" ? { extra: info.extra as Record<string, unknown> } : {}),
    }
  }
  const part = properties.part as any
  if (part?.metadata?.overlay_direct_reply === true) {
    const messageID = part?.messageID || (properties as any).messageID || ""
    const persisted = messageID ? readPersistedMessageInfo(messageID) : undefined
    if (!persisted) throw new Error(`bridge: direct-reply part missing persisted message info for ${messageID}`)
    return { role: "user", orderKey: persisted.orderKey, extra: { overlay_direct_reply: true } }
  }
  const messageID = part?.messageID || (properties as any).messageID || ""
  if (messageID && messageInfoCache.has(messageID)) {
    return messageInfoCache.get(messageID)!
  }
  if (messageID) {
    const persisted = readPersistedMessageInfo(messageID)
    if (persisted) return persisted
    throw new Error(`bridge: message ${messageID} missing role in cache and DB while enriching event`)
  }
  throw new Error("bridge: event missing both info.role and messageID")
}

/**
 * Stamp resolvedRole / channel / goalID / parentSessionID onto every event.
 * Source of truth: session.kind, session.goal_id, session.parent_id.
 */
function enrichProperties(
  type: string,
  properties: Record<string, unknown>,
  sessionID: string,
  taskID: string,
): Record<string, unknown> {
  const info = infoForEvent(properties)
  const rootSessionID = taskSession(taskID) || ""
  const meta = overlayMeta(sessionID, rootSessionID, info)
  const goalID = sessionGoalID(sessionID)
  const parentSessionID = sessionParentID(sessionID)
  const enriched = { ...properties }

  if (type === Message.Event.PartUpdated.type) {
    const { messageOrderKey, partOrderKey } = partOrderKeysForEvent(properties)
    enriched.part = { ...partRecord(properties), orderKey: partOrderKey }
    enriched.orderKey = messageOrderKey
  } else if (enriched.info && typeof enriched.info === "object") {
    const infoWithMeta = {
      ...(enriched.info as any),
      resolvedRole: meta.resolvedRole,
      channel: meta.channel,
      ...(goalID ? { goalID } : {}),
      ...(parentSessionID ? { parentSessionID } : {}),
    }
    if (typeof infoWithMeta.orderKey !== "string" || infoWithMeta.orderKey.length === 0) {
      throw new Error(`bridge: message ${String((infoWithMeta as any).id || "<unknown>")} missing info.orderKey`)
    }
    enriched.info = {
      ...infoWithMeta,
      orderKey: infoWithMeta.orderKey,
    }
  } else {
    enriched.orderKey = info.orderKey
  }
  enriched.resolvedRole = meta.resolvedRole
  enriched.channel = meta.channel
  if (goalID) enriched.goalID = goalID
  if (parentSessionID) enriched.parentSessionID = parentSessionID
  return enriched
}

function ephemeralEnvelopeOrderKey(type: string, payload: Record<string, unknown>): string {
  if (type === Message.Event.Updated.type) {
    const info = payload.info
    const orderKey = info && typeof info === "object" ? (info as Record<string, unknown>).orderKey : undefined
    if (typeof orderKey === "string" && orderKey.length > 0) return orderKey
    throw new Error("bridge: message.updated missing envelope orderKey")
  }
  const orderKey = payload.orderKey
  if (typeof orderKey === "string" && orderKey.length > 0) return orderKey
  throw new Error(`bridge: ${type} missing envelope orderKey`)
}

/**
 * Stamp routing metadata onto lifecycle events without requiring a message
 * role. `session.status` and `session.idle` are about the session itself;
 * they do not have an authoring message and therefore must not enter
 * `infoForEvent()`.
 */
function enrichLifecycleProperties(
  properties: Record<string, unknown>,
  sessionID: string,
  input?: { orderKey?: string },
): Record<string, unknown> {
  const kind = sessionRole(sessionID)
  if (!kind) {
    throw new Error(
      `bridge: lifecycle event for session ${sessionID} has no kind in the database. ` +
        `Every lifecycle event must target a persisted Session row.`,
    )
  }
  const goalID = sessionGoalID(sessionID)
  const parentSessionID = sessionParentID(sessionID)
  const enriched: Record<string, unknown> = {
    ...properties,
    channel: kind === "root" ? "main" : kind,
  }
  if (input?.orderKey) {
    const provided = typeof properties.orderKey === "string" ? properties.orderKey.trim() : ""
    if (provided && provided !== input.orderKey) {
      throw new Error(`bridge: lifecycle event for session ${sessionID} orderKey drift between input and session row`)
    }
    enriched.orderKey = input.orderKey
  }
  if (kind !== "root") enriched.resolvedRole = kind
  if (goalID) enriched.goalID = goalID
  if (parentSessionID) enriched.parentSessionID = parentSessionID
  return enriched
}

function bridgeFailureSummary(type: string, error: string) {
  return `Session bridge failed to persist ${type}: ${error}`
}

function appendBridgePersistFailure(input: {
  taskID: string
  sessionID: string
  type: string
  error: string
  properties: Record<string, unknown>
}) {
  const now = Date.now()
  return ProtocolStore.appendEvent({
    kind: "event",
    type: "session.bridge.persist_failed",
    aggregate: "task",
    aggregate_id: input.taskID,
    task_id: input.taskID,
    run_id: null,
    goal_run_id: null,
    session_id: null,
    interaction_id: null,
    stream_id: null,
    source: "session.bridge",
    target: null,
    correlation_id: null,
    causation_id: null,
    reply_to: null,
    emitted_at: now,
    payload: {
      taskID: input.taskID,
      sessionID: input.sessionID,
      failed_type: input.type,
      error: input.error,
      summary: bridgeFailureSummary(input.type, input.error),
      original: input.properties,
    },
  })
}

function appendBridgeEvent(input: {
  type: string
  taskID: string
  sessionID: string
  orderKey?: string
  payload: Record<string, unknown>
}) {
  const now = Date.now()
  void ProtocolStore.appendEvent({
    kind: "event",
    type: input.type,
    aggregate: "task",
    aggregate_id: input.taskID,
    task_id: input.taskID,
    run_id: null,
    goal_run_id: null,
    session_id: input.sessionID,
    interaction_id: null,
    stream_id: null,
    source: "session.bridge",
    target: null,
    correlation_id: null,
    causation_id: null,
    reply_to: null,
    emitted_at: now,
    order_key: input.orderKey,
    payload: input.payload,
  }).catch((err) => {
    const detail = err instanceof Error ? err.message : String(err)
    log.warn("bridge: session event persist failed", { type: input.type, error: detail })
    void appendBridgePersistFailure({
      taskID: input.taskID,
      sessionID: input.sessionID,
      type: input.type,
      error: detail,
      properties: input.payload,
    }).catch((diagnosticError) => {
      log.error("bridge: failed to persist bridge diagnostic event", {
        type: input.type,
        error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
      })
    })
  })
}

function appendBridgePreparationFailure(input: { type: string; properties: Record<string, unknown>; error: string }) {
  const sessionID = sessionFromProperties(input.properties)
  if (!sessionID) {
    log.warn("bridge: cannot persist bridge preparation failure without session id", {
      type: input.type,
      error: input.error,
    })
    return
  }
  const taskID = taskIDForSession(sessionID)
  if (!taskID) {
    log.warn("bridge: cannot persist bridge preparation failure for non-task-owned session", {
      type: input.type,
      sessionID,
      error: input.error,
    })
    return
  }
  void appendBridgePersistFailure({
    taskID,
    sessionID,
    type: input.type,
    error: input.error,
    properties: input.properties,
  }).catch((diagnosticError) => {
    log.error("bridge: failed to persist bridge preparation diagnostic event", {
      type: input.type,
      sessionID,
      error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
    })
  })
}

function messageEventDiagnosticProperties(properties: Record<string, unknown>): Record<string, unknown> {
  const diagnostic: Record<string, unknown> = {}
  if (typeof properties.sessionID === "string" && properties.sessionID) diagnostic.sessionID = properties.sessionID
  if (typeof properties.messageID === "string" && properties.messageID) diagnostic.messageID = properties.messageID
  if (typeof properties.partID === "string" && properties.partID) diagnostic.partID = properties.partID
  if (typeof properties.field === "string" && properties.field) diagnostic.field = properties.field

  const info = properties.info
  if (info && typeof info === "object") {
    const value = info as Record<string, unknown>
    diagnostic.info = {
      ...(typeof value.id === "string" && value.id ? { id: value.id } : {}),
      ...(typeof value.sessionID === "string" && value.sessionID ? { sessionID: value.sessionID } : {}),
      ...(typeof value.role === "string" && value.role ? { role: value.role } : {}),
    }
  }

  const part = properties.part
  if (part && typeof part === "object") {
    const value = part as Record<string, unknown>
    diagnostic.part = {
      ...(typeof value.id === "string" && value.id ? { id: value.id } : {}),
      ...(typeof value.sessionID === "string" && value.sessionID ? { sessionID: value.sessionID } : {}),
      ...(typeof value.messageID === "string" && value.messageID ? { messageID: value.messageID } : {}),
      ...(typeof value.type === "string" && value.type ? { type: value.type } : {}),
    }
  }

  return diagnostic
}

function bridgeDiagnosticPropertiesForType(
  type: string,
  properties: Record<string, unknown>,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const diagnostic = type.startsWith("message.") ? messageEventDiagnosticProperties(properties) : { ...properties }
  return extra ? { ...diagnostic, ...extra } : diagnostic
}

/**
 * Push a message event through live SSE subscriptions only.
 *
 * Message events are NEVER persisted to `protocol_event`. Source of truth for
 * messages is the `message` / `part` tables — clients hydrate from those on
 * reconnect (see Session.messages). Persisting would be a 双源 violation
 * (rule 23) and historically blew up `protocol_event.payload` to hundreds of
 * MB by re-snapshotting the full message on every update.
 */
/**
 * Push a session-lifecycle event (session.status / session.idle) through SSE
 * AND persist it in `protocol_event`. Unlike message events, lifecycle events
 * are tiny (sessionID + status enum + optional reason/error) and benefit from
 * persistence: an overlay reconnect replays from `protocol_event`, so cards
 * reload with their last terminal status instead of falling back to the
 * default `running` and re-spinning forever.
 *
 * Single source of truth for session lifecycle, per
 * `specs/current/architecture/07-panel-reactivity.md`. The persisted row also feeds
 * `engine/store.ts listActiveSessionsForTask`'s NOT EXISTS terminal exclusion.
 */
function bridgeSessionLifecycle(type: string, properties: Record<string, unknown>) {
  try {
    const sessionID = sessionFromProperties(properties)
    if (!sessionID) return
    const taskID = taskIDForSession(sessionID)
    if (!taskID) return
    const orderKey = sessionLifecycleOrderKey(sessionID)
    const enriched = enrichLifecycleProperties(properties, sessionID, { orderKey })
    appendBridgeEvent({ type, taskID, sessionID, orderKey, payload: enriched })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    appendBridgePreparationFailure({ type, properties, error })
    log.warn("bridge: session lifecycle preparation failed", { type, error })
  }
}

function sessionErrorSummary(properties: Record<string, unknown>): string {
  const error = properties.error as { data?: { message?: unknown }; message?: unknown; name?: unknown } | undefined
  const dataMessage = error?.data?.message
  if (typeof dataMessage === "string" && dataMessage.length > 0) return dataMessage
  const message = error?.message
  if (typeof message === "string" && message.length > 0) return message
  const name = error?.name
  if (typeof name === "string" && name.length > 0) return name
  return "session stream error"
}

/**
 * Persist session stream/provider errors independently of terminal lifecycle.
 * A provider can fail while the processor later reports a secondary symptom
 * (for example "terminal tool missing"). The operator must see the original
 * stream error, so it gets its own tiny replayable event instead of being only
 * a process log line.
 */
function bridgeSessionError(type: string, properties: Record<string, unknown>) {
  try {
    const sessionID = sessionFromProperties(properties)
    if (!sessionID) return
    const taskID = taskIDForSession(sessionID)
    if (!taskID) return
    const orderKey = sessionLifecycleOrderKey(sessionID)
    const enriched = enrichLifecycleProperties(properties, sessionID, { orderKey })
    appendBridgeEvent({
      type,
      taskID,
      sessionID,
      orderKey,
      payload: {
        ...enriched,
        summary: sessionErrorSummary(properties),
      },
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    appendBridgePreparationFailure({ type, properties, error })
    log.warn("bridge: session error preparation failed", { type, error })
  }
}

function bridgeTaskReport(properties: Record<string, unknown>) {
  try {
    const sessionID = sessionFromProperties(properties)
    if (!sessionID) throw new Error("task.report missing sessionID")
    const resolvedTaskID = taskIDForSession(sessionID)
    if (!resolvedTaskID) throw new Error(`task.report session ${sessionID} is not task-owned`)
    const payloadTaskID = typeof properties.taskID === "string" && properties.taskID ? properties.taskID : undefined
    if (payloadTaskID && payloadTaskID !== resolvedTaskID) {
      throw new Error(
        `task.report taskID ${payloadTaskID} does not own session ${sessionID}; expected ${resolvedTaskID}`,
      )
    }
    const enriched = enrichLifecycleProperties({ ...properties, taskID: resolvedTaskID }, sessionID)
    appendBridgeEvent({
      type: TaskReport.EventDef.type,
      taskID: resolvedTaskID,
      sessionID,
      payload: {
        ...enriched,
        summary: typeof properties.summary === "string" ? properties.summary : "task report",
      },
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    appendBridgePreparationFailure({ type: TaskReport.EventDef.type, properties, error })
    log.warn("bridge: task report preparation failed", { error })
  }
}

function bridgeEvent(type: string, properties: Record<string, unknown>) {
  // Top-level guard: subscribers run synchronously inside Bus.dispatch's for-loop;
  // a sync throw here would abort dispatch for sibling subscribers. Old code hid
  // this behind enqueueBridgeWork's swallowed promise — keep the same behaviour
  // explicitly so transient DB / lookup failures degrade an event, not the bus.
  try {
    const sessionID = sessionFromProperties(properties)
    if (!sessionID) return
    const taskID = taskIDForSession(sessionID)
    if (!taskID) return
    const enriched = enrichProperties(type, properties, sessionID, taskID)
    ProtocolStore.dispatchEphemeral({
      type,
      aggregate: "task",
      taskID,
      sessionID,
      source: "session.bridge",
      orderKey: ephemeralEnvelopeOrderKey(type, enriched),
      payload: enriched,
    })
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    appendBridgePreparationFailure({ type, properties: messageEventDiagnosticProperties(properties), error })
    log.warn("bridge: live message event preparation failed", { type, error })
  }
}

function enqueueCrossInstanceBridge(
  type: string,
  props: Record<string, unknown>,
  hostDirectory: string,
  sourceDirectory: string | undefined,
  handler: (props: Record<string, unknown>) => void,
) {
  crossInstanceBridgeQueue = crossInstanceBridgeQueue
    .catch(() => undefined)
    .then(() =>
      Instance.provide({
        directory: hostDirectory,
        fn: () => {
          handler(props)
        },
      }),
    )
    .catch((err) => {
      const error = err instanceof Error ? err.message : String(err)
      void Instance.provide({
        directory: hostDirectory,
        fn: () => {
          appendBridgePreparationFailure({
            type,
            properties: bridgeDiagnosticPropertiesForType(type, props, {
              ...(sourceDirectory ? { sourceDirectory } : {}),
            }),
            error,
          })
        },
      }).catch((diagnosticError) => {
        log.error("bridge: failed to persist cross-instance relay diagnostic", {
          type,
          sourceDirectory,
          error: diagnosticError instanceof Error ? diagnosticError.message : String(diagnosticError),
        })
      })
      log.error("bridge: cross-instance relay failed", {
        type,
        sourceDirectory,
        error,
      })
    })
    .then(() => undefined)
}

// Cross-Instance event types and their handlers. Additions don't require
// touching dispatch logic — register the type → handler here.
const CROSS_INSTANCE_HANDLERS: Record<string, (props: Record<string, unknown>) => void> = {
  [Message.Event.Updated.type]: (props) => {
    cacheMessageInfo(props)
    bridgeEvent(Message.Event.Updated.type, props)
  },
  [Message.Event.PartUpdated.type]: (props) => {
    bridgeEvent(Message.Event.PartUpdated.type, props)
  },
  [Message.Event.Removed.type]: (props) => {
    bridgeEvent(Message.Event.Removed.type, props)
  },
  [Message.Event.PartRemoved.type]: (props) => {
    bridgeEvent(Message.Event.PartRemoved.type, props)
  },
  [Message.Event.PartDelta.type]: (props) => {
    bridgeEvent(Message.Event.PartDelta.type, props)
  },
  [SessionStatus.Event.Status.type]: (props) => {
    bridgeSessionLifecycle(SessionStatus.Event.Status.type, props)
  },
  [SessionStatus.Event.Idle.type]: (props) => {
    bridgeSessionLifecycle(SessionStatus.Event.Idle.type, props)
  },
  [SessionEvents.Error.type]: (props) => {
    bridgeSessionError(SessionEvents.Error.type, props)
  },
  [TaskReport.EventDef.type]: (props) => {
    bridgeTaskReport(props)
  },
}

const MESSAGE_TYPES = new Set(Object.keys(CROSS_INSTANCE_HANDLERS))

export function ensureTaskMessageProtocolBridge() {
  const localDirectory = Instance.directory
  if (!initializedLocalDirectories.has(localDirectory)) {
    initializedLocalDirectories.add(localDirectory)

    Bus.subscribe(Message.Event.Updated, (event) => {
      cacheMessageInfo(event.properties)
      bridgeEvent(Message.Event.Updated.type, event.properties)
    })
    Bus.subscribe(Message.Event.PartUpdated, (event) => {
      bridgeEvent(Message.Event.PartUpdated.type, event.properties)
    })
    Bus.subscribe(Message.Event.Removed, (event) => {
      bridgeEvent(Message.Event.Removed.type, event.properties)
    })
    Bus.subscribe(Message.Event.PartRemoved, (event) => {
      bridgeEvent(Message.Event.PartRemoved.type, event.properties)
    })
    Bus.subscribe(Message.Event.PartDelta, (event) => {
      bridgeEvent(Message.Event.PartDelta.type, event.properties)
    })
    Bus.subscribe(SessionStatus.Event.Status, (event) => {
      bridgeSessionLifecycle(SessionStatus.Event.Status.type, event.properties)
    })
    Bus.subscribe(SessionStatus.Event.Idle, (event) => {
      bridgeSessionLifecycle(SessionStatus.Event.Idle.type, event.properties)
    })
    Bus.subscribe(SessionEvents.Error, (event) => {
      bridgeSessionError(SessionEvents.Error.type, event.properties)
    })
    Bus.subscribe(TaskReport.EventDef, (event) => {
      bridgeTaskReport(event.properties)
    })
    Bus.subscribe(Bus.InstanceDisposed, (event) => {
      initializedLocalDirectories.delete(event.properties.directory)
    })
  }

  if (globalRelayInitialized) return
  globalRelayInitialized = true

  // Cross-Instance bridge: executor sessions run in worktree Instances whose
  // Bus.publish() never reaches the main Instance's subscribers. GlobalBus
  // sees all Instances; we re-execute inside the host Instance context so
  // Database lookups (sessionRole etc.) use the main DB, not the worktree's.
  GlobalBus.on("event", (envelope) => {
    if (!envelope.payload || !MESSAGE_TYPES.has(envelope.payload.type)) return
    const hostDirectory = Instance.directory
    if (envelope.directory === hostDirectory) return
    const props = envelope.payload.properties
    if (!props) return
    const handler = CROSS_INSTANCE_HANDLERS[envelope.payload.type]
    if (!handler) return
    enqueueCrossInstanceBridge(envelope.payload.type, props, hostDirectory, envelope.directory, handler)
  })
}
