import { Session } from "."
import type { Message } from "./message"

export const RIGHT_SIDEBAR_CODING_ASSISTANT_DEFAULT_TITLE = "Coding assistant"
export const MISSION_CONTROL_DEFAULT_TITLE = "Mission Control"
export const FIRST_MESSAGE_SESSION_TITLE_MAX_LENGTH = 200

function isRightSidebarCodingAssistant(session: Session.Info): boolean {
  const codingAssistant =
    session.metadata && typeof session.metadata === "object"
      ? (session.metadata as Record<string, unknown>).codingAssistant
      : undefined
  return (
    session.kind === "assistant" &&
    session.title === RIGHT_SIDEBAR_CODING_ASSISTANT_DEFAULT_TITLE &&
    !!codingAssistant &&
    typeof codingAssistant === "object" &&
    (codingAssistant as Record<string, unknown>).surface === "right-sidebar"
  )
}

function isMissionControl(session: Session.Info): boolean {
  return session.kind === "mission" && session.title === MISSION_CONTROL_DEFAULT_TITLE
}

function firstTextTitle(parts: Message.Part[]): string | undefined {
  const text = parts
    .find((part): part is Message.TextPart => part.type === "text")
    ?.text.trim()
    .replace(/\s+/g, " ")
  if (!text) return undefined
  return text.length > FIRST_MESSAGE_SESSION_TITLE_MAX_LENGTH
    ? text.slice(0, FIRST_MESSAGE_SESSION_TITLE_MAX_LENGTH)
    : text
}

export async function setSessionTitleFromFirstUserMessage(input: {
  sessionID: string
  messageID: string
  parts: Message.Part[]
}): Promise<Session.Info | undefined> {
  const title = firstTextTitle(input.parts)
  if (!title) return undefined

  const session = await Session.get(input.sessionID)
  if (!isRightSidebarCodingAssistant(session) && !isMissionControl(session)) return undefined

  const userMessages = (await Session.messages({ sessionID: input.sessionID })).filter(
    (message) => message.info.role === "user",
  )
  if (userMessages.length !== 1 || userMessages[0]?.info.id !== input.messageID) return undefined

  return Session.setTitle({ sessionID: input.sessionID, title })
}
