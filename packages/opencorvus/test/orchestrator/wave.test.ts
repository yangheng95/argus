import { expect, test } from "bun:test"
import { normalizePlanWaves } from "../../src/orchestrator/wave"

test("normalizePlanWaves converts one-based indices and splits into one wave per goal", () => {
  const waves = normalizePlanWaves({
    waves: [{
      title: "Foundation",
      objective: "Bootstrap app shell",
      goal_indices: [1, 2, 3],
      owned_paths: ["src/app.tsx"],
    }],
    goals: [
      { description: "Bootstrap app" },
      { description: "Build API" },
      { description: "Add theme" },
    ],
  })

  expect(waves).toHaveLength(3)
  expect(waves[0]?.goal_indices).toEqual([0])
  expect(waves[1]?.goal_indices).toEqual([1])
  expect(waves[2]?.goal_indices).toEqual([2])
  expect(waves[0]?.title).toBe("Foundation · Bootstrap app")
  expect(waves[1]?.title).toBe("Foundation · Build API")
  expect(waves[2]?.title).toBe("Foundation · Add theme")
})

test("normalizePlanWaves rejects planner output that omits waves", () => {
  expect(() =>
    normalizePlanWaves({
      goals: [
        { description: "Goal A" },
        { description: "Goal B" },
      ],
    }),
  ).toThrow("plan waves must cover every goal explicitly")
})

test("normalizePlanWaves rejects partial coverage instead of synthesizing fallback waves", () => {
  expect(() =>
    normalizePlanWaves({
      waves: [{
        title: "Wave 1: Setup",
        goal_indices: [1],
      }],
      goals: [
        { description: "Setup" },
        { description: "Implement" },
        { description: "Test" },
        { description: "Deploy" },
      ],
    }),
  ).toThrow("missing goal indices: 1, 2, 3")
})
