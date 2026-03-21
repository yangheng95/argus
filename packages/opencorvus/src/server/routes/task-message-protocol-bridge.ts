import { Bus } from "@/bus"
import { OrchestratorProtocol } from "@/orchestrator/protocol"
import { ProtocolStore } from "@/protocol/store"
import { MessageV2 } from "@/session/message"
import { Log } from "@/util/log"
import { taskIDForSession } from "./task-event"

const log = Log.create({ service: "task-message-protocol-bridge" })
let initialized = false

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
  await OrchestratorProtocol.emit(def as any, properties as any, {
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
  ProtocolStore.dispatchEphemeral({
    type: MessageV2.Event.PartDelta.type,
    aggregate: "task",
    taskID,
    sessionID,
    source: "session.bridge",
    payload: properties,
  })
}

export function ensureTaskMessageProtocolBridge() {
  if (initialized) return
  initialized = true
  // Persisted events — written to protocol_event, replayable on reconnect
  Bus.subscribe(MessageV2.Event.Updated, (event) => bridgeEvent(MessageV2.Event.Updated, event.properties))
  Bus.subscribe(MessageV2.Event.PartUpdated, (event) => bridgeEvent(MessageV2.Event.PartUpdated, event.properties))
  Bus.subscribe(MessageV2.Event.Removed, (event) => bridgeEvent(MessageV2.Event.Removed, event.properties))
  Bus.subscribe(MessageV2.Event.PartRemoved, (event) => bridgeEvent(MessageV2.Event.PartRemoved, event.properties))
  // Ephemeral — dispatched to live SSE subscribers but NOT persisted.
  // High frequency (every text token); on reconnect, client recovers full
  // text from persisted message.part.updated or transcript snapshot.
  Bus.subscribe(MessageV2.Event.PartDelta, (event) => bridgeDelta(event.properties))
}
