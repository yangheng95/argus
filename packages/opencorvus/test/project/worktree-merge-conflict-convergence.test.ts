import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { tmpdir } from "../fixture/fixture"

const gitEnv = ["-c", "user.email=t@t.local", "-c", "user.name=test"] as const

describe("Worktree.mergeWithMerge convergence", () => {
  // Regression: with the previous rebase-based design, the agent's reconcile
  // commit appended *after* the conflicting goal commit was discarded on the
  // next rebase replay (rebase always re-replays from the merge base), so the
  // same conflict re-appeared every retry — non-convergent. The merge-based
  // design positions the reconcile commit at the topology join point, so the
  // second mergeWithMerge call sees a clean tree whose tip strictly descends
  // primary's tip and ff-publishes successfully.
  test("agent reconcile-in-MERGING-state then commit converges on second call", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    // Seed a file on master so both sides can diverge over it.
    await fs.writeFile(path.join(tmp.path, "lock.json"), "base\n")
    await $`git add lock.json`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "seed lock"`.cwd(tmp.path).quiet()

    // Create a goal worktree off master and edit lock.json on the goal branch.
    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `goal-${Date.now().toString(36)}` }),
    })
    await fs.writeFile(path.join(info.directory, "lock.json"), "goal-side\n")
    await $`git add lock.json`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit -m "goal edit"`.cwd(info.directory).quiet()

    // Meanwhile master gets a competing edit at the same lines.
    await fs.writeFile(path.join(tmp.path, "lock.json"), "primary-side\n")
    await $`git add lock.json`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "primary edit"`.cwd(tmp.path).quiet()

    // Round 1: merge_back hits a conflict, throws MergeConflictError without
    // aborting. Worktree must be left in MERGING state.
    let firstErr: unknown
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: () => Worktree.mergeWithMerge({ branch: info.branch, worktreeDir: info.directory }),
      })
    } catch (err) {
      firstErr = err
    }
    expect(Worktree.MergeConflictError.isInstance(firstErr)).toBe(true)

    const mergeHead = await $`git rev-parse --verify --quiet MERGE_HEAD`.quiet().nothrow().cwd(info.directory)
    expect(mergeHead.exitCode).toBe(0)

    const conflictFile = path.join(info.directory, "lock.json")
    const conflictBody = await fs.readFile(conflictFile, "utf8")
    expect(conflictBody).toContain("<<<<<<<")
    expect(conflictBody).toContain(">>>>>>>")

    // Agent reconciles in place and commits — that completes the merge.
    await fs.writeFile(conflictFile, "reconciled\n")
    await $`git add lock.json`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit --no-edit`.cwd(info.directory).quiet()

    // Round 2: tree is clean, MERGE_HEAD gone, goal tip strictly descends
    // primary tip. mergeWithMerge must now ff-publish into primary.
    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.mergeWithMerge({ branch: info.branch, worktreeDir: info.directory }),
    })
    expect(result.primaryBranch).toBe("master")
    expect(result.primaryHead).toMatch(/^[0-9a-f]{40}$/)

    const primaryLock = await fs.readFile(path.join(tmp.path, "lock.json"), "utf8")
    expect(primaryLock.replace(/\r\n/g, "\n")).toBe("reconciled\n")
  })

  test("rejects re-entry while a previous merge is unfinished", async () => {
    await using tmp = await tmpdir({ git: true })
    await $`git ${gitEnv} branch -M master`.cwd(tmp.path).quiet()

    await fs.writeFile(path.join(tmp.path, "f.txt"), "base\n")
    await $`git add f.txt`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "seed"`.cwd(tmp.path).quiet()

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `goal-${Date.now().toString(36)}` }),
    })
    await fs.writeFile(path.join(info.directory, "f.txt"), "goal\n")
    await $`git add f.txt`.cwd(info.directory).quiet()
    await $`git ${gitEnv} commit -m "goal edit"`.cwd(info.directory).quiet()

    await fs.writeFile(path.join(tmp.path, "f.txt"), "primary\n")
    await $`git add f.txt`.cwd(tmp.path).quiet()
    await $`git ${gitEnv} commit -m "primary edit"`.cwd(tmp.path).quiet()

    // First call leaves MERGING state.
    let firstErr: unknown
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: () => Worktree.mergeWithMerge({ branch: info.branch, worktreeDir: info.directory }),
      })
    } catch (err) {
      firstErr = err
    }
    expect(Worktree.MergeConflictError.isInstance(firstErr)).toBe(true)

    // Second call without the agent finishing the merge must surface a
    // MergeFailedError pointing at the unfinished MERGE_HEAD instead of
    // silently subsuming the agent's pending work into a fresh merge.
    let secondErr: unknown
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: () => Worktree.mergeWithMerge({ branch: info.branch, worktreeDir: info.directory }),
      })
    } catch (err) {
      secondErr = err
    }
    expect(Worktree.MergeFailedError.isInstance(secondErr)).toBe(true)
  })
})
