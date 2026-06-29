import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const bridgeSource = readFileSync(
  join(__dirname, "..", "..", "src", "orchestrator", "protocol", "message-bridge.ts"),
  "utf8",
)
const protocolStoreSource = readFileSync(join(__dirname, "..", "..", "src", "protocol", "store.ts"), "utf8")

describe("message-bridge persistence guard", () => {
  // Regression: protocol_event used to grow to 300+ MB because every bus
  // `message.updated` re-snapshotted the full message info into the event log.
  // Message events stay ephemeral; tiny session lifecycle events are persisted
  // so reconnect and hydration keep terminal status.
  test("does not import EngineProtocol (which writes to protocol_event)", () => {
    expect(bridgeSource).not.toContain("EngineProtocol")
  })

  test("persists session lifecycle and session error events", () => {
    expect(bridgeSource).toContain("function bridgeSessionLifecycle")
    expect(bridgeSource).toContain("function bridgeSessionError")
    expect(bridgeSource).toContain("function bridgeTaskReport")
    expect(bridgeSource).toContain("session.bridge.persist_failed")
    expect(bridgeSource).toContain("ProtocolStore.appendEvent")
    expect(bridgeSource).toMatch(/Bus\.subscribe\(SessionStatus\.Event\.Status,[\s\S]*bridgeSessionLifecycle/)
    expect(bridgeSource).toMatch(/Bus\.subscribe\(SessionStatus\.Event\.Idle,[\s\S]*bridgeSessionLifecycle/)
    expect(bridgeSource).toMatch(/Bus\.subscribe\(SessionEvents\.Error,[\s\S]*bridgeSessionError/)
    expect(bridgeSource).toMatch(/Bus\.subscribe\(TaskReport\.EventDef,[\s\S]*bridgeTaskReport/)
  })

  test("does not hide foreign-key bridge failures", () => {
    expect(bridgeSource).not.toContain("FOREIGN KEY constraint failed")
    expect(bridgeSource).toContain("appendBridgePersistFailure")
    expect(bridgeSource).toContain("appendBridgePreparationFailure")
    expect(bridgeSource).toContain("failed to persist cross-instance relay diagnostic")
    expect(bridgeSource).not.toContain("bridge: dropping event after error")
  })

  test("uses dispatchEphemeral for every Message.Event subscription", () => {
    expect(bridgeSource).toContain("ProtocolStore.dispatchEphemeral")
    const eventTypes = [
      "Message.Event.Updated",
      "Message.Event.PartUpdated",
      "Message.Event.Removed",
      "Message.Event.PartRemoved",
      "Message.Event.PartDelta",
    ]
    for (const t of eventTypes) {
      expect(bridgeSource).toContain(`Bus.subscribe(${t},`)
    }
  })

  test("stamps message orderKey on part events and only part orderKey into Message.Part", () => {
    expect(bridgeSource).toContain("partOrderKeysForEvent")
    expect(bridgeSource).toContain("messageOrderKey")
    expect(bridgeSource).toContain("enriched.part = { ...partRecord(properties), orderKey: partOrderKey }")
    expect(bridgeSource).toContain("enriched.orderKey = messageOrderKey")
    expect(bridgeSource).not.toMatch(/enriched\.part\s*=\s*{[^}]*resolvedRole/)
    expect(bridgeSource).not.toMatch(/enriched\.part\s*=\s*{[^}]*channel/)
    expect(bridgeSource).not.toMatch(/enriched\.part\s*=\s*{[^}]*parentSessionID/)
  })

  test("dispatchEphemeral docstring records the 双源 (rule 23) rationale", () => {
    expect(protocolStoreSource).toMatch(/双源|rule 23/)
  })
  test("cross-instance message relay is serialized instead of fire-and-forget", () => {
    expect(bridgeSource).toContain("enqueueCrossInstanceBridge")
    expect(bridgeSource).toContain("crossInstanceBridgeQueue = crossInstanceBridgeQueue")
    expect(bridgeSource).toMatch(/\.then\(\(\) =>\s*Instance\.provide\(/)
    expect(bridgeSource).toContain("failed to persist cross-instance relay diagnostic")
  })
})
