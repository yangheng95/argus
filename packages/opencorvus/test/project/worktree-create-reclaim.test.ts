// ── Worktree.create reclaim contract ──
//
// When the caller passes an explicit `name`, Worktree.create MUST reuse that
// exact path (reclaiming any stale directory/branch from a previous run).
// It must NOT fall back to a randomized suffix like `${name}-brave-panda`.
//
// This test exists because the old `candidate()` loop silently rotated to a
// random suffix on conflict, which in turn caused goal retries to land on a
// different path (e.g. goal-o0zuyqh0 → goal-o0zuyqh0-gentle-pixel). That
// rotation broke prompt-cache continuity across retries — system prompt
// embeds Instance.directory byte-for-byte, and any byte change invalidates
// the 1h system cache. If a future change re-introduces the suffix-fallback
// path, this test will fail and force the author to own that decision.

import { describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Worktree } from "../../src/worktree"
import { Filesystem } from "../../src/util/filesystem"
import { tmpdir } from "../fixture/fixture"

describe("Worktree.create — deterministic name reclaim (no fallback)", () => {
  test("schema rejects the retired checkout option", () => {
    expect(Worktree.CreateInput.safeParse({ name: "retired-checkout", checkout: "sync" }).success).toBe(false)
  })

  test("second create with the same name reuses the exact path; no randomized suffix", async () => {
    await using tmp = await tmpdir({ git: true })
    const name = `reclaim-test-${Date.now().toString(36)}`

    const first = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name }),
    })

    expect(first.name).toBe(name)
    expect(path.basename(first.directory)).toBe(name)
    expect(await Filesystem.exists(first.directory)).toBe(true)

    // Leave the first worktree + branch in place and ask for the same name
    // again. The reclaim path should tear down the stale artifacts and
    // return the SAME directory — not a randomized alternative.
    const second = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name }),
    })

    expect(second.name).toBe(name)
    expect(second.directory).toBe(first.directory)
    expect(second.branch).toBe(first.branch)
    expect(await Filesystem.exists(second.directory)).toBe(true)

    // And there is no sibling directory with a `-<suffix>` derived name —
    // the old fallback path would have produced `${name}-brave-panda` (or
    // similar) under the same root.
    const parent = path.dirname(first.directory)
    const siblings = await $`ls ${parent}`.quiet().text()
    const stray = siblings
      .split("\n")
      .map((s) => s.trim())
      .filter((s) => s.startsWith(`${name}-`))
    expect(stray).toEqual([])
  })

  test("reclaim succeeds when only a stale branch ref is left (no directory)", async () => {
    await using tmp = await tmpdir({ git: true })
    const name = `branch-only-${Date.now().toString(36)}`
    const branch = `opencorvus/${name}`

    // Create the branch in isolation (no worktree attached). Simulates the
    // "crash left a dangling ref" state that the old fallback used to work
    // around by rotating the name.
    const makeBranch = await $`git branch ${branch}`.cwd(tmp.path).quiet().nothrow()
    expect(makeBranch.exitCode).toBe(0)

    const info = await Instance.provide({
      directory: tmp.path,
      fn: () => Worktree.create({ name }),
    })

    expect(info.name).toBe(name)
    expect(path.basename(info.directory)).toBe(name)
  })
})
