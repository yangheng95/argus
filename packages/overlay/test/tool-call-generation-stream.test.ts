import { describe, expect, test } from "bun:test"
import { testMessageOrderKey, testPartOrderKey } from "./fixtures/timeline-order"

describe("tool call generation stream", () => {
  test("projects backend tool deltas into tool state.raw without run.progress synthesis", async () => {
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
      const card = cardTreeStore.cards["executor:session:ses_tool_stream:message:msg_tool_stream"]
      return card?.parts.find((part: any) => part?.type === "tool")
    }

    resetWriter()

    expect(
      routeSSEEvent({
        type: "run.progress",
        event_id: "evt_legacy_tool_delta",
        timestamp: 1,
        properties: {
          type: "tool_delta",
          sessionID: "ses_tool_stream",
          id: "call_write",
          name: "write_file",
          delta: '{"path":"src/legacy.ts"}',
        },
      }),
    ).toBe(true)
    expect(cardTreeStore.cards["executor:session:ses_tool_stream:message:executor:msg:default"]).toBeUndefined()

    routeSSEEvent({
      type: "message.updated",
      event_id: "evt_message",
      orderKey: testMessageOrderKey("msg_tool_stream", 1),
      timestamp: 1,
      properties: {
        info: {
          id: "msg_tool_stream",
          sessionID: "ses_tool_stream",
          role: "assistant",
          resolvedRole: "executor",
          channel: "executor",
          agent: "executor",
          orderKey: testMessageOrderKey("msg_tool_stream", 1),
          time: { created: 1 },
        },
      },
    })
    routeSSEEvent({
      type: "message.part.updated",
      event_id: "evt_part",
      orderKey: testMessageOrderKey("msg_tool_stream", 1),
      timestamp: 1,
      properties: {
        channel: "executor",
        resolvedRole: "executor",
        orderKey: testMessageOrderKey("msg_tool_stream", 1),
        part: {
          id: "part_tool_stream",
          messageID: "msg_tool_stream",
          sessionID: "ses_tool_stream",
          type: "tool",
          tool: "write_file",
          callID: "call_write",
          orderKey: testPartOrderKey("part_tool_stream", 1),
          state: {
            status: "running",
            input: {},
            title: "write_file",
            metadata: {},
            time: { start: 1 },
          },
        },
      },
    })
    routeSSEEvent({
      type: "message.part.delta",
      event_id: "evt_1",
      timestamp: 1,
      properties: {
        partID: "part_tool_stream",
        messageID: "msg_tool_stream",
        sessionID: "ses_tool_stream",
        field: "raw",
        delta: '{"path":"src/app.ts",',
      },
    })
    routeSSEEvent({
      type: "message.part.delta",
      event_id: "evt_2",
      timestamp: 2,
      properties: {
        partID: "part_tool_stream",
        messageID: "msg_tool_stream",
        sessionID: "ses_tool_stream",
        field: "raw",
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
