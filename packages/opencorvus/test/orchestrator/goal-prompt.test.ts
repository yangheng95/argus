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
        check_selector: ["build", "test", "ui_review", "startup"],
      },
    } as any,
    taskRequest: [
      "Implement IndexedDB journal storage.",
      "",
      "Only create or modify these files:",
      "- src/journal/store.ts",
      "- src/journal/store.test.ts",
      "",
      "Do not add package.json, bun.lock, tsconfig.json, README files, docs, or any other files unless they are strictly required.",
    ].join("\n"),
  })

  expect(prompt).toContain("Coordinator context:")
  expect(prompt).toContain("Stage context:")
  expect(prompt).toContain("same evolving workspace")
  expect(prompt).toContain("Workspace root rule:")
  expect(prompt).toContain("Do not scaffold a nested app or package directory")
  expect(prompt).toContain("Required self-run checks for this goal:")
  expect(prompt).toContain("build, test")
  expect(prompt).toContain("Evaluator-managed checks for this goal:")
  expect(prompt).toContain("ui_review, startup")
  expect(prompt).toContain("Scoped request constraints:")
  expect(prompt).toContain("Allowed file edits:")
  expect(prompt).toContain("- src/journal/store.ts")
  expect(prompt).toContain("- src/journal/store.test.ts")
  expect(prompt).toContain("Do not create, modify, or delete any file outside this allowlist.")
  expect(prompt).toContain("If a tool, type error, or test seems to require edits to an unlisted file such as tsconfig.json")
  expect(prompt).toContain("Do not add package.json, bun.lock")
  expect(prompt).toContain("Do not run bun install, bun add, npm install")
  expect(prompt).toContain("Do not invoke npm, npx, pnpm, or yarn")
  expect(prompt).toContain("Do not create package-lock.json")
  expect(prompt).toContain("Do not create demo pages, dist/index.html")
  expect(prompt).toContain("Do not keep searching for missing folders, future modules, or 'complete project structure' work.")
  expect(prompt).toContain("Do not run generic directory-completeness sweeps")
  expect(prompt).toContain("If this stage is a bootstrap/foundation step, create only the minimal scaffold")
  expect(prompt).toContain("## Run Context")
  expect(prompt).toContain("The previous attempt did not satisfy the acceptance checks.")
  expect(prompt).toContain("Failure focus: Focus this retry on the storage layer.")
  expect(prompt).not.toContain("Wave contract:")
  expect(prompt).not.toContain("FULL_EXECUTION_GUIDE_SHOULD_NOT_APPEAR")
})
