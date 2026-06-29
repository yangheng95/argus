import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { tmpdir } from "../fixture/fixture"
import { Ripgrep } from "../../src/file/ripgrep"

describe("file.ripgrep", () => {
  test("engine codebase search uses the central ripgrep runtime resolver", async () => {
    const source = await Bun.file(path.resolve(import.meta.dir, "../../src/engine/codebase-tools.ts")).text()

    expect(source).toContain("await Ripgrep.filepath()")
    expect(source).not.toContain('"rg",')
  })

  test("defaults to include hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".opencorvus"), { recursive: true })
        await Bun.write(path.join(dir, ".opencorvus", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(Ripgrep.files({ cwd: tmp.path }))
    const hasVisible = files.includes("visible.txt")
    const hasHidden = files.includes(path.join(".opencorvus", "thing.json"))
    expect(hasVisible).toBe(true)
    expect(hasHidden).toBe(true)
  })

  test("hidden false excludes hidden", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "visible.txt"), "hello")
        await fs.mkdir(path.join(dir, ".opencorvus"), { recursive: true })
        await Bun.write(path.join(dir, ".opencorvus", "thing.json"), "{}")
      },
    })

    const files = await Array.fromAsync(Ripgrep.files({ cwd: tmp.path, hidden: false }))
    const hasVisible = files.includes("visible.txt")
    const hasHidden = files.includes(path.join(".opencorvus", "thing.json"))
    expect(hasVisible).toBe(true)
    expect(hasHidden).toBe(false)
  })

  test("passes shell metacharacters to ripgrep as one pattern argument", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "source.txt"), "needle; echo pwned > injected.txt\n")
      },
    })

    const matches = await Ripgrep.search({
      cwd: tmp.path,
      pattern: "needle; echo pwned > injected.txt",
    })

    expect(matches).toHaveLength(1)
    expect(matches[0]?.path.text).toBe("source.txt")
    expect(matches[0]?.lines.text).toBe("needle; echo pwned > injected.txt\n")
    await expect(fs.stat(path.join(tmp.path, "injected.txt"))).rejects.toThrow()
  })

  test("returns empty matches only for ripgrep no-match exit code", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "source.txt"), "haystack\n")
      },
    })

    const matches = await Ripgrep.search({
      cwd: tmp.path,
      pattern: "missing-needle",
    })

    expect(matches).toEqual([])
  })

  test("throws on ripgrep search failures instead of returning empty matches", async () => {
    await using tmp = await tmpdir({
      init: async (dir) => {
        await Bun.write(path.join(dir, "source.txt"), "haystack\n")
      },
    })

    await expect(
      Ripgrep.search({
        cwd: tmp.path,
        pattern: "[",
      }),
    ).rejects.toThrow(/ripgrep search failed with code/)
  })
})
