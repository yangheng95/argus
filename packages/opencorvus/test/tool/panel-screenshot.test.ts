import { afterEach, expect, mock, test } from "bun:test"
import { Identifier } from "../../src/id/id"

afterEach(() => {
  mock.restore()
})

test("capture_overlay_screenshot returns a PNG attachment", async () => {
  mock.module("node-screenshots", () => ({
    Window: class {
      static all() {
        return [
          {
            title: () => "OpenCorvus",
            appName: () => "OpenCorvus",
            width: () => 900,
            height: () => 680,
            z: () => 1,
            isFocused: () => true,
            isMinimized: () => false,
            captureImageSync: () => ({
              toPngSync: () => Buffer.from("hello"),
            }),
          },
        ]
      }
    },
  }))

  const { PanelTool } = await import("../../src/tool/panel")
  const tool = await PanelTool.init()
  const result = await tool.execute(
    {
      action: "capture_overlay_screenshot",
    },
    {
      sessionID: Identifier.ascending("session"),
      messageID: Identifier.ascending("message"),
      agent: "panel-test",
      abort: new AbortController().signal,
      messages: [],
      metadata() {},
      async ask() {},
      extra: { surface: "panel" },
    },
  )
  const output = JSON.parse(result.output)

  expect(output.message).toContain("Captured OpenCorvus GUI")
  expect(output.attachments).toHaveLength(1)
  expect(output.attachments[0]).toMatchObject({
    mime: "image/png",
    filename: "OpenCorvus.png",
    url: "data:image/png;base64,aGVsbG8=",
  })
})
