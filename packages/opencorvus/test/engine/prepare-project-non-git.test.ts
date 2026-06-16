import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { existsSync } from "fs"
import path from "path"
import { Instance } from "../../src/project/instance"
import { Project } from "../../src/project/project"
import {
  EngineChannelBindingTable,
  EngineProgressSnapshotTable,
  EngineTaskTable,
} from "../../src/engine/engine.sql"
import { EngineService } from "@/task-api"
import { Worktree } from "../../src/worktree"
import { MessageTable, SessionTable } from "../../src/session/session.sql"
import { Database } from "../../src/storage/db"
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
    const before = workflowCounts()

    let thrown: unknown
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          expect(Instance.project.id).toBe(Project.directoryProjectID(tmp.path))
          expect(Instance.project.id).not.toBe("global")
          await EngineService.createTask({
            executor: "claude-code",
            title: "should never get here",
            request: "this task creation must reject",
            queue: false,
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
    expect(workflowCounts()).toEqual(before)
  })
})

function workflowCounts() {
  return Database.use((db) => ({
    tasks: db.select().from(EngineTaskTable).all().length,
    channels: db.select().from(EngineChannelBindingTable).all().length,
    progress: db.select().from(EngineProgressSnapshotTable).all().length,
    sessions: db.select().from(SessionTable).all().length,
    messages: db.select().from(MessageTable).all().length,
  }))
}
