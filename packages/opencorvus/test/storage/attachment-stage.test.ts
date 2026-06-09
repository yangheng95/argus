import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { AttachmentStore } from "../../src/storage/attachment-store"

describe("AttachmentStore.stageToWorktree", () => {
  test("copies multimodal attachments into <worktree>/references/", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const a = await AttachmentStore.write(
          projectID,
          Buffer.from([0x89, 0x50, 0x4e, 0x47]),
          "image/png",
          "screenshot.png",
        )
        const b = await AttachmentStore.write(
          projectID,
          Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d]),
          "image/png",
          "另一个 截图.png",
        )
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "worktree-"))

        const staged = await AttachmentStore.stageToWorktree(projectID, [a, b], worktreeDir)
        expect(staged).toHaveLength(2)
        expect(staged[0].relPath).toBe("references/screenshot.png")
        // CJK + space passes the safe-filename regex (rule: only ban shell-meta + path sep).
        expect(staged[1].relPath).toBe("references/另一个 截图.png")
        for (const s of staged) {
          const exists = await fs
            .stat(s.absPath)
            .then(() => true)
            .catch(() => false)
          expect(exists).toBe(true)
          expect(s.absPath.startsWith(path.join(worktreeDir, "references"))).toBe(true)
        }
      },
    })
  })

  test("falls back to attachment-<i>-<sha8>.<ext> for unsafe filenames", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const a = await AttachmentStore.write(
          projectID,
          Buffer.from([0x89, 0x50, 0x4e]),
          "image/png",
          "evil$name|with;chars.png",
        )
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "worktree-"))
        const staged = await AttachmentStore.stageToWorktree(projectID, [a], worktreeDir)
        expect(staged).toHaveLength(1)
        expect(staged[0].relPath).toMatch(/^references\/attachment-1-[0-9a-f]{8}\.png$/)
      },
    })
  })

  test("skips non-multimodal attachments and returns empty for empty input", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const txt = await AttachmentStore.write(projectID, Buffer.from("hello"), "text/plain", "spec.txt")
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "worktree-"))
        const staged = await AttachmentStore.stageToWorktree(projectID, [txt], worktreeDir)
        expect(staged).toEqual([])
        const refsDirExists = await fs
          .stat(path.join(worktreeDir, "references"))
          .then(() => true)
          .catch(() => false)
        // Empty input → no references/ directory created
        expect(refsDirExists).toBe(false)

        const empty = await AttachmentStore.stageToWorktree(projectID, [], worktreeDir)
        expect(empty).toEqual([])
      },
    })
  })

  test("idempotent across re-runs (existing destination skipped)", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const a = await AttachmentStore.write(projectID, Buffer.from([0x89, 0x50, 0x4e]), "image/png", "screenshot.png")
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "worktree-"))
        const first = await AttachmentStore.stageToWorktree(projectID, [a], worktreeDir)
        const mtimeFirst = (await fs.stat(first[0].absPath)).mtime.getTime()
        // Mutate destination — second staging must NOT overwrite
        await fs.writeFile(first[0].absPath, Buffer.from([0xff, 0xff, 0xff]))
        const second = await AttachmentStore.stageToWorktree(projectID, [a], worktreeDir)
        expect(second[0].relPath).toBe(first[0].relPath)
        const bytes = await fs.readFile(first[0].absPath)
        expect(bytes).toEqual(Buffer.from([0xff, 0xff, 0xff]))
        void mtimeFirst
      },
    })
  })

  test("renderStagedList emits empty string when nothing staged", () => {
    expect(AttachmentStore.renderStagedList([])).toBe("")
  })

  test("renderStagedList includes worktree-relative paths and original filename when present", () => {
    const out = AttachmentStore.renderStagedList([
      {
        relPath: "references/screenshot.png",
        absPath: "/abs/screenshot.png",
        mime: "image/png",
        originalFilename: "屏幕截图.png",
      },
    ])
    expect(out).toContain("`references/screenshot.png`")
    expect(out).toContain("originally `屏幕截图.png`")
    expect(out).toContain("Staged Reference Files")
  })

  test("STAGED_REFERENCES_SUBDIR is the conventional 'references' string", () => {
    expect(AttachmentStore.STAGED_REFERENCES_SUBDIR).toBe("references")
  })
})
