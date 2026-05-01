import { describe, expect, test } from "bun:test"
import {
  RECOMMENDED_GLOBAL_METRICS,
  RECOMMENDED_GOAL_METRICS,
  createArchitectOutputTools,
} from "../../src/architect/output-tools"

async function exec<T>(tool: any, input: unknown): Promise<string> {
  const result = await tool.execute(input as T)
  return String(result)
}

function registerBaselineGoal(tools: any) {
  return exec(tools.register_goal, {
    id: "goal_api",
    title: "API endpoints",
    objective:
      "Expose the HTTP handlers that front the stock endpoints with the declared signatures and contract.",
    acceptance_specs: [
      {
        id: "acc-api-build",
        source_requirement_id: "REQ-1",
        goal_id: "goal_api",
        title: "Build passes",
        severity: "essential",
        scorers: [
          {
            type: "heuristic",
            name: "build",
            spec: { kind: "shell", cmd: "bun run build" },
          },
        ],
      },
    ],
    owned_paths: ["src/api/index.ts"],
    depends_on: [],
    exports: ["getStocks(): Stock[]"],
    imports: [],
    priority: "blocking",
    kind: "feature",
    requirement_ids: ["REQ-1"],
  })
}

function registerBaselineVerificationGoal(tools: any) {
  return exec(tools.register_goal, {
    id: "goal_tests",
    title: "Integration regression tests",
    objective:
      "Write and run integration regression tests that verify the API goal through the declared contract.",
    acceptance_specs: [
      {
        id: "acc-tests-suite",
        source_requirement_id: "REQ-1",
        goal_id: "goal_tests",
        title: "Integration suite passes",
        severity: "essential",
        scorers: [
          {
            type: "heuristic",
            name: "integration",
            spec: { kind: "shell", cmd: "bun test tests/integration/" },
          },
        ],
      },
    ],
    owned_paths: ["tests/integration/api.test.ts"],
    depends_on: ["goal_api"],
    exports: [],
    imports: ["getStocks(): Stock[] from goal_api"],
    priority: "blocking",
    kind: "verification",
    requirement_ids: ["REQ-1"],
  })
}

async function registerRecommendedPerGoalMetrics(tools: any, goalID: string) {
  for (const name of RECOMMENDED_GOAL_METRICS) {
    await exec(tools.register_goal_metric_spec, {
      goal_id: goalID,
      name,
      description: `recommended ${name}`,
      unit: "ratio",
      direction: "higher_better",
      target: 1.0,
      floor: 0.5,
      weight: 1.0,
      gate_class: "blocking",
      evaluator_kind: "shell",
      evaluator_config: { cmd: `bun test -- ${name}` },
      source_requirement_ids: ["REQ-1"],
    })
  }
}

async function registerRecommendedGlobalMetrics(tools: any) {
  for (const name of RECOMMENDED_GLOBAL_METRICS) {
    await exec(tools.register_global_metric_spec, {
      name,
      description: `recommended ${name}`,
      unit: "ratio",
      direction: "higher_better",
      target: 1.0,
      floor: 0.5,
      weight: 1.0,
      gate_class: "blocking",
      evaluator_kind: "judge",
      evaluator_config: { criteria: name },
      source_requirement_ids: [],
    })
  }
}

describe("architect output-tools — metric registration", () => {
  test("register_goal_metric_spec records a spec on the collector", async () => {
    const kit = createArchitectOutputTools({ workDir: process.cwd() })
    await registerBaselineGoal(kit.tools)
    const msg = await exec(kit.tools.register_goal_metric_spec, {
      goal_id: "goal_api",
      name: "functional_correctness",
      description: "api tests pass",
      unit: "ratio",
      direction: "higher_better",
      target: 1.0,
      floor: 0.8,
      weight: 1.0,
      gate_class: "blocking",
      evaluator_kind: "shell",
      evaluator_config: { cmd: "bun test" },
      source_requirement_ids: ["REQ-1"],
    })
    expect(msg).toContain("OK")
    expect(kit.getCollector().goal_metric_specs).toHaveLength(1)
  })

  test("register_goal_metric_spec rejects reference to unknown goal", async () => {
    const kit = createArchitectOutputTools({ workDir: process.cwd() })
    const msg = await exec(kit.tools.register_goal_metric_spec, {
      goal_id: "goal_missing",
      name: "functional_correctness",
      description: "noop",
      unit: "ratio",
      direction: "higher_better",
      target: 1.0,
      floor: 0.5,
      weight: 1.0,
      gate_class: "blocking",
      evaluator_kind: "shell",
      evaluator_config: {},
      source_requirement_ids: [],
    })
    expect(msg).toContain("Error")
  })

  test("register_goal_metric_spec refuses floor==target on higher_better blocking", async () => {
    const kit = createArchitectOutputTools({ workDir: process.cwd() })
    await registerBaselineGoal(kit.tools)
    const msg = await exec(kit.tools.register_goal_metric_spec, {
      goal_id: "goal_api",
      name: "functional_correctness",
      description: "x",
      unit: "ratio",
      direction: "higher_better",
      target: 0.9,
      floor: 0.9,
      weight: 1.0,
      gate_class: "blocking",
      evaluator_kind: "shell",
      evaluator_config: { cmd: "bun test" },
      source_requirement_ids: [],
    })
    expect(msg).toContain("Error")
    expect(msg).toContain("floor must be strictly lower")
  })

  test("register_global_metric_spec overwrites duplicate names", async () => {
    const kit = createArchitectOutputTools({ workDir: process.cwd() })
    await exec(kit.tools.register_global_metric_spec, {
      name: "user_intent_fidelity",
      description: "x",
      unit: "ratio",
      direction: "higher_better",
      target: 1.0,
      floor: 0.5,
      weight: 1.0,
      gate_class: "blocking",
      evaluator_kind: "judge",
      evaluator_config: {},
      source_requirement_ids: [],
    })
    const msg = await exec(kit.tools.register_global_metric_spec, {
      name: "user_intent_fidelity",
      description: "dupe",
      unit: "ratio",
      direction: "higher_better",
      target: 1.0,
      floor: 0.5,
      weight: 1.0,
      gate_class: "blocking",
      evaluator_kind: "judge",
      evaluator_config: {},
      source_requirement_ids: [],
    })
    expect(msg).toContain("overwritten")
    const dups = kit.getCollector().global_metric_specs.filter((m) => m.name === "user_intent_fidelity")
    expect(dups).toHaveLength(1)
    expect(dups[0].description).toBe("dupe")
  })

  test("register_challenge_seed stores seed with all fields", async () => {
    const kit = createArchitectOutputTools({ workDir: process.cwd() })
    await registerBaselineGoal(kit.tools)
    const msg = await exec(kit.tools.register_challenge_seed, {
      id: "seed-stock-empty",
      scope: "goal",
      target_ref: "goal_api",
      claim: "Empty stock list should not crash the dashboard",
      rationale: "No empty-state code found in src/api",
      priority_hint: "high",
    })
    expect(msg).toContain("OK")
    expect(kit.getCollector().challenge_seeds).toHaveLength(1)
  })
})

describe("submit_architect — optional metric coverage", () => {
  test("PASSES when recommended metrics are present", async () => {
    const kit = createArchitectOutputTools({ workDir: process.cwd() })
    await registerBaselineGoal(kit.tools)
    await registerBaselineVerificationGoal(kit.tools)
    await exec(kit.tools.register_traceability, {
      requirement_id: "REQ-1",
      goal_ids: ["goal_api", "goal_tests"],
    })
    await registerRecommendedPerGoalMetrics(kit.tools, "goal_api")
    await registerRecommendedPerGoalMetrics(kit.tools, "goal_tests")
    await registerRecommendedGlobalMetrics(kit.tools)
    await exec(kit.tools.register_contract, {
      category: "interface_contract",
      title: "API contract",
      spec: "```ts\nexport function getStocks(): Stock[]\n```",
      goal_ids: ["goal_api", "goal_tests"],
    })
    const msg = await exec(kit.tools.submit_architect, {
      summary: "Test task decomposition",
    })
    expect(msg).toContain("PASS")
    expect(kit.getCollector().finalized).toBe(true)
    const c = kit.getCollector()
    expect(c.goal_metric_specs).toHaveLength(8)
    expect(c.global_metric_specs).toHaveLength(4)
  })
})
