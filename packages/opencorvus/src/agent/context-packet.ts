export type AgentContextScope = "task" | "goal" | "goal_run" | "session"
export type AgentContextModality = "text" | "image" | "audio" | "video" | "file"

export type AgentContextTextPart = {
  type: "text"
  text: string
}

export type AgentContextMediaRefPart = {
  type: "media_ref"
  url: string
  mime: string
  filename?: string
  label?: string
  modality?: Exclude<AgentContextModality, "text">
  sha?: string
  size?: number
  scope?: {
    kind: "task" | "goal" | "goal_run" | "session"
    taskID?: string
    goalID?: string
    goalRunID?: string
    sessionID?: string
  }
}

export type AgentContextStructuredPart = {
  type: "structured"
  schema: string
  data: unknown
  label?: string
  summary?: string
}

export type AgentContextPacketPart = AgentContextTextPart | AgentContextMediaRefPart | AgentContextStructuredPart

export type AgentContextAttachmentRef = {
  sha?: string
  url?: string
  mime?: string
  size?: number
  filename?: string
}

export type AgentContextPacket = {
  id: string
  title: string
  source?: string
  scope?: AgentContextScope
  parts: readonly AgentContextPacketPart[]
}

const AGENT_CONTEXT_SCOPES: readonly AgentContextScope[] = ["task", "goal", "goal_run", "session"]
const AGENT_CONTEXT_PART_TYPES = new Set(["text", "media_ref", "structured"])
const AGENT_CONTEXT_MEDIA_REF_KEYS = new Set(["type", "url", "mime", "filename", "label", "modality", "sha", "size", "scope"])
const AGENT_CONTEXT_MEDIA_SCOPE_KEYS = new Set(["kind", "taskID", "goalID", "goalRunID", "sessionID"])

function isAgentContextScope(value: unknown): value is AgentContextScope {
  return typeof value === "string" && (AGENT_CONTEXT_SCOPES as readonly string[]).includes(value)
}

export function textContextPacket(input: {
  id: string
  title: string
  body: string
  source?: string
  scope?: AgentContextScope
}): AgentContextPacket | undefined {
  const body = input.body.trim()
  if (!body) return undefined
  return {
    id: input.id,
    title: input.title,
    source: input.source,
    scope: input.scope,
    parts: [{ type: "text", text: body }],
  }
}

export function attachmentContextPacket(
  attachments: readonly AgentContextAttachmentRef[] | undefined,
  opts: {
    id?: string
    title?: string
    source?: string
    scope?: AgentContextScope
    note?: string
  } = {},
): AgentContextPacket | undefined {
  if (!attachments?.length) return undefined
  const parts: AgentContextPacketPart[] = [
    {
      type: "text",
      text:
        opts.note?.trim() ||
        "Attachments are provided as link/index refs, not hidden prompt bytes. Inspect listed refs through visible tools before making visual, audio, video, PDF, or file-content claims.",
    },
  ]
  attachments.forEach((attachment, index) => {
    const url = attachment.url?.trim()
    const mime = attachment.mime?.trim()
    if (!url || !mime) {
      throw new Error(`AgentContextPacket attachment ${attachment.filename ?? attachment.sha ?? index + 1} requires url and mime`)
    }
    parts.push({
      type: "media_ref",
      url,
      mime,
      ...(attachment.filename ? { filename: attachment.filename } : {}),
      ...(attachment.sha ? { sha: attachment.sha } : {}),
      ...(typeof attachment.size === "number" ? { size: attachment.size } : {}),
    })
  })
  return {
    id: opts.id ?? "task-attachments",
    title: opts.title ?? "Task Attachments",
    source: opts.source ?? "task_attachments",
    scope: opts.scope ?? "task",
    parts,
  }
}

export function withAttachmentContextPacket(
  packets: readonly AgentContextPacket[] | undefined,
  attachments: readonly AgentContextAttachmentRef[] | undefined,
  opts?: Parameters<typeof attachmentContextPacket>[1],
): AgentContextPacket[] {
  const packet = attachmentContextPacket(attachments, opts)
  return packet ? [...(packets ?? []), packet] : [...(packets ?? [])]
}

export function renderAgentContextPackets(packets: readonly AgentContextPacket[] = []): string {
  validateAgentContextPackets(packets)
  const sections: string[] = []
  for (const packet of packets) {
    const body = renderAgentContextPacketBody(packet)
    if (!body) continue
    const meta = [`context_packet_id: ${packet.id}`]
    if (packet.source?.trim()) meta.push(`source: ${packet.source.trim()}`)
    if (packet.scope) meta.push(`scope: ${packet.scope}`)
    sections.push([`# ${packet.title}`, "", ...meta, "", body].join("\n"))
  }
  return sections.join("\n\n")
}

export function renderAgentContextPacketSection(packets: readonly AgentContextPacket[] | undefined): string | undefined {
  const nonEmpty = (packets ?? []).filter((packet) => packet.parts.length > 0)
  if (nonEmpty.length === 0) return undefined
  validateAgentContextPackets(nonEmpty)
  return [
    "# Agent Context Packets",
    "",
    "The scheduler supplied these typed context packets as upstream task evidence. Media appears as refs only; inspect cited refs through available tools before making visual, audio, video, or file-content claims.",
    "",
    renderAgentContextPackets(nonEmpty),
  ].join("\n")
}

export function agentContextPacketText(packet: AgentContextPacket): string {
  validateAgentContextPacket(packet)
  return packet.parts
    .map((part) => {
      if (part.type === "text") return part.text
      if (part.type === "media_ref") return renderMediaRefPart(part)
      return renderStructuredPart(part)
    })
    .join("\n")
}

export function agentContextPacketTextByStructuredSchema(
  packets: readonly AgentContextPacket[] | undefined,
  schema: string,
): string | undefined {
  validateAgentContextPackets(packets ?? [])
  const text = (packets ?? [])
    .filter((packet) => packet.parts.some((part) => part.type === "structured" && part.schema === schema))
    .map(agentContextPacketText)
    .join("\n\n")
    .trim()
  return text.length > 0 ? text : undefined
}

export function agentContextStructuredPartsBySchema<T>(
  packets: readonly AgentContextPacket[] | undefined,
  schema: string,
): T[] {
  validateAgentContextPackets(packets ?? [])
  const values: T[] = []
  for (const packet of packets ?? []) {
    for (const part of packet.parts) {
      if (part.type !== "structured" || part.schema !== schema) continue
      values.push(part.data as T)
    }
  }
  return values
}

export function agentContextStructuredPartBySchema<T>(
  packets: readonly AgentContextPacket[] | undefined,
  schema: string,
): T | undefined {
  const values = agentContextStructuredPartsBySchema<T>(packets, schema)
  if (values.length > 1) {
    throw new Error(`AgentContextPacket structured schema ${schema} appears more than once`)
  }
  return values[0]
}

export function validateAgentContextPackets(packets: readonly AgentContextPacket[] = []): void {
  for (const packet of packets) validateAgentContextPacket(packet)
}

export function validateAgentContextPacket(packet: AgentContextPacket): void {
  assertRequiredRenderableString(packet.id, "packet id")
  assertRequiredRenderableString(packet.title, `packet ${packet.id} title`)
  if (packet.source !== undefined) assertNoInlinePayload(packet.source, `packet ${packet.id} source`)
  if (packet.scope !== undefined && !isAgentContextScope(packet.scope)) {
    throw new Error(`AgentContextPacket packet ${packet.id} scope must be one of ${AGENT_CONTEXT_SCOPES.join(", ")}`)
  }
  for (const part of packet.parts) {
    const partType = (part as { type?: unknown }).type
    if (typeof partType !== "string" || !AGENT_CONTEXT_PART_TYPES.has(partType)) {
      throw new Error(
        `AgentContextPacket packet ${packet.id} contains unsupported part type ${JSON.stringify(partType ?? "(missing)")}`,
      )
    }
    if (part.type === "text") {
      assertNoInlinePayload(part.text, "text part")
      continue
    }
    if (part.type === "media_ref") {
      assertLinkBasedMediaRef(part)
      continue
    }
    assertStructuredPart(part)
  }
}

function renderAgentContextPacketBody(packet: AgentContextPacket): string {
  const lines: string[] = []
  for (const part of packet.parts) {
    if (part.type === "text") {
      const text = part.text.trim()
      if (text) lines.push(text)
      continue
    }
    if (part.type === "media_ref") {
      lines.push(renderMediaRefPart(part))
      continue
    }
    lines.push(renderStructuredPart(part))
  }
  return lines.join("\n")
}

function assertLinkBasedMediaRef(part: AgentContextMediaRefPart): void {
  assertAllowedObjectKeys(part, AGENT_CONTEXT_MEDIA_REF_KEYS, "media_ref")
  assertRequiredRenderableString(part.url, "media_ref url")
  assertRequiredRenderableString(part.mime, `media_ref ${part.url} mime`)
  if (!isLinkOrIndexRef(part.url)) {
    throw new Error(
      `AgentContextPacket media_ref ${part.filename ?? part.label ?? part.mime} must use a link or index ref, not inline bytes or an opaque payload`,
    )
  }
  for (const [key, value] of Object.entries({
    filename: part.filename,
    label: part.label,
    sha: part.sha,
  })) {
    if (typeof value === "string") assertNoInlinePayload(value, `media_ref ${part.url} ${key}`)
  }
  if (part.scope !== undefined) {
    if (!part.scope || typeof part.scope !== "object" || Array.isArray(part.scope)) {
      throw new Error(`AgentContextPacket media_ref ${part.url} scope must be an object`)
    }
    assertAllowedObjectKeys(part.scope, AGENT_CONTEXT_MEDIA_SCOPE_KEYS, `media_ref ${part.url} scope`)
    if (!isAgentContextScope(part.scope.kind)) {
      throw new Error(`AgentContextPacket media_ref ${part.url} scope.kind must be one of ${AGENT_CONTEXT_SCOPES.join(", ")}`)
    }
    for (const [key, value] of Object.entries(part.scope)) {
      if (key === "kind") continue
      if (value !== undefined && typeof value !== "string") {
        throw new Error(`AgentContextPacket media_ref ${part.url} scope.${key} must be a string`)
      }
      if (typeof value === "string") assertNoInlinePayload(value, `media_ref ${part.url} scope.${key}`)
    }
  }
}

function assertAllowedObjectKeys(value: object, allowed: ReadonlySet<string>, context: string): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new Error(`AgentContextPacket ${context} contains unsupported field ${JSON.stringify(key)}`)
    }
  }
}

function assertStructuredPart(part: AgentContextStructuredPart): void {
  assertRequiredRenderableString(part.schema, "structured part schema")
  if (part.label !== undefined) assertNoInlinePayload(part.label, `structured part ${part.schema} label`)
  if (part.summary !== undefined) assertNoInlinePayload(part.summary, `structured part ${part.schema} summary`)
  if (part.data === undefined) {
    throw new Error(`AgentContextPacket structured part ${part.schema} requires data`)
  }
  assertNoInlinePayload(part.data, `structured part ${part.schema} data`)
}

function renderStructuredPart(part: AgentContextStructuredPart): string {
  assertStructuredPart(part)
  return [
    `structured_ref: schema=${part.schema}`,
    ...(part.label ? [`label=${part.label}`] : []),
    ...(part.summary ? [`summary=${part.summary}`] : []),
  ].join("; ")
}

function renderMediaRefPart(part: AgentContextMediaRefPart): string {
  assertLinkBasedMediaRef(part)
  return [
    `media_ref: type=${part.modality ?? mediaModality(part.mime)}`,
    `mime=${part.mime}`,
    `url=${part.url}`,
    ...(part.filename ? [`filename=${part.filename}`] : []),
    ...(part.label ? [`label=${part.label}`] : []),
    ...(part.sha ? [`sha=${part.sha}`] : []),
    ...(typeof part.size === "number" ? [`size=${part.size}`] : []),
    ...(part.scope ? [`scope=${mediaScopeLabel(part.scope)}`] : []),
  ].join("; ")
}

function assertRequiredRenderableString(value: string, path: string): void {
  if (!value.trim()) {
    throw new Error(`AgentContextPacket ${path} requires a non-empty string`)
  }
  assertNoInlinePayload(value, path)
}

function assertNoInlinePayload(value: unknown, path: string, seen = new Set<object>()): void {
  if (typeof value === "string") {
    if (containsInlineDataURL(value)) {
      throw new Error(`AgentContextPacket ${path} must not contain inline data URLs; use link or index refs instead`)
    }
    if (containsLikelyInlineBase64Blob(value)) {
      throw new Error(`AgentContextPacket ${path} must not contain inline binary payloads; use link or index refs instead`)
    }
    return
  }
  if (!value || typeof value !== "object") return
  if (seen.has(value)) return
  seen.add(value)
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoInlinePayload(item, `${path}[${index}]`, seen))
    return
  }
  for (const [key, item] of Object.entries(value)) {
    assertNoInlinePayload(item, `${path}.${key}`, seen)
  }
}

function containsInlineDataURL(value: string): boolean {
  return /data:(?:[a-z][a-z0-9+.-]*(?:\/[a-z0-9+.-]*)?)?(?:;[^\s,]*)?,/i.test(value)
}

function containsLikelyInlineBase64Blob(value: string): boolean {
  const tokens = value.match(/[A-Za-z0-9+/=]{80,}/g) ?? []
  return tokens.some((token) => {
    const normalized = token.replace(/\s+/g, "")
    if (normalized.length < 80 || normalized.length % 4 !== 0) return false
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return false
    const hasUpper = /[A-Z]/.test(normalized)
    const hasLower = /[a-z]/.test(normalized)
    const hasDigit = /[0-9]/.test(normalized)
    const hasBase64Marker = /[+/=]/.test(normalized)
    return hasBase64Marker || (hasUpper && hasLower && hasDigit)
  })
}

function isLinkOrIndexRef(value: string): boolean {
  const trimmed = value.trim()
  if (!trimmed) return false
  if (containsInlineDataURL(trimmed) || containsLikelyInlineBase64Blob(trimmed)) return false
  return (
    /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ||
    /^[A-Za-z]:[\\/]/.test(trimmed) ||
    trimmed.startsWith("/") ||
    trimmed.startsWith("\\") ||
    trimmed.startsWith("./") ||
    trimmed.startsWith("../") ||
    trimmed.includes("/") ||
    trimmed.includes("\\") ||
    /\.[A-Za-z0-9]{1,12}(?:[?#].*)?$/.test(trimmed)
  )
}

function mediaModality(mime: string): Exclude<AgentContextModality, "text"> {
  const normalized = mime.toLowerCase()
  if (normalized.startsWith("image/")) return "image"
  if (normalized.startsWith("audio/")) return "audio"
  if (normalized.startsWith("video/")) return "video"
  return "file"
}

function mediaScopeLabel(scope: NonNullable<AgentContextMediaRefPart["scope"]>): string {
  const ids = [
    scope.taskID ? `task=${scope.taskID}` : "",
    scope.goalID ? `goal=${scope.goalID}` : "",
    scope.goalRunID ? `goal_run=${scope.goalRunID}` : "",
    scope.sessionID ? `session=${scope.sessionID}` : "",
  ]
    .filter(Boolean)
    .join(", ")
  return ids.length > 0 ? `${scope.kind} (${ids})` : scope.kind
}
