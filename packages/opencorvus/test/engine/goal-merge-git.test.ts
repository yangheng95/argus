import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { createGoalDeliveryCommit } from "../../src/goal/runner"
import { mergeGoalDelivery } from "../../src/engine/runtime"
import { Filesystem } from "../../src/util/filesystem"
import { Instance } from "../../src/project/instance"
import { tmpdir } from "../fixture/fixture"

const cleanupDirs: string[] = []

afterEach(async () => {
  while (cleanupDirs.length > 0) {
    const dir = cleanupDirs.pop()
    if (!dir) continue
    await $`git worktree remove --force ${dir}`.quiet().nothrow()
    await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
  }
})

async function commitFile(root: string, file: string, content: string, message: string) {
  await Bun.write(path.join(root, file), content)
  await $`git add -- ${file}`.cwd(root).quiet()
  await $`git -c user.email=opencorvus@local -c user.name=OpenCorvus commit -m ${message}`.cwd(root).quiet()
}

function normalizeEol(input: string) {
  return input.replace(/\r\n/g, "\n")
}

async function makeWorktree(root: string, name: string) {
  const dir = path.join(path.dirname(root), `${name}-${Date.now().toString(36)}`)
  cleanupDirs.push(dir)
  await $`git worktree add ${dir} -b ${`branch-${Date.now().toString(36)}`}`.cwd(root).quiet()
  return dir
}

describe("mergeGoalDelivery git integration", () => {
  test("merges a goal delivery by cherry-picking the worktree commit", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    await commitFile(root, "app.txt", "base\n", "base file")

    const worktreeDir = await makeWorktree(root, "merge-success")
    await Bun.write(path.join(worktreeDir, "app.txt"), "feature\n")

    const commitRef = await Instance.provide({
      directory: worktreeDir,
      fn: () => createGoalDeliveryCommit([{ file: "app.txt", status: "modified" }], "Goal success"),
    })

    await Instance.provide({
      directory: root,
      fn: () => mergeGoalDelivery(
        { id: "task_1" } as any,
        { id: "run_1" } as any,
        { id: "plan_1" } as any,
        { id: "glr_1" } as any,
        {
          summary: "Goal success changed app.txt",
          commitRef,
          diffs: [{ file: "app.txt", status: "modified" }],
        },
        {} as any,
      ),
    })

    expect(normalizeEol(await Filesystem.readText(path.join(root, "app.txt")))).toBe("feature\n")
    const status = await $`git status --porcelain=v1`.cwd(root).quiet().text()
    expect(status.trim()).toBe("")
  })

  test("aborts cherry-pick and leaves main worktree clean on conflict", async () => {
    await using tmp = await tmpdir({ git: true })
    const root = tmp.path
    await commitFile(root, "app.txt", "base\n", "base file")

    const worktreeDir = await makeWorktree(root, "merge-conflict")
    await Bun.write(path.join(worktreeDir, "app.txt"), "feature\n")
    const commitRef = await Instance.provide({
      directory: worktreeDir,
      fn: () => createGoalDeliveryCommit([{ file: "app.txt", status: "modified" }], "Goal conflict"),
    })

    await commitFile(root, "app.txt", "main\n", "main change")

    await expect(
      Instance.provide({
        directory: root,
        fn: () => mergeGoalDelivery(
          { id: "task_1" } as any,
          { id: "run_1" } as any,
          { id: "plan_1" } as any,
          { id: "glr_conflict" } as any,
          {
            summary: "Goal conflict changed app.txt",
            commitRef,
            diffs: [{ file: "app.txt", status: "modified" }],
          },
          {} as any,
        ),
      }),
    ).rejects.toThrow(/goal merge conflict/i)

    expect(normalizeEol(await Filesystem.readText(path.join(root, "app.txt")))).toBe("main\n")
    const status = await $`git status --porcelain=v1`.cwd(root).quiet().text()
    expect(status.trim()).toBe("")
  })
})
