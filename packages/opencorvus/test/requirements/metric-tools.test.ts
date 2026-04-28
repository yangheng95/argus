import { describe, expect, test } from "bun:test"
import {
  MANDATORY_GLOBAL_BLOCKING_METRICS,
  MANDATORY_GOAL_BLOCKING_METRICS,
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

async function registerMandatoryPerGoalMetrics(tools: any, goalID: string) {
  for (const name of MANDATORY_GOAL_BLOCKING_METRICS) {
    await exec(tools.register_goal_metric_spec, {
      goal_id: goalID,
      name,
      description: `mandatory ${name}`,
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

async function registerMandatoryGlobalMetrics(tools: any) {
  for (const name of MANDATORY_GLOBAL_BLOCKING_METRICS) {
    await exec(tools.register_global_metric_spec, {
      name,
      description: `mandatory ${name}`,
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

  test("register_global_metric_spec rejects duplicate names", async () => {
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
    expect(msg).toContain("already registered")
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

describe("submit_architect — mandatory blocking coverage", () => {
  test("REJECTS when per-goal mandatory blocking metric is missing", async () => {
    const kit = createArchitectOutputTools({ workDir: process.cwd() })
    await registerBaselineGoal(kit.tools)
    await exec(kit.tools.register_traceability, {
      requirement_id: "REQ-1",
      goal_ids: ["goal_api"],
    })
    await registerMandatoryGlobalMetrics(kit.tools)
    // Register 3 of the 4 mandatory per-goal metrics — missing regression_count.
    for (const name of MANDATORY_GOAL_BLOCKING_METRICS.slice(0, 3)) {
      await exec(kit.tools.register_goal_metric_spec, {
        goal_id: "goal_api",
        name,
        description: `x ${name}`,
        unit: "ratio",
        direction: "higher_better",
        target: 1.0,
        floor: 0.5,
        weight: 1.0,
        gate_class: "blocking",
        evaluator_kind: "shell",
        evaluator_config: { cmd: "bun test" },
        source_requirement_ids: ["REQ-1"],
      })
    }
    const msg = await exec(kit.tools.submit_architect, {
      summary: "Test task decomposition",
    })
    expect(msg).toContain("ISSUES")
    expect(msg).toContain("regression_count")
    expect(kit.getCollector().finalized).toBe(false)
  })

  test("REJECTS when any global mandatory blocking metric is missing", async () => {
    const kit = createArchitectOutputTools({ workDir: process.cwd() })
    await registerBaselineGoal(kit.tools)
    await exec(kit.tools.register_traceability, {
      requirement_id: "REQ-1",
      goal_ids: ["goal_api"],
    })
    await registerMandatoryPerGoalMetrics(kit.tools, "goal_api")
    // Register 3 of the 4 mandatory globals — missing architecture_integrity.
    for (const name of MANDATORY_GLOBAL_BLOCKING_METRICS.slice(0, 3)) {
      await exec(kit.tools.register_global_metric_spec, {
        name,
        description: `x ${name}`,
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
    const msg = await exec(kit.tools.submit_architect, {
      summary: "Test task decomposition",
    })
    expect(msg).toContain("ISSUES")
    expect(msg).toContain("user_intent_fidelity")
  })

  test("PASSES when every mandatory blocking metric is present", async () => {
    const kit = createArchitectOutputTools({ workDir: process.cwd() })
    await registerBaselineGoal(kit.tools)
    await exec(kit.tools.register_traceability, {
      requirement_id: "REQ-1",
      goal_ids: ["goal_api"],
    })
    await registerMandatoryPerGoalMetrics(kit.tools, "goal_api")
    await registerMandatoryGlobalMetrics(kit.tools)
    const msg = await exec(kit.tools.submit_architect, {
      summary: "Test task decomposition",
    })
    expect(msg).toContain("PASS")
    expect(kit.getCollector().finalized).toBe(true)
    const c = kit.getCollector()
    expect(c.goal_metric_specs).toHaveLength(4)
    expect(c.global_metric_specs).toHaveLength(4)
  })
})
