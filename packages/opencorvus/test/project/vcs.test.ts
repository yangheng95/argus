import { afterEach, describe, expect, test } from "bun:test"
import { tmpdir } from "../fixture/fixture"
import { Instance } from "../../src/project/instance"
import { Vcs } from "../../src/project/vcs"
import { resetDatabase } from "../fixture/db"
import { Log } from "../../src/util/log"
import path from "path"
import { $ } from "bun"

Log.init({ print: false })

describe("Vcs.info", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("reports a clean repository", async () => {
    await using tmp = await tmpdir({ git: true })

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await Vcs.info()

        expect(typeof info.branch).toBe("string")
        expect(info.clean).toBe(true)
        expect(info.dirty).toBe(false)
        expect(info.staged).toBe(0)
        expect(info.modified).toBe(0)
        expect(info.untracked).toBe(0)
        expect(info.conflicts).toBe(0)
      },
    })
  })

  test("reports staged, modified, and untracked files", async () => {
    await using tmp = await tmpdir({ git: true })

    await Bun.write(path.join(tmp.path, "tracked.txt"), "base")
    await $`git add tracked.txt`.cwd(tmp.path).quiet()
    await $`git commit -m "tracked"`.cwd(tmp.path).quiet()
    await Bun.write(path.join(tmp.path, "staged.txt"), "staged")
    await $`git add staged.txt`.cwd(tmp.path).quiet()
    await Bun.write(path.join(tmp.path, "tracked.txt"), "changed")
    await Bun.write(path.join(tmp.path, "new.txt"), "new")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const info = await Vcs.info()

        expect(info.dirty).toBe(true)
        expect(info.clean).toBe(false)
        expect(info.staged).toBe(1)
        expect(info.modified).toBe(1)
        expect(info.untracked).toBe(1)
      },
    })
  })
})

describe("Vcs.diff", () => {
  afterEach(async () => {
    await resetDatabase()
  })

  test("returns git patches for modified and untracked working-tree files", async () => {
    await using tmp = await tmpdir({ git: true })

    await Bun.write(path.join(tmp.path, "tracked.txt"), "base\n")
    await $`git add tracked.txt`.cwd(tmp.path).quiet()
    await $`git commit -m "tracked"`.cwd(tmp.path).quiet()
    await Bun.write(path.join(tmp.path, "tracked.txt"), "base\nchanged\n")
    await Bun.write(path.join(tmp.path, "new.txt"), "new\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const diff = await Vcs.diff("git", { context: 2 })
        const tracked = diff.find((item) => item.file === "tracked.txt")
        const added = diff.find((item) => item.file === "new.txt")

        expect(tracked?.status).toBe("modified")
        expect(tracked?.additions).toBe(1)
        expect(tracked?.deletions).toBe(0)
        expect(tracked?.patch).toContain("diff --git")
        expect(tracked?.patch).toContain("+changed")

        expect(added?.status).toBe("added")
        expect(added?.additions).toBe(1)
        expect(added?.deletions).toBe(0)
        expect(added?.patch).toContain("new.txt")
        expect(added?.patch).toContain("+new")
      },
    })
  })

  test("does not synthesize text patches for untracked binary files", async () => {
    await using tmp = await tmpdir({ git: true })

    await Bun.write(path.join(tmp.path, "asset.bin"), new Uint8Array([0, 255, 1, 2, 3, 4]))

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const diff = await Vcs.diff("git", { context: 2 })
        const binary = diff.find((item) => item.file === "asset.bin")

        expect(binary?.status).toBe("added")
        expect(binary?.additions).toBe(0)
        expect(binary?.deletions).toBe(0)
        expect(binary?.patch).toBeUndefined()
      },
    })
  })
})
