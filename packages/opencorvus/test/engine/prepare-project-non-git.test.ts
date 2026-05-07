import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import path from "path"
import { Database } from "../../src/storage/db"
import { ProjectTable } from "../../src/project/project.sql"
import { Instance } from "../../src/project/instance"
import { EngineService } from "@/task-api"
import { Worktree } from "../../src/worktree"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

/**
 * 2026-04-30 W2-V32 — `EngineService.createTask` must REFUSE to create a
 * task when the active project directory is not a git repository.
 *
 * Pre-fix the `prepareProject` helper called `Project.initGit` whenever
 * `Instance.directory` lacked a `.git` — task creation silently
 * materialized a git repo on disk as a side effect of an HTTP POST.
 * That violated rule 7 (no fallback) and was one of the three darwin
 * 500-storm contributors (the cwd fallback in server middleware →
 * Instance.provide → prepareProject's auto-init → permission denied at
 * `/`).
 *
 * The new contract: prepareProject throws `Worktree.NotGitError`
 * (NamedError → onError 412 Precondition Failed) so the overlay can
 * render an explicit "Initialize this directory as a git repository?"
 * prompt and call `POST /project/current/init-git` only on a real user
 * gesture.
 */

describe("EngineService.createTask in a non-git directory (W2-V32)", () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  afterEach(async () => {
    await resetDatabase()
  })

  test("throws WorktreeNotGitError without auto-creating .git", async () => {
    await using tmp = await tmpdir() // NB: no `git: true` — directory has no .git
    expect(existsSync(path.join(tmp.path, ".git"))).toBe(false)

    // Seed a project row so Instance.provide doesn't bail on missing project state.
    Database.use((db) =>
      db
        .insert(ProjectTable)
        .values({
          id: "global",
          worktree: "/",
          name: "non-git scope",
          sandboxes: [],
          time_created: Date.now(),
          time_updated: Date.now(),
        })
        .onConflictDoNothing()
        .run(),
    )

    let thrown: unknown
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          await EngineService.createTask({
            executor: "claude-code",
            title: "should never get here",
            request: "this task creation must reject",
          } as Parameters<typeof EngineService.createTask>[0])
        },
      })
    } catch (err) {
      thrown = err
    }

    expect(thrown).toBeInstanceOf(Worktree.NotGitError)
    expect((thrown as Worktree.NotGitError).name).toBe("WorktreeNotGitError")
    // Critical: the directory must NOT have been turned into a git
    // repo as a side effect.
    expect(existsSync(path.join(tmp.path, ".git"))).toBe(false)
  })
})
