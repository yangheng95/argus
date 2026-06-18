import { $ } from "bun"
import { describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { collectMainWorktreeDiff } from "../../src/engine/workspace-export"
import { tmpdir } from "../fixture/fixture"

describe("workspace export runtime filtering", () => {
  test("excludes OpenCorvus runtime paths from changed files and patch body", async () => {
    await using tmp = await tmpdir({ git: true })
    await fs.mkdir(path.join(tmp.path, "src"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, "src", "app.ts"), "export const value = 1\n")
    await $`git add src/app.ts`.cwd(tmp.path).quiet()
    await $`git commit -m baseline`.cwd(tmp.path).quiet()
    const baseRef = (await $`git rev-parse HEAD`.cwd(tmp.path).quiet().text()).trim()

    await fs.mkdir(path.join(tmp.path, ".opencorvus", "r", "t", "ab", "cdef12"), { recursive: true })
    await fs.writeFile(path.join(tmp.path, ".opencorvus", "r", "t", "ab", "cdef12", "trace.jsonl"), "large runtime\n")
    await fs.mkdir(path.join(tmp.path, ".opencorvus", "runtime", "tasks", "legacy"), { recursive: true })
    await fs.writeFile(
      path.join(tmp.path, ".opencorvus", "runtime", "tasks", "legacy", "trace.jsonl"),
      "legacy runtime\n",
    )
    await fs.writeFile(path.join(tmp.path, "src", "app.ts"), "export const value = 2\n")
    await $`git add -f .opencorvus/r/t/ab/cdef12/trace.jsonl .opencorvus/runtime/tasks/legacy/trace.jsonl src/app.ts`
      .cwd(tmp.path)
      .quiet()
    await $`git commit -m changes`.cwd(tmp.path).quiet()

    const diff = await collectMainWorktreeDiff(tmp.path, baseRef)

    expect(diff.changedFiles).toEqual(["src/app.ts"])
    expect(diff.patch).toContain("src/app.ts")
    expect(diff.patch).not.toContain(".opencorvus/r")
    expect(diff.patch).not.toContain(".opencorvus/runtime")
    expect(diff.patch).not.toContain("large runtime")
    expect(diff.patch).not.toContain("legacy runtime")
  })
})
