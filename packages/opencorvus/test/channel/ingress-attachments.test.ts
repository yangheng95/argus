import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { ChannelIngress } from "../../src/channel/ingress"
import { ControlMessage } from "../../src/control/message"
import { Log } from "../../src/util/log"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

/**
 * Overlay image ingestion fidelity contract.
 *
 * Pre-fix `ChannelIngress.message` ignored `input.attachments` and called
 * `ControlMessage.handle` without forwarding them. Slack/feishu/etc. file
 * uploads disappeared at the control-plane boundary before
 * `panel.create_task` / `panel.send_task_message` could decode them, so
 * IM channels saw the same fidelity-0 surface as the bug-C overlay path.
 *
 * The fix forwards `attachments` through `ControlMessageInput`, normalizing
 * either `{data}` (channel runtimes that already have raw base64) or
 * `{url: dataURL}` into the strict ControlAttachment data-URL form.
 */
describe("ChannelIngress attachment forwarding", () => {
  afterEach(async () => {
    mock.restore()
    await resetDatabase()
  })

  test("forwards channel attachments to ControlMessage as data URLs", async () => {
    const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
      kind: "panel_response",
      message: "stub",
    })

    const PNG_BASE64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

    await ChannelIngress.message({
      platform: "slack",
      channel: "C123",
      thread: "T123",
      text: "Look at this design.",
      attachments: [
        // Slack-style: bytes already base64'd in `data` field.
        { mime: "image/png", filename: "design.png", data: PNG_BASE64 },
      ],
    })

    expect(handleSpy).toHaveBeenCalledTimes(1)
    const call = handleSpy.mock.calls[0]?.[0] as
      | { attachments?: Array<{ mime: string; url: string; filename?: string }> }
      | undefined
    expect(call?.attachments).toHaveLength(1)
    const att = call!.attachments![0]
    expect(att.mime).toBe("image/png")
    expect(att.filename).toBe("design.png")
    // Must be normalized into a data URL so the downstream control-plane
    // LLM sees the bytes as a multimodal file part and panel.* tools can
    // decode them strictly.
    expect(att.url.startsWith("data:image/png;base64,")).toBe(true)
    expect(att.url).toContain(PNG_BASE64)
  })

  test("passes through pre-formed data URLs without double-encoding", async () => {
    const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
      kind: "panel_response",
      message: "stub",
    })

    const dataUrl = "data:image/jpeg;base64,/9j/4AAQSkZJRg=="

    await ChannelIngress.message({
      platform: "telegram",
      channel: "@me",
      thread: "12345",
      text: "Forwarded image.",
      attachments: [{ mime: "image/jpeg", filename: "photo.jpg", url: dataUrl }],
    })

    const call = handleSpy.mock.calls[0]?.[0] as { attachments?: Array<{ url: string }> } | undefined
    expect(call?.attachments?.[0]?.url).toBe(dataUrl)
  })

  test("rejects non-data-URL attachments instead of forwarding garbage", async () => {
    const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
      kind: "panel_response",
      message: "stub",
    })

    let thrown: unknown
    try {
      await ChannelIngress.message({
        platform: "slack",
        channel: "C123",
        thread: "T123",
        text: "Look at this.",
        attachments: [
          // Neither base64 data nor data URL — pre-fix, this would be
          // treated as base64 and produce corrupted bytes.
          { mime: "image/png", filename: "bad.png", url: "https://slack.example/files/abc.png" },
        ],
      })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Error)
    expect((thrown as Error).message).toContain("bad.png")
    expect(handleSpy).not.toHaveBeenCalled()
  })

  test("does not add attachments field when channel input has none", async () => {
    const handleSpy = spyOn(ControlMessage, "handle").mockResolvedValue({
      kind: "panel_response",
      message: "stub",
    })

    await ChannelIngress.message({
      platform: "discord",
      channel: "1",
      thread: "2",
      text: "plain message",
    })

    const call = handleSpy.mock.calls[0]?.[0] as { attachments?: unknown[] }
    expect(call.attachments).toBeUndefined()
  })
})
