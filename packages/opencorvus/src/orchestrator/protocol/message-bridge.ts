import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Instance } from "@/project/instance"
import { EngineProtocol } from "@/engine/protocol"
import { ProtocolStore } from "@/protocol/store"
import { Message } from "@/session/message"
import { Log } from "@/util/log"
import { Database, eq } from "@/storage/db"
import { MessageTable, type SessionKind } from "@/session/session.sql"
import { taskIDForSession, taskSession, sessionRole, sessionGoalID, sessionParentID } from "../task-event"

const log = Log.create({ service: "task-message-protocol-bridge" })
let initialized = false
let bridgeQueue = Promise.resolve()

// ── Overlay rendering metadata ──
//
// `session.kind` is the authoritative source for "what is this session for".
// The overlay renders a card per kind; this module's job is to stamp the kind
// (and goalID / parentSessionID) onto every outgoing message event so the
// frontend can route without re-deriving anything.

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
  const isRoot = !!rootSessionID && sessionID === rootSessionID

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

  const kind = sessionRole(sessionID)
  if (!kind) {
    throw new Error(
      `overlayMeta: session ${sessionID} has no kind in the DB. Every session ` +
      `must be created via Session.createNext({kind: ...}); a row missing kind ` +
      `means a code path bypassed createNext or the row was inserted directly.`,
    )
  }
  if (kind === "root") {
    throw new Error(
      `overlayMeta: child session ${sessionID} has kind="root" (only the ` +
      `task's session_id should be a root). Probably a Session.createNext ` +
      `call passed kind="root" with a parentID.`,
    )
  }
  if (role === "user") {
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

const messageInfoCache = new Map<string, { role: string; extra?: Record<string, unknown> }>()

function rememberMessageInfo(messageID: string, info: { role: string; extra?: Record<string, unknown> }) {
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
  rememberMessageInfo(info.id, {
    role: info.role,
    ...(info.extra && typeof info.extra === "object" ? { extra: info.extra as Record<string, unknown> } : {}),
  })
}

function readPersistedMessageInfo(messageID: string): { role: string; extra?: Record<string, unknown> } | undefined {
  const row = Database.use((db) =>
    db
      .select({ data: MessageTable.data })
      .from(MessageTable)
      .where(eq(MessageTable.id, messageID))
      .get(),
  )
  const role = row?.data && typeof row.data === "object" && "role" in row.data
    ? (row.data as Record<string, unknown>).role
    : undefined
  if (typeof role !== "string" || !role) return undefined
  const extra = row?.data && typeof row.data === "object" && "extra" in row.data
    ? (row.data as Record<string, unknown>).extra
    : undefined
  const info = {
    role,
    ...(extra && typeof extra === "object" ? { extra: extra as Record<string, unknown> } : {}),
  }
  rememberMessageInfo(messageID, info)
  return info
}

function infoForEvent(properties: Record<string, unknown>): { role: string; extra?: Record<string, unknown> } {
  const info = properties.info as any
  if (info && typeof info === "object" && info.role) {
    return {
      role: String(info.role),
      ...(info.extra && typeof info.extra === "object" ? { extra: info.extra as Record<string, unknown> } : {}),
    }
  }
  const part = properties.part as any
  if (part?.metadata?.overlay_direct_reply === true) {
    return { role: "user", extra: { overlay_direct_reply: true } }
  }
  const messageID =
    part?.messageID ||
    (properties as any).messageID ||
    ""
  if (messageID && messageInfoCache.has(messageID)) {
    return messageInfoCache.get(messageID)!
  }
  if (messageID) {
    const persisted = readPersistedMessageInfo(messageID)
    if (persisted) return persisted
    throw new Error(
      `bridge: message ${messageID} missing role in cache and DB while enriching event`,
    )
  }
  throw new Error("bridge: event missing both info.role and messageID")
}

function enqueueBridgeWork(work: () => Promise<void>) {
  const pending = bridgeQueue.then(work)
  bridgeQueue = pending.then(() => undefined, () => undefined)
  return pending
}

/**
 * Stamp resolvedRole / channel / goalID / parentSessionID onto every event.
 * Source of truth: session.kind, session.goal_id, session.parent_id.
 */
function enrichProperties(properties: Record<string, unknown>, sessionID: string, taskID: string): Record<string, unknown> {
  const info = infoForEvent(properties)
  const rootSessionID = taskSession(taskID) || ""
  const meta = overlayMeta(sessionID, rootSessionID, info)
  const goalID = sessionGoalID(sessionID)
  const parentSessionID = sessionParentID(sessionID)
  const enriched = { ...properties }

  if (enriched.info && typeof enriched.info === "object") {
    enriched.info = {
      ...(enriched.info as any),
      resolvedRole: meta.resolvedRole,
      channel: meta.channel,
      ...(goalID ? { goalID } : {}),
      ...(parentSessionID ? { parentSessionID } : {}),
    }
  }
  if (enriched.part && typeof enriched.part === "object") {
    enriched.part = {
      ...(enriched.part as any),
      resolvedRole: meta.resolvedRole,
      channel: meta.channel,
      ...(goalID ? { goalID } : {}),
      ...(parentSessionID ? { parentSessionID } : {}),
    }
  }
  enriched.resolvedRole = meta.resolvedRole
  enriched.channel = meta.channel
  if (goalID) enriched.goalID = goalID
  if (parentSessionID) enriched.parentSessionID = parentSessionID
  return enriched
}

/** Persist a message event to protocol_event (has sequence, replayable on reconnect). */
async function bridgeEvent<Definition extends typeof Message.Event[keyof typeof Message.Event]>(
  def: Definition,
  properties: Record<string, unknown>,
) {
  const sessionID = sessionFromProperties(properties)
  if (!sessionID) return
  const taskID = taskIDForSession(sessionID)
  if (!taskID) return
  let enriched: Record<string, unknown>
  try {
    enriched = enrichProperties(properties, sessionID, taskID)
  } catch (err) {
    log.error("bridge: enrichment failed — dropping event", {
      type: def.type,
      sessionID,
      taskID,
      error: err instanceof Error ? err.message : String(err),
    })
    return
  }
  log.info("bridge → protocol", {
    type: def.type,
    sessionID,
    taskID,
    resolvedRole: (enriched as Record<string, unknown>).resolvedRole,
    channel: (enriched as Record<string, unknown>).channel,
    msgID: (properties.info as any)?.id ?? (properties.part as any)?.messageID ?? "",
  })
  await EngineProtocol.emit(def as any, enriched as any, {
    taskID,
    sessionID,
    source: "session.bridge",
  })
}

/** Push a delta through live subscriptions only (no DB, no sequence). */
function bridgeDelta(properties: Record<string, unknown>) {
  const sessionID = sessionFromProperties(properties)
  if (!sessionID) return
  const taskID = taskIDForSession(sessionID)
  if (!taskID) return
  let enriched: Record<string, unknown>
  try {
    enriched = enrichProperties(properties, sessionID, taskID)
  } catch (err) {
    log.error("bridge: delta enrichment failed — dropping event", {
      sessionID,
      taskID,
      error: err instanceof Error ? err.message : String(err),
    })
    return
  }
  ProtocolStore.dispatchEphemeral({
    type: Message.Event.PartDelta.type,
    aggregate: "task",
    taskID,
    sessionID,
    source: "session.bridge",
    payload: enriched,
  })
}

// Cross-Instance event types and their handlers (registry replaces the prior
// if-chain on event type — additions don't require touching dispatch logic).
const CROSS_INSTANCE_HANDLERS: Record<string, (props: Record<string, unknown>) => Promise<void> | void> = {
  [Message.Event.Updated.type]: async (props) => {
    cacheMessageInfo(props)
    await bridgeEvent(Message.Event.Updated, props)
  },
  [Message.Event.PartUpdated.type]: async (props) => {
    await bridgeEvent(Message.Event.PartUpdated, props)
  },
  [Message.Event.Removed.type]: async (props) => {
    await bridgeEvent(Message.Event.Removed, props)
  },
  [Message.Event.PartRemoved.type]: async (props) => {
    await bridgeEvent(Message.Event.PartRemoved, props)
  },
  [Message.Event.PartDelta.type]: (props) => {
    bridgeDelta(props)
  },
}

const MESSAGE_TYPES = new Set(Object.keys(CROSS_INSTANCE_HANDLERS))

export function ensureTaskMessageProtocolBridge() {
  if (initialized) return
  initialized = true
  const hostDirectory = Instance.directory

  Bus.subscribe(Message.Event.Updated, (event) => enqueueBridgeWork(async () => {
    cacheMessageInfo(event.properties)
    await bridgeEvent(Message.Event.Updated, event.properties)
  }))
  Bus.subscribe(Message.Event.PartUpdated, (event) => enqueueBridgeWork(async () => {
    await bridgeEvent(Message.Event.PartUpdated, event.properties)
  }))
  Bus.subscribe(Message.Event.Removed, (event) => enqueueBridgeWork(async () => {
    await bridgeEvent(Message.Event.Removed, event.properties)
  }))
  Bus.subscribe(Message.Event.PartRemoved, (event) => enqueueBridgeWork(async () => {
    await bridgeEvent(Message.Event.PartRemoved, event.properties)
  }))
  Bus.subscribe(Message.Event.PartDelta, (event) => enqueueBridgeWork(async () => {
    await bridgeDelta(event.properties)
  }))

  // Cross-Instance bridge: executor sessions run in worktree Instances whose
  // Bus.publish() never reaches the main Instance's subscribers. GlobalBus
  // sees all Instances; we re-execute inside the host Instance context so
  // Database / ProtocolStore use the main DB, not the worktree's.
  GlobalBus.on("event", (envelope) => {
    if (!envelope.payload || !MESSAGE_TYPES.has(envelope.payload.type)) return
    if (envelope.directory === hostDirectory) return
    const props = envelope.payload.properties
    if (!props) return
    const handler = CROSS_INSTANCE_HANDLERS[envelope.payload.type]
    if (!handler) return
    void enqueueBridgeWork(async () => {
      await Instance.provide({
        directory: hostDirectory,
        fn: async () => {
          await handler(props)
        },
      })
    }).catch((err) => {
      log.error("bridge: cross-instance relay failed", {
        type: envelope.payload?.type,
        sourceDirectory: envelope.directory,
        error: err instanceof Error ? err.message : String(err),
      })
    })
  })
}
