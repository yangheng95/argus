import { describe, test, expect } from "bun:test"
import { buildPlannerPrompt, buildPlannerSystem } from "@/planner/per-goal"
import type { GoalContract, GoalContractFields } from "@/pipeline/types"

function mkGoal(overrides: Partial<GoalContractFields> = {}): GoalContractFields {
  return {
    id: "goal_test",
    title: "Test goal",
    objective: "Implement the test goal with all the necessary details.",
    acceptance_specs: [],
    owned_paths: ["src/test.ts"],
    depends_on: [],
    priority: "blocking",
    kind: "feature",
    requirement_ids: [],
    exports: [],
    imports: [],
    ...overrides,
  }
}

function mkContract(goal: GoalContractFields, dependencies: GoalContractFields[]): GoalContract {
  return {
    goal: goal as any,
    planNode: null,
    run: { id: "run_1" } as any,
    task: { id: "tsk_1", title: "task", request: "user request text" } as any,
    plan: { id: "plan_1" } as any,
    dependencies: dependencies as any,
  }
}

const SECRET_OBJECTIVE =
  "DEPENDENCY_OBJECTIVE_SHOULD_NOT_LEAK — this long prose reproduces PRD sections and must never appear in the planner prompt, because the planner only needs the dependency's declared interfaces."

describe("buildPlannerPrompt — dependency context", () => {
  test("dependency with exports: emits title + exports only, no objective leak", () => {
    const goal = mkGoal({
      id: "goal_consumer",
      depends_on: ["goal_producer"],
    })
    const dep = mkGoal({
      id: "goal_producer",
      title: "Producer",
      objective: SECRET_OBJECTIVE,
      exports: ["type Stock = { id: string }", "getStocks(): Stock[]"],
    })
    const prompt = buildPlannerPrompt(mkContract(goal, [dep]), "", "", "user request text")

    expect(prompt).toContain("## Dependencies (completed before this goal)")
    expect(prompt).toContain("**Producer**")
    expect(prompt).toContain("exports: type Stock = { id: string }, getStocks(): Stock[]")
    expect(prompt).not.toContain(SECRET_OBJECTIVE)
    expect(prompt).not.toContain("DEPENDENCY_OBJECTIVE_SHOULD_NOT_LEAK")
  })

  test("dependency without exports (verification/system kind): emits kind note, no fallback to objective", () => {
    const goal = mkGoal({
      id: "goal_consumer",
      depends_on: ["goal_verify"],
    })
    const dep = mkGoal({
      id: "goal_verify",
      title: "Smoke test",
      objective: SECRET_OBJECTIVE,
      exports: [],
      kind: "verification",
    })
    const prompt = buildPlannerPrompt(mkContract(goal, [dep]), "", "", "user request text")

    expect(prompt).toContain("**Smoke test**")
    expect(prompt).toContain("kind: verification")
    expect(prompt).toContain("no exported interfaces")
    expect(prompt).not.toContain(SECRET_OBJECTIVE)
  })

  test("multiple dependencies: each listed on its own line with only interfaces", () => {
    const goal = mkGoal({
      id: "goal_integrate",
      depends_on: ["goal_a", "goal_b"],
    })
    const depA = mkGoal({
      id: "goal_a",
      title: "A",
      objective: SECRET_OBJECTIVE + " A-specific",
      exports: ["fnA(): number"],
    })
    const depB = mkGoal({
      id: "goal_b",
      title: "B",
      objective: SECRET_OBJECTIVE + " B-specific",
      exports: ["type B"],
    })
    const prompt = buildPlannerPrompt(mkContract(goal, [depA, depB]), "", "", "user request text")

    expect(prompt).toContain("**A** — exports: fnA(): number")
    expect(prompt).toContain("**B** — exports: type B")
    expect(prompt).not.toContain(SECRET_OBJECTIVE)
  })

  test("no dependencies: Dependencies section is omitted", () => {
    const goal = mkGoal({ id: "goal_standalone" })
    const prompt = buildPlannerPrompt(mkContract(goal, []), "", "", "user request text")
    expect(prompt).not.toContain("## Dependencies")
  })
})

describe("buildPlannerSystem — intent bundle advertisement", () => {
  test("unconditionally advertises intent bundle path (caller contract: always mounted)", () => {
    const sys = buildPlannerSystem()
    expect(sys).toContain(".opencorvus/intent/")
    expect(sys).toContain("intent/request.md")
    expect(sys).toContain("Restating the user's request")
  })
})
