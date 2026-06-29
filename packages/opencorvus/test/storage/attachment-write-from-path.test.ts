/**
 * AttachmentStore.writeFromPath — single-source convenience for tool
 * producers (acceptance screenshot, future MCP image migration).
 *
 * Attachment-store single-source contract.
 *
 * The point of writeFromPath is to eliminate every ad-hoc
 * `fs.readFile + base64 + data URL` pipeline. These tests pin the
 * contract callers depend on: MIME inferred from path, content-addressed
 * dedupe, hard error on unknown extension (rule 1 — no silent
 * application/octet-stream fallback).
 */
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x42])

describe("AttachmentStore.writeFromPath", () => {
  test("infers MIME from extension and persists at sha-addressed path", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const src = path.join(tmp.path, "shot-1.png")
        await fs.writeFile(src, PNG_MAGIC)
        const ref = await AttachmentStore.writeFromPath(projectID, src)
        expect(ref.mime).toBe("image/png")
        expect(ref.url).toBe(`/attachment/${projectID}/${ref.sha}.png`)
        expect(ref.size).toBe(PNG_MAGIC.length)
        // Bytes round-trip through the store.
        const located = AttachmentStore.nameFromUrl(ref.url)!
        const bytes = await AttachmentStore.read(located.projectID, located.name)
        expect(bytes.equals(PNG_MAGIC)).toBe(true)
        const metadata = await AttachmentStore.readReference(located.projectID, located.name)
        expect(metadata).toMatchObject({
          sha: ref.sha,
          url: ref.url,
          mime: "image/png",
          size: PNG_MAGIC.length,
          filename: "shot-1.png",
        })
      },
    })
  })

  test("deduplicates identical bytes across multiple source paths", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const a = path.join(tmp.path, "a.png")
        const b = path.join(tmp.path, "b.png")
        await fs.writeFile(a, PNG_MAGIC)
        await fs.writeFile(b, PNG_MAGIC)
        const refA = await AttachmentStore.writeFromPath(projectID, a)
        const refB = await AttachmentStore.writeFromPath(projectID, b)
        expect(refA.sha).toBe(refB.sha)
        // Same on-disk file — content-addressed dedupe.
        const filesOnDisk = await AttachmentStore.listOnDisk(projectID)
        expect(filesOnDisk).toHaveLength(1)
      },
    })
  })

  test("throws on unknown extension when no explicit mime given (rule 1, no silent fallback)", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const src = path.join(tmp.path, "mystery.xyz")
        await fs.writeFile(src, Buffer.from([1, 2, 3]))
        await expect(AttachmentStore.writeFromPath(projectID, src)).rejects.toThrow(/unsupported extension/i)
      },
    })
  })

  test("accepts explicit mime override for unknown extension", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const src = path.join(tmp.path, "thing.dat")
        await fs.writeFile(src, Buffer.from("hello"))
        const ref = await AttachmentStore.writeFromPath(projectID, src, "application/pdf")
        expect(ref.mime).toBe("application/pdf")
        expect(ref.url.endsWith(".dat")).toBe(true) // ext follows source filename
      },
    })
  })
})
