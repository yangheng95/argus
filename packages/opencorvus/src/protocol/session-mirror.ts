import { GlobalBus } from "@/bus/global"
import { PermissionNext } from "@/permission/next"
import { ProtocolStore } from "@/protocol/store"
import { Question } from "@/question"
import { Message, Session, SessionStatus } from "@/session"
import { sessionGoalID, sessionRole } from "@/orchestrator/task-event"
import { isRightSidebarCodingAssistantSession } from "@/coding-assistant/session"

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

function stampMissionPayload(type: string, props: Record<string, unknown>): Record<string, unknown> {
  const payload = { ...props }
  const info = payload.info
  const part = payload.part
  const infoRole =
    info && typeof info === "object" && typeof (info as Record<string, unknown>).role === "string"
      ? String((info as Record<string, unknown>).role)
      : ""
  const isUser = infoRole === "user"
  const channel = isUser ? "main" : "mission"
  const resolvedRole = isUser ? "user" : "mission"
  if (info && typeof info === "object") {
    payload.info = {
      ...(info as Record<string, unknown>),
      channel,
      resolvedRole,
    }
  }
  if (part && typeof part === "object") {
    payload.part = {
      ...(part as Record<string, unknown>),
      channel: type === "message.part.delta" ? channel : ((part as Record<string, unknown>).channel ?? "mission"),
      resolvedRole:
        type === "message.part.delta" ? resolvedRole : ((part as Record<string, unknown>).resolvedRole ?? "mission"),
    }
  }
  payload.channel = channel
  payload.resolvedRole = resolvedRole
  return payload
}

export function enrichMissionSessionTranscript(messages: Message.WithParts[]): Message.WithParts[] {
  return messages.map((message) => {
    const isUser = message.info.role === "user"
    const channel = isUser ? "main" : "mission"
    const resolvedRole = isUser ? "user" : "mission"
    return {
      ...message,
      info: {
        ...message.info,
        channel,
        resolvedRole,
      } as unknown as Message.Info,
      parts: message.parts.map((part) => ({
        ...part,
        channel,
        resolvedRole,
      })),
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
    const payload = sessionRole(sessionID) === "mission" ? stampMissionPayload("message.updated", props) : { ...props }
    const info = payload.info as Record<string, unknown>
    if (!info.agent) info.agent = "executor"
    return {
      type: "message.updated",
      summary: typeof info.role === "string" ? `Message updated: ${info.role}` : "Message updated",
      payload,
    }
  }
  if (event.type === Message.Event.PartUpdated.type) {
    const payload =
      sessionRole(sessionID) === "mission" ? stampMissionPayload("message.part.updated", props) : { ...props }
    const part = payload.part as Record<string, unknown>
    return {
      type: "message.part.updated",
      summary: typeof part.type === "string" ? `Part updated: ${part.type}` : "Part updated",
      payload,
    }
  }
  if (event.type === Message.Event.PartDelta.type) {
    return {
      type: "message.part.delta",
      summary: typeof props.field === "string" ? `Delta: ${props.field}` : "Message delta",
      payload: sessionRole(sessionID) === "mission" ? stampMissionPayload("message.part.delta", props) : props,
    }
  }
  if (event.type === Message.Event.Removed.type) {
    return {
      type: "message.removed",
      summary: "Message removed",
      payload: sessionRole(sessionID) === "mission" ? stampMissionPayload("message.removed", props) : props,
    }
  }
  if (event.type === Message.Event.PartRemoved.type) {
    return {
      type: "message.part.removed",
      summary: "Part removed",
      payload: sessionRole(sessionID) === "mission" ? stampMissionPayload("message.part.removed", props) : props,
    }
  }
  if (event.type === Session.Event.Error.type) {
    return {
      type: "session.error",
      summary: "Session error",
      payload: props,
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

async function shouldMirrorStandaloneSession(sessionID: string): Promise<boolean> {
  const role = sessionRole(sessionID)
  if (role === "mission") return true
  if (role !== "assistant") return false
  const session = await Session.get(sessionID).catch(() => undefined)
  return !!session && isRightSidebarCodingAssistantSession(session)
}

export async function mirrorSessionBusEvent(event: SessionBusEvent, sessionID: string): Promise<void> {
  if (sessionBusEventSessionID(event) !== sessionID) return
  if (!(await shouldMirrorStandaloneSession(sessionID))) return
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
