import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

describe("Worktree merge publication", () => {
  test("does not host-commit dirty executor output before merge", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "README.md"), "scaffold\n")
    await $`git add README.md`.cwd(tmp.path).quiet()
    await $`git -c user.name=test -c user.email=t@t.local commit -m "scaffold"`.cwd(tmp.path).quiet()
    const result = await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const headBefore = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()

        await fs.writeFile(path.join(tmp.path, "README.md"), "scaffold\nedited\n")
        await fs.writeFile(path.join(tmp.path, "new-file.txt"), "from executor\n")

        const err = await Worktree.mergeWithMerge({
          branch: "opencorvus/executor-output",
          worktreeDir: tmp.path,
        }).then(
          () => undefined,
          (error) => error,
        )
        const headAfter = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()
        const status = (await $`git status --porcelain`.cwd(tmp.path).text()).split("\n").filter(Boolean).sort()
        return { err, headBefore, headAfter, status }
      },
    })

    expect(Worktree.MergeFailedError.isInstance(result.err)).toBe(true)
    expect(Worktree.mergeFailureDetail(result.err)?.reason).toContain("worktree is dirty")
    expect(result.headAfter).toBe(result.headBefore)
    expect(result.status).toEqual([" M README.md", "?? new-file.txt"])
  })
})
