import { describe, expect, spyOn, test } from "bun:test"
import { Instance } from "../../src/project/instance"
import { ChannelIngress } from "../../src/channel/ingress"
import { Gateway } from "../../src/gateway"
import { ControlMessage } from "../../src/control/message"
import { tmpdir } from "../fixture/fixture"
import { Log } from "../../src/util/log"

Log.init({ print: false })

// Phase 5 invariants:
//  - ChannelIngress.message with no binding AND user_id present → Gateway.handleMessage
//  - ChannelIngress.message with no binding AND no user_id → ControlMessage.handle (legacy)
//  - ChannelIngress.message with an existing binding still goes through ControlMessage.handle
//    (we don't disturb already-bound threads in Phase 5)

describe("ChannelIngress → Gateway routing (Phase 5)", () => {
  test("new thread with user_id routes to Gateway", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const gwSpy = spyOn(Gateway, "handleMessage").mockResolvedValue({
          sessionID: "ses_fake",
          text: "ack from gateway",
          toolCalls: 0,
        })
        const ctrlSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
          kind: "panel_response",
          message: "should-not-be-called",
        } as any)
        try {
          const result = await ChannelIngress.message({
            platform: "slack",
            channel: "C-new",
            thread: "T-new",
            text: "hi gateway",
            user_id: "U-1",
          })
          expect(gwSpy).toHaveBeenCalledTimes(1)
          expect(ctrlSpy).toHaveBeenCalledTimes(0)
          const ck = (gwSpy.mock.calls[0]?.[0] as any)?.channelKey as string
          expect(ck).toBe("slack:C-new:U-1")
          expect((result as any).kind).toBe("panel_response")
          expect((result as any).message).toBe("ack from gateway")
        } finally {
          gwSpy.mockRestore()
          ctrlSpy.mockRestore()
        }
      },
    })
  })

  test("new thread WITHOUT user_id falls through to ControlMessage (no fallback fabrication)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const gwSpy = spyOn(Gateway, "handleMessage").mockResolvedValue({
          sessionID: "ses_fake",
          text: "should-not-be-called",
          toolCalls: 0,
        })
        const ctrlSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
          kind: "panel_response",
          message: "ctrl-handled",
        } as any)
        try {
          const result = await ChannelIngress.message({
            platform: "slack",
            channel: "C-anon",
            thread: "T-anon",
            text: "hi anon",
            // user_id intentionally absent — Gateway needs identity, so we
            // refuse to invent one and let ControlMessage handle the legacy
            // path. Per CLAUDE.md rule #1 — no silent fallback.
          })
          expect(gwSpy).toHaveBeenCalledTimes(0)
          expect(ctrlSpy).toHaveBeenCalledTimes(1)
          expect((result as any).message).toBe("ctrl-handled")
        } finally {
          gwSpy.mockRestore()
          ctrlSpy.mockRestore()
        }
      },
    })
  })
})
