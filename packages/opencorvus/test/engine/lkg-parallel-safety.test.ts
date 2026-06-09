import { afterEach, describe, expect, test } from "bun:test"
import { $ } from "bun"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { EngineArtifactTable, EngineTaskTable } from "../../src/engine/engine.sql"
import { EngineGit } from "../../src/engine/git"
import type { TaskRow } from "../../src/engine/store"
import { Instance } from "../../src/project/instance"
import { Database } from "../../src/storage/db"
import { resetDatabase } from "../fixture/db"

afterEach(async () => {
  await resetDatabase()
})

describe("acceptance Last-Known-Good parallel safety", () => {
  test("no active sibling goals: regression resets to the recorded LKG sha", async () => {
    const dir = await makeGitDir()
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const task = seedTask({ id: uniqueID("task_lkg_no_siblings") })
          const previousSha = await commitFile(dir, "app.txt", "previous\n", "previous")
          const roundSha = await commitFile(dir, "app.txt", "regressed\n", "round")
          const inputTask = withLKG(task, previousSha, 1.1)

          const result = await EngineGit.evaluateAndApplyLKG({
            task: inputTask,
            iteration: 2,
            score: 0.1,
            roundCommitSha: roundSha,
          })

          expect(result.outcome.kind).toBe("regressed")
          expect("rolledBackTo" in result.outcome ? result.outcome.rolledBackTo : "").toBe(previousSha)
          expect(await head(dir)).toBe(previousSha)
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("active sibling goals: regression skips reset and reports the blockers", async () => {
    const dir = await makeGitDir()
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const task = seedTask({ id: uniqueID("task_lkg_with_siblings") })
          const runID = uniqueID("run_lkg_siblings")
          insertGoalRunAttempt({ taskID: task.id, runID, goalRunID: "grun_active_b", status: "running" })
          insertGoalRunAttempt({ taskID: task.id, runID, goalRunID: "grun_active_a", status: "accepted" })
          insertGoalRunAttempt({ taskID: task.id, runID, goalRunID: "grun_done", status: "completed" })
          const previousSha = await commitFile(dir, "app.txt", "previous\n", "previous")
          const roundSha = await commitFile(dir, "app.txt", "regressed\n", "round")
          const inputTask = withLKG(task, previousSha, 1.1)

          const result = await EngineGit.evaluateAndApplyLKG({
            task: inputTask,
            iteration: 2,
            score: 0.1,
            roundCommitSha: roundSha,
          })

          expect(result.outcome.kind).toBe("blocked_by_siblings")
          expect("activeSiblings" in result.outcome ? result.outcome.activeSiblings : []).toEqual([
            "grun_active_a",
            "grun_active_b",
          ])
          expect(await head(dir)).toBe(roundSha)
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })

  test("missing LKG sha: regression remains held and never resets even with active siblings", async () => {
    const dir = await makeGitDir()
    try {
      await Instance.provide({
        directory: dir,
        fn: async () => {
          const task = seedTask({ id: uniqueID("task_lkg_missing_sha") })
          insertGoalRunAttempt({
            taskID: task.id,
            runID: uniqueID("run_lkg_missing"),
            goalRunID: "grun_active",
            status: "running",
          })
          await commitFile(dir, "app.txt", "previous\n", "previous")
          const roundSha = await commitFile(dir, "app.txt", "regressed\n", "round")
          const inputTask = withLKG(task, "", 1.1)

          const result = await EngineGit.evaluateAndApplyLKG({
            task: inputTask,
            iteration: 2,
            score: 0.1,
            roundCommitSha: roundSha,
          })

          expect(result.outcome.kind).toBe("held")
          expect(await head(dir)).toBe(roundSha)
        },
      })
    } finally {
      await fs.rm(dir, { recursive: true, force: true })
    }
  })
})

async function makeGitDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-lkg-parallel-"))
  await $`git init`.cwd(dir).quiet()
  await $`git -c user.name=test -c user.email=test@example.com commit --allow-empty -m init`.cwd(dir).quiet()
  return dir
}

async function commitFile(dir: string, file: string, content: string, message: string): Promise<string> {
  await fs.writeFile(path.join(dir, file), content)
  await $`git add ${file}`.cwd(dir).quiet()
  await $`git -c user.name=test -c user.email=test@example.com commit -m ${message}`.cwd(dir).quiet()
  return await head(dir)
}

async function head(dir: string): Promise<string> {
  return (await $`git rev-parse HEAD`.cwd(dir).quiet().text()).trim()
}

function seedTask(input: { id: string }): TaskRow {
  const now = Date.now()
  const row = {
    id: input.id,
    project_id: Instance.project.id,
    source: "test",
    title: input.id,
    request: "test LKG rollback",
    priority: "normal",
    metadata: null,
    attachments: [],
    system_artifacts: [],
    design_specs: [],
    criteria_results: [],
    time_created: now,
    time_updated: now,
    time_started: now,
  } as TaskRow
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values(row as any)
      .run(),
  )
  return row
}

function withLKG(task: TaskRow, bestCommitSha: string, bestScore: number): TaskRow {
  return {
    ...task,
    metadata: {
      git: {
        acceptance_lkg: {
          best_score: bestScore,
          best_commit_sha: bestCommitSha,
          best_round: 1,
          recorded_at: Date.now(),
        },
      },
    },
  } as TaskRow
}

function insertGoalRunAttempt(input: {
  taskID: string
  runID: string
  goalRunID: string
  status: "accepted" | "running" | "completed"
}) {
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id: `${input.goalRunID}_${now}`,
        task_id: input.taskID,
        run_id: input.runID,
        goal_run_id: input.goalRunID,
        kind: "goal_run_attempt",
        label: `attempt-${input.status}`,
        payload: {
          goal_id: `goal_${input.goalRunID}`,
          plan_node_id: null,
          session_id: null,
          status: input.status,
          retry_count: 0,
          blocking_reason: null,
          error: null,
          workspace_dir: null,
          workspace_branch: null,
          workspace_base_ref: null,
          base_ref: null,
          merge_ref: null,
          supersede_of: null,
          superseded_reason: null,
          superseded_at: null,
          metadata: null,
          time_started: now,
          time_completed: input.status === "completed" ? now : null,
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
}

function uniqueID(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
}
