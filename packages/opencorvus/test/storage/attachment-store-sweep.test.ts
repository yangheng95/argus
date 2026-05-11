/**
 * Garbage-collection regression suite for AttachmentStore.sweep.
 *
 * Specs: specs/delivery-attachment-store-single-source-2026-05-11.md.
 *
 * The store is content-addressed and write-only — every part / session /
 * task that ever referenced a file leaves its bytes behind on disk
 * forever. Now that delivery's compare_visual_artifacts persists through
 * the store instead of inlining base64 into part.data, an unswept store
 * just moves the unbounded growth from DB to FS. These tests pin the
 * sweep contract:
 *
 *   - orphan files (not referenced by any persisted part) are deleted,
 *   - referenced files survive,
 *   - files younger than GC_MIN_AGE_MS are spared so a sweep racing a
 *     concurrent write does not delete a fresh attachment before its
 *     part row lands.
 */
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { Session } from "../../src/session"
import { Identifier } from "../../src/id/id"

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function differentBytes(suffix: number): Buffer {
  return Buffer.concat([PNG_MAGIC, Buffer.from([suffix])])
}

async function ageFile(absPath: string, ageMs: number) {
  // Backdate mtime so the sweep's GC_MIN_AGE_MS gate considers the file
  // old enough to delete. Using fs.utimes keeps the contents intact.
  const past = new Date(Date.now() - ageMs - 1_000)
  await fs.utimes(absPath, past, past)
}

describe("AttachmentStore.sweep", () => {
  test("deletes unreferenced files older than the min-age gate", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const orphanA = await AttachmentStore.write(projectID, differentBytes(1), "image/png", "a.png")
        const orphanB = await AttachmentStore.write(projectID, differentBytes(2), "image/png", "b.png")

        // Backdate both files past the 60s skip-young gate so sweep
        // considers them deletable.
        await ageFile(AttachmentStore.resolveAbsolute(projectID, AttachmentStore.nameFromUrl(orphanA.url)!.name)!, 120_000)
        await ageFile(AttachmentStore.resolveAbsolute(projectID, AttachmentStore.nameFromUrl(orphanB.url)!.name)!, 120_000)

        const before = await AttachmentStore.listOnDisk(projectID)
        expect(before).toHaveLength(2)

        const result = await AttachmentStore.sweep(projectID)
        expect(result.deleted).toBe(2)
        expect(result.kept).toBe(0)
        expect(result.skippedYoung).toBe(0)
        expect(result.bytesFreed).toBeGreaterThan(0)

        const after = await AttachmentStore.listOnDisk(projectID)
        expect(after).toHaveLength(0)
      },
    })
  })

  test("keeps files referenced by any part.data row", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const kept = await AttachmentStore.write(projectID, differentBytes(3), "image/png", "kept.png")
        const orphan = await AttachmentStore.write(projectID, differentBytes(4), "image/png", "orphan.png")

        // Persist a part whose state.attachments references `kept` —
        // collectReferencedShas pulls every `/attachment/<id>/<sha>.<ext>`
        // url out of `part.data`. We do not need full message lineage; a
        // tool part written directly via Session.updatePart is enough.
        const session = await Session.create({ kind: "orchestrator" })
        const message = await Session.updateMessage({
          id: Identifier.ascending("message"),
          sessionID: session.id,
          role: "user",
          time: { created: Date.now() },
          agent: "user",
          model: { providerID: "test", modelID: "test" },
        } as any)
        await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: message.id,
          sessionID: session.id,
          type: "file",
          mime: "image/png",
          filename: "kept.png",
          url: kept.url,
        } as any)

        // Backdate both attachments past the min-age gate.
        await ageFile(AttachmentStore.resolveAbsolute(projectID, AttachmentStore.nameFromUrl(kept.url)!.name)!, 120_000)
        await ageFile(AttachmentStore.resolveAbsolute(projectID, AttachmentStore.nameFromUrl(orphan.url)!.name)!, 120_000)

        const result = await AttachmentStore.sweep(projectID)
        expect(result.kept).toBe(1)
        expect(result.deleted).toBe(1)

        const remaining = await AttachmentStore.listOnDisk(projectID)
        expect(remaining.map((f) => f.sha).sort()).toEqual([kept.sha].sort())
      },
    })
  })

  test("skips files younger than GC_MIN_AGE_MS to avoid racing a fresh write", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        await AttachmentStore.write(projectID, differentBytes(5), "image/png", "fresh.png")
        // Do NOT backdate — the file is younger than 60s.
        const result = await AttachmentStore.sweep(projectID)
        expect(result.skippedYoung).toBe(1)
        expect(result.deleted).toBe(0)
        const remaining = await AttachmentStore.listOnDisk(projectID)
        expect(remaining).toHaveLength(1)
      },
    })
  })

  test("idempotent — running twice deletes 0 the second time", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const orphan = await AttachmentStore.write(projectID, differentBytes(6), "image/png", "o.png")
        await ageFile(AttachmentStore.resolveAbsolute(projectID, AttachmentStore.nameFromUrl(orphan.url)!.name)!, 120_000)
        const first = await AttachmentStore.sweep(projectID)
        expect(first.deleted).toBe(1)
        const second = await AttachmentStore.sweep(projectID)
        expect(second.deleted).toBe(0)
      },
    })
  })

  test("returns 0 deletions for projects that never wrote any attachment", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const result = await AttachmentStore.sweep(projectID)
        expect(result).toEqual({ deleted: 0, bytesFreed: 0, skippedYoung: 0, kept: 0 })
      },
    })
  })
})
