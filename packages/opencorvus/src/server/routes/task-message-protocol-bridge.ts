import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Instance } from "@/project/instance"
import { EngineProtocol } from "@/engine/protocol"
import { ProtocolStore } from "@/protocol/store"
import { Message } from "@/session/message"
import { Log } from "@/util/log"
import type { SessionKind } from "@/session/session.sql"
import { taskIDForSession, taskSession, sessionRole, sessionGoalID, sessionParentID } from "./task-event"

const log = Log.create({ service: "task-message-protocol-bridge" })
let initialized = false

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

/**
 * Compute overlay metadata for a message event.
 *
 * Contract (driven by `session.kind`):
 * - User on root → resolvedRole="user", channel="main" (top-level user bubble)
 * - User on sub-agent session → resolvedRole="orchestrator", channel=session.kind
 *   (engine-synthesized dispatch brief — orchestrator authors it; the card
 *    still lives under the sub-agent's phase/stage)
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
  info: { role?: string },
): { resolvedRole: OverlayResolvedRole; channel: OverlayChannel } {
  const role = String(info.role || "assistant")
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
    // Non-root sessions only receive user-role messages that the engine
    // synthesizes as a dispatch brief for the sub-agent — goal contract +
    // architect consensus + intent-bundle pointer (goal/runner.ts), planner
    // / build scaffolding, retry feedback, delivery seed prompts. The
    // orchestrator is the author, not the human. Resolve role to
    // "orchestrator" so the overlay renders the same full-featured card
    // styling it already uses on the root main channel, while keeping
    // channel=session.kind so the card still groups under the sub-agent's
    // phase/stage. Previously this returned resolvedRole="user" which
    // presented an orchestrator-authored briefing as if a human had typed
    // it, producing the unreadable wall of small text in phase cards.
    return { resolvedRole: "orchestrator", channel: kind }
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

// Cache message-level info (role) so part/delta events can resolve metadata
// without re-reading the message row. message.updated always arrives before
// or with part events for the same message.
const messageRoleCache = new Map<string, string>()

function cacheMessageInfo(properties: Record<string, unknown>) {
  const info = properties.info as any
  if (!info?.id) return
  messageRoleCache.set(info.id, String(info.role || "assistant"))
  if (messageRoleCache.size > 500) {
    const first = messageRoleCache.keys().next().value
    if (first) messageRoleCache.delete(first)
  }
}

function roleForEvent(properties: Record<string, unknown>): string {
  const info = properties.info as any
  if (info && typeof info === "object" && info.role) {
    return String(info.role)
  }
  const messageID =
    (properties.part as any)?.messageID ||
    (properties as any).messageID ||
    ""
  if (messageID && messageRoleCache.has(messageID)) {
    return messageRoleCache.get(messageID)!
  }
  return "assistant"
}

/**
 * Stamp resolvedRole / channel / goalID / parentSessionID onto every event.
 * Source of truth: session.kind, session.goal_id, session.parent_id.
 */
function enrichProperties(properties: Record<string, unknown>, sessionID: string, taskID: string): Record<string, unknown> {
  const role = roleForEvent(properties)
  const rootSessionID = taskSession(taskID) || ""
  const meta = overlayMeta(sessionID, rootSessionID, { role })
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
  // Part events do not carry `info`. Stamp channel/goalID/parentSessionID
  // onto `part` itself so the overlay's handlePartUpdated can build the
  // correctly-staged card on the first event — no stub/backfill dance.
  // The top-level copies below remain for non-info/non-part event shapes.
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
  if (!taskID) {
    // Standalone sessions (MCP / Debug / Coding / Panel / generic Session.create)
    // legitimately don't belong to any task. They still emit message events
    // to the general Bus for their own UIs; the task-scoped protocol_event
    // store just doesn't persist them. This is by design — not a bug.
    return
  }
  let enriched: Record<string, unknown>
  try {
    enriched = enrichProperties(properties, sessionID, taskID)
  } catch (err) {
    // overlayMeta's invariants (kind present, no assistant on root, etc.)
    // guard the overlay's rendering contract. A violation is a data-model
    // bug, but we must not crash the Bus subscriber — that would take down
    // every other task's SSE with one broken row. Loud log + skip.
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

export function ensureTaskMessageProtocolBridge() {
  if (initialized) return
  initialized = true
  const hostDirectory = Instance.directory

  Bus.subscribe(Message.Event.Updated, (event) => {
    cacheMessageInfo(event.properties)
    return bridgeEvent(Message.Event.Updated, event.properties)
  })
  Bus.subscribe(Message.Event.PartUpdated, (event) => bridgeEvent(Message.Event.PartUpdated, event.properties))
  Bus.subscribe(Message.Event.Removed, (event) => bridgeEvent(Message.Event.Removed, event.properties))
  Bus.subscribe(Message.Event.PartRemoved, (event) => bridgeEvent(Message.Event.PartRemoved, event.properties))
  Bus.subscribe(Message.Event.PartDelta, (event) => bridgeDelta(event.properties))

  // Cross-Instance bridge: executor sessions run in worktree Instances whose
  // Bus.publish() never reaches the main Instance's subscribers. GlobalBus
  // sees all Instances; we re-execute inside the host Instance context so
  // Database / ProtocolStore use the main DB, not the worktree's.
  const MESSAGE_TYPES = new Set([
    Message.Event.Updated.type,
    Message.Event.PartUpdated.type,
    Message.Event.Removed.type,
    Message.Event.PartRemoved.type,
    Message.Event.PartDelta.type,
  ])
  GlobalBus.on("event", (envelope) => {
    if (!envelope.payload || !MESSAGE_TYPES.has(envelope.payload.type)) return
    if (envelope.directory === hostDirectory) return
    const props = envelope.payload.properties
    if (!props) return
    Instance.provide({ directory: hostDirectory, fn: () => {
      const type = envelope.payload.type
      if (type === Message.Event.Updated.type) {
        cacheMessageInfo(props)
        return bridgeEvent(Message.Event.Updated, props)
      }
      if (type === Message.Event.PartUpdated.type) return bridgeEvent(Message.Event.PartUpdated, props)
      if (type === Message.Event.Removed.type) return bridgeEvent(Message.Event.Removed, props)
      if (type === Message.Event.PartRemoved.type) return bridgeEvent(Message.Event.PartRemoved, props)
      if (type === Message.Event.PartDelta.type) return bridgeDelta(props)
    }})
  })
}
