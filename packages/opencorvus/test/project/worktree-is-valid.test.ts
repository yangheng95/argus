// ── Worktree.isValid — zombie-worktree detection ──
//
// Regression guard for the Windows partial-teardown bug that left goal
// workspaces as orphan file trees with no `.git` link. The sequence was:
// `git worktree remove --force` succeeded in deleting the per-worktree .git
// file + the primary repo's `.git/worktrees/<name>/` metadata, then the
// follow-up `rm -rf` lost to a file lock on `node_modules/**`. `existsSync`
// on the dir still returned true, so `acquireGoalWorkspace` reused the
// residue — at which point every subsequent `git` call in that dir walked
// up and executed against the primary repo, silently landing commits on
// master while the goal branch stayed behind. `isValid` is the gate that
// lets the caller tell those apart.
//
// Scenarios covered here:
//   1. freshly-created worktree              → valid
//   2. residue with .git deleted (post-fail) → invalid, reason mentions .git
//   3. nonexistent directory                 → invalid, reason mentions .git
//   4. primary repo itself                   → valid (it's in `worktree list`)

import { describe, expect, test } from "bun:test"
import fs from "fs/promises"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("Worktree.isValid", () => {
  test("freshly-created worktree is valid", async () => {
    await using tmp = await tmpdir({ git: true })
    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `valid-ok-${Date.now().toString(36)}` }),
    })

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.isValid(info.directory),
    })
    expect(result.valid).toBe(true)
  })

  test("directory with .git removed looks like a zombie and is rejected", async () => {
    await using tmp = await tmpdir({ git: true })
    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `zombie-${Date.now().toString(36)}` }),
    })

    // Reproduce the Windows partial-teardown state: the .git linkage (which
    // on `git worktree add` is always a file, not a directory) has been
    // deleted along with its primary-repo registry entry, but the working
    // tree files were never removed because a child process held them open.
    await fs.rm(path.join(info.directory, ".git"), { force: true })
    // Also unregister from the primary repo's worktree list to match what
    // `git worktree remove --force` would have done before failing on the
    // rm step. `git worktree prune` is the cheapest way to drop a dangling
    // registration where the worktree path is still present on disk but
    // the .git link is gone — git sees the mismatch and unregisters it.
    await fs.rm(path.join(tmp.path, ".git", "worktrees", path.basename(info.directory)), {
      recursive: true,
      force: true,
    })

    expect(await Filesystem.exists(info.directory)).toBe(true)

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.isValid(info.directory),
    })
    expect(result.valid).toBe(false)
    expect(result.reason ?? "").toMatch(/\.git/)
  })

  test("nonexistent directory is rejected", async () => {
    await using tmp = await tmpdir({ git: true })
    const ghost = path.join(tmp.path, ".opencorvus", "worktrees", "never-existed")

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.isValid(ghost),
    })
    expect(result.valid).toBe(false)
  })

  test("reattaches an empty workspace directory to its recorded branch", async () => {
    await using tmp = await tmpdir({ git: true })
    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `reattach-${Date.now().toString(36)}` }),
    })

    await fs.rm(path.join(info.directory, ".git"), { force: true })
    await fs.rm(path.join(tmp.path, ".git", "worktrees", path.basename(info.directory)), {
      recursive: true,
      force: true,
    })
    await fs.rm(info.directory, { recursive: true, force: true })
    await fs.mkdir(info.directory, { recursive: true })

    const recovered = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.recoverRecorded({ directory: info.directory, branch: info.branch }),
    })

    expect(recovered.status).toBe("recovered")
    const valid = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.isValid(info.directory),
    })
    expect(valid.valid).toBe(true)
  })

  test("does not reclaim a missing-git workspace that still contains files", async () => {
    await using tmp = await tmpdir({ git: true })
    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name: `preserve-zombie-${Date.now().toString(36)}` }),
    })
    await fs.rm(path.join(info.directory, ".git"), { force: true })
    await fs.rm(path.join(tmp.path, ".git", "worktrees", path.basename(info.directory)), {
      recursive: true,
      force: true,
    })
    await fs.writeFile(path.join(info.directory, "uncommitted-progress.txt"), "keep me\n")

    const recovered = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.recoverRecorded({ directory: info.directory, branch: info.branch }),
    })

    expect(recovered.status).toBe("unrecoverable")
    expect(recovered.reason).toContain("preserving")
    expect(await fs.readFile(path.join(info.directory, "uncommitted-progress.txt"), "utf8")).toBe("keep me\n")
  })

  test("primary worktree is valid", async () => {
    await using tmp = await tmpdir({ git: true })

    const result = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.isValid(tmp.path),
    })
    expect(result.valid).toBe(true)
  })
})
