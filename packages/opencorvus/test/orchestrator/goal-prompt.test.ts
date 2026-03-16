import { expect, test } from "bun:test"
import { buildGoalPrompt } from "../../src/orchestrator/goal-runner"

test("buildGoalPrompt keeps executor scope local to the current iterative stage", () => {
  const prompt = buildGoalPrompt({
    brief: "Implement IndexedDB journal storage",
    plan: {
      summary: "Lay foundations first, then advance the feature one stage at a time.",
      prompt: [
        "FULL_EXECUTION_GUIDE_SHOULD_NOT_APPEAR",
        "## Run Context",
        "The previous attempt did not satisfy the acceptance checks.",
      ].join("\n\n"),
      metadata: {
        risks: ["Avoid duplicate scaffolding", "Avoid rewriting unrelated shared entrypoints"],
        failure_summary: "Focus this retry on the storage layer.",
      },
    } as any,
    node: {
      metadata: {
        wave_title: "Storage foundation",
        wave_objective: "Establish the journal persistence layer and shared types",
      },
    } as any,
    goal: {
      description: "Implement IndexedDB journal storage",
      criteria: "Creating, reading, and updating journal records must be validated by tests",
      metadata: {
        check_selector: ["build", "test"],
      },
    } as any,
  })

  expect(prompt).toContain("Coordinator context:")
  expect(prompt).toContain("Stage context:")
  expect(prompt).toContain("same evolving workspace")
  expect(prompt).toContain("Workspace root rule:")
  expect(prompt).toContain("Do not scaffold a nested app or package directory")
  expect(prompt).toContain("## Run Context")
  expect(prompt).toContain("The previous attempt did not satisfy the acceptance checks.")
  expect(prompt).toContain("Failure focus: Focus this retry on the storage layer.")
  expect(prompt).not.toContain("Wave contract:")
  expect(prompt).not.toContain("FULL_EXECUTION_GUIDE_SHOULD_NOT_APPEAR")
})
