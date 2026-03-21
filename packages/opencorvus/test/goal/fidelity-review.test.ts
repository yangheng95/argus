import { describe, it, expect } from "bun:test"
import { applyGoalCorrections, type FidelityReviewResult } from "@/goal/fidelity-review"
import type { GoalDraft } from "@/goal/service"

describe("applyGoalCorrections", () => {
  const baseGoal = (id: string, reqIds: string[]) => ({
    id,
    title: `Goal ${id}`,
    objective: `Implement ${id}`,
    requirement_ids: reqIds,
    depends_on_goal_ids: [] as string[],
    owned_paths: ["src/"],
    done_definition: `${id} done`,
    qa_profile: { rule_selectors: ["build", "test"], spec_scope: "mapped_requirements" as const },
    priority: "blocking" as const,
    kind: "feature" as const,
  })

  it("adds missing goals when requirements are uncovered", () => {
    const goalDraft: GoalDraft = {
      summary: "2 goals",
      goals: [
        baseGoal("g1", ["req_1"]),
        baseGoal("g2", ["req_2"]),
      ],
    }
    const review: FidelityReviewResult = {
      verdict: "needs_correction",
      coverage_issues: [
        { requirement_id: "req_3", issue: "uncovered", explanation: "No goal covers req_3" },
        { requirement_id: "req_4", issue: "uncovered", explanation: "No goal covers req_4" },
      ],
      goal_corrections: [],
      missing_goals: [
        {
          title: "Timeline API",
          objective: "Implement timeline endpoint",
          requirement_ids: ["req_3"],
          done_definition: "GET /timeline works",
          owned_paths: ["src/timeline/"],
          depends_on_goal_ids: ["g1"],
          reason: "req_3 uncovered",
        },
        {
          title: "Tag filtering",
          objective: "Implement tag filtering",
          requirement_ids: ["req_4"],
          done_definition: "tag query param works",
          owned_paths: ["src/diary/"],
          depends_on_goal_ids: ["g2"],
          reason: "req_4 uncovered",
        },
      ],
    }

    const result = applyGoalCorrections(goalDraft, review)
    expect(result.goals.length).toBe(4) // 2 original + 2 added
    expect(result.goals[2].requirement_ids).toContain("req_3")
    expect(result.goals[3].requirement_ids).toContain("req_4")
    expect(result.goals[2].depends_on_goal_ids).toContain("g1")
  })

  it("splits oversized goals", () => {
    const goalDraft: GoalDraft = {
      summary: "1 goal",
      goals: [baseGoal("g1", ["req_1", "req_2", "req_3"])],
    }
    const review: FidelityReviewResult = {
      verdict: "needs_correction",
      coverage_issues: [],
      goal_corrections: [
        {
          goal_id: "g1",
          action: "split",
          reason: "Too broad",
          split_into: [
            { title: "Auth", objective: "Auth impl", requirement_ids: ["req_1"], done_definition: "auth works", owned_paths: ["src/auth/"] },
            { title: "Diary", objective: "Diary impl", requirement_ids: ["req_2", "req_3"], done_definition: "diary works", owned_paths: ["src/diary/"] },
          ],
        },
      ],
      missing_goals: [],
    }

    const result = applyGoalCorrections(goalDraft, review)
    expect(result.goals.length).toBe(2) // g1 split into 2
    expect(result.goals[0].requirement_ids).toContain("req_1")
    expect(result.goals[1].requirement_ids).toContain("req_2")
    expect(result.goals[1].requirement_ids).toContain("req_3")
  })

  it("skips duplicate missing goals if requirements already covered", () => {
    const goalDraft: GoalDraft = {
      summary: "1 goal",
      goals: [baseGoal("g1", ["req_1", "req_2"])],
    }
    const review: FidelityReviewResult = {
      verdict: "needs_correction",
      coverage_issues: [],
      goal_corrections: [],
      missing_goals: [
        {
          title: "Duplicate",
          objective: "Already covered",
          requirement_ids: ["req_1"], // already covered by g1
          done_definition: "done",
          owned_paths: ["src/"],
          depends_on_goal_ids: [],
          reason: "test",
        },
      ],
    }

    const result = applyGoalCorrections(goalDraft, review)
    expect(result.goals.length).toBe(1) // not added because req_1 already covered
  })

  it("returns draft unchanged when approved", () => {
    const goalDraft: GoalDraft = {
      summary: "ok",
      goals: [baseGoal("g1", ["req_1"])],
    }
    const review: FidelityReviewResult = {
      verdict: "approved",
      coverage_issues: [],
      goal_corrections: [],
      missing_goals: [],
    }

    const result = applyGoalCorrections(goalDraft, review)
    expect(result).toBe(goalDraft) // same reference, no changes
  })
})
