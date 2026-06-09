import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

describe("acceptance rejection closure", () => {
  test("structural rejection branches no longer auto-restart from plan", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/orchestrator/tools.ts"), "utf8")

    expect(source).not.toContain('stopReason: "acceptance_restart_plan_budget_exhausted"')
    expect(source).not.toContain('stopReason: "acceptance_restart_plan_repeated_failures"')
    expect(source).not.toContain('stopReason: "acceptance_restart_plan_task_scope"')
    expect(source).not.toContain("Task was automatically restarted from plan")
    expect(source).toContain("post-acceptance whole-task rework")
  })
})
