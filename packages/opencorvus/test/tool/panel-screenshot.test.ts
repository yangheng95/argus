import { afterEach, expect, mock, test } from "bun:test"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

afterEach(async () => {
  mock.restore()
  await resetDatabase()
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

  await using tmp = await tmpdir({ git: true })

  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
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
      })
      expect(output.attachments[0].url).toStartWith(`/attachment/${Instance.project.id}/`)
      expect(output.attachments[0].url).not.toContain("data:image")
      const located = AttachmentStore.nameFromUrl(output.attachments[0].url)
      expect(located?.projectID).toBe(Instance.project.id)
      expect(await AttachmentStore.read(located!.projectID, located!.name)).toEqual(Buffer.from("hello"))
    },
  })
})
