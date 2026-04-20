import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { canReuseMergedGoalState, inspectMergeResolverState } from "../../src/engine/merge-resolver"
import { tmpdir } from "../fixture/fixture"

const cleanupDirs: string[] = []

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (!dir) continue
    await $`git merge --abort`.cwd(dir).quiet().nothrow()
    await $`git worktree remove --force ${dir}`.quiet().nothrow()
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

async function commitFile(root: string, file: string, content: string, message: string) {
  await Bun.write(path.join(root, file), content)
  await $`git add -- ${file}`.cwd(root).quiet()
  await $`git -c user.email=opencorvus@local -c user.name=OpenCorvus commit -m ${message}`.cwd(root).quiet()
}

async function makeWorktree(root: string, name: string) {
  const dir = path.join(path.dirname(root), `${name}-${Date.now().toString(36)}`)
  cleanupDirs.push(dir)
  await $`git worktree add ${dir} -b ${`branch-${Date.now().toString(36)}`}`.cwd(root).quiet()
  return dir
}

describe("merge resolver state inspection", () => {
  test("treats an in-progress merge as non-reusable", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    await commitFile(root, "app.txt", "base\n", "base file")

    const goalDir = await makeWorktree(root, "merge-state-conflict")
    await commitFile(goalDir, "app.txt", "goal\n", "goal change")

    await commitFile(root, "app.txt", "main\n", "main change")
    const mainTip = (await $`git rev-parse HEAD`.cwd(root).quiet().text()).trim()

    const merge = await $`git merge --no-commit --no-ff ${mainTip}`.cwd(goalDir).quiet().nothrow()
    expect(merge.exitCode).not.toBe(0)

    const state = await inspectMergeResolverState(goalDir, mainTip)
    expect(state.stillMerging).toBe(true)
    expect(state.conflictingFiles).toContain("app.txt")
    expect(state.ancestryOK).toBe(false)
    expect(canReuseMergedGoalState(state, mainTip)).toBe(false)
  })

  test("reuses a valid merged tip even if unrelated tracked files are dirty", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    await commitFile(root, "app.txt", "base\n", "base file")
    await commitFile(root, "notes.txt", "note\n", "notes file")

    const goalDir = await makeWorktree(root, "merge-state-reuse")
    await commitFile(goalDir, "app.txt", "goal\n", "goal change")

    await commitFile(root, "app.txt", "main\n", "main change")
    const mainTip = (await $`git rev-parse HEAD`.cwd(root).quiet().text()).trim()

    const merge = await $`git merge --no-commit --no-ff ${mainTip}`.cwd(goalDir).quiet().nothrow()
    expect(merge.exitCode).not.toBe(0)

    await Bun.write(path.join(goalDir, "app.txt"), "goal + main\n")
    await $`git add -- app.txt`.cwd(goalDir).quiet()
    await $`git -c user.email=opencorvus@local -c user.name=OpenCorvus commit -m "resolve merge"` .cwd(goalDir).quiet()

    await Bun.write(path.join(goalDir, "notes.txt"), "note\nextra\n")

    const state = await inspectMergeResolverState(goalDir, mainTip)
    expect(state.stillMerging).toBe(false)
    expect(state.conflictingFiles).toEqual([])
    expect(state.ancestryOK).toBe(true)
    expect(state.head).not.toBe(mainTip)
    expect(state.dirtyEntries.some((line) => line.includes("notes.txt"))).toBe(true)
    expect(canReuseMergedGoalState(state, mainTip)).toBe(true)
  })

  // Regression: goal branch was cut from mainTip, main has NOT advanced, goal
  // executor committed deliveries on the branch. HEAD === goalBranchTip, and
  // `mainTip` is already an ancestor. The old predicate required
  // `head !== goalBranchTip` and treated this as non-reusable — forcing the
  // resolver into a `git merge mainTip` that returned "Already up to date"
  // (exit=0, no MERGE_HEAD) and then erroring with "merge setup failed".
  test("reuses goal tip when mainTip is already an ancestor and main has not advanced", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    await commitFile(root, "app.txt", "base\n", "base file")
    const mainTip = (await $`git rev-parse HEAD`.cwd(root).quiet().text()).trim()

    const goalDir = await makeWorktree(root, "merge-state-ancestor")
    await commitFile(goalDir, "app.txt", "goal\n", "goal change")

    const state = await inspectMergeResolverState(goalDir, mainTip)
    expect(state.stillMerging).toBe(false)
    expect(state.conflictingFiles).toEqual([])
    expect(state.ancestryOK).toBe(true)
    expect(state.head).not.toBe(mainTip)
    expect(canReuseMergedGoalState(state, mainTip)).toBe(true)
  })

  // Degenerate: goal branch equals mainTip — nothing delivered. The resolver
  // should NOT treat this as reusable (there is no delta to fast-forward to).
  test("does not reuse when goal HEAD equals mainTip (no delta)", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    await commitFile(root, "app.txt", "base\n", "base file")
    const mainTip = (await $`git rev-parse HEAD`.cwd(root).quiet().text()).trim()

    const goalDir = await makeWorktree(root, "merge-state-nodelta")

    const state = await inspectMergeResolverState(goalDir, mainTip)
    expect(state.stillMerging).toBe(false)
    expect(state.conflictingFiles).toEqual([])
    expect(state.ancestryOK).toBe(true)
    expect(state.head).toBe(mainTip)
    expect(canReuseMergedGoalState(state, mainTip)).toBe(false)
  })
})
