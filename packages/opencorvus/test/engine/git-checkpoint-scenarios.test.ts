import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import path from "node:path"
import { Database } from "../../src/storage/db"
import { EngineGit, ensureGitignore } from "../../src/engine/git"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import {
  listSnapshots,
  requireTask,
  type AcceptanceRow,
  type PlanRow,
  type ProgressRow,
  type TaskRow,
} from "../../src/engine/store"
import { Log } from "../../src/util/log"
import { tmpdir } from "../fixture/fixture"
import { resetDatabase } from "../fixture/db"

Log.init({ print: false })

// Author identity for git ops inside the test fixture. Distinct from the
// production AUTHOR (OpenCorvus) so failures from the fixture stand out.
const AUTHOR = ["-c", "user.email=opencorvus-test@local", "-c", "user.name=OpenCorvusTest"]

async function git(cwd: string, ...args: string[]) {
  return await $`git ${AUTHOR} ${args}`.cwd(cwd).quiet().nothrow()
}

async function gitHead(cwd: string) {
  const result = await $`git rev-parse HEAD`.cwd(cwd).quiet().nothrow()
  return result.exitCode === 0 ? result.text().trim() || undefined : undefined
}

async function gitCommitCount(cwd: string) {
  const result = await $`git rev-list --count HEAD`.cwd(cwd).quiet().nothrow()
  if (result.exitCode !== 0) return 0
  const n = Number(result.text().trim())
  return Number.isFinite(n) ? n : 0
}

async function writeFile(cwd: string, file: string, content: string) {
  await Bun.write(path.join(cwd, file), content)
}

async function commitFile(cwd: string, file: string, content: string, message: string) {
  await writeFile(cwd, file, content)
  const add = await git(cwd, "add", file)
  if (add.exitCode !== 0) throw new Error(`git add failed: ${add.stderr.toString()}`)
  const ci = await git(cwd, "commit", "-m", message)
  if (ci.exitCode !== 0) throw new Error(`git commit failed: ${ci.stderr.toString()}`)
  return (await gitHead(cwd))!
}

// Build a repo with an unresolved merge conflict on a single file. After this
// runs, `git status --porcelain --branch` reports `UU f.txt`, and
// `Vcs.info().conflicts` is 1 — which is what `EngineGit.prepare` short-
// circuits on.
async function makeMergeConflict(cwd: string) {
  await commitFile(cwd, "f.txt", "base\n", "base")
  const baseBranch = (await $`git rev-parse --abbrev-ref HEAD`.cwd(cwd).quiet()).text().trim()
  await git(cwd, "checkout", "-b", "feature")
  await commitFile(cwd, "f.txt", "feature line\n", "feature edit")
  await git(cwd, "checkout", baseBranch)
  await commitFile(cwd, "f.txt", "main line\n", "main edit")
  const merge = await git(cwd, "merge", "feature", "--no-edit")
  if (merge.exitCode === 0) {
    throw new Error("fixture bug: expected merge conflict but merge succeeded")
  }
}

async function insertTaskRow(opts?: { title?: string; request?: string }): Promise<TaskRow> {
  const id = Identifier.ascending("task")
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id,
        project_id: Instance.project.id,
        source: "test",
        title: opts?.title ?? "snapshot scenario",
        request: opts?.request ?? "snapshot scenario request",
        priority: "normal",
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  return requireTask(id)
}

function fakePlan(steps: string[] = ["alpha step", "beta step"]): PlanRow {
  // Only `plan.summary` and `plan.metadata.steps` are read by EngineGit's
  // commit-message builder. Everything else is structural.
  const now = Date.now()
  return {
    id: Identifier.ascending("plan"),
    task_id: "fixture-task",
    version: 1,
    status: "active",
    summary: "plan summary used in the commit body",
    metadata: { steps },
    time_created: now,
    time_updated: now,
  } as unknown as PlanRow
}

function fakeAcceptance(summary = "acceptance accepted in the test fixture"): AcceptanceRow {
  const now = Date.now()
  return {
    id: Identifier.ascending("acceptance"),
    task_id: "fixture-task",
    run_id: "fixture-run",
    goal_run_id: null,
    status: "accepted" as AcceptanceRow["status"],
    summary,
    result: null,
    time_created: now,
    time_updated: now,
  }
}

function gitProgress(rows: ProgressRow[], stage: "baseline" | "result") {
  return rows.filter((row) => {
    const payload = (row.payload ?? {}) as Record<string, unknown>
    return payload.kind === "git" && payload.stage === stage
  })
}

function gitBaseline(task: TaskRow) {
  return (task.metadata as Record<string, any> | null)?.git?.baseline as Record<string, any> | undefined
}

function gitResult(task: TaskRow) {
  return (task.metadata as Record<string, any> | null)?.git?.result as Record<string, any> | undefined
}

afterEach(async () => {
  await resetDatabase()
})

describe("EngineGit.prepare — baseline scenarios", () => {
  test("scenario 1: clean repo with commits → recorded_head", async () => {
    await using tmp = await tmpdir({ git: true }) // git init + root --allow-empty commit
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Seed .gitignore essentials once outside the assertion window so the
        // baseline call does not produce an unrelated commit. ensureGitignore
        // is idempotent — the in-prepare call will then be a no-op.
        await ensureGitignore()
        const headBefore = await gitHead(tmp.path)
        const commitsBefore = await gitCommitCount(tmp.path)

        const task = await insertTaskRow()
        const result = await EngineGit.prepare(task)

        expect(result.error).toBeUndefined()
        const baseline = gitBaseline(result.task)!
        expect(baseline.mode).toBe("recorded_head")
        expect(baseline.commit).toBe(headBefore)
        expect(baseline.head_before).toBe(headBefore)
        expect(baseline.dirty).toBe(false)
        expect(baseline.conflicts).toBe(0)
        expect(baseline.snapshot).toBeUndefined()

        const commitsAfter = await gitCommitCount(tmp.path)
        expect(commitsAfter).toBe(commitsBefore)

        const progress = gitProgress(listSnapshots(result.task.id), "baseline")
        expect(progress).toHaveLength(1)
        expect(progress[0]!.status).toBe("created")
        const payload = progress[0]!.payload as Record<string, any>
        expect(payload.mode).toBe("recorded_head")
        expect(payload.commit).toBe(headBefore)
      },
    })
  })

  test("scenario 2: dirty repo with commits → created_commit captures the change", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
        const headBefore = await gitHead(tmp.path)
        const commitsBefore = await gitCommitCount(tmp.path)
        // Mix of staged + untracked so baseline.{staged,untracked} are both > 0.
        await writeFile(tmp.path, "tracked.txt", "tracked content\n")
        await git(tmp.path, "add", "tracked.txt")
        await writeFile(tmp.path, "untracked.txt", "untracked content\n")

        const task = await insertTaskRow()
        const result = await EngineGit.prepare(task)

        expect(result.error).toBeUndefined()
        const baseline = gitBaseline(result.task)!
        expect(baseline.mode).toBe("created_commit")
        expect(baseline.commit).toBeTruthy()
        expect(baseline.commit).not.toBe(headBefore)
        expect(baseline.head_before).toBe(headBefore)
        expect(baseline.dirty).toBe(true)
        expect(baseline.staged).toBeGreaterThan(0)
        expect(baseline.untracked).toBeGreaterThan(0)
        expect(baseline.snapshot).toBeUndefined()

        // Exactly one new commit landed (the baseline) — git add -A folded
        // staged + untracked into the same commit.
        expect(await gitCommitCount(tmp.path)).toBe(commitsBefore + 1)
        const ls = await $`git ls-tree --name-only HEAD`.cwd(tmp.path).quiet()
        expect(ls.stdout.toString()).toContain("tracked.txt")
        expect(ls.stdout.toString()).toContain("untracked.txt")

        const progress = gitProgress(listSnapshots(result.task.id), "baseline")
        expect(progress).toHaveLength(1)
        expect((progress[0]!.payload as any).mode).toBe("created_commit")
      },
    })
  })

  test("scenario 3: greenfield git repo (no HEAD, no files) → recorded_head on the bootstrap-seeded gitignore", async () => {
    // Fresh `git init` with no commits. `Instance.provide` bootstrap runs
    // ensureGitignore which materializes the very first commit (.gitignore
    // seed) — by the time `fn` enters, HEAD points at that seed. prepare()
    // then takes the recorded_head path (clean tree, HEAD exists).
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const seedSha = await gitHead(tmp.path)
        expect(seedSha).toBeTruthy()
        expect(await gitCommitCount(tmp.path)).toBe(1)

        const task = await insertTaskRow()
        const result = await EngineGit.prepare(task)

        expect(result.error).toBeUndefined()
        const baseline = gitBaseline(result.task)!
        expect(baseline.mode).toBe("recorded_head")
        expect(baseline.commit).toBe(seedSha)
        expect(baseline.head_before).toBe(seedSha)
        expect(baseline.dirty).toBe(false)
        expect(baseline.conflicts).toBe(0)

        const ls = await $`git ls-tree --name-only HEAD`.cwd(tmp.path).quiet()
        expect(ls.stdout.toString()).toContain(".gitignore")
        // prepare() must not add a commit on top of the bootstrap seed.
        expect(await gitCommitCount(tmp.path)).toBe(1)
      },
    })
  })

  test("scenario 4: greenfield git repo with pre-existing source files → created_commit on top of seed", async () => {
    await using tmp = await tmpdir()
    await $`git init`.cwd(tmp.path).quiet()
    await writeFile(tmp.path, "src.txt", "user source\n")

    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const task = await insertTaskRow()
        const result = await EngineGit.prepare(task)

        expect(result.error).toBeUndefined()
        const baseline = gitBaseline(result.task)!
        // Two commits land overall: ensureGitignore seed (.gitignore) then
        // prepare's own baseline commit (src.txt). baseline.head_before is
        // the seed; baseline.commit is the new tip.
        expect(await gitCommitCount(tmp.path)).toBe(2)
        expect(baseline.mode).toBe("created_commit")
        expect(baseline.commit).toBeTruthy()
        expect(baseline.commit).not.toBe(baseline.head_before)
        expect(baseline.head_before).toBeTruthy()
        expect(baseline.dirty).toBe(true)
        expect(baseline.untracked).toBeGreaterThan(0)

        const ls = await $`git ls-tree --name-only HEAD`.cwd(tmp.path).quiet()
        expect(ls.stdout.toString()).toContain("src.txt")
      },
    })
  })

  test("scenario 5: unresolved merge conflicts → prepare returns error, no baseline written", async () => {
    // Construct the conflict INSIDE the Instance.provide context: bootstrap's
    // own ensureGitignore would fail with "cannot do a partial commit during
    // a merge" if the merge state already existed before Instance.provide.
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await makeMergeConflict(tmp.path)
        const task = await insertTaskRow()
        const result = await EngineGit.prepare(task)

        expect(result.error).toBeTruthy()
        expect(result.error).toContain("merge conflicts")
        expect(gitBaseline(result.task)).toBeUndefined()

        const progress = gitProgress(listSnapshots(result.task.id), "baseline")
        expect(progress).toHaveLength(1)
        expect(progress[0]!.status).toBe("failed")
        const payload = progress[0]!.payload as Record<string, any>
        expect(payload.conflicts).toBeGreaterThan(0)
      },
    })
  })

  test("scenario 6: second prepare is idempotent — no new commit, no new progress row", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
        const task = await insertTaskRow()
        const first = await EngineGit.prepare(task)
        const baselineCommit = gitBaseline(first.task)!.commit
        const commitsAfterFirst = await gitCommitCount(tmp.path)
        const progressAfterFirst = gitProgress(listSnapshots(first.task.id), "baseline").length

        const second = await EngineGit.prepare(first.task)
        expect(second.error).toBeUndefined()
        expect(gitBaseline(second.task)!.commit).toBe(baselineCommit)
        expect(await gitCommitCount(tmp.path)).toBe(commitsAfterFirst)
        expect(gitProgress(listSnapshots(first.task.id), "baseline").length).toBe(progressAfterFirst)
      },
    })
  })
})

describe("EngineGit.complete — result scenarios", () => {
  test("scenario 7: clean tree at completion → recorded_head", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
        const task = await insertTaskRow()
        const prepared = await EngineGit.prepare(task)
        const headBefore = await gitHead(tmp.path)
        const commitsBefore = await gitCommitCount(tmp.path)

        const completed = await EngineGit.complete(prepared.task, fakePlan(), fakeAcceptance())

        expect(completed.error).toBeUndefined()
        const r = gitResult(completed.task)!
        expect(r.mode).toBe("recorded_head")
        expect(r.commit).toBe(headBefore)
        expect(r.head_before).toBe(headBefore)
        expect(r.dirty).toBe(false)
        expect(r.acceptance_id).toBeTruthy()
        expect(r.acceptance_summary).toContain("acceptance")

        expect(await gitCommitCount(tmp.path)).toBe(commitsBefore)
        const progress = gitProgress(listSnapshots(completed.task.id), "result")
        expect(progress).toHaveLength(1)
        expect(progress[0]!.status).toBe("completed")
      },
    })
  })

  test("scenario 8: dirty tree at completion → created_commit with plan + acceptance body", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
        const task = await insertTaskRow({ title: "produce result artifact" })
        const prepared = await EngineGit.prepare(task)
        // Simulate executor edits between prepare and complete.
        await writeFile(tmp.path, "result.txt", "acceptance artifact\n")

        const plan = fakePlan(["first step", "second step"])
        const acceptance = fakeAcceptance("final acceptance summary text")
        const completed = await EngineGit.complete(prepared.task, plan, acceptance)

        expect(completed.error).toBeUndefined()
        const r = gitResult(completed.task)!
        expect(r.mode).toBe("created_commit")
        expect(r.commit).toBeTruthy()

        const subj = await $`git log -1 --pretty=%s ${r.commit}`.cwd(tmp.path).quiet()
        // subject is clipped from task.title for result mode (≤72 chars).
        expect(subj.stdout.toString().trim()).toContain("produce result artifact")
        const body = await $`git log -1 --pretty=%b ${r.commit}`.cwd(tmp.path).quiet()
        const bodyText = body.stdout.toString()
        expect(bodyText).toContain("Task request:")
        expect(bodyText).toContain("Plan summary:")
        expect(bodyText).toContain("first step")
        expect(bodyText).toContain("second step")
        expect(bodyText).toContain("final acceptance summary text")

        const ls = await $`git ls-tree --name-only HEAD`.cwd(tmp.path).quiet()
        expect(ls.stdout.toString()).toContain("result.txt")

        const progress = gitProgress(listSnapshots(completed.task.id), "result")
        expect(progress).toHaveLength(1)
        expect((progress[0]!.payload as any).mode).toBe("created_commit")
      },
    })
  })

  test("scenario 9: merge conflicts at completion → error, no result metadata", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
        const task = await insertTaskRow()
        const prepared = await EngineGit.prepare(task)
        // Introduce conflicts only AFTER prepare, so baseline is clean but
        // complete must short-circuit.
        await makeMergeConflict(tmp.path)

        const completed = await EngineGit.complete(prepared.task, fakePlan(), fakeAcceptance())

        expect(completed.error).toBeTruthy()
        expect(completed.error).toContain("merge conflicts")
        expect(gitResult(completed.task)).toBeUndefined()

        const progress = gitProgress(listSnapshots(completed.task.id), "result")
        expect(progress).toHaveLength(1)
        expect(progress[0]!.status).toBe("failed")
      },
    })
  })

  test("scenario 10: second complete is idempotent — no new commit, no new progress row", async () => {
    await using tmp = await tmpdir({ git: true })
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        await ensureGitignore()
        const task = await insertTaskRow()
        const prepared = await EngineGit.prepare(task)
        await writeFile(tmp.path, "result.txt", "first round\n")
        const firstComplete = await EngineGit.complete(prepared.task, fakePlan(), fakeAcceptance())
        const firstResultCommit = gitResult(firstComplete.task)!.commit
        const commitsAfter = await gitCommitCount(tmp.path)
        const progressAfter = gitProgress(listSnapshots(firstComplete.task.id), "result").length

        // Touch the worktree again — second call must NOT capture this, because
        // task.metadata.git.result is already set and complete short-circuits.
        await writeFile(tmp.path, "ignored-second.txt", "should not enter result\n")
        const secondComplete = await EngineGit.complete(firstComplete.task, fakePlan(), fakeAcceptance())

        expect(secondComplete.error).toBeUndefined()
        expect(gitResult(secondComplete.task)!.commit).toBe(firstResultCommit)
        expect(await gitCommitCount(tmp.path)).toBe(commitsAfter)
        expect(gitProgress(listSnapshots(firstComplete.task.id), "result").length).toBe(progressAfter)
      },
    })
  })
})
