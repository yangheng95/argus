import { afterEach, test, expect } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Snapshot } from "../../src/snapshot"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { Filesystem } from "../../src/util/filesystem"
import { Process } from "../../src/util/process"
import { tmpdir } from "../fixture/fixture"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

afterEach(async () => {
  await Instance.disposeAll()
})

// Git always outputs /-separated paths internally. Snapshot.patch() joins them
// with path.join (which produces \ on Windows) then normalizes back to /.
// This helper does the same for expected values so assertions match cross-platform.
const fwd = (...parts: string[]) => path.join(...parts).replaceAll("\\", "/")
const rel = (...parts: string[]) => path.join(...parts).replaceAll("\\", "/")

async function symlinkIfAvailable(target: string, link: string, type: "file" | "dir") {
  try {
    await fs.symlink(target, link, type)
    return true
  } catch (err) {
    // EPERM is Node's Error PERMission code; Windows returns it when symlink privilege is unavailable.
    if (process.platform === "win32" && (err as NodeJS.ErrnoException).code === "EPERM") return false
    throw err
  }
}

async function bootstrap() {
  return tmpdir({
    init: async (dir) => {
      await $`git init`.cwd(dir).quiet()
      const unique = Math.random().toString(36).slice(2)
      const aContent = `A${unique}`
      const bContent = `B${unique}`
      await Filesystem.write(`${dir}/a.txt`, aContent)
      await Filesystem.write(`${dir}/b.txt`, bContent)
      return {
        aContent,
        bContent,
      }
    },
  })
}

async function bootstrapCommitted() {
  return tmpdir({
    git: true,
    init: async (dir) => {
      const unique = Math.random().toString(36).slice(2)
      const aContent = `A${unique}`
      const bContent = `B${unique}`
      await Filesystem.write(`${dir}/a.txt`, aContent)
      await Filesystem.write(`${dir}/b.txt`, bContent)
      await $`git add .`.cwd(dir).quiet()
      await $`git commit --no-gpg-sign -m init`.cwd(dir).quiet()
      return {
        aContent,
        bContent,
      }
    },
  })
}

async function snapshotWorktree() {
  return bootstrap()
}

test("tracks deleted files correctly", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await $`rm ${tmp.path}/a.txt`.quiet()

      expect((await Snapshot.patch(before!)).files).toContain(rel("a.txt"))
    },
  })
})

test("track initializes a pre-existing non-git snapshot directory before add", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const gitDir = ProjectRuntimePaths.snapshotCacheRoot(Instance.project.worktree, Instance.project.id)
      await fs.rm(gitDir, { recursive: true, force: true })
      await fs.mkdir(gitDir, { recursive: true })
      await Filesystem.write(path.join(gitDir, "stale-marker.txt"), "created before git init")

      const hash = await Snapshot.track()

      expect(hash).toBeTruthy()
      expect(
        await fs
          .access(path.join(gitDir, "HEAD"))
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
    },
  })
})

test("track uses project worktree as the git precondition and skips the global root", async () => {
  await using tmp = await tmpdir()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      expect(Instance.project.id).toBe("global")
      expect(Instance.project.worktree).toBe("/")

      const projectRef = Project as unknown as { isGitRepo: typeof Project.isGitRepo }
      const processRef = Process as unknown as { run: typeof Process.run }
      const originalIsGitRepo = projectRef.isGitRepo
      const originalRun = processRef.run
      const gitCalls: string[][] = []

      projectRef.isGitRepo = (directory: string) => directory === Instance.directory || originalIsGitRepo(directory)
      processRef.run = async (cmd, opts) => {
        if (cmd[0] === "git") gitCalls.push(cmd.map(String))
        return originalRun(cmd, opts)
      }

      try {
        await expect(Snapshot.track()).resolves.toBeUndefined()
        expect(gitCalls).toEqual([])
      } finally {
        projectRef.isGitRepo = originalIsGitRepo
        processRef.run = originalRun
      }
    },
  })
})

test("concurrent first track calls share snapshot git initialization", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const gitDir = ProjectRuntimePaths.snapshotCacheRoot(Instance.project.worktree, Instance.project.id)
      await fs.rm(gitDir, { recursive: true, force: true })

      const hashes = await Promise.all(Array.from({ length: 8 }, () => Snapshot.track()))

      expect(hashes.every(Boolean)).toBe(true)
      expect(new Set(hashes).size).toBe(1)
    },
  })
})

test("patch repairs a partially initialized snapshot git directory before add", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      const gitDir = ProjectRuntimePaths.snapshotCacheRoot(Instance.project.worktree, Instance.project.id)
      await fs.rm(path.join(gitDir, "HEAD"), { force: true })
      await fs.rm(path.join(gitDir, "config"), { force: true })
      await Filesystem.write(`${tmp.path}/a.txt`, "changed after partial snapshot repo damage")

      const patch = await Snapshot.patch(before!)

      expect(patch.files).toContain(rel("a.txt"))
      expect(
        await fs
          .access(path.join(gitDir, "HEAD"))
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
    },
  })
})

test("revert should remove new files", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/new.txt`, "NEW")

      await Snapshot.revert([await Snapshot.patch(before!)])

      expect(
        await fs
          .access(`${tmp.path}/new.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
})

test("revert in subdirectory", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await $`mkdir -p ${tmp.path}/sub`.quiet()
      await Filesystem.write(`${tmp.path}/sub/file.txt`, "SUB")

      await Snapshot.revert([await Snapshot.patch(before!)])

      expect(
        await fs
          .access(`${tmp.path}/sub/file.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
      // Note: revert currently only removes files, not directories
      // The empty subdirectory will remain
    },
  })
})

test("multiple file operations", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await $`rm ${tmp.path}/a.txt`.quiet()
      await Filesystem.write(`${tmp.path}/c.txt`, "C")
      await $`mkdir -p ${tmp.path}/dir`.quiet()
      await Filesystem.write(`${tmp.path}/dir/d.txt`, "D")
      await Filesystem.write(`${tmp.path}/b.txt`, "MODIFIED")

      await Snapshot.revert([await Snapshot.patch(before!)])

      expect(await fs.readFile(`${tmp.path}/a.txt`, "utf-8")).toBe(tmp.extra.aContent)
      expect(
        await fs
          .access(`${tmp.path}/c.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
      // Note: revert currently only removes files, not directories
      // The empty directory will remain
      expect(await fs.readFile(`${tmp.path}/b.txt`, "utf-8")).toBe(tmp.extra.bContent)
    },
  })
})

test("empty directory handling", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await $`mkdir ${tmp.path}/empty`.quiet()

      expect((await Snapshot.patch(before!)).files.length).toBe(0)
    },
  })
})

test("binary file handling", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/image.png`, new Uint8Array([0x89, 0x50, 0x4e, 0x47]))

      const patch = await Snapshot.patch(before!)
      expect(patch.files).toContain(rel("image.png"))

      await Snapshot.revert([patch])
      expect(
        await fs
          .access(`${tmp.path}/image.png`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
})

test("symlink handling", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      if (!(await symlinkIfAvailable(`${tmp.path}/a.txt`, `${tmp.path}/link.txt`, "file"))) return

      expect((await Snapshot.patch(before!)).files).toContain(rel("link.txt"))
    },
  })
})

test("large file handling", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/large.txt`, "x".repeat(1024 * 1024))

      expect((await Snapshot.patch(before!)).files).toContain(rel("large.txt"))
    },
  })
})

test("nested directory revert", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await $`mkdir -p ${tmp.path}/level1/level2/level3`.quiet()
      await Filesystem.write(`${tmp.path}/level1/level2/level3/deep.txt`, "DEEP")

      await Snapshot.revert([await Snapshot.patch(before!)])

      expect(
        await fs
          .access(`${tmp.path}/level1/level2/level3/deep.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
})

test("special characters in filenames", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/file with spaces.txt`, "SPACES")
      await Filesystem.write(`${tmp.path}/file-with-dashes.txt`, "DASHES")
      await Filesystem.write(`${tmp.path}/file_with_underscores.txt`, "UNDERSCORES")

      const files = (await Snapshot.patch(before!)).files
      expect(files).toContain(rel("file with spaces.txt"))
      expect(files).toContain(rel("file-with-dashes.txt"))
      expect(files).toContain(rel("file_with_underscores.txt"))
    },
  })
})

test("revert with empty patches", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      // Should not crash with empty patches
      expect(Snapshot.revert([])).resolves.toBeUndefined()

      // Should not crash with patches that have empty file lists
      expect(Snapshot.revert([{ hash: "dummy", files: [] }])).resolves.toBeUndefined()
    },
  })
})

test("patch with invalid hash", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      // Create a change
      await Filesystem.write(`${tmp.path}/test.txt`, "TEST")

      // Invalid snapshot baselines must fail loudly instead of producing a false empty patch.
      try {
        await Snapshot.patch("invalid-hash-12345")
        throw new Error("Snapshot.patch should reject invalid hashes")
      } catch (err) {
        expect(Snapshot.SnapshotIntegrityError.isInstance(err)).toBe(true)
        if (Snapshot.SnapshotIntegrityError.isInstance(err)) {
          expect(err.data.operation).toBe("snapshot patch diff")
          expect(err.data.stderr).toContain("bad revision")
        }
      }
    },
  })
})

test("track rejects an empty-tree result for a non-empty indexed worktree", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const processRef = Process as unknown as { run: typeof Process.run }
      const originalRun = processRef.run
      processRef.run = async (cmd, opts) => {
        if (cmd[0] !== "git") return originalRun(cmd, opts)
        const args = cmd.slice(1)
        if (args.includes("write-tree")) {
          return {
            code: 0,
            stdout: Buffer.from(`${Snapshot.EMPTY_TREE_HASH}\n`),
            stderr: Buffer.alloc(0),
          }
        }
        if (args.includes("ls-files")) {
          return {
            code: 0,
            stdout: Buffer.from("a.txt\0"),
            stderr: Buffer.alloc(0),
          }
        }
        return {
          code: 0,
          stdout: Buffer.alloc(0),
          stderr: Buffer.alloc(0),
        }
      }

      try {
        try {
          await Snapshot.track()
          throw new Error("Snapshot.track should reject empty-tree results for indexed content")
        } catch (err) {
          expect(Snapshot.SnapshotEmptyTreeError.isInstance(err)).toBe(true)
          if (Snapshot.SnapshotEmptyTreeError.isInstance(err)) {
            expect(err.data.operation).toBe("snapshot track")
            expect(err.data.worktree).toBe(Instance.worktree)
          }
        }
      } finally {
        processRef.run = originalRun
      }
    },
  })
})

test("revert non-existent file", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      // Try to revert a file that doesn't exist in the snapshot
      // This should not crash
      expect(
        Snapshot.revert([
          {
            hash: before!,
            files: [`${tmp.path}/nonexistent.txt`],
          },
        ]),
      ).resolves.toBeUndefined()
    },
  })
})

test("unicode filenames", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      const unicodeFiles = [
        { path: fwd(tmp.path, "文件.txt"), content: "chinese content" },
        { path: fwd(tmp.path, "🚀rocket.txt"), content: "emoji content" },
        { path: fwd(tmp.path, "café.txt"), content: "accented content" },
        { path: fwd(tmp.path, "файл.txt"), content: "cyrillic content" },
      ]

      for (const file of unicodeFiles) {
        await Filesystem.write(file.path, file.content)
      }

      const patch = await Snapshot.patch(before!)
      expect(patch.files.length).toBe(4)

      for (const file of unicodeFiles) {
        expect(patch.files).toContain(path.relative(tmp.path, file.path).replaceAll("\\", "/"))
      }

      await Snapshot.revert([patch])

      for (const file of unicodeFiles) {
        expect(
          await fs
            .access(file.path)
            .then(() => true)
            .catch(() => false),
        ).toBe(false)
      }
    },
  })
})

test.skip("unicode filenames modification and restore", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const chineseFile = fwd(tmp.path, "文件.txt")
      const cyrillicFile = fwd(tmp.path, "файл.txt")

      await Filesystem.write(chineseFile, "original chinese")
      await Filesystem.write(cyrillicFile, "original cyrillic")

      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(chineseFile, "modified chinese")
      await Filesystem.write(cyrillicFile, "modified cyrillic")

      const patch = await Snapshot.patch(before!)
      expect(patch.files).toContain(chineseFile)
      expect(patch.files).toContain(cyrillicFile)

      await Snapshot.revert([patch])

      expect(await fs.readFile(chineseFile, "utf-8")).toBe("original chinese")
      expect(await fs.readFile(cyrillicFile, "utf-8")).toBe("original cyrillic")
    },
  })
})

test("unicode filenames in subdirectories", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await $`mkdir -p "${tmp.path}/目录/подкаталог"`.quiet()
      const deepFile = fwd(tmp.path, "目录", "подкаталог", "文件.txt")
      await Filesystem.write(deepFile, "deep unicode content")

      const patch = await Snapshot.patch(before!)
      expect(patch.files).toContain(rel("目录", "подкаталог", "文件.txt"))

      await Snapshot.revert([patch])
      expect(
        await fs
          .access(deepFile)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
})

test("very long filenames", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      const longName = "a".repeat(120) + ".txt"
      const longFile = fwd(tmp.path, longName)

      await Filesystem.write(longFile, "long filename content")

      const patch = await Snapshot.patch(before!)
      expect(patch.files).toContain(rel(longName))

      await Snapshot.revert([patch])
      expect(
        await fs
          .access(longFile)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
})

test("hidden files", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/.hidden`, "hidden content")
      await Filesystem.write(`${tmp.path}/.gitignore`, "*.log")
      await Filesystem.write(`${tmp.path}/.config`, "config content")

      const patch = await Snapshot.patch(before!)
      expect(patch.files).toContain(rel(".hidden"))
      expect(patch.files).toContain(rel(".gitignore"))
      expect(patch.files).toContain(rel(".config"))
    },
  })
})

test("nested symlinks", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await $`mkdir -p ${tmp.path}/sub/dir`.quiet()
      await Filesystem.write(`${tmp.path}/sub/dir/target.txt`, "target content")
      if (!(await symlinkIfAvailable(`${tmp.path}/sub/dir/target.txt`, `${tmp.path}/sub/dir/link.txt`, "file"))) return
      if (!(await symlinkIfAvailable(`${tmp.path}/sub`, `${tmp.path}/sub-link`, "dir"))) return

      const patch = await Snapshot.patch(before!)
      expect(patch.files).toContain(rel("sub", "dir", "link.txt"))
      expect(patch.files).toContain(rel("sub-link"))
    },
  })
})

test("file permissions and ownership changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      // Change permissions multiple times without relying on platform shell tools.
      await fs.chmod(`${tmp.path}/a.txt`, 0o600)
      await fs.chmod(`${tmp.path}/a.txt`, 0o755)
      await fs.chmod(`${tmp.path}/a.txt`, 0o644)

      const patch = await Snapshot.patch(before!)
      // Note: git doesn't track permission changes on existing files by default
      // Only tracks executable bit when files are first added
      expect(patch.files.length).toBe(0)
    },
  })
})

test("circular symlinks", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      // Create circular symlink
      await fs.symlink(`${tmp.path}/circular`, `${tmp.path}/circular`, "dir").catch(() => {})

      const patch = await Snapshot.patch(before!)
      expect(patch.files.length).toBeGreaterThanOrEqual(0) // Should not crash
    },
  })
})

test("gitignore changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/.gitignore`, "*.ignored")
      await Filesystem.write(`${tmp.path}/test.ignored`, "ignored content")
      await Filesystem.write(`${tmp.path}/normal.txt`, "normal content")

      const patch = await Snapshot.patch(before!)

      // Should track gitignore itself
      expect(patch.files).toContain(rel(".gitignore"))
      // Should track normal files
      expect(patch.files).toContain(rel("normal.txt"))
      // Should not track ignored files (git won't see them)
      expect(patch.files).not.toContain(rel("test.ignored"))
    },
  })
})

test("git info exclude changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      const file = `${tmp.path}/.git/info/exclude`
      const text = await Bun.file(file).text()
      await Bun.write(file, `${text.trimEnd()}\nignored.txt\n`)
      await Bun.write(`${tmp.path}/ignored.txt`, "ignored content")
      await Bun.write(`${tmp.path}/normal.txt`, "normal content")

      const patch = await Snapshot.patch(before!)
      expect(patch.files).toContain(rel("normal.txt"))
      expect(patch.files).not.toContain(rel("ignored.txt"))

      const after = await Snapshot.track()
      const diffs = await Snapshot.diffFull(before!, after!)
      expect(diffs.some((x) => x.file === "normal.txt")).toBe(true)
      expect(diffs.some((x) => x.file === "ignored.txt")).toBe(false)
    },
  })
})

test("git info exclude keeps global excludes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const global = `${tmp.path}/global.ignore`
      const config = `${tmp.path}/global.gitconfig`
      await Bun.write(global, "global.tmp\n")
      await Bun.write(config, `[core]\n\texcludesFile = ${global.replaceAll("\\", "/")}\n`)

      const prev = process.env.GIT_CONFIG_GLOBAL
      process.env.GIT_CONFIG_GLOBAL = config
      try {
        const before = await Snapshot.track()
        expect(before).toBeTruthy()

        const file = `${tmp.path}/.git/info/exclude`
        const text = await Bun.file(file).text()
        await Bun.write(file, `${text.trimEnd()}\ninfo.tmp\n`)

        await Bun.write(`${tmp.path}/global.tmp`, "global content")
        await Bun.write(`${tmp.path}/info.tmp`, "info content")
        await Bun.write(`${tmp.path}/normal.txt`, "normal content")

        const patch = await Snapshot.patch(before!)
        expect(patch.files).toContain(rel("normal.txt"))
        expect(patch.files).not.toContain(rel("global.tmp"))
        expect(patch.files).not.toContain(rel("info.tmp"))
      } finally {
        if (prev) process.env.GIT_CONFIG_GLOBAL = prev
        else delete process.env.GIT_CONFIG_GLOBAL
      }
    },
  })
})

test("track ignores global safecrlf for CRLF files normalized by eol=lf attributes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const config = `${tmp.path}/safecrlf.gitconfig`
      await Bun.write(config, "[core]\n\tsafecrlf = true\n")
      await Bun.write(`${tmp.path}/.gitattributes`, "* text eol=lf\n")
      await Bun.write(`${tmp.path}/crlf.txt`, "one\r\ntwo\r\n")

      const hadGlobal = Object.prototype.hasOwnProperty.call(process.env, "GIT_CONFIG_GLOBAL")
      const prev = process.env.GIT_CONFIG_GLOBAL
      process.env.GIT_CONFIG_GLOBAL = config
      try {
        const hash = await Snapshot.track()
        expect(hash).toBeTruthy()
        if (!hash) throw new Error("Snapshot.track returned no hash")
        expect(hash).not.toBe(Snapshot.EMPTY_TREE_HASH)
      } finally {
        if (hadGlobal) process.env.GIT_CONFIG_GLOBAL = prev
        else delete process.env.GIT_CONFIG_GLOBAL
      }
    },
  })
})

test("concurrent file operations during patch", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      // Start creating files
      const createPromise = (async () => {
        for (let i = 0; i < 10; i++) {
          await Filesystem.write(`${tmp.path}/concurrent${i}.txt`, `concurrent${i}`)
          // Small delay to simulate concurrent operations
          await new Promise((resolve) => setTimeout(resolve, 1))
        }
      })()

      // Get patch while files are being created
      const patchPromise = Snapshot.patch(before!)

      await createPromise
      const patch = await patchPromise

      // Should capture some or all of the concurrent files
      expect(patch.files.length).toBeGreaterThanOrEqual(0)
    },
  })
})

test("snapshot state isolation between projects", async () => {
  // Test that different projects don't interfere with each other
  await using tmp1 = await snapshotWorktree()
  await using tmp2 = await snapshotWorktree()
  let project1ID: string | undefined

  await Instance.provide({
    directory: tmp1.path,
    fn: async () => {
      project1ID = Instance.project.id
      expect(project1ID).not.toBe("global")
      const before1 = await Snapshot.track()
      expect(before1).toBeTruthy()
      await Filesystem.write(`${tmp1.path}/project1.txt`, "project1 content")
    },
  })

  await Instance.provide({
    directory: tmp2.path,
    fn: async () => {
      expect(project1ID).toBeDefined()
      expect(Instance.project.id).not.toBe("global")
      expect(Instance.project.id).not.toBe(project1ID)
      const before2 = await Snapshot.track()
      expect(before2).toBeTruthy()
      await Filesystem.write(`${tmp2.path}/project2.txt`, "project2 content")
      const patch2 = await Snapshot.patch(before2!)
      expect(patch2.files).toContain(rel("project2.txt"))

      // Ensure project1 files don't appear in project2
      expect(patch2.files).not.toContain(rel("project1.txt"))
    },
  })
})

test("patch detects changes in secondary worktree", async () => {
  await using tmp = await bootstrapCommitted()
  const worktreePath = `${tmp.path}-worktree`
  await $`git worktree add ${worktreePath} HEAD`.cwd(tmp.path).quiet()

  try {
    await Instance.provide({
      directory: worktreePath,
      fn: async () => {
        const before = await Snapshot.track()
        expect(before).toBeTruthy()

        const worktreeFile = fwd(worktreePath, "worktree.txt")
        await Filesystem.write(worktreeFile, "worktree content")

        const patch = await Snapshot.patch(before!)
        expect(patch.files).toContain(rel("worktree.txt"))
      },
    })
  } finally {
    await $`git worktree remove --force ${worktreePath}`.cwd(tmp.path).quiet().nothrow()
    await $`rm -rf ${worktreePath}`.quiet()
  }
})

test("revert only removes files in invoking worktree", async () => {
  await using tmp = await bootstrapCommitted()
  const worktreePath = `${tmp.path}-worktree`
  await $`git worktree add ${worktreePath} HEAD`.cwd(tmp.path).quiet()

  try {
    const primaryFile = `${tmp.path}/worktree.txt`
    await Filesystem.write(primaryFile, "primary content")

    await Instance.provide({
      directory: worktreePath,
      fn: async () => {
        const before = await Snapshot.track()
        expect(before).toBeTruthy()

        const worktreeFile = fwd(worktreePath, "worktree.txt")
        await Filesystem.write(worktreeFile, "worktree content")

        const patch = await Snapshot.patch(before!)
        await Snapshot.revert([patch])

        expect(
          await fs
            .access(worktreeFile)
            .then(() => true)
            .catch(() => false),
        ).toBe(false)
      },
    })

    expect(await fs.readFile(primaryFile, "utf-8")).toBe("primary content")
  } finally {
    await $`git worktree remove --force ${worktreePath}`.cwd(tmp.path).quiet().nothrow()
    await $`rm -rf ${worktreePath}`.quiet()
    await $`rm -f ${tmp.path}/worktree.txt`.quiet()
  }
})

test("diff reports worktree-only/shared edits and ignores primary-only", async () => {
  await using tmp = await bootstrapCommitted()
  const worktreePath = `${tmp.path}-worktree`
  await $`git worktree add ${worktreePath} HEAD`.cwd(tmp.path).quiet()

  try {
    await Instance.provide({
      directory: worktreePath,
      fn: async () => {
        const before = await Snapshot.track()
        expect(before).toBeTruthy()

        await Filesystem.write(`${worktreePath}/worktree-only.txt`, "worktree diff content")
        await Filesystem.write(`${worktreePath}/shared.txt`, "worktree edit")
        await Filesystem.write(`${tmp.path}/shared.txt`, "primary edit")
        await Filesystem.write(`${tmp.path}/primary-only.txt`, "primary change")

        const diff = await Snapshot.diff(before!)
        expect(diff).toContain("worktree-only.txt")
        expect(diff).toContain("shared.txt")
        expect(diff).not.toContain("primary-only.txt")
      },
    })
  } finally {
    await $`git worktree remove --force ${worktreePath}`.cwd(tmp.path).quiet().nothrow()
    await $`rm -rf ${worktreePath}`.quiet()
    await $`rm -f ${tmp.path}/shared.txt`.quiet()
    await $`rm -f ${tmp.path}/primary-only.txt`.quiet()
  }
})

test("track with no changes returns same hash", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const hash1 = await Snapshot.track()
      expect(hash1).toBeTruthy()

      // Track again with no changes
      const hash2 = await Snapshot.track()
      expect(hash2).toBe(hash1!)

      // Track again
      const hash3 = await Snapshot.track()
      expect(hash3).toBe(hash1!)
    },
  })
})

test("diff function with various changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      // Make various changes
      await $`rm ${tmp.path}/a.txt`.quiet()
      await Filesystem.write(`${tmp.path}/new.txt`, "new content")
      await Filesystem.write(`${tmp.path}/b.txt`, "modified content")

      const diff = await Snapshot.diff(before!)
      expect(diff).toContain("a.txt")
      expect(diff).toContain("b.txt")
      expect(diff).toContain("new.txt")
    },
  })
})

test("restore function", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      // Make changes
      await $`rm ${tmp.path}/a.txt`.quiet()
      await Filesystem.write(`${tmp.path}/new.txt`, "new content")
      await Filesystem.write(`${tmp.path}/b.txt`, "modified")

      // Restore to original state
      await Snapshot.restore(before!)

      // Tracked files come back at their pre-snapshot content.
      expect(await fs.readFile(`${tmp.path}/a.txt`, "utf-8")).toBe(tmp.extra.aContent)
      expect(await fs.readFile(`${tmp.path}/b.txt`, "utf-8")).toBe(tmp.extra.bContent)
      // Files added between the snapshot and restore() are NOT part of the
      // snapshot's tree, so restoring "to that snapshot" must remove them —
      // otherwise users would silently inherit stray files from interim work.
      expect(
        await fs
          .access(`${tmp.path}/new.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
})

test("revert should not delete files that existed but were deleted in snapshot", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const snapshot1 = await Snapshot.track()
      expect(snapshot1).toBeTruthy()

      await $`rm ${tmp.path}/a.txt`.quiet()

      const snapshot2 = await Snapshot.track()
      expect(snapshot2).toBeTruthy()

      await Filesystem.write(`${tmp.path}/a.txt`, "recreated content")

      const patch = await Snapshot.patch(snapshot2!)
      expect(patch.files).toContain(rel("a.txt"))

      await Snapshot.revert([patch])

      expect(
        await fs
          .access(`${tmp.path}/a.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
    },
  })
})

test("revert preserves file that existed in snapshot when deleted then recreated", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Filesystem.write(`${tmp.path}/existing.txt`, "original content")

      const snapshot = await Snapshot.track()
      expect(snapshot).toBeTruthy()

      await $`rm ${tmp.path}/existing.txt`.quiet()
      await Filesystem.write(`${tmp.path}/existing.txt`, "recreated")
      await Filesystem.write(`${tmp.path}/newfile.txt`, "new")

      const patch = await Snapshot.patch(snapshot!)
      expect(patch.files).toContain(rel("existing.txt"))
      expect(patch.files).toContain(rel("newfile.txt"))

      await Snapshot.revert([patch])

      expect(
        await fs
          .access(`${tmp.path}/newfile.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(false)
      expect(
        await fs
          .access(`${tmp.path}/existing.txt`)
          .then(() => true)
          .catch(() => false),
      ).toBe(true)
      expect(await fs.readFile(`${tmp.path}/existing.txt`, "utf-8")).toBe("original content")
    },
  })
})

test("diffFull sets status based on git change type", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Filesystem.write(`${tmp.path}/grow.txt`, "one\n")
      await Filesystem.write(`${tmp.path}/trim.txt`, "line1\nline2\n")
      await Filesystem.write(`${tmp.path}/delete.txt`, "gone")

      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/grow.txt`, "one\ntwo\n")
      await Filesystem.write(`${tmp.path}/trim.txt`, "line1\n")
      await $`rm ${tmp.path}/delete.txt`.quiet()
      await Filesystem.write(`${tmp.path}/added.txt`, "new")

      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      const diffs = await Snapshot.diffFull(before!, after!)
      expect(diffs.length).toBe(4)

      const added = diffs.find((d) => d.file === "added.txt")
      expect(added).toBeDefined()
      expect(added!.status).toBe("added")

      const deleted = diffs.find((d) => d.file === "delete.txt")
      expect(deleted).toBeDefined()
      expect(deleted!.status).toBe("deleted")

      const grow = diffs.find((d) => d.file === "grow.txt")
      expect(grow).toBeDefined()
      expect(grow!.status).toBe("modified")
      expect(grow!.additions).toBeGreaterThan(0)
      expect(grow!.deletions).toBe(0)

      const trim = diffs.find((d) => d.file === "trim.txt")
      expect(trim).toBeDefined()
      expect(trim!.status).toBe("modified")
      expect(trim!.additions).toBe(0)
      expect(trim!.deletions).toBeGreaterThan(0)
    },
  })
})

test("diffFull with new file additions", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/new.txt`, "new content")

      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      const diffs = await Snapshot.diffFull(before!, after!)
      expect(diffs.length).toBe(1)

      const newFileDiff = diffs[0]
      expect(newFileDiff.file).toBe("new.txt")
      expect(newFileDiff.before).toBe("")
      expect(newFileDiff.after).toBe("new content")
      expect(newFileDiff.additions).toBe(1)
      expect(newFileDiff.deletions).toBe(0)
    },
  })
})

test("diffFull with file modifications", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/b.txt`, "modified content")

      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      const diffs = await Snapshot.diffFull(before!, after!)
      expect(diffs.length).toBe(1)

      const modifiedFileDiff = diffs[0]
      expect(modifiedFileDiff.file).toBe("b.txt")
      expect(modifiedFileDiff.before).toBe(tmp.extra.bContent)
      expect(modifiedFileDiff.after).toBe("modified content")
      expect(modifiedFileDiff.additions).toBeGreaterThan(0)
      expect(modifiedFileDiff.deletions).toBeGreaterThan(0)
    },
  })
})

test("diffFull with file deletions", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await $`rm ${tmp.path}/a.txt`.quiet()

      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      const diffs = await Snapshot.diffFull(before!, after!)
      expect(diffs.length).toBe(1)

      const removedFileDiff = diffs[0]
      expect(removedFileDiff.file).toBe("a.txt")
      expect(removedFileDiff.before).toBe(tmp.extra.aContent)
      expect(removedFileDiff.after).toBe("")
      expect(removedFileDiff.additions).toBe(0)
      expect(removedFileDiff.deletions).toBe(1)
    },
  })
})

test("diffFull with multiple line additions", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/multi.txt`, "line1\nline2\nline3")

      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      const diffs = await Snapshot.diffFull(before!, after!)
      expect(diffs.length).toBe(1)

      const multiDiff = diffs[0]
      expect(multiDiff.file).toBe("multi.txt")
      expect(multiDiff.before).toBe("")
      expect(multiDiff.after).toBe("line1\nline2\nline3")
      expect(multiDiff.additions).toBe(3)
      expect(multiDiff.deletions).toBe(0)
    },
  })
})

test("diffFull with addition and deletion", async () => {
  await using tmp = await snapshotWorktree()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/added.txt`, "added content")
      await fs.unlink(`${tmp.path}/a.txt`)

      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      const diffs = await Snapshot.diffFull(before!, after!)
      expect(diffs.length).toBe(2)

      const addedFileDiff = diffs.find((d) => d.file === "added.txt")
      expect(addedFileDiff).toBeDefined()
      expect(addedFileDiff!.before).toBe("")
      expect(addedFileDiff!.after).toBe("added content")
      expect(addedFileDiff!.additions).toBe(1)
      expect(addedFileDiff!.deletions).toBe(0)

      const removedFileDiff = diffs.find((d) => d.file === "a.txt")
      expect(removedFileDiff).toBeDefined()
      expect(removedFileDiff!.before).toBe(tmp.extra.aContent)
      expect(removedFileDiff!.after).toBe("")
      expect(removedFileDiff!.additions).toBe(0)
      expect(removedFileDiff!.deletions).toBe(1)
    },
  })
})

test("diffFull with multiple additions and deletions", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/multi1.txt`, "line1\nline2\nline3")
      await Filesystem.write(`${tmp.path}/multi2.txt`, "single line")
      await $`rm ${tmp.path}/a.txt`.quiet()
      await $`rm ${tmp.path}/b.txt`.quiet()

      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      const diffs = await Snapshot.diffFull(before!, after!)
      expect(diffs.length).toBe(4)

      const multi1Diff = diffs.find((d) => d.file === "multi1.txt")
      expect(multi1Diff).toBeDefined()
      expect(multi1Diff!.additions).toBe(3)
      expect(multi1Diff!.deletions).toBe(0)

      const multi2Diff = diffs.find((d) => d.file === "multi2.txt")
      expect(multi2Diff).toBeDefined()
      expect(multi2Diff!.additions).toBe(1)
      expect(multi2Diff!.deletions).toBe(0)

      const removedADiff = diffs.find((d) => d.file === "a.txt")
      expect(removedADiff).toBeDefined()
      expect(removedADiff!.additions).toBe(0)
      expect(removedADiff!.deletions).toBe(1)

      const removedBDiff = diffs.find((d) => d.file === "b.txt")
      expect(removedBDiff).toBeDefined()
      expect(removedBDiff!.additions).toBe(0)
      expect(removedBDiff!.deletions).toBe(1)
    },
  })
})

test("diffFull with no changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      const diffs = await Snapshot.diffFull(before!, after!)
      expect(diffs.length).toBe(0)
    },
  })
})

test("diffFull with binary file changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/binary.bin`, new Uint8Array([0x00, 0x01, 0x02, 0x03]))

      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      const diffs = await Snapshot.diffFull(before!, after!)
      expect(diffs.length).toBe(1)

      const binaryDiff = diffs[0]
      expect(binaryDiff.file).toBe("binary.bin")
      expect(binaryDiff.before).toBe("")
    },
  })
})

test("diffFull with whitespace changes", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      await Filesystem.write(`${tmp.path}/whitespace.txt`, "line1\nline2")
      const before = await Snapshot.track()
      expect(before).toBeTruthy()

      await Filesystem.write(`${tmp.path}/whitespace.txt`, "line1\n\nline2\n")

      const after = await Snapshot.track()
      expect(after).toBeTruthy()

      const diffs = await Snapshot.diffFull(before!, after!)
      expect(diffs.length).toBe(1)

      const whitespaceDiff = diffs[0]
      expect(whitespaceDiff.file).toBe("whitespace.txt")
      expect(whitespaceDiff.additions).toBeGreaterThan(0)
    },
  })
})

// Regression: restore must reproduce the snapshot's worktree EXACTLY — files
// added between track() and restore() (not present in the snapshot's tree)
// have to be removed. Earlier `read-tree + checkout-index -a -f` only wrote
// out tree contents and silently left every "extra" file behind, so revert
// looked successful while leaving stray files in the working copy.
test("restore removes files added after the snapshot was taken", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = await Snapshot.track()
      expect(baseline).toBeTruthy()

      for (const i of [1, 2, 3]) {
        await Filesystem.write(`${tmp.path}/extra-${i}.txt`, `E${i}`)
      }

      await Snapshot.restore(baseline!)

      // baseline files survived
      expect(await fs.readFile(`${tmp.path}/a.txt`, "utf-8")).toBe(tmp.extra.aContent)
      // extras gone
      for (const i of [1, 2, 3]) {
        expect(
          await fs
            .access(`${tmp.path}/extra-${i}.txt`)
            .then(() => true)
            .catch(() => false),
        ).toBe(false)
      }
    },
  })
})

// Regression: previously `Snapshot.cleanup()` (hourly scheduler + the
// per-deleteTask hook) ran `git gc --prune=now` against the bare repo, but
// every tree object emitted by `track()` is dangling (no ref / no reflog),
// so cleanup destroyed every snapshot that live message parts and task
// baselines were still pointing at — restore() failed with "fatal: failed
// to unpack tree object". The fix removed both the API and its callers
// outright. This test pins the structural guarantee: snapshots stay
// restorable after later track cycles, with no explicit GC API to call.
test("snapshots stay restorable after a later track cycle", async () => {
  await using tmp = await bootstrap()
  await Instance.provide({
    directory: tmp.path,
    fn: async () => {
      const baseline = await Snapshot.track()
      expect(baseline).toBeTruthy()

      // Unit coverage only needs one later dangling tree write to pin the
      // structural invariant; the dedicated snapshot benchmark covers the
      // 50-cycle stress case without Bun's default 5s per-test budget.
      await Filesystem.write(`${tmp.path}/a.txt`, `iteration-0-${"x".repeat(64)}`)
      await Snapshot.track()

      await Filesystem.write(`${tmp.path}/a.txt`, "scrambled-after-many-tracks")
      await Snapshot.restore(baseline!)
      expect(await fs.readFile(`${tmp.path}/a.txt`, "utf-8")).toBe(tmp.extra.aContent)

      // The structural invariant: there is no public API on Snapshot that
      // could shred dangling tree objects without also breaking active
      // snapshots, so neither cleanup() nor init() should exist.
      const snap = Snapshot as unknown as Record<string, unknown>
      expect(typeof snap.cleanup).toBe("undefined")
      expect(typeof snap.init).toBe("undefined")
    },
  })
})
