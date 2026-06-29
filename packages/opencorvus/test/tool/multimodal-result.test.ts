/**
 * Multimodal tool-result builder returns AttachmentStore refs, not data URLs.
 *
 * Attachment-store single-source contract
 *
 * Pre-2026-05-11 visual tool results packed every screenshot byte
 * into `attachments[].url` as `data:image/png;base64,...`. The same image
 * could be inlined 40 times in one session (database forensics), which is the
 * out-of-memory driver this migration repairs. These tests pin the new contract:
 *
 *   - the returned `url` is `/attachment/<projectID>/<sha>.<ext>` — never
 *     a data URL,
 *   - the bytes are persisted in AttachmentStore (and `read()` round-trips),
 *   - identical bytes used twice in one call deduplicate to a single
 *     on-disk file (content-addressed).
 *
 * Pairs with `inline-base64-rejected.test.ts`: the guard ensures the old
 * shape cannot regress, and this test ensures the new shape produces what
 * the guard accepts.
 */
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { buildMultimodalToolResult } from "../../src/tool/multimodal-result"

const PNG_A = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1])
const PNG_B = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 2])

describe("buildMultimodalToolResult", () => {
  test("returns /attachment/<projectID>/<sha>.<ext> refs, never data URLs", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const aPath = path.join(tmp.path, "a.png")
        const bPath = path.join(tmp.path, "b.png")
        await fs.writeFile(aPath, PNG_A)
        await fs.writeFile(bPath, PNG_B)
        const result = await buildMultimodalToolResult({
          projectID,
          text: "compare a vs b",
          images: [
            { path: aPath, mime: "image/png", filename: "a.png" },
            { path: bPath, mime: "image/png", filename: "b.png" },
          ],
        })
        expect(result.attachments).toHaveLength(2)
        for (const att of result.attachments) {
          expect(att.url.startsWith("data:")).toBe(false)
          expect(att.url.startsWith(`/attachment/${projectID}/`)).toBe(true)
          expect(att.url).toMatch(/\.png$/)
          // The url is the canonical form the migration / sweep / message
          // bridge / toModelOutput all recognise.
          expect(AttachmentStore.nameFromUrl(att.url)).toBeTruthy()
        }
      },
    })
  }, 15000)

  test("deduplicates identical bytes via content-addressed sha", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const src1 = path.join(tmp.path, "same-1.png")
        const src2 = path.join(tmp.path, "same-2.png")
        await fs.writeFile(src1, PNG_A)
        await fs.writeFile(src2, PNG_A)
        const result = await buildMultimodalToolResult({
          projectID,
          text: "",
          images: [
            { path: src1, mime: "image/png", filename: "same-1.png" },
            { path: src2, mime: "image/png", filename: "same-2.png" },
          ],
        })
        // Two attachments by reference, but one on-disk file.
        expect(result.attachments).toHaveLength(2)
        const refA = AttachmentStore.nameFromUrl(result.attachments[0].url)!
        const refB = AttachmentStore.nameFromUrl(result.attachments[1].url)!
        expect(refA.name).toBe(refB.name)
        const onDisk = await AttachmentStore.listOnDisk(projectID)
        expect(onDisk).toHaveLength(1)
      },
    })
  }, 15000)

  test("bytes round-trip through AttachmentStore.read", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const src = path.join(tmp.path, "shot.png")
        await fs.writeFile(src, PNG_A)
        const result = await buildMultimodalToolResult({
          projectID,
          text: "",
          images: [{ path: src, mime: "image/png", filename: "shot.png" }],
        })
        const located = AttachmentStore.nameFromUrl(result.attachments[0].url)!
        const bytes = await AttachmentStore.read(located.projectID, located.name)
        expect(bytes.equals(PNG_A)).toBe(true)
      },
    })
  }, 15000)
})
