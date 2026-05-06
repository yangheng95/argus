import { expect, test } from "bun:test"
import { mkdirSync, writeFileSync } from "fs"
import { mkdtempSync } from "fs"
import { tmpdir } from "os"
import path from "path"
import {
  architectValidationIssues,
  createArchitectOutputTools,
  isArchitectReadyToFinalize,
} from "../../src/architect/output-tools"

function freshWorkDir() {
  return mkdtempSync(path.join(tmpdir(), "opencorvus-architect-tools-"))
}

function acceptance(goalID: string, requirementID: string) {
  return {
    id: `acc-${goalID}`,
    source_requirement_id: requirementID,
    goal_id: goalID,
    title: `${goalID} passes verification`,
    severity: "essential" as const,
    scorers: [
      {
        type: "heuristic" as const,
        name: `${goalID}-tests`,
        spec: { kind: "shell" as const, cmd: "bun test" },
        expect: { exit_code: 0 },
      },
    ],
  }
}

const FEATURE_GOAL = {
  id: "goal_feature",
  title: "Feature",
  objective: "Implement the requested feature change with focused verification, clear ownership boundaries, and deterministic local tests.",
  acceptance_specs: [acceptance("goal_feature", "REQ-1")],
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
  objective: "Write and run integration regression coverage over the feature goal so delivery can trust the merged worktree.",
  acceptance_specs: [acceptance("goal_verify", "REQ-2")],
  owned_paths: ["tests/integration/router.test.ts"],
  depends_on: ["goal_feature"],
  exports: [],
  imports: ["Router from goal_feature"],
  priority: "blocking" as const,
  kind: "verification" as const,
  requirement_ids: ["REQ-2"],
}

async function registerAssemblyOwner(
  tools: ReturnType<typeof createArchitectOutputTools>["tools"],
  goalID: string = "goal_feature",
  surface: string = "final-deliverable",
) {
  await tools.register_assembly_owner.execute!(
    {
      surface,
      goal_id: goalID,
      rationale: "One goal must own final stitching for the shared deliverable.",
    } as any,
    {} as any,
  )
}

function readinessMatchesSubmitPrecondition(
  collector: ReturnType<ReturnType<typeof createArchitectOutputTools>["getCollector"]>,
) {
  expect(isArchitectReadyToFinalize(collector)).toBe(architectValidationIssues(collector).length === 0)
}

test("remove_goal cascades to traceability, contracts, and fidelity rows", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const { tools } = kit

  await tools.register_goal.execute!({ ...FEATURE_GOAL } as any, {} as any)
  await tools.register_goal.execute!({ ...VERIFY_GOAL } as any, {} as any)

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
  await registerAssemblyOwner(tools)
  await tools.register_source_coverage.execute!(
    {
      id: "src-router",
      paths: ["src/index.ts"],
      goal_ids: ["goal_feature", "goal_verify"],
      action: "modify",
      rationale: "Both goals reference this integration surface before removal.",
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

  const before = kit.getCollector()
  expect(before.traceability.length).toBe(2)
  expect(before.contracts.length).toBe(2)
  expect(before.source_coverage.length).toBe(1)

  const out = await tools.remove_goal.execute!(
    { id: "goal_verify", reason: "Superseded by integration tests inside goal_feature" } as any,
    {} as any,
  )
  expect(out).toMatch(/^OK: goal "goal_verify" removed/)
  expect(out).toMatch(/Cascaded:/)

  const c = kit.getCollector()
  expect(c.goals.map((g) => g.id)).toEqual(["goal_feature"])
  expect(c.traceability.length).toBe(2)
  const reqTwo = c.traceability.find((t) => t.requirementID === "REQ-2")!
  expect(reqTwo.goalIDs).toEqual(["goal_feature"])
  expect(c.source_coverage[0].goal_ids).toEqual(["goal_feature"])
  expect(c.contracts.map((x) => x.title)).toEqual(["Router shape"])
  expect(c.contracts[0].goalIDs).toEqual(["goal_feature"])
})

test("goal contract defaults are applied before architect validation", async () => {
  const rawFeatureGoal = { ...FEATURE_GOAL } as any
  delete rawFeatureGoal.depends_on
  delete rawFeatureGoal.exports
  delete rawFeatureGoal.imports
  delete rawFeatureGoal.requirement_ids

  const kit = createArchitectOutputTools({
    existingGoals: [rawFeatureGoal],
    workDir: freshWorkDir(),
  } as any)

  expect(kit.getCollector().goals[0].depends_on).toEqual([])
  expect(kit.getCollector().goals[0].exports).toEqual([])
  expect(kit.getCollector().goals[0].imports).toEqual([])
  expect(kit.getCollector().goals[0].requirement_ids).toEqual([])
  expect(architectValidationIssues(kit.getCollector()).join("\n")).toContain(
    "feature goal must declare at least one export",
  )

  kit.reset()
  expect(kit.getCollector().goals[0].depends_on).toEqual([])

  const registered = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const { tools } = registered
  const rawVerificationGoal = { ...VERIFY_GOAL } as any
  delete rawVerificationGoal.depends_on
  delete rawVerificationGoal.imports
  await tools.register_goal.execute!(rawVerificationGoal, {} as any)

  expect(registered.getCollector().goals[0].depends_on).toEqual([])
  expect(registered.getCollector().goals[0].imports).toEqual([])
  const submit = await tools.submit_architect.execute!(
    { summary: "Omitted relationship arrays should validate as empty arrays." } as any,
    {} as any,
  )
  expect(submit).toMatch(/^ISSUES \(/)
})

test("remove_goal followed by submit_architect finalizes without orphaned dependent rows", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const { tools } = kit

  await tools.register_goal.execute!({ ...FEATURE_GOAL } as any, {} as any)
  await tools.register_goal.execute!({ ...VERIFY_GOAL } as any, {} as any)
  await tools.register_goal.execute!(
    {
      id: "goal_old",
      title: "Old redundant feature",
      objective: "Wrong-shaped goal that the architect later removes.",
      acceptance_specs: [acceptance("goal_old", "REQ-3")],
      owned_paths: ["src/old.ts"],
      depends_on: [],
      exports: ["OldRouter"],
      imports: [],
      priority: "advisory",
      kind: "feature",
      requirement_ids: ["REQ-3"],
    } as any,
    {} as any,
  )
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-1", goal_ids: ["goal_feature", "goal_verify"] } as any,
    {} as any,
  )
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-2", goal_ids: ["goal_verify"] } as any,
    {} as any,
  )
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-3", goal_ids: ["goal_old"] } as any,
    {} as any,
  )
  await tools.register_contract.execute!(
    {
      category: "interface_contract",
      title: "Router",
      spec: "```ts\nexport type Router = unknown\n```",
      goal_ids: ["goal_feature", "goal_verify", "goal_old"],
    } as any,
    {} as any,
  )
  await registerAssemblyOwner(tools)

  await tools.remove_goal.execute!(
    { id: "goal_old", reason: "Redundant placeholder; verification covered elsewhere." } as any,
    {} as any,
  )

  const submit = await tools.submit_architect.execute!(
    { summary: "Feature and verification goals with cascaded cleanup of placeholder goal." } as any,
    {} as any,
  )
  expect(submit).toMatch(/^PASS: Architect output finalized\./)
  expect(kit.getCollector().finalized).toBe(true)
})

test("submit_architect rejects missing source coverage for existing owned paths", async () => {
  const workDir = freshWorkDir()
  mkdirSync(path.join(workDir, "src"), { recursive: true })
  writeFileSync(path.join(workDir, "src", "index.ts"), "export const router = true\n")

  const kit = createArchitectOutputTools({ existingGoals: [], workDir })
  const { tools } = kit

  await tools.register_goal.execute!({ ...FEATURE_GOAL } as any, {} as any)
  await tools.register_goal.execute!({ ...VERIFY_GOAL } as any, {} as any)
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-1", goal_ids: ["goal_feature", "goal_verify"] } as any,
    {} as any,
  )
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-2", goal_ids: ["goal_verify"] } as any,
    {} as any,
  )
  await tools.register_contract.execute!(
    {
      category: "interface_contract",
      title: "Router",
      spec: "```ts\nexport type Router = unknown\n```",
      goal_ids: ["goal_feature", "goal_verify"],
    } as any,
    {} as any,
  )
  await registerAssemblyOwner(tools)

  const rejected = await tools.submit_architect.execute!(
    { summary: "Existing source surfaces must be explicitly covered." } as any,
    {} as any,
  )
  expect(rejected).toContain("Missing source coverage for existing owned paths: src/index.ts")

  await tools.register_source_coverage.execute!(
    {
      id: "src-router",
      paths: ["src/index.ts"],
      goal_ids: ["goal_feature"],
      action: "modify",
      rationale: "Feature goal owns the existing router entrypoint change.",
    } as any,
    {} as any,
  )

  const accepted = await tools.submit_architect.execute!(
    { summary: "Existing source surface is now covered." } as any,
    {} as any,
  )
  expect(accepted).toMatch(/^PASS: Architect output finalized\./)
})

test("submit_architect rejects missing reference coverage for visual specs", async () => {
  const kit = createArchitectOutputTools({
    existingGoals: [],
    workDir: freshWorkDir(),
    designSpecs: [{
      id: "vis-hero",
      category: "layout",
      title: "Hero layout",
      requirement: "Restore the hero layout exactly.",
      applies_to: "hero",
      severity: "must",
    }],
    requireReferenceCoverage: true,
  } as any)
  const { tools } = kit

  await tools.register_goal.execute!({ ...FEATURE_GOAL } as any, {} as any)
  await tools.register_goal.execute!({ ...VERIFY_GOAL } as any, {} as any)
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-1", goal_ids: ["goal_feature", "goal_verify"] } as any,
    {} as any,
  )
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-2", goal_ids: ["goal_verify"] } as any,
    {} as any,
  )
  await tools.register_contract.execute!(
    {
      category: "interface_contract",
      title: "Router",
      spec: "```ts\nexport type Router = unknown\n```",
      goal_ids: ["goal_feature", "goal_verify"],
    } as any,
    {} as any,
  )
  await registerAssemblyOwner(tools)

  const rejected = await tools.submit_architect.execute!(
    { summary: "Reference coverage is mandatory when visual specs exist." } as any,
    {} as any,
  )
  expect(rejected).toContain("Missing reference coverage for visual specs: vis-hero")

  await tools.register_reference_coverage.execute!(
    {
      id: "ref-hero",
      surface: "hero",
      goal_ids: ["goal_feature"],
      visual_spec_ids: ["vis-hero"],
      expectation: "Feature goal must restore the hero section 1:1 from the authoritative reference.",
    } as any,
    {} as any,
  )

  const accepted = await tools.submit_architect.execute!(
    { summary: "Reference coverage is now complete." } as any,
    {} as any,
  )
  expect(accepted).toMatch(/^PASS: Architect output finalized\./)
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
  await tools.register_goal.execute!({ ...VERIFY_GOAL } as any, {} as any)
  await tools.register_contract.execute!(
    {
      category: "interface_contract",
      title: "Router",
      spec: "```ts\nexport type Router = unknown\n```",
      goal_ids: ["goal_feature", "goal_verify"],
    } as any,
    {} as any,
  )
  await registerAssemblyOwner(tools)

  readinessMatchesSubmitPrecondition(complete.getCollector())
  expect(isArchitectReadyToFinalize(complete.getCollector())).toBe(false)
  const missingTraceability = await tools.submit_architect.execute!(
    { summary: "Single feature goal without traceability must not finalize." } as any,
    {} as any,
  )
  expect(missingTraceability).toContain("Missing traceability for REQ-1")

  await tools.register_traceability.execute!(
    { requirement_id: "REQ-1", goal_ids: ["goal_feature", "goal_verify"] } as any,
    {} as any,
  )
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-2", goal_ids: ["goal_verify"] } as any,
    {} as any,
  )
  readinessMatchesSubmitPrecondition(complete.getCollector())
  expect(isArchitectReadyToFinalize(complete.getCollector())).toBe(true)
  const accepted = await tools.submit_architect.execute!(
    { summary: "Single complete feature goal without duplicate metric rulers." } as any,
    {} as any,
  )
  expect(accepted).toMatch(/^PASS: Architect output finalized\./)
  expect(complete.getCollector().finalized).toBe(true)
})

test("architect finalizes from goals traceability and contracts without metric ruler", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const { tools } = kit

  await tools.register_goal.execute!({ ...FEATURE_GOAL } as any, {} as any)
  await tools.register_goal.execute!({ ...VERIFY_GOAL } as any, {} as any)
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-1", goal_ids: ["goal_feature", "goal_verify"] } as any,
    {} as any,
  )
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-2", goal_ids: ["goal_verify"] } as any,
    {} as any,
  )
  await tools.register_contract.execute!(
    {
      category: "interface_contract",
      title: "Router",
      spec: "```ts\nexport type Router = unknown\n```",
      goal_ids: ["goal_feature", "goal_verify"],
    } as any,
    {} as any,
  )
  await registerAssemblyOwner(tools)

  expect(architectValidationIssues(kit.getCollector())).toEqual([])
  const accepted = await tools.submit_architect.execute!(
    { summary: "Goal contracts are complete without duplicate metric gates." } as any,
    {} as any,
  )
  expect(accepted).toMatch(/^PASS: Architect output finalized\./)
})

test("architect readiness stays false until every prompt-level finalize invariant is complete", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const { tools } = kit

  await tools.register_goal.execute!({ ...FEATURE_GOAL } as any, {} as any)
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-1", goal_ids: ["goal_feature"] } as any,
    {} as any,
  )
  expect(isArchitectReadyToFinalize(kit.getCollector())).toBe(false)
  expect(architectValidationIssues(kit.getCollector()).join("\n")).toContain("Missing dedicated verification goal")

  await tools.register_goal.execute!(
    {
      ...VERIFY_GOAL,
      depends_on: [],
      imports: [],
      owned_paths: ["tests/unit/router.test.ts"],
    } as any,
    {} as any,
  )
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-2", goal_ids: ["goal_verify"] } as any,
    {} as any,
  )
  const invalidVerificationIssues = architectValidationIssues(kit.getCollector()).join("\n")
  expect(invalidVerificationIssues).toContain("missing depends_on feature goals goal_feature")
  expect(invalidVerificationIssues).toContain("owned_paths must stay under tests/integration")

  await tools.register_goal.execute!({ ...VERIFY_GOAL } as any, {} as any)
  expect(isArchitectReadyToFinalize(kit.getCollector())).toBe(false)
  expect(architectValidationIssues(kit.getCollector()).join("\n")).toContain("No interface_contract or shared_type contract")

  await tools.register_contract.execute!(
    {
      category: "interface_contract",
      title: "Router",
      spec: "```ts\nexport type Router = unknown\n```",
      goal_ids: ["goal_feature", "goal_verify"],
    } as any,
    {} as any,
  )
  await registerAssemblyOwner(tools)
  readinessMatchesSubmitPrecondition(kit.getCollector())
  expect(isArchitectReadyToFinalize(kit.getCollector())).toBe(true)
})

test("architect validator rejects every fixable registration inconsistency before terminal scoping", () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const collector = kit.getCollector()
  collector.goals.push({
    ...FEATURE_GOAL,
    exports: [],
    acceptance_specs: [{ ...acceptance("goal_feature", "REQ-1"), goal_id: "wrong_goal" }],
  })
  collector.goals.push({
    ...VERIFY_GOAL,
    imports: [],
  })
  collector.contracts.push({
    category: "interface_contract",
    title: "Missing goal contract",
    spec: "```ts\nexport type Missing = unknown\n```",
    goalIDs: ["goal_missing"],
  })

  const issues = architectValidationIssues(collector).join("\n")
  expect(issues).toContain("feature goal must declare at least one export")
  expect(issues).toContain("acceptance spec acc-goal_feature has mismatched goal_id")
  expect(issues).toContain("Goal goal_verify: depends_on is set but imports is empty")
  expect(issues).toContain("Contract \"Missing goal contract\": references unknown goals goal_missing")
  expect(isArchitectReadyToFinalize(collector)).toBe(false)
})

test("architect validator rejects a bootstrap goal that is not in every downstream depends_on", () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: freshWorkDir() })
  const collector = kit.getCollector()
  const bootstrapGoal = {
    ...FEATURE_GOAL,
    id: "goal_bootstrap",
    title: "Bootstrap",
    acceptance_specs: [acceptance("goal_bootstrap", "REQ-1")],
    owned_paths: ["package.json", "src/main.tsx", "src/App.tsx"],
    exports: ["Runnable Vite React shell"],
    kind: "bootstrap" as const,
  }
  collector.goals.push(bootstrapGoal)
  collector.goals.push({
    ...FEATURE_GOAL,
    id: "goal_theme",
    title: "Theme",
    acceptance_specs: [acceptance("goal_theme", "REQ-2")],
    owned_paths: ["src/theme.ts"],
    exports: ["ThemeProvider"],
    requirement_ids: ["REQ-2"],
  })
  collector.goals.push({
    ...VERIFY_GOAL,
    depends_on: ["goal_theme"],
    imports: ["ThemeProvider from goal_theme"],
  })

  const rejected = architectValidationIssues(collector).join("\n")
  expect(rejected).toContain(
    "Bootstrap goal goal_bootstrap: every non-bootstrap goal must list it in depends_on; missing goal_theme, goal_verify",
  )

  collector.goals[1] = {
    ...collector.goals[1],
    depends_on: ["goal_bootstrap"],
    imports: ["Runnable Vite React shell from goal_bootstrap"],
  }
  collector.goals[2] = {
    ...collector.goals[2],
    depends_on: ["goal_bootstrap", "goal_theme"],
    imports: [
      "Runnable Vite React shell from goal_bootstrap",
      "ThemeProvider from goal_theme",
    ],
  }

  const acceptedBootstrapIssues = architectValidationIssues(collector)
    .filter((issue) => issue.startsWith("Bootstrap goal "))
  expect(acceptedBootstrapIssues).toEqual([])
})
