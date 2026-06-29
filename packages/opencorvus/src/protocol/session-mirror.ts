import { GlobalBus } from "@/bus/global"
import { PermissionNext } from "@/permission/next"
import { ProtocolStore } from "@/protocol/store"
import { Question } from "@/question"
import { Message, Session, SessionStatus } from "@/session"
import { sessionGoalID, sessionRole } from "@/orchestrator/task-event"
import { overlayMeta } from "@/orchestrator/protocol/message-bridge"
import { Identifier } from "@/id/id"
import { Database, and, eq } from "@/storage/db"
import { MessageTable, PartTable, SessionTable } from "@/session/session.sql"
import { Log } from "@/util/log"
import { timelineMessageOrderKey, timelineOrderKey, timelinePartOrderKey } from "@/timeline/order"

const log = Log.create({ service: "session-mirror" })

export type SessionBusEvent = {
  type: string
  properties: Record<string, unknown>
}

export type SessionMirrorEvent = {
  type: string
  summary?: string
  payload?: Record<string, unknown>
}

export function sessionBusEventSessionID(event: SessionBusEvent): string | undefined {
  const props = event.properties
  if (typeof props.sessionID === "string" && props.sessionID.length > 0) return props.sessionID
  const info = props.info
  if (typeof info === "object" && info !== null && typeof (info as Record<string, unknown>).sessionID === "string") {
    return (info as Record<string, unknown>).sessionID as string
  }
  const part = props.part
  if (typeof part === "object" && part !== null && typeof (part as Record<string, unknown>).sessionID === "string") {
    return (part as Record<string, unknown>).sessionID as string
  }
  return undefined
}

type MessageOverlayInfo = {
  role: string
  orderKey: string
  extra?: Record<string, unknown>
}

function persistedMessageOverlayInfo(messageID: string): MessageOverlayInfo {
  const row = Database.use((db) =>
    db
      .select({ data: MessageTable.data, timeCreated: MessageTable.time_created })
      .from(MessageTable)
      .where(eq(MessageTable.id, messageID))
      .get(),
  )
  if (!row) throw new Error(`session-mirror: message ${messageID} missing persisted row for overlay enrichment`)
  const data = row.data as Record<string, unknown> | undefined
  const role = data?.role
  if (!data || typeof role !== "string" || role.length === 0) {
    throw new Error(`session-mirror: message ${messageID} missing persisted role for overlay enrichment`)
  }
  const orderKey = timelineMessageOrderKey({
    info: {
      id: messageID,
      time: { created: row.timeCreated },
    },
  })
  const extra = data.extra
  return {
    role,
    orderKey,
    ...(extra && typeof extra === "object" && !Array.isArray(extra) ? { extra: extra as Record<string, unknown> } : {}),
  }
}

function messageIDFromPayload(props: Record<string, unknown>): string {
  const part = props.part
  if (part && typeof part === "object" && typeof (part as Record<string, unknown>).messageID === "string") {
    return String((part as Record<string, unknown>).messageID)
  }
  if (typeof props.messageID === "string") return props.messageID
  return ""
}

function partOrderKeysForPayload(props: Record<string, unknown>): { messageOrderKey: string; partOrderKey: string } {
  const part = props.part
  if (!part || typeof part !== "object" || Array.isArray(part)) {
    throw new Error("session-mirror: part event missing part for overlay enrichment")
  }
  const record = part as Record<string, unknown>
  const partID = typeof record.id === "string" ? record.id : ""
  const messageID = typeof record.messageID === "string" ? record.messageID : ""
  const sessionID = typeof record.sessionID === "string" ? record.sessionID : ""
  if (!partID || !messageID || !sessionID) {
    throw new Error("session-mirror: part event missing part id/messageID/sessionID for overlay enrichment")
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
  if (!rows.message) {
    throw new Error(`session-mirror: message ${messageID} missing persisted row for overlay enrichment`)
  }
  if (!rows.part) throw new Error(`session-mirror: part ${partID} missing persisted row for overlay enrichment`)
  const messageOrderKey = timelineMessageOrderKey({
    info: {
      id: messageID,
      time: { created: rows.message.timeCreated },
    },
  })
  const partOrderKey = timelinePartOrderKey({ id: partID, timeCreated: rows.part.timeCreated })
  if (typeof record.orderKey === "string" && record.orderKey.length > 0 && record.orderKey !== partOrderKey) {
    throw new Error(`session-mirror: part ${partID} orderKey drift between payload and persisted row`)
  }
  const eventOrderKey = props.orderKey
  if (typeof eventOrderKey === "string" && eventOrderKey.length > 0 && eventOrderKey !== messageOrderKey) {
    throw new Error(`session-mirror: part event ${partID} orderKey drift between payload and owning message`)
  }
  return { messageOrderKey, partOrderKey }
}

function overlayInfoForPayload(props: Record<string, unknown>): MessageOverlayInfo {
  const info = props.info
  if (info && typeof info === "object") {
    const record = info as Record<string, unknown>
    if (typeof record.role === "string" && record.role.length > 0) {
      if (typeof record.orderKey !== "string" || record.orderKey.length === 0) {
        throw new Error(`session-mirror: message ${String(record.id || "<unknown>")} missing info.orderKey`)
      }
      const extra = record.extra
      return {
        role: record.role,
        orderKey: record.orderKey,
        ...(extra && typeof extra === "object" && !Array.isArray(extra)
          ? { extra: extra as Record<string, unknown> }
          : {}),
      }
    }
  }
  const messageID = messageIDFromPayload(props)
  if (!messageID) throw new Error("session-mirror: message event missing role and messageID")
  return persistedMessageOverlayInfo(messageID)
}

function sessionEventMeta(sessionID: string): { channel: string; resolvedRole: string } {
  const kind = sessionRole(sessionID)
  if (!kind) throw new Error(`session-mirror: session ${sessionID} has no kind for overlay enrichment`)
  if (kind === "root") return { channel: "main", resolvedRole: "user" }
  return { channel: kind, resolvedRole: kind }
}

function sessionOrderKey(sessionID: string): string {
  const row = Database.use((db) =>
    db.select({ timeCreated: SessionTable.time_created }).from(SessionTable).where(eq(SessionTable.id, sessionID)).get(),
  )
  if (!row) throw new Error(`session-mirror: session ${sessionID} missing persisted row for overlay enrichment`)
  return timelineOrderKey({
    domain: "session",
    time: row.timeCreated,
    id: sessionID,
  })
}

function questionRequestID(props: Record<string, unknown>): string {
  const id = typeof props.id === "string" ? props.id : typeof props.requestID === "string" ? props.requestID : ""
  if (!id) throw new Error("session-mirror: question event missing id/requestID for overlay enrichment")
  return id
}

function questionOrderKey(props: Record<string, unknown>): string {
  const requestID = questionRequestID(props)
  return timelineOrderKey({
    domain: "interaction",
    time: Identifier.timestamp(requestID),
    id: requestID,
  })
}

function stampPayloadWithMeta(
  props: Record<string, unknown>,
  meta: { channel: string; resolvedRole: string; orderKey?: string },
): Record<string, unknown> {
  const payload = { ...props }
  const info = payload.info
  if (info && typeof info === "object") {
    const stampedInfo: Record<string, unknown> = {
      ...(info as Record<string, unknown>),
      channel: meta.channel,
      resolvedRole: meta.resolvedRole,
    }
    if (typeof stampedInfo.orderKey !== "string" || stampedInfo.orderKey.length === 0) {
      throw new Error(`session-mirror: message ${String(stampedInfo.id || "<unknown>")} missing info.orderKey`)
    }
    payload.info = {
      ...stampedInfo,
      orderKey: stampedInfo.orderKey,
    }
  }
  if ("orderKey" in meta) {
    payload.orderKey = meta.orderKey
  }
  payload.channel = meta.channel
  payload.resolvedRole = meta.resolvedRole
  return payload
}

function stampSessionPayload(sessionID: string, props: Record<string, unknown>): Record<string, unknown> {
  const info = overlayInfoForPayload(props)
  return stampPayloadWithMeta(props, { ...overlayMeta(sessionID, "", info), orderKey: info.orderKey })
}

function stampSessionPartPayload(sessionID: string, props: Record<string, unknown>): Record<string, unknown> {
  const meta = overlayMeta(sessionID, "", overlayInfoForPayload(props))
  const { messageOrderKey, partOrderKey } = partOrderKeysForPayload(props)
  const payload = stampPayloadWithMeta(props, { ...meta, orderKey: messageOrderKey })
  const part = payload.part
  if (!part || typeof part !== "object" || Array.isArray(part)) {
    throw new Error("session-mirror: stamped part event missing part")
  }
  payload.part = { ...(part as Record<string, unknown>), orderKey: partOrderKey }
  payload.orderKey = messageOrderKey
  return payload
}

function stampSessionEventPayload(
  sessionID: string,
  props: Record<string, unknown>,
  orderKey = sessionOrderKey(sessionID),
): Record<string, unknown> {
  return stampPayloadWithMeta(props, { ...sessionEventMeta(sessionID), orderKey })
}

export function enrichStandaloneSessionTranscript(messages: Message.WithParts[]): Message.WithParts[] {
  return messages.map((message) => {
    const meta = overlayMeta(message.info.sessionID, "", message.info)
    return {
      ...message,
      info: {
        ...message.info,
        channel: meta.channel,
        resolvedRole: meta.resolvedRole,
        orderKey: timelineMessageOrderKey(message),
      } as unknown as Message.Info,
      parts: message.parts,
    }
  })
}

export function mapSessionBusEvent(
  event: SessionBusEvent,
  input: { goalID?: string; sessionID?: string },
): SessionMirrorEvent | undefined {
  const props = event.properties
  const sessionID = sessionBusEventSessionID(event)
  if (!sessionID) return
  if (input.goalID) {
    if (sessionGoalID(sessionID) !== input.goalID) return
  } else if (input.sessionID) {
    if (sessionID !== input.sessionID) return
  } else {
    return
  }

  if (event.type === SessionStatus.Event.Status.type) {
    const payload = stampSessionEventPayload(sessionID, props)
    const status = props.status
    const statusType =
      status && typeof status === "object" && typeof (status as Record<string, unknown>).type === "string"
        ? String((status as Record<string, unknown>).type)
        : "unknown"
    const reason =
      status && typeof status === "object" && typeof (status as Record<string, unknown>).reason === "string"
        ? String((status as Record<string, unknown>).reason)
        : ""
    return {
      type: "session.status",
      summary: reason ? `session status: ${statusType} (${reason})` : `session status: ${statusType}`,
      payload,
    }
  }
  if (event.type === SessionStatus.Event.Idle.type) {
    const payload = stampSessionEventPayload(sessionID, props)
    return {
      type: "session.idle",
      summary: "Session idle",
      payload,
    }
  }
  if (event.type === Message.Event.Updated.type) {
    const payload = stampSessionPayload(sessionID, props)
    const info = payload.info as Record<string, unknown>
    if (!info.agent) info.agent = "executor"
    return {
      type: "message.updated",
      summary: typeof info.role === "string" ? `Message updated: ${info.role}` : "Message updated",
      payload,
    }
  }
  if (event.type === Message.Event.PartUpdated.type) {
    const payload = stampSessionPartPayload(sessionID, props)
    const part = payload.part as Record<string, unknown>
    return {
      type: "message.part.updated",
      summary: typeof part.type === "string" ? `Part updated: ${part.type}` : "Part updated",
      payload,
    }
  }
  if (event.type === Message.Event.PartDelta.type) {
    const payload = stampSessionPayload(sessionID, props)
    return {
      type: "message.part.delta",
      summary: typeof props.field === "string" ? `Delta: ${props.field}` : "Message delta",
      payload,
    }
  }
  if (event.type === Message.Event.Removed.type) {
    const payload = stampSessionEventPayload(sessionID, props)
    return {
      type: "message.removed",
      summary: "Message removed",
      payload,
    }
  }
  if (event.type === Message.Event.PartRemoved.type) {
    const payload = stampSessionEventPayload(sessionID, props)
    return {
      type: "message.part.removed",
      summary: "Part removed",
      payload,
    }
  }
  if (event.type === Session.Event.Error.type) {
    const payload = stampSessionEventPayload(sessionID, props)
    return {
      type: "session.error",
      summary: "Session error",
      payload,
    }
  }
  if (event.type === PermissionNext.Event.Asked.type) {
    const payload = stampSessionEventPayload(sessionID, props)
    return {
      type: "permission.asked",
      summary: `Permission requested: ${String(props.permission ?? "")}`.trim(),
      payload,
    }
  }
  if (event.type === PermissionNext.Event.Replied.type) {
    const payload = stampSessionEventPayload(sessionID, props)
    return {
      type: "permission.replied",
      summary: `Permission reply: ${String(props.reply ?? "")}`.trim(),
      payload,
    }
  }
  if (event.type === Question.Event.Asked.type) {
    const payload = stampSessionEventPayload(sessionID, props, questionOrderKey(props))
    return {
      type: "question.asked",
      summary: "Question requested",
      payload,
    }
  }
  if (event.type === Question.Event.Replied.type) {
    const payload = stampSessionEventPayload(sessionID, props, questionOrderKey(props))
    return {
      type: "question.replied",
      summary: "Question answered",
      payload,
    }
  }
  if (event.type === Question.Event.Rejected.type) {
    const payload = stampSessionEventPayload(sessionID, props, questionOrderKey(props))
    return {
      type: "question.rejected",
      summary: "Question rejected",
      payload,
    }
  }
  return {
    type: event.type,
    summary: event.type,
    payload: props,
  }
}

async function shouldMirrorSessionScopedStream(sessionID: string): Promise<boolean> {
  const role = sessionRole(sessionID)
  if (role === "mission") return true
  return role === "assistant"
}

export async function mirrorSessionBusEvent(event: SessionBusEvent, sessionID: string): Promise<void> {
  if (sessionBusEventSessionID(event) !== sessionID) return
  if (!(await shouldMirrorSessionScopedStream(sessionID))) return
  const mapped = mapSessionBusEvent(event, { sessionID })
  if (!mapped) return
  const orderKey = mapped.payload?.orderKey
  if (typeof orderKey !== "string" || orderKey.length === 0) {
    throw new Error(`session-mirror: ${mapped.type} missing envelope orderKey`)
  }
  ProtocolStore.dispatchEphemeral({
    type: mapped.type,
    aggregate: "session",
    sessionID,
    source: "session.bridge",
    orderKey,
    payload: {
      ...(mapped.payload ?? {}),
      summary: mapped.summary ?? mapped.type,
    },
  })
}

export function subscribeSessionMirror(
  sessionID: string,
  onMirrorError?: (error: unknown, event: SessionBusEvent) => void,
): () => void {
  const handler = (envelope: { payload?: SessionBusEvent }) => {
    const event = envelope.payload
    if (!event || typeof event.type !== "string" || !event.properties) return
    void mirrorSessionBusEvent(event, sessionID).catch((error) => {
      log.warn("session mirror event failed", {
        sessionID,
        eventType: event.type,
        error: errorMessage(error),
      })
      if (onMirrorError) {
        onMirrorError(error, event)
        return
      }
      queueMicrotask(() => {
        throw error
      })
    })
  }
  GlobalBus.on("event", handler)
  return () => GlobalBus.off("event", handler)
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
