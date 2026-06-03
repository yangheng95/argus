import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import sharp from "sharp"
import { buildScreenshotToolOutput } from "../../src/build/screenshot-tool"
import type { RuntimeCaptureSuccess } from "../../src/runtime/page-capture"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

describe("build screenshot tool", () => {
  test("attaches an aspect-ratio preserved PNG no larger than 1440x900 for the next model turn", async () => {
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-build-screenshot-tool-"))
    try {
      await Bun.$`git init`.cwd(projectDir).quiet()
      const screenshotPath = path.join(projectDir, "fixture.png")
      await sharp({
        create: {
          width: 1600,
          height: 1000,
          channels: 4,
          background: { r: 21, g: 154, b: 116, alpha: 1 },
        },
      })
        .png()
        .toFile(screenshotPath)

      await Instance.provide({
        directory: projectDir,
        fn: async () => {
          const output = (await buildScreenshotToolOutput(Instance.project.id, {
            captured: true,
            passed: true,
            url: "http://127.0.0.1:4173",
            target_url: "http://127.0.0.1:4173",
            path: screenshotPath,
            sha: "fixture-sha",
            bytes: 9,
            size: { width: 1600, height: 1000 },
            requested_viewport: { width: 1600, height: 1000 },
            viewport: { width: 1600, height: 1000, capped: false },
            layers: { pixel: { variance: 72.5 } },
            dom: {
              textLength: 0,
              nodeCount: 0,
              bodyDescendantCount: 0,
              hasBodyChildren: true,
              isEmptyRootShell: false,
            },
            summary: "captured",
          } as RuntimeCaptureSuccess)) as any

          expect(output.text).toContain('"ok": true')
          expect(output.text).toContain('"resized": true')
          expect(output.attachments).toHaveLength(1)
          const attachment = output.attachments[0]
          expect(attachment.mime).toBe("image/png")
          expect(attachment.url).toStartWith(`/attachment/${Instance.project.id}/`)
          expect(attachment.url).not.toStartWith("data:")
          const located = AttachmentStore.nameFromUrl(attachment.url)
          expect(located).toBeTruthy()
          const bytes = await AttachmentStore.read(located!.projectID, located!.name)
          expect(bytes.subarray(0, 8)).toEqual(PNG_SIGNATURE)
          const metadata = await sharp(bytes).metadata()
          expect(metadata.width).toBe(1440)
          expect(metadata.height).toBe(900)
        },
      })
    } finally {
      await fs.rm(projectDir, { recursive: true, force: true })
    }
  }, 15000)
})
