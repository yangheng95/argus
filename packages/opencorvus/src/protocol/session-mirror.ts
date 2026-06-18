import { GlobalBus } from "@/bus/global"
import { PermissionNext } from "@/permission/next"
import { ProtocolStore } from "@/protocol/store"
import { Question } from "@/question"
import { Message, Session, SessionStatus } from "@/session"
import { sessionGoalID, sessionRole } from "@/orchestrator/task-event"
import { overlayMeta } from "@/orchestrator/protocol/message-bridge"
import { Database, eq } from "@/storage/db"
import { MessageTable } from "@/session/session.sql"

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
  extra?: Record<string, unknown>
}

function persistedMessageOverlayInfo(messageID: string): MessageOverlayInfo {
  const row = Database.use((db) =>
    db.select({ data: MessageTable.data }).from(MessageTable).where(eq(MessageTable.id, messageID)).get(),
  )
  const data = row?.data as Record<string, unknown> | undefined
  const role = data?.role
  if (!data || typeof role !== "string" || role.length === 0) {
    throw new Error(`session-mirror: message ${messageID} missing persisted role for overlay enrichment`)
  }
  const extra = data.extra
  return {
    role,
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

function overlayInfoForPayload(props: Record<string, unknown>): MessageOverlayInfo {
  const info = props.info
  if (info && typeof info === "object") {
    const record = info as Record<string, unknown>
    if (typeof record.role === "string" && record.role.length > 0) {
      const extra = record.extra
      return {
        role: record.role,
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

function stampPayloadWithMeta(
  props: Record<string, unknown>,
  meta: { channel: string; resolvedRole: string },
): Record<string, unknown> {
  const payload = { ...props }
  const info = payload.info
  if (info && typeof info === "object") {
    payload.info = {
      ...(info as Record<string, unknown>),
      channel: meta.channel,
      resolvedRole: meta.resolvedRole,
    }
  }
  payload.channel = meta.channel
  payload.resolvedRole = meta.resolvedRole
  return payload
}

function stampSessionPayload(sessionID: string, props: Record<string, unknown>): Record<string, unknown> {
  return stampPayloadWithMeta(props, overlayMeta(sessionID, "", overlayInfoForPayload(props)))
}

function stampSessionEventPayload(sessionID: string, props: Record<string, unknown>): Record<string, unknown> {
  return stampPayloadWithMeta(props, sessionEventMeta(sessionID))
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
    return {
      type: "session.status",
      summary: String(props.status ?? "session status"),
      payload: props,
    }
  }
  if (event.type === SessionStatus.Event.Idle.type) {
    return {
      type: "session.idle",
      summary: "Session idle",
      payload: props,
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
    const payload = stampSessionPayload(sessionID, props)
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
    return {
      type: "permission.asked",
      summary: `Permission requested: ${String(props.permission ?? "")}`.trim(),
      payload: props,
    }
  }
  if (event.type === PermissionNext.Event.Replied.type) {
    return {
      type: "permission.replied",
      summary: `Permission reply: ${String(props.reply ?? "")}`.trim(),
      payload: props,
    }
  }
  if (event.type === Question.Event.Asked.type) {
    return {
      type: "question.asked",
      summary: "Question requested",
      payload: props,
    }
  }
  if (event.type === Question.Event.Replied.type) {
    return {
      type: "question.replied",
      summary: "Question answered",
      payload: props,
    }
  }
  if (event.type === Question.Event.Rejected.type) {
    return {
      type: "question.rejected",
      summary: "Question rejected",
      payload: props,
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
  ProtocolStore.dispatchEphemeral({
    type: mapped.type,
    aggregate: "session",
    sessionID,
    source: "session.bridge",
    payload: {
      ...(mapped.payload ?? {}),
      summary: mapped.summary ?? mapped.type,
    },
  })
}

export function subscribeSessionMirror(sessionID: string): () => void {
  const handler = (envelope: { payload?: SessionBusEvent }) => {
    const event = envelope.payload
    if (!event || typeof event.type !== "string" || !event.properties) return
    void mirrorSessionBusEvent(event, sessionID)
  }
  GlobalBus.on("event", handler)
  return () => GlobalBus.off("event", handler)
}
