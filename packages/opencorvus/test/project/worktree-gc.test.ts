import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import { EngineGoalTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { Worktree } from "../../src/worktree"
import { WorktreeGC } from "../../src/worktree/gc"
import { Filesystem } from "../../src/util/filesystem"
import { seedGoalRunAttemptWithWorkspace } from "../fixture/goal-run-attempt"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const TEN_DAYS_MS = 10 * 24 * 60 * 60 * 1000

function seedProject(projectID: string, primaryDir: string, now: number) {
  Database.use((db) =>
    db
      .insert(ProjectTable)
      .values({
        id: projectID,
        worktree: primaryDir,
        name: "Worktree GC Test",
        sandboxes: [],
        time_created: now,
        time_updated: now,
      })
      .onConflictDoNothing()
      .run(),
  )
}

async function makeOld(directory: string, now: number) {
  const old = new Date(now - TEN_DAYS_MS)
  await fs.utimes(directory, old, old)
}

describe("WorktreeGC orphan sweep", () => {
  let tmp: Awaited<ReturnType<typeof tmpdir>>

  beforeEach(async () => {
    await resetDatabase()
    tmp = await tmpdir({ git: true })
  })

  afterEach(async () => {
    await resetDatabase()
    await tmp?.[Symbol.asyncDispose]?.()
  })

  test("removes an old, clean, unreferenced worktree (dir + branch)", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        seedProject(Instance.project.id, tmp.path, now)
        const wt = await Worktree.create({ name: "gc-old-clean" })
        await makeOld(wt.directory, now)

        const plan = await WorktreeGC.inspect({ now })
        expect(plan.candidates.map((c) => c.directory)).toContain(wt.directory)

        const result = await WorktreeGC.apply(plan)
        expect(result.removed).toBeGreaterThanOrEqual(1)
        expect(await Filesystem.exists(wt.directory)).toBe(false)
        const ref = await $`git show-ref --verify --quiet refs/heads/${wt.branch}`.cwd(tmp.path).quiet().nothrow()
        expect(ref.exitCode).not.toBe(0)
      },
    })
  }, 30_000)

  test("preserves a recent worktree even if clean (no age-only deletion)", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        seedProject(Instance.project.id, tmp.path, now)
        const wt = await Worktree.create({ name: "gc-recent" })

        const plan = await WorktreeGC.inspect({ now })
        expect(plan.candidates.map((c) => c.directory)).not.toContain(wt.directory)
        expect(await Filesystem.exists(wt.directory)).toBe(true)
      },
    })
  }, 30_000)

  test("preserves an old worktree with untracked files", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        seedProject(Instance.project.id, tmp.path, now)
        const wt = await Worktree.create({ name: "gc-untracked" })
        await Bun.write(path.join(wt.directory, "in-transit.txt"), "executor work")
        await makeOld(wt.directory, now)

        const plan = await WorktreeGC.inspect({ now })
        expect(plan.candidates.map((c) => c.directory)).not.toContain(wt.directory)
      },
    })
  }, 30_000)

  test("preserves an old worktree with commits not merged into primary", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        seedProject(Instance.project.id, tmp.path, now)
        const wt = await Worktree.create({ name: "gc-in-transit-commit" })
        await Bun.write(path.join(wt.directory, "feature.txt"), "acceptance")
        await $`git add -A`.cwd(wt.directory).quiet()
        await $`git -c user.name=t -c user.email=t@t commit -m "in-transit attempt"`.cwd(wt.directory).quiet()
        await makeOld(wt.directory, now)

        const plan = await WorktreeGC.inspect({ now })
        expect(plan.candidates.map((c) => c.directory)).not.toContain(wt.directory)
      },
    })
  }, 30_000)

  test("preserves an old, clean worktree still referenced by a live goal_run", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        const projectID = Instance.project.id
        seedProject(projectID, tmp.path, now)
        const taskID = `task_gc_${now}`
        const goalID = `goal_gc_${now}`

        Database.transaction((db) => {
          db.insert(EngineTaskTable)
            .values({
              id: taskID,
              project_id: projectID,
              source: "test",
              title: "gc live task",
              request: "keep worktree",
              priority: "normal",
              time_created: now,
              time_updated: now,
              time_started: now,
            })
            .run()
          db.insert(EngineGoalTable)
            .values({
              id: goalID,
              task_id: taskID,
              title: "live goal",
              slug: "live-goal",
              objective: "still running",
              acceptance_specs: [],
              owned_paths: [],
              depends_on: [],
              exports: [],
              imports: [],
              kind: "feature",
              requirement_ids: [],
              priority: "blocking",
              source: "test",
              status: "running",
              order_index: 0,
              time_created: now,
              time_updated: now,
            })
            .run()
        })

        const wt = await Worktree.create({ name: "gc-live-ref" })
        seedGoalRunAttemptWithWorkspace({
          taskID,
          goalID,
          workspaceDir: wt.directory,
          workspaceBranch: wt.branch,
          status: "running",
          now,
        })
        await makeOld(wt.directory, now)

        const plan = await WorktreeGC.inspect({ now })
        expect(plan.candidates.map((c) => c.directory)).not.toContain(wt.directory)
        expect(await Filesystem.exists(wt.directory)).toBe(true)
      },
    })
  }, 30_000)

  test("removes an old zombie directory with no .git linkage", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const now = Date.now()
        seedProject(Instance.project.id, tmp.path, now)
        const root = Worktree.worktreesRoot(tmp.path)
        const zombie = path.join(root, "gc-zombie")
        await fs.mkdir(zombie, { recursive: true })
        await Bun.write(path.join(zombie, "residue.txt"), "windows partial rm")
        await makeOld(zombie, now)

        const plan = await WorktreeGC.inspect({ now })
        expect(plan.candidates.map((c) => c.directory)).toContain(zombie)

        await WorktreeGC.apply(plan)
        expect(await Filesystem.exists(zombie)).toBe(false)
      },
    })
  }, 30_000)
})
