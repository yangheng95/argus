import type { AudioAttachment, IncomingMessage, MessageHandler } from "../adapter"

function pick(...values: unknown[]) {
  for (const value of values) {
    if (value === undefined || value === null) continue
    const text = String(value).trim()
    if (text) return text
  }
}

export function threadId(...values: unknown[]) {
  return pick(...values) ?? `${Date.now()}`
}

export async function emit(
  handler: MessageHandler | undefined,
  input: {
    platform: string
    channel?: unknown
    thread?: unknown | unknown[]
    user?: unknown
    text?: unknown
    audio?: AudioAttachment
  },
) {
  if (!handler) return false

  const channel = pick(input.channel)
  const user = pick(input.user)
  const thread = Array.isArray(input.thread) ? pick(...input.thread) : pick(input.thread)
  const text = input.text === undefined || input.text === null ? "" : String(input.text)

  if (!channel || !user || !thread) return false
  if (!text && !input.audio) return false

  const message: IncomingMessage = {
    platform: input.platform,
    channel,
    thread,
    user,
    text,
  }
  if (input.audio) message.audio = input.audio

  await handler(message)
  return true
}
