import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineArtifactTable,
  EngineTaskTable,
  EnginePlanVersionTable,
  EngineGoalTable,
} from "../../src/engine/engine.sql"
import { createDecisionLog } from "../../src/decision-log"
import { goalSlug } from "../../src/engine/persist"
import { buildRetryFeedbackSection, buildGoalPrompt } from "../../src/goal/runner"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

// 2026-04-20 per-goal evaluator removal: retry feedback now reads solely from
// decision_log "retry" entries — the delivery agent's rejection analysis. The
// prior test suite poked at EngineEvaluationTable rows with scope="goal_run",
// which is gone. This replacement exercises the new decision-log-only contract.

let projectID = ""
let taskID = ""
let planID = ""
let goalID = ""
let runID = ""
let goalRunID = ""
let tmp: Awaited<ReturnType<typeof tmpdir>>

function seed() {
  const now = Date.now()
  Database.use((db) =>
    db.insert(ProjectTable).values({
      id: projectID,
      worktree: process.cwd(),
      name: "Retry Feedback Test",
      sandboxes: "[]",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EngineTaskTable).values({
      id: taskID,
      project_id: projectID,
      source: "test",
      title: "Retry feedback task",
      request: "Test retry feedback from decision log",
      status: "active",
      priority: "normal",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EnginePlanVersionTable).values({
      id: planID,
      task_id: taskID,
      version: 1,
      status: "active",
      summary: "Test plan",
      prompt: "Test plan prompt",
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EngineGoalTable).values({
      id: goalID,
      task_id: taskID,
      plan_version_id: planID,
      title: "Implement add()",
      slug: goalSlug("Implement add()"),
      objective: "Add an `add(a, b)` function that returns a + b",
      owned_paths: ["src/math.ts", "test/math.test.ts"],
      depends_on: [],
      exports: [],
      imports: [],
      kind: "feature",
      requirement_ids: [],
      priority: "blocking",
      source: "test",
      retry_count: 0,
      order_index: 0,
      time_created: now,
      time_updated: now,
    }).run(),
  )
  // Phase-6-e: run rows live in engine_artifact (kind="run").
  Database.use((db) =>
    db.insert(EngineArtifactTable).values({
      id: runID,
      task_id: taskID,
      run_id: runID,
      kind: "run",
      label: "run-running",
      payload: {
        plan_version_id: planID,
        session_id: null,
        executor: "opencode",
        status: "running",
        phase: "execute",
        blocking_reason: null,
        error: null,
        retry_count: 0,
        executor_ref: null,
        metadata: null,
        time_started: now,
        time_completed: null,
      },
      time_created: now,
      time_updated: now,
    }).run(),
  )
  // Phase-6-d: goal_run rows live in engine_artifact (kind="goal_run_attempt").
  Database.use((db) =>
    db.insert(EngineArtifactTable).values({
      id: goalRunID,
      task_id: taskID,
      run_id: runID,
      goal_run_id: goalRunID,
      kind: "goal_run_attempt",
      label: "attempt-failed",
      payload: {
        goal_id: goalID,
        plan_node_id: null,
        session_id: null,
        status: "failed",
        retry_count: 0,
        blocking_reason: null,
        error: null,
        workspace_dir: null,
        base_ref: null,
        merge_ref: null,
        supersede_of: null,
        superseded_reason: null,
        superseded_at: null,
        metadata: null,
        time_started: null,
        time_completed: now,
      },
      time_created: now,
      time_updated: now,
    }).run(),
  )
}

beforeEach(async () => {
  await resetDatabase()
  tmp = await tmpdir()
  const stamp = Date.now().toString(16)
  projectID = `project_retryctx_${stamp}`
  taskID = `tsk_${stamp}retryctx`
  planID = `plan_${stamp}retryctx`
  goalID = `goal_${stamp}retryctx`
  runID = `run_${stamp}retryctx`
  goalRunID = `gr_${stamp}retryctx`
  seed()
})

afterEach(async () => {
  await resetDatabase()
  await tmp?.[Symbol.asyncDispose]?.()
})

describe("buildRetryFeedbackSection", () => {
  test("returns empty string when no retry decision-log entry exists", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = buildRetryFeedbackSection(taskID, goalID)
        expect(result).toBe("")
      },
    })
  })

  test("emits header + coordinator analysis when a retry entry exists for this goal", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        log.append({
          goalID,
          phase: "retry",
          key: `retry_analysis_${goalID}`,
          value: "[test_failure] Increase timeout to 10s and await async cleanup",
          reason: "test foo timed out at 5s while DB write was in flight",
        })

        const result = buildRetryFeedbackSection(taskID, goalID)
        expect(result).toContain("Prior Attempt Failed")
        expect(result).toContain("Coordinator Root-Cause Analysis")
        expect(result).toContain("Increase timeout to 10s")
        expect(result).toContain("test foo timed out at 5s")
        expect(result).toContain("Required For This Retry")
      },
    })
  })

  test("filters retry entries to this goal — other goals do not leak in", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        log.append({
          goalID,
          phase: "retry",
          key: `retry_analysis_${goalID}`,
          value: "[bun_test] fix assertion on add()",
          reason: "delivery rejected because add(2,3) returned NaN",
        })
        log.append({
          goalID: "goal_unrelated",
          phase: "retry",
          key: "retry_analysis_other",
          value: "[code_bug] Fix unrelated null deref",
          reason: "this should not appear in the section for goalID",
        })

        const result = buildRetryFeedbackSection(taskID, goalID)
        expect(result).toContain("fix assertion on add()")
        expect(result).not.toContain("Fix unrelated null deref")
        expect(result).not.toContain("goal_unrelated")
      },
    })
  })

  test("all retry entries for this goal appear in order (multiple attempts)", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        log.append({
          goalID,
          phase: "retry",
          key: "retry_analysis_first",
          value: "[first] build error on line 10",
          reason: "attempt 1 rejected on build failure",
        })
        log.append({
          goalID,
          phase: "retry",
          key: "retry_analysis_second",
          value: "[second] still failing after first retry",
          reason: "attempt 2 rejected — same line still broken",
        })

        const result = buildRetryFeedbackSection(taskID, goalID)
        expect(result).toContain("[first]")
        expect(result).toContain("[second]")
        const firstIdx = result.indexOf("[first]")
        const secondIdx = result.indexOf("[second]")
        expect(firstIdx).toBeGreaterThan(0)
        expect(secondIdx).toBeGreaterThan(firstIdx)
      },
    })
  })

  test("buildGoalPrompt embeds retry feedback section when entries exist", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const log = createDecisionLog(taskID)
        log.append({
          goalID,
          phase: "retry",
          key: `retry_analysis_${goalID}`,
          value: "[bun_test] fix add() regression",
          reason: "add(2,3) returned NaN",
        })

        const goal = Database.use((db) =>
          db.select().from(EngineGoalTable).where((_: any) => true).all(),
        ).find((g) => g.id === goalID)
        expect(goal).toBeDefined()
        const plan = Database.use((db) =>
          db.select().from(EnginePlanVersionTable).where((_: any) => true).all(),
        ).find((p) => p.id === planID)
        expect(plan).toBeDefined()

        const prompt = buildGoalPrompt({
          plan: plan! as any,
          node: {
            id: "pn_test",
            plan_version_id: planID,
            title: "Implement add()",
            brief: "Write src/math.ts and a bun test that asserts add(2,3)===5",
            order_index: 0,
            goal_id: goalID,
            metadata: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          } as any,
          goal: goal! as any,
          taskRequest: "Test that retries surface delivery rejection context",
          taskID,
          cwd: "/tmp/worktree",
        })

        expect(prompt).toContain("Prior Attempt Failed")
        expect(prompt).toContain("fix add() regression")
      },
    })
  })
})
