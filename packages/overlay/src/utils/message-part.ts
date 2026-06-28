const CONTROL_PROTOCOL_MESSAGE_PART_TYPES = new Set(["step-start", "step-finish"])
const NON_PROJECTABLE_MESSAGE_PART_TYPES = new Set([...CONTROL_PROTOCOL_MESSAGE_PART_TYPES, "boundary"])

export function messagePartType(part: any): string {
  return String(part?.type || "")
}

export function isProtocolControlMessagePart(part: any): boolean {
  const type = messagePartType(part)
  return Boolean(type && CONTROL_PROTOCOL_MESSAGE_PART_TYPES.has(type))
}

export function isBoundaryMessagePart(part: any): boolean {
  return messagePartType(part) === "boundary"
}

export function isCardBodyMessagePart(part: any): boolean {
  const type = messagePartType(part)
  return Boolean(type && !NON_PROJECTABLE_MESSAGE_PART_TYPES.has(type))
}

export function messagePartHasDisplayContent(part: any): boolean {
  if (!isCardBodyMessagePart(part)) return false
  const type = messagePartType(part)
  if (type === "reasoning") return Boolean(String(part?.text || "").replace(/[\[\]\s]/g, ""))
  if (type === "text") return Boolean(String(part?.text || "").trim())
  return true
}
