import { expect, test } from "bun:test"
import { createArchitectOutputTools, architectValidationFindings } from "@/architect/output-tools"

function acceptance(goalID: string, contractIDs: string[] = []) {
  return {
    id: `acc-${goalID}`,
    source_requirement_id: "REQ-1",
    goal_id: goalID,
    title: `${goalID} acceptance`,
    severity: "essential" as const,
    scorers:
      contractIDs.length > 0
        ? [
            {
              type: "contract_audit" as const,
              name: "graph-contract",
              spec: { kind: "contract_graph" as const, contract_ids: contractIDs },
              expect: { status: "passed" as const },
            },
          ]
        : [
            {
              type: "heuristic" as const,
              name: "tests",
              spec: { kind: "shell" as const, cmd: "bun test" },
              expect: { exit_code: 0 },
            },
          ],
  }
}

async function registerTwoGoalGraph() {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })
  const { tools } = kit
  await tools.register_goal.execute!(
    {
      id: "goal_model",
      title: "Model",
      objective: "Define the shared model contract and code paths used by downstream rendering work.",
      acceptance_specs: [acceptance("goal_model")],
      owned_paths: ["src/model.ts"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )
  await tools.register_goal.execute!(
    {
      id: "goal_ui",
      title: "UI",
      objective: "Render the UI using only the graph contract produced by the model goal.",
      acceptance_specs: [acceptance("goal_ui", ["contract_order"])],
      owned_paths: ["src/ui.tsx"],
      depends_on: ["goal_model"],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )
  await tools.register_traceability.execute!(
    { requirement_id: "REQ-1", goal_ids: ["goal_model", "goal_ui"] } as any,
    {} as any,
  )
  await tools.register_assembly_owner.execute!(
    {
      surface: "final-ui",
      goal_id: "goal_ui",
      rationale: "The UI goal owns final stitching of the shared model into the rendered surface.",
    } as any,
    {} as any,
  )
  return kit
}

test("architect registers graph contracts and finalizes without goal imports or exports", async () => {
  const kit = await registerTwoGoalGraph()
  const { tools } = kit

  await tools.register_contract.execute!(
    {
      id: "contract_order",
      kind: "type",
      name: "Order",
      producer_goal_id: "goal_model",
      consumer_goal_ids: ["goal_ui"],
      summary: "Shared order status model for UI rendering.",
      ir: {
        kind: "type",
        name: "Order",
        fields: [
          {
            name: "status",
            typeExpr: "string",
            valueDomain: { kind: "literal_union", values: ["new", "paid"] },
          },
        ],
      },
    } as any,
    {} as any,
  )
  await tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_model",
      to_goal_id: "goal_ui",
      reason: "contract",
      contract_ids: ["contract_order"],
    } as any,
    {} as any,
  )

  const out = await tools.submit_architect.execute!({ summary: "Graph-based two-goal architecture." } as any, {} as any)
  expect(out).toContain("PASS")
  expect(kit.getCollector().goals[0]).not.toHaveProperty("exports")
  expect(kit.getCollector().goals[0]).not.toHaveProperty("imports")
})

test("register_goal returns actionable guidance for malformed scorer type without mutating collector", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })

  const out = await kit.tools.register_goal.execute!(
    {
      id: "goal_bad_acceptance",
      title: "Bad acceptance",
      objective: "Define a goal whose malformed scorer should be rejected without entering the collector.",
      acceptance_specs: [
        {
          id: "acc-bad",
          source_requirement_id: "REQ-1",
          goal_id: "goal_bad_acceptance",
          title: "Bad shell scorer",
          severity: "essential",
          scorers: [
            {
              type: "shell",
              name: "files-exist",
              spec: { kind: "shell", cmd: "bun test" },
              expect: { exit_code: 0 },
            },
          ],
        },
      ],
      owned_paths: ["src/example.ts"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )

  expect(out).toContain("collector unchanged")
  expect(out).toContain('"shell" is not a scorer type')
  expect(out).toContain('type="heuristic" with spec.kind="shell"')
  expect(kit.getCollector().goals).toHaveLength(0)
})

test("dependency reason with unknown contract id is a concern", async () => {
  const kit = await registerTwoGoalGraph()
  await kit.tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_model",
      to_goal_id: "goal_ui",
      reason: "contract",
      contract_ids: ["missing_contract"],
    } as any,
    {} as any,
  )

  const findings = architectValidationFindings(kit.getCollector(), { workDir: process.cwd() })
  expect(
    findings.some(
      (finding) => finding.severity === "concern" && finding.code === "dependency_contract_unknown_contract",
    ),
  ).toBe(true)
})

test("contract dependency reason without contract id is a concern", async () => {
  const kit = await registerTwoGoalGraph()
  await kit.tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_model",
      to_goal_id: "goal_ui",
      reason: "contract",
      contract_ids: [],
    } as any,
    {} as any,
  )

  const findings = architectValidationFindings(kit.getCollector(), { workDir: process.cwd() })
  expect(
    findings.some((finding) => finding.severity === "concern" && finding.code === "contract_edge_empty_contract_ids"),
  ).toBe(true)
})

test("dependency contract id mismatch is a concern", async () => {
  const kit = await registerTwoGoalGraph()
  await kit.tools.register_contract.execute!(
    {
      id: "contract_order",
      kind: "type",
      name: "Order",
      producer_goal_id: "goal_model",
      consumer_goal_ids: ["goal_model"],
      summary: "Shared order status model for UI rendering.",
      ir: {
        kind: "type",
        name: "Order",
        fields: [
          {
            name: "status",
            typeExpr: "string",
            valueDomain: { kind: "literal_union", values: ["new", "paid"] },
          },
        ],
      },
    } as any,
    {} as any,
  )
  await kit.tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_model",
      to_goal_id: "goal_ui",
      reason: "contract",
      contract_ids: ["contract_order"],
    } as any,
    {} as any,
  )

  const findings = architectValidationFindings(kit.getCollector(), { workDir: process.cwd() })
  expect(
    findings.some((finding) => finding.severity === "concern" && finding.code === "dependency_contract_edge_mismatch"),
  ).toBe(true)
})

test("depends_on edge without graph reason is a concern", async () => {
  const kit = await registerTwoGoalGraph()

  const findings = architectValidationFindings(kit.getCollector(), { workDir: process.cwd() })
  expect(
    findings.some((finding) => finding.severity === "concern" && finding.code === "dependency_edge_missing_reason"),
  ).toBe(true)
})

test("dependency cycle is a blocker", async () => {
  const kit = await registerTwoGoalGraph()
  await kit.tools.register_goal.execute!(
    {
      id: "goal_model",
      title: "Model",
      objective: "Define the shared model contract and code paths used by downstream rendering work.",
      acceptance_specs: [acceptance("goal_model")],
      owned_paths: ["src/model.ts"],
      depends_on: ["goal_ui"],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )

  const findings = architectValidationFindings(kit.getCollector(), { workDir: process.cwd() })
  expect(findings.some((finding) => finding.severity === "blocker" && finding.code === "dependency_cycle")).toBe(true)
})

test("bootstrap scaffold dependency without ordering summary is a concern", async () => {
  const kit = await registerTwoGoalGraph()
  await kit.tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_model",
      to_goal_id: "goal_ui",
      reason: "bootstrap_scaffold",
      contract_ids: [],
    } as any,
    {} as any,
  )

  const findings = architectValidationFindings(kit.getCollector(), { workDir: process.cwd() })
  expect(
    findings.some((finding) => finding.severity === "concern" && finding.code === "non_contract_edge_missing_summary"),
  ).toBe(true)
})

test("submit_architect finalizes executable graph while reporting concerns", async () => {
  const kit = await registerTwoGoalGraph()

  const out = await kit.tools.submit_architect.execute!(
    { summary: "Executable graph with non-blocking contract concerns." } as any,
    {} as any,
  )

  expect(out).toContain("PASS")
  expect(out).toContain("Concerns:")
  expect(out).toContain("dependency_edge_missing_reason")
  expect(kit.getCollector().finalized).toBe(true)
})
