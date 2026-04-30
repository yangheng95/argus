import { expect, test } from "bun:test"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  architectValidationIssues,
  createArchitectOutputTools,
  isArchitectReadyToFinalize,
  MANDATORY_GOAL_BLOCKING_METRICS,
  MANDATORY_GLOBAL_BLOCKING_METRICS,
} from "../../src/architect/output-tools"

function freshWorkDir() {
  return mkdtempSync(path.join(tmpdir(), "opencorvus-architect-tools-"))
}

const FEATURE_GOAL = {
  id: "goal_feature",
  title: "Feature",
  objective: "Implement the requested change with focused verification.",
  acceptance_specs: [],
  owned_paths: ["src/index.ts"],
  depends_on: [],
  exports: ["Router"],
  imports: [],
  priority: "blocking" as const,
  kind: "feature" as const,
  requirement_ids: ["REQ-1"],
}

const VERIFY_GOAL = {
  id: "goal_verify",
  title: "Verification",
  objective: "Run integration tests over the feature goal.",
  acceptance_specs: [],
  owned_paths: ["tests/router.test.ts"],
  depends_on: ["goal_feature"],
  exports: [],
  imports: ["Router from goal_feature"],
  priority: "blocking" as const,
  kind: "verification" as const,
  requirement_ids: ["REQ-2"],
}

function metric(goalID: string, name: string, gateClass: "blocking" | "diagnostic" = "blocking") {
  return {
    goal_id: goalID,
    name,
    description: `${name} for ${goalID}`,
    unit: "ratio",
    direction: "higher_better" as const,
    target: 1.0,
    floor: 0.5,
    weight: 1,
    gate_class: gateClass,
    evaluator_kind: "heuristic" as const,
    evaluator_config: { kind: "shell", cmd: "exit 0" },
    source_requirement_ids: [],
  }
}

function globalMetric(name: string, gateClass: "blocking" | "diagnostic" = "blocking") {
  return {
    name,
    description: `${name} global`,
    unit: "ratio",
    direction: "higher_better" as const,
    target: 1.0,
    floor: 0.5,
    weight: 1,
    gate_class: gateClass,
    evaluator_kind: "heuristic" as const,
    evaluator_config: { kind: "shell", cmd: "exit 0" },
    source_requirement_ids: [],
  }
}

async function fillMandatoryBlockingMetrics(
  tools: ReturnType<typeof createArchitectOutputTools>["tools"],
  goalID: string,
) {
  for (const name of MANDATORY_GOAL_BLOCKING_METRICS) {
    await tools.register_goal_metric_spec.execute!(metric(goalID, name) as any, {} as any)
  }
}

async function fillMandatoryGlobalBlockingMetrics(
  tools: ReturnType<typeof createArchitectOutputTools>["tools"],
) {
  for (const name of MANDATORY_GLOBAL_BLOCKING_METRICS) {
    await tools.register_global_metric_spec.execute!(globalMetric(name) as any, {} as any)
  }
}

function readinessMatchesSubmitPrecondition(
  collector: ReturnType<ReturnType<typeof createArchitectOutputTools>["getCollector"]>,
) {
  expect(isArchitectReadyToFinalize(collector)).toBe(architectValidationIssues(collector).length === 0)
}

test("remove_goal cascades to goal metrics, traceability, contracts, challenge seeds", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const { tools } = kit

  await tools.register_goal.execute!({ ...FEATURE_GOAL } as any, {} as any)
  await tools.register_goal.execute!({ ...VERIFY_GOAL } as any, {} as any)
  await fillMandatoryBlockingMetrics(tools, "goal_feature")
  await fillMandatoryBlockingMetrics(tools, "goal_verify")

  await tools.register_traceability.execute!(
    { requirement_id: "REQ-1", goal_ids: ["goal_feature"] } as any,
    {} as any,
  )
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-2", goal_ids: ["goal_feature", "goal_verify"] } as any,
    {} as any,
  )

  await tools.register_contract.execute!(
    {
      category: "interface_contract",
      title: "Router shape",
      spec: "```ts\nexport type Router = unknown\n```",
      goal_ids: ["goal_feature", "goal_verify"],
    } as any,
    {} as any,
  )
  await tools.register_contract.execute!(
    {
      category: "shared_type",
      title: "Verify-only type",
      spec: "```ts\nexport type T = unknown\n```",
      goal_ids: ["goal_verify"],
    } as any,
    {} as any,
  )

  await tools.register_challenge_seed.execute!(
    {
      id: "seed_verify",
      scope: "goal",
      target_ref: "goal_verify",
      claim: "Router redirect under unauth might leak the protected path.",
      rationale: "Existing redirect logic loses query string in test fixtures.",
      priority_hint: "medium",
    } as any,
    {} as any,
  )

  const before = kit.getCollector()
  expect(before.goal_metric_specs.length).toBe(MANDATORY_GOAL_BLOCKING_METRICS.length * 2)
  expect(before.traceability.length).toBe(2)
  expect(before.contracts.length).toBe(2)
  expect(before.challenge_seeds.length).toBe(1)

  const out = await tools.remove_goal.execute!(
    { id: "goal_verify", reason: "Superseded by integration tests inside goal_feature" } as any,
    {} as any,
  )
  expect(out).toMatch(/^OK: goal "goal_verify" removed/)
  expect(out).toMatch(/Cascaded:/)

  const c = kit.getCollector()
  expect(c.goals.map((g) => g.id)).toEqual(["goal_feature"])
  expect(c.goal_metric_specs.every((m) => m.goal_id === "goal_feature")).toBe(true)
  expect(c.goal_metric_specs.length).toBe(MANDATORY_GOAL_BLOCKING_METRICS.length)
  expect(c.challenge_seeds.length).toBe(0)
  expect(c.traceability.length).toBe(2)
  const reqTwo = c.traceability.find((t) => t.requirementID === "REQ-2")!
  expect(reqTwo.goalIDs).toEqual(["goal_feature"])
  expect(c.contracts.map((x) => x.title)).toEqual(["Router shape"])
  expect(c.contracts[0].goalIDs).toEqual(["goal_feature"])
})

test("register_goal_metric_spec overwrites prior (goal_id, name) instead of erroring", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const { tools } = kit
  await tools.register_goal.execute!({ ...FEATURE_GOAL } as any, {} as any)

  const first = await tools.register_goal_metric_spec.execute!(
    metric("goal_feature", "functional_correctness", "diagnostic") as any,
    {} as any,
  )
  expect(first).toMatch(/^OK: goal metric "functional_correctness" registered/)

  const second = await tools.register_goal_metric_spec.execute!(
    metric("goal_feature", "functional_correctness", "blocking") as any,
    {} as any,
  )
  expect(second).toMatch(/^OK: goal metric "functional_correctness" overwritten/)

  const c = kit.getCollector()
  const fc = c.goal_metric_specs.filter(
    (m) => m.goal_id === "goal_feature" && m.name === "functional_correctness",
  )
  expect(fc.length).toBe(1)
  expect(fc[0].gate_class).toBe("blocking")
})

test("register_global_metric_spec overwrites prior name instead of erroring", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const { tools } = kit

  const first = await tools.register_global_metric_spec.execute!(
    globalMetric("user_intent_fidelity", "diagnostic") as any,
    {} as any,
  )
  expect(first).toMatch(/^OK: global metric "user_intent_fidelity" registered/)

  const second = await tools.register_global_metric_spec.execute!(
    globalMetric("user_intent_fidelity", "blocking") as any,
    {} as any,
  )
  expect(second).toMatch(/^OK: global metric "user_intent_fidelity" overwritten/)

  const c = kit.getCollector()
  const dups = c.global_metric_specs.filter((m) => m.name === "user_intent_fidelity")
  expect(dups.length).toBe(1)
  expect(dups[0].gate_class).toBe("blocking")
})

test("remove_goal followed by submit_architect finalizes — no orphan-metric deadlock", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const { tools } = kit

  await tools.register_goal.execute!({ ...FEATURE_GOAL } as any, {} as any)
  await tools.register_goal.execute!(
    {
      id: "goal_tests",
      title: "Tests",
      objective: "Wrong-shaped goal that the architect later removes.",
      acceptance_specs: [],
      owned_paths: ["tests/old.ts"],
      depends_on: ["goal_feature"],
      exports: [],
      imports: [],
      priority: "advisory",
      kind: "verification",
      requirement_ids: [],
    } as any,
    {} as any,
  )
  await fillMandatoryBlockingMetrics(tools, "goal_feature")
  for (const name of MANDATORY_GOAL_BLOCKING_METRICS) {
    await tools.register_goal_metric_spec.execute!(
      metric("goal_tests", name, "diagnostic") as any,
      {} as any,
    )
  }
  await fillMandatoryGlobalBlockingMetrics(tools)
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-1", goal_ids: ["goal_feature"] } as any,
    {} as any,
  )
  await tools.register_contract.execute!(
    {
      category: "interface_contract",
      title: "Router",
      spec: "```ts\nexport type Router = unknown\n```",
      goal_ids: ["goal_feature", "goal_tests"],
    } as any,
    {} as any,
  )

  await tools.remove_goal.execute!(
    { id: "goal_tests", reason: "Redundant placeholder; verification covered elsewhere." } as any,
    {} as any,
  )

  const submit = await tools.submit_architect.execute!(
    { summary: "Single feature goal with cascaded cleanup of placeholder verification goal." } as any,
    {} as any,
  )
  expect(submit).toMatch(/^PASS: Architect output finalized\./)
  expect(kit.getCollector().finalized).toBe(true)
  expect(kit.getCollector().goal_metric_specs.every((m) => m.goal_id === "goal_feature")).toBe(true)
})

test("architect readiness remains identical to submit_architect validation precondition", async () => {
  const incomplete = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  readinessMatchesSubmitPrecondition(incomplete.getCollector())
  expect(isArchitectReadyToFinalize(incomplete.getCollector())).toBe(false)
  const rejected = await incomplete.tools.submit_architect.execute!(
    { summary: "Incomplete architecture should not finalize." } as any,
    {} as any,
  )
  expect(rejected).toMatch(/^ISSUES \(/)
  expect(incomplete.getCollector().finalized).toBe(false)

  const complete = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const { tools } = complete
  await tools.register_goal.execute!({ ...FEATURE_GOAL } as any, {} as any)
  await fillMandatoryBlockingMetrics(tools, "goal_feature")
  await fillMandatoryGlobalBlockingMetrics(tools)

  readinessMatchesSubmitPrecondition(complete.getCollector())
  expect(isArchitectReadyToFinalize(complete.getCollector())).toBe(true)
  const accepted = await tools.submit_architect.execute!(
    { summary: "Single complete feature goal with mandatory metrics." } as any,
    {} as any,
  )
  expect(accepted).toMatch(/^PASS: Architect output finalized\./)
  expect(complete.getCollector().finalized).toBe(true)
})
