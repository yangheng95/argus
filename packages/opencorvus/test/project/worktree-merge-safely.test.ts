import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

const gitEnv = ["-c", "user.email=t@t.local", "-c", "user.name=test"] as const

describe("Worktree.mergeSafely", () => {
  test("returns merged instead of throwing on a clean publication", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-clean-${Date.now().toString(36)}` }),
    })
    await fs.writeFile(path.join(info.directory, "feature.txt"), "feature\n")
    await $`git add feature.txt`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit -m "feature"`.cwd(info.directory).quiet()

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("merged")
    if (outcome.status !== "merged") throw new Error(`unexpected outcome ${outcome.status}`)
    expect(outcome.primaryBranch).toBe("master")
    expect(outcome.primaryHead).toMatch(/^[0-9a-f]{40}$/)
  })

  test("returns conflict and preserves MERGE_HEAD instead of throwing", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    await fs.writeFile(path.join(tmp.path, "shared.txt"), "base\n")
    await $`git add shared.txt`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "seed"`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-conflict-${Date.now().toString(36)}` }),
    })
    await fs.writeFile(path.join(info.directory, "shared.txt"), "goal\n")
    await $`git add shared.txt`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit -m "goal edit"`.cwd(info.directory).quiet()

    await fs.writeFile(path.join(tmp.path, "shared.txt"), "primary\n")
    await $`git add shared.txt`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "primary edit"`.cwd(tmp.path).quiet()

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("conflict")
    if (outcome.status !== "conflict") throw new Error(`unexpected outcome ${outcome.status}`)
    expect(outcome.conflictPaths).toEqual(["shared.txt"])
    const mergeHead = await $`git rev-parse --verify --quiet MERGE_HEAD`
      .quiet()
      .nothrow()
      .cwd(info.directory)
    expect(mergeHead.exitCode).toBe(0)
  })

  test("returns blocked with dirty paths instead of throwing", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    await fs.writeFile(path.join(tmp.path, "tracked.txt"), "base\n")
    await $`git add tracked.txt`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "seed"`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `safe-dirty-${Date.now().toString(36)}` }),
    })
    await fs.writeFile(path.join(info.directory, "tracked.txt"), "dirty\n")
    await fs.writeFile(path.join(info.directory, "new.txt"), "new\n")

    const outcome = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeSafely({ branch: info.branch, worktreeDir: info.directory }),
    })

    expect(outcome.status).toBe("blocked")
    if (outcome.status !== "blocked") throw new Error(`unexpected outcome ${outcome.status}`)
    expect(outcome.reason).toContain("worktree is dirty")
    expect(outcome.dirtyPaths).toEqual(["M tracked.txt", "?? new.txt"])
  })
})
