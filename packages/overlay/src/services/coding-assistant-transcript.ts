export type AssistantPart = Record<string, any> & {
  id: string
  messageID?: string
  type?: string
  text?: string
}

export type AssistantMessage = {
  info: Record<string, any> & {
    id: string
    role?: string
    agent?: string
    time?: { created?: number; updated?: number }
  }
  parts: AssistantPart[]
}

export function messageID(message: AssistantMessage): string {
  return String(message.info.id)
}

export function messageTime(message: AssistantMessage): number {
  return Number(message.info.time?.created ?? message.info.time?.updated ?? 0)
}

export function partText(part: AssistantPart): string {
  if (typeof part.text === "string") return part.text
  if (typeof part.content === "string") return part.content
  if (part.type === "tool") {
    const name = String(part.tool ?? part.toolName ?? part.call?.name ?? "tool")
    const status = String(part.state?.status ?? part.status ?? "pending")
    return `${name} · ${status}`
  }
  try {
    return JSON.stringify(part.state ?? part, null, 2)
  } catch {
    return String(part.type ?? "")
  }
}

export function normalizeMessage(raw: any): AssistantMessage | null {
  if (!raw || typeof raw !== "object") return null
  const info = raw.info && typeof raw.info === "object" ? raw.info : raw
  if (!info.id) return null
  return {
    info: info as AssistantMessage["info"],
    parts: Array.isArray(raw.parts) ? raw.parts.filter((part: any) => part && typeof part === "object") : [],
  }
}

export function mergeMessage(messages: AssistantMessage[], next: AssistantMessage): AssistantMessage[] {
  const id = messageID(next)
  const index = messages.findIndex((item) => messageID(item) === id)
  if (index < 0) return [...messages, next].sort((a, b) => messageTime(a) - messageTime(b))
  const prev = messages[index]!
  const mergedParts = [...prev.parts]
  for (const part of next.parts) {
    const partIndex = mergedParts.findIndex((item) => item.id === part.id)
    if (partIndex < 0) mergedParts.push(part)
    else mergedParts[partIndex] = { ...mergedParts[partIndex], ...part }
  }
  const updated = [...messages]
  updated[index] = {
    info: { ...prev.info, ...next.info },
    parts: mergedParts,
  }
  return updated.sort((a, b) => messageTime(a) - messageTime(b))
}

export function mergePart(messages: AssistantMessage[], part: AssistantPart): AssistantMessage[] {
  const mid = String(part.messageID ?? "")
  if (!mid) return messages
  const index = messages.findIndex((item) => messageID(item) === mid)
  const base: AssistantMessage =
    index >= 0
      ? messages[index]!
      : {
          info: {
            id: mid,
            role: "assistant",
            agent: "coding",
            time: { created: Date.now() },
          },
          parts: [],
        }
  const partIndex = base.parts.findIndex((item) => item.id === part.id)
  const parts = [...base.parts]
  if (partIndex < 0) parts.push(part)
  else parts[partIndex] = { ...parts[partIndex], ...part }
  const next = [...messages]
  if (index < 0) next.push({ ...base, parts })
  else next[index] = { ...base, parts }
  return next.sort((a, b) => messageTime(a) - messageTime(b))
}

export function mergeDelta(messages: AssistantMessage[], payload: Record<string, any>): AssistantMessage[] {
  const messageID = String(payload.messageID ?? "")
  const partID = String(payload.partID ?? "")
  const field = String(payload.field ?? "")
  const delta = typeof payload.delta === "string" ? payload.delta : ""
  if (!messageID || !partID || field !== "text" || !delta) return messages
  const index = messages.findIndex((item) => item.info.id === messageID)
  const base: AssistantMessage =
    index >= 0
      ? messages[index]!
      : {
          info: {
            id: messageID,
            role: "assistant",
            agent: "coding",
            time: { created: Date.now() },
          },
          parts: [],
        }
  const partIndex = base.parts.findIndex((part) => part.id === partID)
  const parts = [...base.parts]
  if (partIndex < 0) {
    parts.push({ id: partID, messageID, type: "text", text: delta })
  } else {
    const prev = parts[partIndex]!
    parts[partIndex] = { ...prev, text: `${prev.text ?? ""}${delta}` }
  }
  const next = [...messages]
  if (index < 0) next.push({ ...base, parts })
  else next[index] = { ...base, parts }
  return next.sort((a, b) => messageTime(a) - messageTime(b))
}

export function applyAssistantSessionEvent(
  messages: AssistantMessage[],
  event: { type?: string; payload?: Record<string, any> },
): AssistantMessage[] {
  const payload = event.payload && typeof event.payload === "object" ? event.payload : {}
  if (event.type === "message.updated" && payload.info) {
    const msg = normalizeMessage({ info: payload.info, parts: [] })
    return msg ? mergeMessage(messages, msg) : messages
  }
  if (event.type === "message.part.updated" && payload.part) {
    return mergePart(messages, payload.part as AssistantPart)
  }
  if (event.type === "message.part.delta") {
    return mergeDelta(messages, payload)
  }
  return messages
}
