import { describe, expect, test } from "bun:test"
import { resolveEvalDir } from "../../src/delivery/checks/per-goal"

describe("resolveEvalDir", () => {
  test("stays anchored at the worktree root", async () => {
    const workDir = "/tmp/worktree"
    const evalDir = await resolveEvalDir(workDir, [
      "apps/web/src/app/page.tsx",
      "apps/web/package.json",
    ])

    expect(evalDir).toBe(workDir)
  })
})
