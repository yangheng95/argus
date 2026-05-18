import { describe, expect, test } from "bun:test"
import { PlannerFailureError } from "../../src/task-api"

// Regression: PlannerFailureError was collateral-deleted by the config Phase 2
// refactor while server/routes/orchestrator.ts still imported it from
// "@/task-api" and branched on `error instanceof PlannerFailureError` (mapping
// planner failures to a 4xx instead of a generic 500). The dangling reference
// broke `tsc --noEmit` repo-wide. This guards the restored export + shape so a
// future type-relocation cannot silently drop it again (CLAUDE.md rule 36).
describe("PlannerFailureError", () => {
  test("is exported from @/task-api and is an Error subclass", () => {
    const err = new PlannerFailureError("planner produced no valid plan")
    expect(err).toBeInstanceOf(Error)
    expect(err).toBeInstanceOf(PlannerFailureError)
    expect(err.name).toBe("PlannerFailureError")
    expect(err.message).toBe("planner produced no valid plan")
  })

  test("propagates the optional cause", () => {
    const root = new Error("upstream boom")
    const err = new PlannerFailureError("planner failed", { cause: root })
    expect(err.cause).toBe(root)
  })
})
