import { describe, expect, test } from "bun:test"
import { readyGoalNodes } from "../../src/goal/readiness"

describe("goal kind dispatchability", () => {
  test("verification goals do not enter the execution-ready queue", () => {
    const nodes = [
      {
        id: "node_feature",
        kind: "goal",
        goal_id: "goal_feature",
        depends_on_ids: [],
      },
      {
        id: "node_verification",
        kind: "goal",
        goal_id: "goal_verification",
        depends_on_ids: [],
      },
    ] as any

    const goals = [
      {
        id: "goal_feature",
        kind: "feature",
        source: "spec",
        priority: "blocking",
        status: "pending",
      },
      {
        id: "goal_verification",
        kind: "verification",
        source: "spec",
        priority: "blocking",
        status: "pending",
      },
    ] as any

    const ready = readyGoalNodes(nodes, goals, [])
    expect(ready.map((entry) => entry.goal.id)).toEqual(["goal_feature"])
  })
})
