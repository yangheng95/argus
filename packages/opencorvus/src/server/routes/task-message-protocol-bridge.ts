import { Bus } from "@/bus"
import { OrchestratorProtocol } from "@/orchestrator/protocol"
import { ProtocolStore } from "@/protocol/store"
import { MessageV2 } from "@/session/message"
import { Log } from "@/util/log"
import { taskIDForSession, taskSession } from "./task-event"

const log = Log.create({ service: "task-message-protocol-bridge" })
let initialized = false

// ── Overlay rendering metadata ──
// The backend is the authority on message identity (role, channel).
// We compute this once here so the frontend never has to infer it.

/** Canonical display roles for the overlay UI. */
type OverlayRole =
  | "user" | "assistant" | "spec" | "planner" | "goal"
  | "executor" | "evaluator" | "delivery" | "system"

/** Map raw agent name → canonical overlay role. Single source of truth. */
function resolveRole(agent: string): OverlayRole {
  const a = (agent || "").trim().toLowerCase()
  if (!a) return "assistant"
  if (a === "user") return "user"
  if (a === "spec") return "spec"
  if (a === "planner" || a === "plan" || a === "planning" || a === "replan") return "planner"
  if (a === "goal" || a === "goal_gate") return "goal"
  if (a === "executor" || a === "build" || a === "coding" || a === "general" || a === "explore" || a === "execute") return "executor"
  if (a === "judge" || a === "evaluator" || a === "evaluation" || a === "scheduler" || a === "review" || a === "evaluate") return "evaluator"
  if (a === "delivery" || a === "deliver" || a === "files" || a === "publish") return "delivery"
  if (a === "system" || a === "compaction" || a === "title" || a === "summary") return "system"
  return "assistant"
}

/** Stages that get their own AgentCard in the overlay. */
const CARD_STAGES = new Set<OverlayRole>(["spec", "planner", "goal", "executor", "evaluator", "delivery"])

/**
 * Compute overlay metadata for a message event.
 * Returns { resolvedRole, channel } to be injected into the event payload.
 */
function overlayMeta(
  sessionID: string,
  taskID: string,
  info: { role?: string; agent?: string; sessionID?: string },
) {
  const rootSessionID = taskSession(taskID) || ""
  const role = String(info.role || "assistant")
  const agent = String(info.agent || "")
  const isRoot = !rootSessionID || sessionID === rootSessionID

  // User messages always go to main conversation
  if (role === "user") {
    // Child session user messages are orchestrator prompts — hide from main
    return { resolvedRole: "user" as OverlayRole, channel: isRoot ? "main" : "filtered" }
  }

  // Root session assistant messages stay as-is
  if (isRoot) {
    const resolved = resolveRole(agent)
    const channel = CARD_STAGES.has(resolved) ? resolved : "main"
    return { resolvedRole: resolved, channel }
  }

  // Child session — determine if it's a pipeline stage or executor
  const resolved = resolveRole(agent)
  if (CARD_STAGES.has(resolved)) {
    return { resolvedRole: resolved, channel: resolved }
  }
  // Unknown child session agent → executor
  return { resolvedRole: "executor" as OverlayRole, channel: "executor" }
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

/** Inject _overlay metadata into event properties. */
function enrichProperties(properties: Record<string, unknown>, sessionID: string, taskID: string): Record<string, unknown> {
  const info = infoForEvent(properties)
  const meta = overlayMeta(sessionID, taskID, info)
  return { ...properties, _overlay: meta }
}

/** Persist a message event to protocol_event (has sequence, replayable on reconnect). */
async function bridgeEvent<Definition extends typeof MessageV2.Event[keyof typeof MessageV2.Event]>(
  def: Definition,
  properties: Record<string, unknown>,
) {
  const sessionID = sessionFromProperties(properties)
  if (!sessionID) return
  const taskID = taskIDForSession(sessionID)
  if (!taskID) {
    log.debug("skipping message protocol bridge: task unresolved", {
      type: def.type,
      sessionID,
    })
    return
  }
  const enriched = enrichProperties(properties, sessionID, taskID)
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
    type: MessageV2.Event.PartDelta.type,
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
  // Persisted events — written to protocol_event, replayable on reconnect
  Bus.subscribe(MessageV2.Event.Updated, (event) => {
    cacheMessageInfo(event.properties)
    return bridgeEvent(MessageV2.Event.Updated, event.properties)
  })
  Bus.subscribe(MessageV2.Event.PartUpdated, (event) => bridgeEvent(MessageV2.Event.PartUpdated, event.properties))
  Bus.subscribe(MessageV2.Event.Removed, (event) => bridgeEvent(MessageV2.Event.Removed, event.properties))
  Bus.subscribe(MessageV2.Event.PartRemoved, (event) => bridgeEvent(MessageV2.Event.PartRemoved, event.properties))
  // Ephemeral — dispatched to live SSE subscribers but NOT persisted.
  // High frequency (every text token); on reconnect, client recovers full
  // text from persisted message.part.updated or transcript snapshot.
  Bus.subscribe(MessageV2.Event.PartDelta, (event) => bridgeDelta(event.properties))
}
