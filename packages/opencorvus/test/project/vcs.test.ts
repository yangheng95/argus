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
