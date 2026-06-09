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
    expect(bridgeSource).toContain("ProtocolStore.appendEvent")
    expect(bridgeSource).toMatch(/Bus\.subscribe\(SessionStatus\.Event\.Status,[\s\S]*bridgeSessionLifecycle/)
    expect(bridgeSource).toMatch(/Bus\.subscribe\(SessionStatus\.Event\.Idle,[\s\S]*bridgeSessionLifecycle/)
    expect(bridgeSource).toMatch(/Bus\.subscribe\(SessionEvents\.Error,[\s\S]*bridgeSessionError/)
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

  test("dispatchEphemeral docstring records the 双源 (rule 23) rationale", () => {
    expect(protocolStoreSource).toMatch(/双源|rule 23/)
  })
  test("cross-instance message relay is serialized instead of fire-and-forget", () => {
    expect(bridgeSource).toContain("enqueueCrossInstanceBridge")
    expect(bridgeSource).not.toContain("void Instance.provide")
  })
})
