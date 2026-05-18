import { expect, test } from "bun:test"
import { validateArchitectContractGraph, type ArchitectContractGraph } from "@/architect/contract-graph"
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

function contractAuditSpec(contractIDs: string[], severity: "essential" | "important" = "essential") {
  return {
    scorers: [
      {
        type: "contract_audit" as const,
        name: "graph-contract",
        spec: { kind: "contract_graph" as const, contract_ids: contractIDs },
        expect: { status: "passed" as const },
      },
    ],
    severity,
  }
}

function baseGraph(contractIDs: string[] = ["contract_order"]): ArchitectContractGraph {
  return {
    version: 1,
    contracts: contractIDs.map((id) => ({
      id,
      kind: "static_data" as const,
      name: "OrderStatusCatalog",
      producer_goal_id: "goal_model",
      consumer_goal_ids: ["goal_ui"],
      summary: "Shared status catalog consumed by the UI goal.",
      artifact_paths: ["src/model.ts"],
    })),
    dependency_contracts:
      contractIDs.length > 0
        ? [
            {
              from_goal_id: "goal_model",
              to_goal_id: "goal_ui",
              reason: "contract" as const,
              contract_ids: contractIDs,
            },
          ]
        : [],
  }
}

function graphGoals(uiAcceptanceSpecs: Array<{ scorers: Array<{ type: string; spec?: unknown }>; severity?: string }>) {
  return [
    { id: "goal_model", depends_on: [], acceptance_specs: [] },
    { id: "goal_ui", depends_on: ["goal_model"], acceptance_specs: uiAcceptanceSpecs },
  ]
}

function contractWithoutAuditCoverageFindings(input: {
  graph: ArchitectContractGraph
  uiAcceptanceSpecs: Array<{ scorers: Array<{ type: string; spec?: unknown }>; severity?: string }>
}) {
  return validateArchitectContractGraph({
    goals: graphGoals(input.uiAcceptanceSpecs),
    graph: input.graph,
  }).filter((finding) => finding.code === "contract_without_audit_coverage")
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

  const out = await tools.submit_architect.execute!(
    {
      summary: "Graph-based two-goal architecture.",
      decomposition_analysis:
        "The model goal owns the shared contract and the UI goal consumes it for rendering, so neither goal is oversized. The UI goal owns final integration because it depends on the model contract and verifies the rendered surface.",
    } as any,
    {} as any,
  )
  expect(out).toContain("PASS")
  expect(kit.getCollector().goals[0]).not.toHaveProperty("exports")
  expect(kit.getCollector().goals[0]).not.toHaveProperty("imports")
})

test("contract covered by related essential contract_audit has no audit coverage concern", () => {
  const findings = contractWithoutAuditCoverageFindings({
    graph: baseGraph(),
    uiAcceptanceSpecs: [contractAuditSpec(["contract_order"])],
  })

  expect(findings).toHaveLength(0)
})

test("contract without essential contract_audit coverage reports audit coverage concern", () => {
  const findings = contractWithoutAuditCoverageFindings({
    graph: baseGraph(),
    uiAcceptanceSpecs: [],
  })

  expect(findings).toHaveLength(1)
  expect(findings[0]).toMatchObject({
    code: "contract_without_audit_coverage",
    severity: "concern",
    scope: { contract_ids: ["contract_order"], goal_ids: ["goal_model", "goal_ui"] },
    repair_tools: ["register_goal", "modify_goal", "register_contract"],
  })
})

test("non-essential contract_audit coverage still reports audit coverage concern", () => {
  const findings = contractWithoutAuditCoverageFindings({
    graph: baseGraph(),
    uiAcceptanceSpecs: [contractAuditSpec(["contract_order"], "important")],
  })

  expect(findings).toHaveLength(1)
  expect(findings[0]?.code).toBe("contract_without_audit_coverage")
})

test("empty contract graph does not report audit coverage concern", () => {
  const findings = contractWithoutAuditCoverageFindings({
    graph: baseGraph([]),
    uiAcceptanceSpecs: [],
  })

  expect(findings).toHaveLength(0)
})

test("typed closed-domain contract without scorers reports only unified audit coverage concern", () => {
  const findings = validateArchitectContractGraph({
    goals: graphGoals([]),
    graph: {
      version: 1,
      contracts: [
        {
          id: "contract_order",
          kind: "type",
          name: "Order",
          producer_goal_id: "goal_model",
          consumer_goal_ids: ["goal_ui"],
          summary: "Shared order status model for UI rendering.",
          artifact_paths: ["src/model.ts"],
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
        },
      ],
      dependency_contracts: [
        {
          from_goal_id: "goal_model",
          to_goal_id: "goal_ui",
          reason: "contract",
          contract_ids: ["contract_order"],
        },
      ],
    },
  })

  expect(findings.map((finding) => finding.code)).toEqual(["contract_without_audit_coverage"])
  expect(findings.some((finding) => finding.code === "contract_audit_missing_criterion")).toBe(false)
})

test("submit_architect blocks single large goal decomposition", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })
  await kit.tools.register_goal.execute!(
    {
      id: "goal_everything",
      title: "Everything",
      objective: "Implement and verify the entire requested change as one broad unit of work.",
      acceptance_specs: [acceptance("goal_everything")],
      owned_paths: ["src/index.ts", "test/index.test.ts"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )

  const out = await kit.tools.submit_architect.execute!(
    {
      summary: "Single goal decomposition.",
      decomposition_analysis:
        "This analysis intentionally explains the unsafe single boundary: implementation and verification are still combined, so the graph should be split before build dispatch can start.",
    } as any,
    {} as any,
  )

  expect(out).toContain("BLOCKERS")
  expect(out).toContain("insufficient_goal_decomposition")
  expect(kit.getCollector().finalized).toBe(false)
})

test("submit_architect reports zero graph contracts as a concern without blocking goal finalization", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })
  await kit.tools.register_goal.execute!(
    {
      id: "goal_model",
      title: "Model",
      objective: "Define the reusable model surface for the downstream implementation.",
      acceptance_specs: [acceptance("goal_model")],
      owned_paths: ["src/model.ts"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )
  await kit.tools.register_goal.execute!(
    {
      id: "goal_render",
      title: "Render",
      objective: "Render the user-facing surface and verify it against the shared model contract.",
      acceptance_specs: [acceptance("goal_render")],
      owned_paths: ["src/render.tsx"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )

  const out = await kit.tools.submit_architect.execute!(
    {
      summary: "Two goals without graph contracts.",
      decomposition_analysis:
        "The model and render goals are both modest, but the missing graph contract should block because downstream work has no durable handoff surface.",
    } as any,
    {} as any,
  )

  expect(out).toContain("PASS")
  expect(out).toContain("missing_contract_graph_contract")
  expect(kit.getCollector().finalized).toBe(true)
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

test("register_dependency_contract rejects unknown contract id without mutating collector", async () => {
  const kit = await registerTwoGoalGraph()
  const out = await kit.tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_model",
      to_goal_id: "goal_ui",
      reason: "contract",
      contract_ids: ["missing_contract"],
    } as any,
    {} as any,
  )

  expect(out).toContain("unknown contract")
  expect(out).toContain("collector unchanged")
  expect(kit.getCollector().contract_graph.dependency_contracts).toHaveLength(0)
})

test("register_dependency_contract rejects contract reason without contract id", async () => {
  const kit = await registerTwoGoalGraph()
  const out = await kit.tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_model",
      to_goal_id: "goal_ui",
      reason: "contract",
      contract_ids: [],
    } as any,
    {} as any,
  )

  expect(out).toContain("reason=contract but no contract_ids")
  expect(out).toContain("collector unchanged")
  expect(kit.getCollector().contract_graph.dependency_contracts).toHaveLength(0)
})

test("register_dependency_contract rejects contract id that does not belong to the edge", async () => {
  const kit = await registerTwoGoalGraph()
  await kit.tools.register_contract.execute!(
    {
      id: "contract_order",
      kind: "type",
      name: "Order",
      producer_goal_id: "goal_model",
      consumer_goal_ids: [],
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
  const out = await kit.tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_model",
      to_goal_id: "goal_ui",
      reason: "contract",
      contract_ids: ["contract_order"],
    } as any,
    {} as any,
  )

  expect(out).toContain('contract "contract_order" belongs to goal_model -> []')
  expect(out).toContain("collector unchanged")
  expect(kit.getCollector().contract_graph.dependency_contracts).toHaveLength(0)
})

test("register_dependency_contract rejects reversed dependency direction with explicit guidance", async () => {
  const kit = await registerTwoGoalGraph()
  const out = await kit.tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_ui",
      to_goal_id: "goal_model",
      reason: "integration_order",
      contract_ids: [],
      summary: "Incorrectly reversed edge.",
    } as any,
    {} as any,
  )

  expect(out).toContain("This edge is reversed")
  expect(out).toContain("producer/prerequisite -> consumer/dependent")
  expect(out).toContain('from_goal_id: "goal_model"')
  expect(out).toContain('to_goal_id: "goal_ui"')
  expect(kit.getCollector().contract_graph.dependency_contracts).toHaveLength(0)
})

test("depends_on edge without graph reason is a blocker", async () => {
  const kit = await registerTwoGoalGraph()

  const findings = architectValidationFindings(kit.getCollector(), { workDir: process.cwd() })
  expect(
    findings.some((finding) => finding.severity === "blocker" && finding.code === "dependency_edge_missing_reason"),
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

test("register_dependency_contract rejects bootstrap scaffold dependency without ordering summary", async () => {
  const kit = await registerTwoGoalGraph()
  const out = await kit.tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_model",
      to_goal_id: "goal_ui",
      reason: "bootstrap_scaffold",
      contract_ids: [],
    } as any,
    {} as any,
  )

  expect(out).toContain("must include summary")
  expect(out).toContain("collector unchanged")
  expect(kit.getCollector().contract_graph.dependency_contracts).toHaveLength(0)
})

test("submit_architect blocks executable graph with an unregistered dependency reason", async () => {
  const kit = await registerTwoGoalGraph()

  const out = await kit.tools.submit_architect.execute!(
    {
      summary: "Executable graph with non-blocking contract concerns.",
      decomposition_analysis:
        "The model goal owns the reusable data contract, while the UI goal owns rendering and integration verification. The dependency is necessary because UI behavior consumes the model surface, and the split keeps each goal modest.",
    } as any,
    {} as any,
  )

  expect(out).toContain("BLOCKERS")
  expect(out).toContain("dependency_edge_missing_reason")
  expect(kit.getCollector().finalized).toBe(false)
})
