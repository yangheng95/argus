import { describe, expect, test } from "bun:test"
import { mkdtempSync, existsSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import { ensureGitignore } from "../../src/engine/git"

/**
 * 2026-04-30 W2-V32 — `Instance.provide` on a greenfield directory must
 * NOT auto-run `git init`. Pre-fix the bootstrap silently materialized a
 * `.git` directory whenever a request landed on a non-git path (rule 7
 * fallback). On darwin this turned `process.cwd()=="/"` (Tauri sidecar
 * launched from Finder, no `current_dir` set on spawn) into
 * `git init /` → permission denied → `Instance.provide` rejected → cache
 * cleared → next request reproduced → 500-storm across every overlay
 * endpoint that goes through the Instance middleware.
 *
 * The new contract:
 *   - `Instance.provide` succeeds on greenfield directories without
 *     creating any disk artifact under `.git/`.
 *   - The bootstrap returns a directory-scoped project identity
 *     (non-git → deterministic id, worktree: directory, sandbox: directory).
 *   - Routes that *require* a working tree must explicitly check
 *     `Project.isGitRepo` and throw `WorktreeNotGitError` (412) so the
 *     overlay can prompt the user for an explicit init.
 *
 * Earlier (since-superseded) regression — the deadlock W2-V29 originally
 * patched in `Project.initGit` is now moot: the bootstrap no longer
 * touches initGit at all.
 */

describe("Instance.provide bootstrap (greenfield)", () => {
  test("completes on a non-git directory without creating .git", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oc-greenfield-"))
    expect(Project.isGitRepo(dir)).toBe(false)

    let inside = false
    let projectID = ""
    let worktree = ""
    await Instance.provide({
      directory: dir,
      fn: async () => {
        inside = true
        projectID = Instance.project.id
        worktree = Instance.worktree
        // The body runs inside Instance context; calling ensureGitignore
        // is allowed but writes only `.gitignore` (no `.git/`).
        await ensureGitignore()
      },
    })
    expect(inside).toBe(true)

    // Critical assertion (the contract this test is pinning):
    // No `.git` directory was materialized as a side effect of
    // Instance.provide. Pre-fix this would have been true (a fresh
    // git repo); post-fix it must remain a non-git directory.
    expect(existsSync(path.join(dir, ".git"))).toBe(false)
    expect(Project.isGitRepo(dir)).toBe(false)

    // ensureGitignore should still be writable — it writes a plain
    // file regardless of git-ness.
    expect(existsSync(path.join(dir, ".gitignore"))).toBe(true)
    expect(projectID).toBe(Project.directoryProjectID(dir))
    expect(projectID).not.toBe("global")
    expect(worktree).toBe(dir)
  })
})
