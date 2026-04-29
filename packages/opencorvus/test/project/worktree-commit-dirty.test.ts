import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

describe("Worktree.commitDirty", () => {
  // Regression: external executors (claude-code, codex) cannot call the
  // OpenCorvus `merge_back` tool, so the host owns finalization. If the
  // executor wrote files but never committed, mergeWithMerge's pre-flight
  // would refuse to start — the original benchmark failure on the
  // claude-code executor.
  test("commits uncommitted changes so a subsequent merge has work to integrate", async () => {
    await using tmp = await tmpdir({ git: true })
    // Establish an initial commit on master so merges have a base.
    await fs.writeFile(path.join(tmp.path, "README.md"), "scaffold\n")
    await $`git add README.md`.cwd(tmp.path).quiet()
    await $`git -c user.name=test -c user.email=t@t.local commit -m "scaffold"`.cwd(tmp.path).quiet()

    // Simulate what claude-code leaves behind: a tracked + an untracked
    // change, neither committed.
    await fs.writeFile(path.join(tmp.path, "README.md"), "scaffold\nedited\n")
    await fs.writeFile(path.join(tmp.path, "new-file.txt"), "from executor\n")

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.commitDirty({ worktreeDir: tmp.path, label: "test/branch" }),
    })

    expect(result.committed).toBe(true)
    if (!result.committed) throw new Error("guard")
    expect(result.head).toMatch(/^[0-9a-f]{40}$/)

    const status = await $`git status --porcelain`.cwd(tmp.path).text()
    expect(status.trim()).toBe("")

    const subject = (await $`git log -1 --pretty=%s`.cwd(tmp.path).text()).trim()
    expect(subject).toBe("build(host): test/branch")
  })

  test("is a no-op when the worktree is already clean", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.writeFile(path.join(tmp.path, "README.md"), "scaffold\n")
    await $`git add README.md`.cwd(tmp.path).quiet()
    await $`git -c user.name=test -c user.email=t@t.local commit -m "scaffold"`.cwd(tmp.path).quiet()
    const headBefore = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.commitDirty({ worktreeDir: tmp.path, label: "no-op" }),
    })

    expect(result.committed).toBe(false)
    const headAfter = (await $`git rev-parse HEAD`.cwd(tmp.path).text()).trim()
    expect(headAfter).toBe(headBefore)
  })
})
