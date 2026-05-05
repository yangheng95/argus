import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

// Phase A2 — fidelity gate runs BEFORE worktree creation in the build tool.
//
// Pre-fix order (orchestrator/tools.ts:4267-4290): Worktree.create →
// updateGoalWorkspace → validatePersistedArchitectFidelity → return on
// failure. The early return left the worktree on disk and a poisoned
// engine_goal.workspace_dir row that read as "in-flight" but had no
// goal_run_attempt artifact (bench gemini reproducer 2026-05-04).
//
// The build tool is wired through createOrchestratorTools() with deep
// dependencies, so this regression check enforces the order at the source
// level: in the build tool body, the first call to
// `validatePersistedArchitectFidelity` MUST appear before the first call
// to `Worktree.create` and the first call to `updateGoalWorkspace`.

function findIndex(haystack: string, needle: string, after = 0): number {
  const idx = haystack.indexOf(needle, after)
  return idx
}

describe("orchestrator/tools.ts build dispatch fidelity-first ordering", () => {
  test("validatePersistedArchitectFidelity precedes Worktree.create / updateGoalWorkspace", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../src/orchestrator/tools.ts"),
      "utf8",
    )

    // Anchor on the goal-path build branch the fix touched — the BuildAgent
    // import marker is the function-local boundary used in production.
    const buildBranchAnchor = source.indexOf(`const { BuildAgent } = await import("@/build/agent")`)
    expect(buildBranchAnchor).toBeGreaterThan(0)

    const validateIdx = findIndex(source, "validatePersistedArchitectFidelity({", buildBranchAnchor)
    const worktreeCreateIdx = findIndex(source, "Worktree.create({", buildBranchAnchor)
    const updateGoalWorkspaceIdx = findIndex(source, "updateGoalWorkspace({", buildBranchAnchor)

    expect(validateIdx).toBeGreaterThan(0)
    expect(worktreeCreateIdx).toBeGreaterThan(0)
    expect(updateGoalWorkspaceIdx).toBeGreaterThan(0)

    // The fidelity gate must come first within this branch.
    expect(validateIdx).toBeLessThan(worktreeCreateIdx)
    expect(validateIdx).toBeLessThan(updateGoalWorkspaceIdx)
  })

  test("fidelity-failure return path returns the blocked-dispatch sentinel before any side effect", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../src/orchestrator/tools.ts"),
      "utf8",
    )

    const buildBranchAnchor = source.indexOf(`const { BuildAgent } = await import("@/build/agent")`)
    const sentinelIdx = source.indexOf(
      "Build dispatch blocked: architect fidelity contract is incomplete.",
      buildBranchAnchor,
    )
    const worktreeCreateIdx = source.indexOf("Worktree.create({", buildBranchAnchor)
    expect(sentinelIdx).toBeGreaterThan(0)
    expect(sentinelIdx).toBeLessThan(worktreeCreateIdx)
  })
})
