import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const bridgeSource = readFileSync(
  join(__dirname, "..", "..", "src", "orchestrator", "protocol", "message-bridge.ts"),
  "utf8",
)
const protocolStoreSource = readFileSync(
  join(__dirname, "..", "..", "src", "protocol", "store.ts"),
  "utf8",
)

describe("message-bridge persistence guard", () => {
  // Regression: protocol_event used to grow to 300+ MB because every bus
  // `message.updated` re-snapshotted the full message info into the event log.
  // The fix routes message.* events through dispatchEphemeral (live SSE only);
  // canonical message state lives in the message/part tables. These guards
  // prevent the persistence path from being re-introduced.
  test("does not import EngineProtocol (which writes to protocol_event)", () => {
    expect(bridgeSource).not.toContain("EngineProtocol")
  })

  test("does not call appendEvent (DB write API)", () => {
    expect(bridgeSource).not.toContain("appendEvent")
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
})
