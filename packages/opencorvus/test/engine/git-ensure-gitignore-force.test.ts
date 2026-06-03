import { test, expect } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"

/**
 * Regression for the publish_acceptance deterministic failure observed in
 * r11 bench (`_session-r11-glm5cn.out` line 91025, 2026-04-30T19:34:37):
 *
 *   ensureGitignore: stage .gitignore failed: The following paths are
 *   ignored by one of your .gitignore files: .opencorvus
 *
 * Root cause: goal worktrees live under `<project>/.opencorvus/runtime/.../
 * goal-<id>/`, and the project-root `.gitignore` (which goal worktrees
 * share via the parent repo) lists `.opencorvus/runtime/`. Running
 * `git add -- .gitignore` from inside that worktree triggers git's
 * "ignored path" guard. the goal workspace terminal
 * cleanup then aborts and orchestrator loops trying to redeliver,
 * burning the budget without ever publishing.
 *
 * Fix: ensureGitignore stages `.gitignore` with `--force` to bypass the
 * parent-scope ignore rule. Semantic match — we always want the baseline
 * `.gitignore` to seed the worktree, regardless of whether the
 * containing path was marked ignored at a higher level.
 *
 * Source-level guard pins the `--force` argument so a future PR that
 * "cleans up" the flag without understanding why it's there gets caught
 * before re-introducing the wedge.
 */

const GIT_SRC = path.join(
  import.meta.dir,
  "..",
  "..",
  "src",
  "engine",
  "git.ts",
)

const src = await fs.readFile(GIT_SRC, "utf8")

test("ensureGitignore stages .gitignore with --force flag", () => {
  // Match: git(["add", "--force", "--", ".gitignore"], ...). Tolerate any
  // whitespace/quoting variants that preserve the same arg sequence.
  expect(src).toMatch(/\["add",\s*"--force",\s*"--",\s*"\.gitignore"\]/)
})

test("ensureGitignore does NOT silently revert to plain `git add` for the baseline", () => {
  // Negative: pin the absence of the previous `["add", "--", ".gitignore"]`
  // form (without --force). If both forms appear the test still fails —
  // intentional, the function must use exactly the --force variant.
  expect(src).not.toMatch(/\["add",\s*"--",\s*"\.gitignore"\]/)
})
