import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { pathToFileURL } from "node:url"
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

  test("generates attachment-<i>-<sha8>.<ext> for unsafe filenames", async () => {
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

  test("copies diagnostic text attachments and returns empty for empty input", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const txt = await AttachmentStore.write(projectID, Buffer.from("hello"), "text/plain", "spec.txt")
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "worktree-"))
        const staged = await AttachmentStore.stageToWorktree(projectID, [txt], worktreeDir)
        expect(staged).toHaveLength(1)
        expect(staged[0].relPath).toBe("references/spec.txt")
        expect(staged[0].mime).toBe("text/plain")
        expect(await fs.readFile(staged[0].absPath, "utf8")).toBe("hello")

        const emptyWorktreeDir = await fs.mkdtemp(path.join(tmp.path, "empty-worktree-"))
        const empty = await AttachmentStore.stageToWorktree(projectID, [], emptyWorktreeDir)
        expect(empty).toEqual([])
        const refsDirExists = await fs
          .stat(path.join(emptyWorktreeDir, "references"))
          .then(() => true)
          .catch(() => false)
        // Empty input -> no references/ directory created.
        expect(refsDirExists).toBe(false)
      },
    })
  })

  test("idempotent across re-runs and preserves conflicting staged files", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const bytes = Buffer.from([0x89, 0x50, 0x4e])
        const a = await AttachmentStore.write(projectID, bytes, "image/png", "screenshot.png")
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "worktree-"))
        const first = await AttachmentStore.stageToWorktree(projectID, [a], worktreeDir)
        const secondSame = await AttachmentStore.stageToWorktree(projectID, [a], worktreeDir)
        expect(secondSame[0].relPath).toBe(first[0].relPath)
        expect(await fs.readFile(secondSame[0].absPath)).toEqual(bytes)

        // Mutated staged files are preserved; the source blob gets a distinct name.
        await fs.writeFile(first[0].absPath, Buffer.from([0xff, 0xff, 0xff]))
        const second = await AttachmentStore.stageToWorktree(projectID, [a], worktreeDir)
        expect(second[0].relPath).not.toBe(first[0].relPath)
        expect(second[0].relPath).toMatch(/^references\/screenshot-[0-9a-f]{8}\.png$/)
        expect(await fs.readFile(first[0].absPath)).toEqual(Buffer.from([0xff, 0xff, 0xff]))
        expect(await fs.readFile(second[0].absPath)).toEqual(bytes)
      },
    })
  })

  test("stages different same-name attachments to distinct reference files", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const firstBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x01])
        const secondBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x02])
        const first = await AttachmentStore.write(projectID, firstBytes, "image/png", "screenshot.png")
        const second = await AttachmentStore.write(projectID, secondBytes, "image/png", "screenshot.png")
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "worktree-"))

        const staged = await AttachmentStore.stageToWorktree(projectID, [first, second], worktreeDir)

        expect(staged).toHaveLength(2)
        expect(staged[0].relPath).not.toBe(staged[1].relPath)
        expect(await fs.readFile(staged[0].absPath)).toEqual(firstBytes)
        expect(await fs.readFile(staged[1].absPath)).toEqual(secondBytes)
        expect(staged[1].relPath).toMatch(/^references\/screenshot-[0-9a-f]{8}\.png$/)

        const restagedSecond = await AttachmentStore.stageToWorktree(projectID, [second], worktreeDir)
        expect(restagedSecond[0].relPath).toBe(staged[1].relPath)
        expect(await fs.readFile(restagedSecond[0].absPath)).toEqual(secondBytes)
      },
    })
  })

  test("rejects when the deterministic collision filename is occupied by different content", async () => {
    await using tmp = await tmpdir()
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const projectID = Instance.project.id
        const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x03])
        const attachment = await AttachmentStore.write(projectID, bytes, "image/png", "screenshot.png")
        const worktreeDir = await fs.mkdtemp(path.join(tmp.path, "worktree-"))
        const refsDir = path.join(worktreeDir, "references")
        await fs.mkdir(refsDir, { recursive: true })
        const suffixPath = path.join(refsDir, `screenshot-${attachment.sha.slice(0, 8)}.png`)
        await fs.writeFile(path.join(refsDir, "screenshot.png"), Buffer.from([0xaa]))
        await fs.writeFile(suffixPath, Buffer.from([0xbb]))

        await expect(AttachmentStore.stageToWorktree(projectID, [attachment], worktreeDir)).rejects.toThrow(
          `AttachmentStore.stageToWorktree: staged filename collision for references/screenshot-${attachment.sha.slice(0, 8)}.png`,
        )
        expect(await fs.readFile(path.join(refsDir, "screenshot.png"))).toEqual(Buffer.from([0xaa]))
        expect(await fs.readFile(suffixPath)).toEqual(Buffer.from([0xbb]))
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

  test("filePartsFromStagedReferences emits file URLs for staged byte sources", () => {
    const absPath = path.join(process.cwd(), "references", "source-reference.png")
    const parts = AttachmentStore.filePartsFromStagedReferences([
      {
        relPath: "references/source-reference.png",
        absPath,
        mime: "image/png",
        originalFilename: "url-www.example.png",
      },
    ])

    expect(parts).toEqual([
      {
        type: "file",
        url: pathToFileURL(absPath).href,
        mime: "image/png",
        filename: "source-reference.png",
      },
    ])
  })
})
