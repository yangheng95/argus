import { afterEach, expect, test } from "bun:test"
import { $ } from "bun"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

test("refreshes a cached global project when the directory becomes a git repository", async () => {
  await using tmp = await tmpdir()

  await Instance.provide({
    directory: tmp.path,
    fn: () => {
      expect(Instance.project.id).toBe("global")
      expect(Instance.worktree).toBe("/")
    },
  })

  await $`git init`.cwd(tmp.path).quiet()

  await Instance.provide({
    directory: tmp.path,
    async fn() {
      expect(Instance.project.id).not.toBe("global")
      expect(Instance.directory).toBe(tmp.path)
      expect(Instance.worktree).toBe(tmp.path)
      expect(Instance.project.worktree).toBe(tmp.path)

      const info = await Worktree.create({ name: "stale-cache-smoke" })
      try {
        expect(info.directory).toContain(".opencorvus")
        expect(info.directory).not.toBe("/")
      } finally {
        await Worktree.remove({ directory: info.directory })
      }
    },
  })
})
