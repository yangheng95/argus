import { describe, expect, test } from "bun:test"

describe("tool call generation stream", () => {
  test("projects executor tool deltas into tool state.raw", async () => {
    ;(globalThis as any).__OPENCORVUS_OVERLAY_VERSION__ = "test"
    if (typeof globalThis.requestAnimationFrame === "undefined") {
      ;(globalThis as any).requestAnimationFrame = (() => 1) as any
      ;(globalThis as any).cancelAnimationFrame = (() => {}) as any
    }
    const { cardTreeStore } = await import("../src/store/card-tree")
    const { routeSSEEvent } = await import("../src/services/events")
    const { flushBufferedPartDeltas, resetWriter } = await import("../src/services/tree-writer")
    const { describeToolPart } = await import("../src/utils/tool")
    const toolPart = () => {
      const card = cardTreeStore.cards["executor:session:ses_tool_stream:message:executor:msg:default"]
      return card?.parts.find((part: any) => part?.type === "tool")
    }

    resetWriter()

    routeSSEEvent({
      type: "run.progress",
      event_id: "evt_1",
      timestamp: 1,
      properties: {
        type: "tool_delta",
        sessionID: "ses_tool_stream",
        id: "call_write",
        name: "write_file",
        delta: '{"path":"src/app.ts",',
      },
    })
    routeSSEEvent({
      type: "run.progress",
      event_id: "evt_2",
      timestamp: 2,
      properties: {
        type: "tool_delta",
        sessionID: "ses_tool_stream",
        id: "call_write",
        name: "write_file",
        delta: '"content":"console.log(1)"}',
      },
    })
    flushBufferedPartDeltas()

    const part = toolPart()
    expect(part?.state?.raw).toBe('{"path":"src/app.ts","content":"console.log(1)"}')
    expect(part?.raw).toBeUndefined()
    expect(describeToolPart(part)?.detail).toContain("src/app.ts")
  })
})
