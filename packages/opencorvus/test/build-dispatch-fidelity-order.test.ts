import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

function findIndex(haystack: string, needle: string, after = 0): number {
  return haystack.indexOf(needle, after)
}

describe("orchestrator/tools.ts build dispatch ignores architect fidelity gaps", () => {
  test("goal build branch does not block on validatePersistedArchitectFidelity before worktree creation", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/orchestrator/tools.ts"), "utf8")

    const buildBranchAnchor = source.indexOf(
      `const { BuildAgent, collectGoalContributionDiffs } = await import("@/build/agent")`,
    )
    expect(buildBranchAnchor).toBeGreaterThan(0)

    const worktreeCreateIdx = findIndex(source, "Worktree.create({", buildBranchAnchor)
    const validateIdx = findIndex(source, "validatePersistedArchitectFidelity({", buildBranchAnchor)
    const blockedSentinelIdx = findIndex(
      source,
      "Build dispatch blocked: architect fidelity contract is incomplete.",
      buildBranchAnchor,
    )

    expect(worktreeCreateIdx).toBeGreaterThan(0)
    expect(validateIdx).toBe(-1)
    expect(blockedSentinelIdx).toBe(-1)
  })
})
