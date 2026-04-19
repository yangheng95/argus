import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { Database } from "../../src/storage/db"
import { Identifier } from "../../src/id/id"
import { Instance } from "../../src/project/instance"
import { ProjectTable } from "../../src/project/project.sql"
import {
  EngineTaskTable,
  EnginePlanVersionTable,
  EngineGoalTable,
  EngineRunTable,
  EngineGoalRunTable,
  EngineEvaluationTable,
  type EngineGoalCheck,
} from "../../src/engine/engine.sql"
import { createDecisionLog } from "../../src/decision-log"
import { buildRetryFeedbackSection, buildGoalPrompt } from "../../src/goal/runner"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

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
      vcs: "git",
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
      request: "Test that retries surface evaluator failure context",
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
      objective: "Add an `add(a, b)` function that returns a + b",
      done_definition: "bun test passes",
      owned_paths: ["src/math.ts", "test/math.test.ts"],
      depends_on: [],
      exports: [],
      imports: [],
      kind: "feature",
      requirement_ids: [],
      priority: "blocking",
      source: "test",
      status: "pending",
      retry_count: 0,
      order_index: 0,
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EngineRunTable).values({
      id: runID,
      task_id: taskID,
      plan_version_id: planID,
      executor: "opencode",
      status: "running",
      phase: "execute",
      retry_count: 0,
      time_created: now,
      time_updated: now,
    }).run(),
  )
  Database.use((db) =>
    db.insert(EngineGoalRunTable).values({
      id: goalRunID,
      task_id: taskID,
      goal_id: goalID,
      coordinator_run_id: runID,
      executor: "opencode",
      status: "failed",
      retry_count: 0,
      time_created: now,
      time_updated: now,
    }).run(),
  )
}

function insertRejectedEval(checks: EngineGoalCheck[], summary: string) {
  const evalID = Identifier.ascending("evaluation")
  const now = Date.now()
  Database.use((db) =>
    db.insert(EngineEvaluationTable).values({
      id: evalID,
      task_id: taskID,
      run_id: runID,
      goal_run_id: goalRunID,
      scope: "goal_run",
      status: "failed",
      verdict: "rejected",
      summary,
      checks,
      time_completed: now,
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
  test("returns empty string when no prior failed evaluation exists", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const result = buildRetryFeedbackSection(taskID, goalID)
        expect(result).toBe("")
      },
    })
  })

  test("surfaces failed checks with names + evidence + evaluator summary", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        insertRejectedEval(
          [
            { name: "bun_test", status: "failed", mode: "strict", evidence: "math.test.ts: expected 5 got NaN" },
            { name: "tsc", status: "passed" },
            { name: "lint", status: "failed", mode: "strict", evidence: "Unused import 'foo' on line 3" },
          ],
          "Build succeeded but tests and lint failed.",
        )

        const result = buildRetryFeedbackSection(taskID, goalID)
        expect(result).toContain("Prior Attempt Failed")
        expect(result).toContain("Build succeeded but tests and lint failed.")
        expect(result).toContain("**bun_test**")
        expect(result).toContain("math.test.ts: expected 5 got NaN")
        expect(result).toContain("**lint**")
        expect(result).toContain("Unused import 'foo' on line 3")
        // Passed check must NOT show up in failed section
        const failedHeaderIdx = result.indexOf("### Failed Checks")
        const tail = result.slice(failedHeaderIdx)
        expect(tail).not.toContain("**tsc**")
      },
    })
  })

  test("includes coordinator decision-log retry analysis filtered to this goal", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        insertRejectedEval(
          [{ name: "bun_test", status: "failed", mode: "strict", evidence: "test failed" }],
          "Tests failed.",
        )
        const log = createDecisionLog(taskID)
        log.append({
          goalID,
          phase: "retry",
          key: `retry_analysis_${goalID}`,
          value: "[test_failure] Increase timeout to 10s and await async cleanup",
          reason: "test foo timed out at 5s while DB write was in flight",
        })
        // Unrelated retry entry on a different goal — must be filtered out
        log.append({
          goalID: "goal_unrelated",
          phase: "retry",
          key: "retry_analysis_other",
          value: "[code_bug] Fix unrelated null deref",
          reason: "this should not appear in the section for goalID",
        })

        const result = buildRetryFeedbackSection(taskID, goalID)
        expect(result).toContain("Coordinator Root-Cause Analysis")
        expect(result).toContain("Increase timeout to 10s")
        expect(result).toContain("test foo timed out at 5s")
        expect(result).not.toContain("Fix unrelated null deref")
        expect(result).not.toContain("goal_unrelated")
      },
    })
  })

  test("uses the LATEST rejected evaluation when multiple failed evals exist", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        insertRejectedEval(
          [{ name: "bun_test", status: "failed", mode: "strict", evidence: "first attempt evidence" }],
          "First failure",
        )
        // Sleep 5ms to ensure distinct time_created
        await new Promise((r) => setTimeout(r, 5))
        insertRejectedEval(
          [{ name: "bun_test", status: "failed", mode: "strict", evidence: "second attempt evidence" }],
          "Second failure",
        )

        const result = buildRetryFeedbackSection(taskID, goalID)
        expect(result).toContain("Second failure")
        expect(result).toContain("second attempt evidence")
        expect(result).not.toContain("First failure")
        expect(result).not.toContain("first attempt evidence")
      },
    })
  })

  test("surfaces owned_paths gate failures without requiring a spec_id", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        insertRejectedEval(
          [{
            name: "goal_owned_paths_conformance",
            status: "failed",
            mode: "strict",
            scorer_kind: "prebuilt",
            trigger: "on_goal",
            evidence: "wrote src/src/app/layout.tsx but owned_paths declares src/app/layout.tsx",
          }],
          "owned_paths conformance failed: wrote src/src/app/layout.tsx but owned_paths declares src/app/layout.tsx",
        )

        const result = buildRetryFeedbackSection(taskID, goalID)
        expect(result).toContain("owned_paths conformance failed")
        expect(result).toContain("goal_owned_paths_conformance")
        expect(result).toContain("wrote src/src/app/layout.tsx but owned_paths declares src/app/layout.tsx")
      },
    })
  })

  test("buildGoalPrompt embeds retry feedback section between architect and Goal", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        insertRejectedEval(
          [{ name: "bun_test", status: "failed", mode: "strict", evidence: "expected 5 got NaN" }],
          "Tests failed in math.test.ts",
        )

        const goal = Database.use((db) =>
          db.select().from(EngineGoalTable).where(
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (EngineGoalTable.id as any).inArray
              ? undefined
              : undefined,
          ).all(),
        ).find((g) => g.id === goalID)!
        const plan = Database.use((db) =>
          db.select().from(EnginePlanVersionTable).all(),
        ).find((p) => p.id === planID)!

        const prompt = buildGoalPrompt({
          plan,
          node: {
            id: "node_1",
            task_id: taskID,
            plan_version_id: planID,
            kind: "goal",
            goal_id: goalID,
            title: "Implement add()",
            brief: "Write src/math.ts and a bun test that asserts add(2,3)===5",
            depends_on_ids: [],
            order_index: 0,
            metadata: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          },
          goal,
          taskRequest: "",
          taskID,
          allGoals: [goal],
          cwd: "/tmp/worktree",
        })

        expect(prompt).toContain("Prior Attempt Failed")
        expect(prompt).toContain("Tests failed in math.test.ts")
        expect(prompt).toContain("expected 5 got NaN")

        const retryIdx = prompt.indexOf("Prior Attempt Failed")
        const goalIdx = prompt.indexOf(`Goal:\nImplement add()`)
        expect(retryIdx).toBeGreaterThan(-1)
        expect(goalIdx).toBeGreaterThan(retryIdx)
      },
    })
  })

  test("first run (no prior failed eval) does NOT include retry section", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const goal = Database.use((db) =>
          db.select().from(EngineGoalTable).all(),
        ).find((g) => g.id === goalID)!
        const plan = Database.use((db) =>
          db.select().from(EnginePlanVersionTable).all(),
        ).find((p) => p.id === planID)!

        const prompt = buildGoalPrompt({
          plan,
          node: {
            id: "node_1",
            task_id: taskID,
            plan_version_id: planID,
            kind: "goal",
            goal_id: goalID,
            title: "Implement add()",
            brief: "Write src/math.ts",
            depends_on_ids: [],
            order_index: 0,
            metadata: null,
            time_created: Date.now(),
            time_updated: Date.now(),
          },
          goal,
          taskRequest: "",
          taskID,
          allGoals: [goal],
          cwd: "/tmp/worktree",
        })

        expect(prompt).not.toContain("Prior Attempt Failed")
        expect(prompt).not.toContain("Failed Checks")
      },
    })
  })

  test("evidence longer than 1500 chars is truncated with marker", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const longEvidence = "x".repeat(2000)
        insertRejectedEval(
          [{ name: "bun_test", status: "failed", mode: "strict", evidence: longEvidence }],
          "long evidence",
        )

        const result = buildRetryFeedbackSection(taskID, goalID)
        expect(result).toContain("…(truncated)")
        // Should contain at most 1500 x's (plus the truncation marker)
        const xCount = (result.match(/x/g) || []).length
        expect(xCount).toBeLessThanOrEqual(1501)
        expect(xCount).toBeGreaterThanOrEqual(1500)
      },
    })
  })

  test("eval with no checks array still surfaces summary section", async () => {
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        // Insert eval where checks is missing entirely
        const evalID = Identifier.ascending("evaluation")
        const now = Date.now()
        Database.use((db) =>
          db.insert(EngineEvaluationTable).values({
            id: evalID,
            task_id: taskID,
            run_id: runID,
            goal_run_id: goalRunID,
            scope: "goal_run",
            status: "failed",
            verdict: "rejected",
            summary: "Evaluator could not parse output but rejected anyway",
            checks: null,
            time_completed: now,
            time_created: now,
            time_updated: now,
          }).run(),
        )

        const result = buildRetryFeedbackSection(taskID, goalID)
        expect(result).toContain("Prior Attempt Failed")
        expect(result).toContain("Evaluator could not parse output but rejected anyway")
        expect(result).not.toContain("Failed Checks")
      },
    })
  })
})
