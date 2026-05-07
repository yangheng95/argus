import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("deliver rejection closure", () => {
  test("structural rejection branches auto-restart from plan", () => {
    const source = readFileSync(
      resolve(import.meta.dir, "../src/orchestrator/tools.ts"),
      "utf8",
    )

    expect(source).toContain('stopReason: "delivery_restart_plan_budget_exhausted"')
    expect(source).toContain('stopReason: "delivery_restart_plan_repeated_failures"')
    expect(source).toContain('stopReason: "delivery_restart_plan_task_scope"')
    expect(source).toContain('stage: "plan"')
    expect(source).toContain("Task was automatically restarted from plan before any further build dispatch.")
    expect(source).toContain("Task was automatically restarted from plan before any identical rework could repeat.")
    expect(source).toContain("Task was automatically restarted from plan to rebuild the decomposition.")
  })
})
