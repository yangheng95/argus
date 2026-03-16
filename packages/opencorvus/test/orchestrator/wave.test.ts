import { expect, test } from "bun:test"
import { normalizePlanWaves } from "../../src/orchestrator/wave"

test("normalizePlanWaves converts one-based indices and splits into one wave per goal", () => {
  const waves = normalizePlanWaves({
    waves: [{
      title: "Foundation",
      objective: "Bootstrap app shell",
      goal_indices: [1, 2],
      owned_paths: ["src/app.tsx"],
    }],
    goals: [
      { description: "Bootstrap app" },
      { description: "Build API" },
      { description: "Add theme" },
    ],
  })

  // normalizePlanWaves always produces one wave per goal (iterative stages)
  expect(waves).toHaveLength(3)
  expect(waves[0]?.goal_indices).toEqual([0])
  expect(waves[1]?.goal_indices).toEqual([1])
  expect(waves[2]?.goal_indices).toEqual([2])
  expect(waves[0]?.title).toBe("Foundation \u00b7 Bootstrap app")
  expect(waves[1]?.title).toBe("Foundation \u00b7 Build API")
  expect(waves[2]?.title).toBe("Wave 3: Add theme")
})

test("normalizePlanWaves falls back to singleton waves when planner omits waves", () => {
  const waves = normalizePlanWaves({
    goals: [
      { description: "Goal A" },
      { description: "Goal B" },
    ],
  })

  expect(waves.map((wave) => wave.goal_indices)).toEqual([[0], [1]])
})

test("fallback wave titles are sequentially numbered after explicit waves", () => {
  const waves = normalizePlanWaves({
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
  })

  // One explicit wave for goal 0 (1-based index 1), three fallback waves for goals 1,2,3
  expect(waves).toHaveLength(4)
  expect(waves[0]?.title).toBe("Wave 1: Setup")
  expect(waves[0]?.goal_indices).toEqual([0])
  // Fallback titles should be Wave 2, Wave 3, Wave 4 — not Wave 3, Wave 4, Wave 5
  expect(waves[1]?.title).toMatch(/^Wave 2/)
  expect(waves[2]?.title).toMatch(/^Wave 3/)
  expect(waves[3]?.title).toMatch(/^Wave 4/)
})
