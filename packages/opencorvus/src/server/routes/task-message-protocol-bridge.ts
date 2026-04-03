import { Bus } from "@/bus"
import { GlobalBus } from "@/bus/global"
import { Instance } from "@/project/instance"
import { OrchestratorProtocol } from "@/orchestrator/protocol"
import { ProtocolStore } from "@/protocol/store"
import { Message } from "@/session/message"
import { Log } from "@/util/log"
import { taskIDForSession, taskSession, sessionRole } from "./task-event"

const log = Log.create({ service: "task-message-protocol-bridge" })
let initialized = false

// ── Overlay rendering metadata ──
// The backend is the authority on message identity (role, channel).
// We compute this once here so the frontend never has to infer it.

/** Canonical display roles for the overlay UI. */
type OverlayRole =
  | "user" | "assistant" | "spec" | "architect" | "planner" | "goal"
  | "executor" | "evaluator" | "delivery" | "system"

/** Map raw agent name → canonical overlay role. Single source of truth. */
export function resolveRole(agent: string): OverlayRole {
  const a = (agent || "").trim().toLowerCase()
  if (!a) return "assistant"
  if (a === "user") return "user"
  if (a === "orchestrator" || a === "task_agent") return "assistant"
  if (a === "spec") return "spec"
  if (a === "architect" || a === "architecture" || a === "coordination") return "architect"
  if (a === "planner" || a === "plan" || a === "planning" || a === "replan") return "planner"
  if (a === "goal" || a === "goal_gate") return "goal"
  if (a === "executor" || a === "build" || a === "coding" || a === "general" || a === "explore" || a === "execute" || a === "opencode" || a === "codex" || a === "claude-code") return "executor"
  if (a === "judge" || a === "evaluator" || a === "evaluation" || a === "scheduler" || a === "review" || a === "evaluate") return "evaluator"
  if (a === "delivery" || a === "deliver" || a === "files" || a === "publish") return "delivery"
  if (a === "system" || a === "compaction" || a === "title" || a === "summary") return "system"
  return "assistant"
}

/** Stages that get their own AgentCard in the overlay. */
const CARD_STAGES = new Set<OverlayRole>(["spec", "architect", "planner", "goal", "executor", "evaluator", "delivery"])

/**
 * Compute overlay metadata for a message event.
 * Returns { resolvedRole, channel } to be injected into the event payload.
 */
export function overlayMeta(
  sessionID: string,
  taskID: string,
  info: { role?: string; agent?: string; sessionID?: string },
) {
  const rootSessionID = taskSession(taskID) || ""
  const role = String(info.role || "assistant")
  const agent = String(info.agent || "")
  const isRoot = !rootSessionID || sessionID === rootSessionID

  // User messages: root session → main conversation, child session → parent agent's card
  if (role === "user") {
    if (isRoot) return { resolvedRole: "user" as OverlayRole, channel: "main" }
    // Child session user messages are orchestrator prompts — route to the
    // agent card that owns this session so they are visible alongside replies.
    const parentRole = sessionRole(sessionID)
    const resolved = parentRole ? resolveRole(parentRole) : ("user" as OverlayRole)
    // Route to the parent stage's card if it has one; otherwise these are
    // internal orchestrator prompts (e.g. Task Agent → child) that should
    // NOT appear in the main conversation — mark as "filtered".
    const channel = CARD_STAGES.has(resolved) ? resolved : "filtered"
    return { resolvedRole: "user" as OverlayRole, channel }
  }

  // Root session assistant messages stay as-is
  if (isRoot) {
    const resolved = resolveRole(agent)
    const channel = CARD_STAGES.has(resolved) ? resolved : "main"
    return { resolvedRole: resolved, channel }
  }

  // Child session — agent field is authoritative, same logic as root
  const resolved = resolveRole(agent)
  const channel = CARD_STAGES.has(resolved) ? resolved : "main"
  return { resolvedRole: resolved, channel }
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

// Cache message-level info (role, agent) so part/delta events can resolve metadata
// without DB queries. message.updated always arrives before/with part events.
const messageInfoCache = new Map<string, { role: string; agent: string }>()

function cacheMessageInfo(properties: Record<string, unknown>) {
  const info = properties.info as any
  if (!info?.id) return
  messageInfoCache.set(info.id, {
    role: String(info.role || "assistant"),
    agent: String(info.agent || ""),
  })
  // Keep cache bounded — evict oldest entries if too large
  if (messageInfoCache.size > 500) {
    const first = messageInfoCache.keys().next().value
    if (first) messageInfoCache.delete(first)
  }
}

function infoForEvent(properties: Record<string, unknown>): { role: string; agent: string } {
  // message.updated: info is directly in properties
  const info = properties.info as any
  if (info && typeof info === "object" && info.role) {
    return { role: String(info.role), agent: String(info.agent || "") }
  }
  // message.part.updated / message.part.delta: look up by messageID
  const messageID =
    (properties.part as any)?.messageID ||
    (properties as any).messageID ||
    ""
  if (messageID && messageInfoCache.has(messageID)) {
    return messageInfoCache.get(messageID)!
  }
  // Fallback: no info available (part arrived before message — rare)
  return { role: "assistant", agent: "" }
}

/**
 * Stamp resolvedRole and channel directly into info (message.updated)
 * or as top-level fields (part/delta events).
 * Every event that reaches the frontend MUST carry these fields.
 */
function enrichProperties(properties: Record<string, unknown>, sessionID: string, taskID: string): Record<string, unknown> {
  const info = infoForEvent(properties)
  // External executor processes don't stamp agent — fill from session registry
  if (!info.agent) {
    const role = sessionRole(sessionID)
    if (role) info.agent = role
  }
  const meta = overlayMeta(sessionID, taskID, info)
  const enriched = { ...properties }

  // message.updated: stamp into info object directly
  if (enriched.info && typeof enriched.info === "object") {
    enriched.info = { ...(enriched.info as any), resolvedRole: meta.resolvedRole, channel: meta.channel }
  }
  // Always set at top level so part/delta events also carry the metadata
  enriched.resolvedRole = meta.resolvedRole
  enriched.channel = meta.channel
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
    log.info("skipping message protocol bridge: task unresolved", {
      type: def.type,
      sessionID,
    })
    return
  }
  const enriched = enrichProperties(properties, sessionID, taskID)
  const meta = overlayMeta(sessionID, taskID, infoForEvent(properties))
  log.info("bridge → protocol", {
    type: def.type,
    sessionID,
    taskID,
    resolvedRole: meta.resolvedRole,
    channel: meta.channel,
    msgID: (properties.info as any)?.id ?? (properties.part as any)?.messageID ?? "",
  })
  await OrchestratorProtocol.emit(def as any, enriched as any, {
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
  const enriched = enrichProperties(properties, sessionID, taskID)
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

  // Persisted events — written to protocol_event, replayable on reconnect
  Bus.subscribe(Message.Event.Updated, (event) => {
    cacheMessageInfo(event.properties)
    return bridgeEvent(Message.Event.Updated, event.properties)
  })
  Bus.subscribe(Message.Event.PartUpdated, (event) => bridgeEvent(Message.Event.PartUpdated, event.properties))
  Bus.subscribe(Message.Event.Removed, (event) => bridgeEvent(Message.Event.Removed, event.properties))
  Bus.subscribe(Message.Event.PartRemoved, (event) => bridgeEvent(Message.Event.PartRemoved, event.properties))
  // Ephemeral — dispatched to live SSE subscribers but NOT persisted.
  // High frequency (every text token); on reconnect, client recovers full
  // text from persisted message.part.updated or transcript snapshot.
  Bus.subscribe(Message.Event.PartDelta, (event) => bridgeDelta(event.properties))

  // ── Cross-Instance bridge ──
  // Executor sessions run in worktree Instances (different Instance.directory).
  // Their Bus.publish() goes to the worktree's Instance-scoped Bus, which the
  // subscriptions above never see. GlobalBus receives ALL events from ALL
  // Instances, so we subscribe here to catch worktree-scoped message events.
  // We skip events from our own Instance (already handled above) to avoid
  // double-processing.
  const MESSAGE_TYPES = new Set([
    Message.Event.Updated.type,
    Message.Event.PartUpdated.type,
    Message.Event.Removed.type,
    Message.Event.PartRemoved.type,
    Message.Event.PartDelta.type,
  ])
  GlobalBus.on("event", (envelope) => {
    if (!envelope.payload || !MESSAGE_TYPES.has(envelope.payload.type)) return
    // Skip events from the host Instance — already handled by Bus.subscribe above
    if (envelope.directory === hostDirectory) return
    const props = envelope.payload.properties
    if (!props) return
    // Run the same bridge logic inside the host Instance context so that
    // Database/ProtocolStore calls use the main project's DB, not the worktree's.
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
