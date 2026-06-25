/**
 * Schema contract for goal-level vs step-level worktree fields.
 *
 * Codex review 2026-05-11 §6.1 / §6.4 / §6.5: the projection of "which
 * directory + branch a goal is running in" lives at the GOAL level
 * (TaskBoardGoalWorkflow.workspaceDir/workspaceBranch) and NOT on each
 * step's payload. The wire-side schema must enforce this single source
 * (rule 8) so a future refactor can't silently regrow step.workspaceDir.
 */

import { describe, expect, test } from "bun:test"
import { TaskBoardGoalWorkflow, TaskBoardGoalStepPayload } from "../../src/engine/model"

describe("TaskBoardGoalWorkflow — goal-level worktree pointer is the single source", () => {
  test("workspaceDir is a top-level optional string", () => {
    const shape = TaskBoardGoalWorkflow.shape
    expect(shape.workspaceDir).toBeDefined()
    // Round-trip a sample value to confirm the field is wired (not just
    // defined but read-only at the type level).
    const parsed = TaskBoardGoalWorkflow.parse({
      goalID: "g1",
      goalTitle: "t",
      goalStatus: "running",
      orderIndex: 0,
      retryCount: 0,
      priority: "blocking",
      steps: [],
      workspaceDir: "D:/wt/goal-a",
      workspaceBranch: "goal-a",
    })
    expect(parsed.workspaceDir).toBe("D:/wt/goal-a")
    expect(parsed.workspaceBranch).toBe("goal-a")
  })

  test("workspaceBranch is a sibling of workspaceDir at the goal level", () => {
    const shape = TaskBoardGoalWorkflow.shape
    expect(shape.workspaceBranch).toBeDefined()
  })
})

describe("TaskBoardGoalStepPayload — step-level workspaceDir is GONE (single source: goal level)", () => {
  test("step payload schema does not declare workspaceDir", () => {
    const shape = TaskBoardGoalStepPayload.shape
    expect("workspaceDir" in shape).toBe(false)
  })

  test("step payload schema does not declare workspaceBranch either", () => {
    const shape = TaskBoardGoalStepPayload.shape
    expect("workspaceBranch" in shape).toBe(false)
  })

  test("a payload object carrying workspaceDir parses through (Zod strips unknown by default) but the schema does not surface it", () => {
    // Zod's default behavior on extra keys is to strip silently. This
    // test pins that any code that still tries to write workspaceDir
    // into a step payload will see it disappear at the parse boundary —
    // matching the rule 8 single-source intent.
    const parsed = TaskBoardGoalStepPayload.parse({
      buildSessionID: "sid",
      workspaceDir: "D:/should-not-survive",
    } as unknown)
    expect((parsed as Record<string, unknown>).workspaceDir).toBeUndefined()
  })

  test("step payload schema carries the delivered commit ref", () => {
    const parsed = TaskBoardGoalStepPayload.parse({
      buildSessionID: "sid",
      commitRef: "abc123def456",
      publishedCommitRef: "merge1234567",
      diffBaseRef: "base12345678",
      diffHeadRef: "head12345678",
    })
    expect(parsed.commitRef).toBe("abc123def456")
    expect(parsed.publishedCommitRef).toBe("merge1234567")
    expect(parsed.diffBaseRef).toBe("base12345678")
    expect(parsed.diffHeadRef).toBe("head12345678")
  })
})
