import { describe, expect, test } from "bun:test"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import { Instance } from "../../src/project/instance"
import { ensureGitignore } from "../../src/engine/git"

/**
 * 2026-04-30 — `Instance.provide` on a greenfield directory (no `.git`)
 * deadlocked itself: the bootstrap iife awaited `Project.initGit`, which
 * awaited `Instance.refresh(directory)`, which `await`ed the very same
 * in-flight iife from the cache → circular wait, never resolved. Manifested
 * as overlay-web-benchmark hanging silently after the third `fromDirectory`
 * log line, before puppeteer ever launched (so the user "saw nothing").
 *
 * Fix removes the redundant Instance.refresh from Project.initGit (rule 8 —
 * single source: bootstrap iife re-reads via Project.fromDirectory itself,
 * and the only other initGit callers — task-api/prepareProject and
 * server/routes/project — already call Instance.refresh themselves).
 *
 * This test pins the contract: Instance.provide on a fresh dir must
 * complete (not hang) and the directory must end up as a git repo.
 */

describe("Instance.provide bootstrap (greenfield)", () => {
  test("completes on a directory with no .git (no self-deadlock)", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "oc-greenfield-"))
    let inside = false
    let done = false
    await Instance.provide({
      directory: dir,
      fn: async () => {
        inside = true
        await ensureGitignore()
        done = true
      },
    })
    expect(inside).toBe(true)
    expect(done).toBe(true)

    const $ = (await import("bun")).$
    const head = await $`git rev-parse --verify HEAD`.cwd(dir).quiet().nothrow()
    expect(head.exitCode).toBe(0)
  })
})
