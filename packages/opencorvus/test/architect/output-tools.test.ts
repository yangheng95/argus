import { expect, test } from "bun:test"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { validateArchitectContractGraph, type ArchitectContractGraph } from "@/architect/contract-graph"
import { createArchitectOutputTools, architectValidationFindings } from "@/architect/output-tools"
import { GoalContractFieldsSchema } from "@/pipeline/goal-contract.schema"

function acceptance(goalID: string, contractIDs: string[] = [], sourceRequirementID = "REQ-1") {
  return {
    id: `acc-${goalID}`,
    source_requirement_id: sourceRequirementID,
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

function scriptRefAcceptance(goalID: string, scriptPath: string) {
  return {
    id: `acc-${goalID}`,
    source_requirement_id: "REQ-1",
    goal_id: goalID,
    title: `${goalID} scripted acceptance`,
    severity: "essential" as const,
    scorers: [
      {
        type: "heuristic" as const,
        name: "scripted-check",
        spec: { kind: "script_ref" as const, path: scriptPath, args: [] },
        expect: { exit_code: 0 },
      },
    ],
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

function contractRef(id: string = "contract_order", consumerGoalIDs: string[] = ["goal_ui"]) {
  const ir = {
    kind: "type" as const,
    name: "Order",
    fields: [
      {
        name: "status",
        typeExpr: "string",
        valueDomain: { kind: "literal_union" as const, values: ["new", "paid"] },
      },
    ],
  }
  return {
    id,
    kind: "type" as const,
    name: "Order",
    producer_goal_id: "goal_model",
    consumer_goal_ids: consumerGoalIDs,
    summary: "Shared order status model for UI rendering.",
    ir_json: JSON.stringify(ir),
  }
}

function componentContractRef(component: unknown, id: string = "contract_widget_component") {
  return {
    id,
    kind: "component" as const,
    name: "WidgetPanel",
    producer_goal_id: "goal_model",
    consumer_goal_ids: ["goal_ui"],
    summary: "Shared component surface for UI rendering.",
    component_json: JSON.stringify(component),
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

test("register_goal rejects internal runtime owned paths before collector mutation", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })

  const out = await kit.tools.register_goal.execute!(
    {
      id: "goal_stage1_manifest",
      title: "Stage 1 manifest",
      objective:
        "Create a durable Stage 1 manifest that downstream build goals can read without relying on host runtime state.",
      acceptance_specs: [acceptance("goal_stage1_manifest")],
      owned_paths: [".opencorvus/r/t/ab/cdef12/stage1/evidence-manifest-prd.md"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    },
    {} as any,
  )

  expect(out).toContain("internal OpenCorvus runtime path")
  expect(out).toContain("durable deliverables under project source/docs paths")
  expect(kit.getCollector().goals).toHaveLength(0)
})

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
      acceptance_specs: [acceptance("goal_ui")],
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

  await tools.register_contract.execute!(contractRef() as any, {} as any)
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
  expect(kit.getCollector().fact_check_items).toEqual([])
  expect(kit.getCollector().goals[0]).not.toHaveProperty("exports")
  expect(kit.getCollector().goals[0]).not.toHaveProperty("imports")
})

test("register_contract component_json accepts comma-separated props string", async () => {
  const kit = await registerTwoGoalGraph()

  const out = await kit.tools.register_contract.execute!(
    componentContractRef({
      props: "title, items, onSelect",
      events: ["select"],
      slots: ["header"],
    }) as any,
    {} as any,
  )

  expect(out).toContain("OK")
  expect(kit.getCollector().contract_graph.contracts[0]?.component).toEqual({
    props: "title, items, onSelect",
    events: ["select"],
    slots: ["header"],
  })
})

test("register_contract component_json rejects props arrays", async () => {
  const kit = await registerTwoGoalGraph()

  await expect(
    kit.tools.register_contract.execute!(
      componentContractRef({ props: ["title", "items"], events: [], slots: [] }, "contract_bad_component") as any,
      {} as any,
    ),
  ).rejects.toThrow()
  expect(kit.getCollector().contract_graph.contracts).toEqual([])
})

test("remove_goal cascades depends_on references from remaining goals", async () => {
  const kit = await registerTwoGoalGraph()
  const { tools } = kit

  await tools.register_contract.execute!(contractRef() as any, {} as any)
  await tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_model",
      to_goal_id: "goal_ui",
      reason: "contract",
      contract_ids: ["contract_order"],
    } as any,
    {} as any,
  )

  const out = await tools.remove_goal.execute!(
    {
      id: "goal_model",
      reason: "model surface was folded into the UI goal during re-sizing",
    } as any,
    {} as any,
  )

  expect(out).toContain("1 goal depends_on ref(s)")
  expect(kit.getCollector().goals.find((goal) => goal.id === "goal_ui")?.depends_on).toEqual([])
  expect(
    architectValidationFindings(kit.getCollector(), { workDir: process.cwd() }).some(
      (finding) => finding.code === "unknown_dependency_goal",
    ),
  ).toBe(false)
})

test("architect normalizes frontend-design source baseline owned paths to acceptance root", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })

  const result = await kit.tools.register_goal.execute!(
    {
      id: "goal_frontend_api",
      title: "Frontend API",
      objective:
        "Adopt the frontend source baseline into the acceptance root and implement API client code used by the app.",
      acceptance_specs: [acceptance("goal_frontend_api")],
      owned_paths: [
        "frontend-design-skeleton/package.json",
        "frontend-design-skeleton/src/types/api.ts",
        "frontend-design-skeleton\\src\\hooks\\useApi.ts",
      ],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )

  expect(result).toContain("normalized source-baseline owned_paths to acceptance-root paths")
  expect(kit.getCollector().goals[0]?.owned_paths).toEqual(["package.json", "src/types/api.ts", "src/hooks/useApi.ts"])
})

test("architect rejects contract evidence_refs outside active research evidence ids", async () => {
  const kit = createArchitectOutputTools({
    existingGoals: [
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
      },
      {
        id: "goal_ui",
        title: "UI",
        objective: "Render the UI using only the graph contract produced by the model goal.",
        acceptance_specs: [acceptance("goal_ui")],
        owned_paths: ["src/ui.tsx"],
        depends_on: ["goal_model"],
        priority: "blocking",
        kind: "feature",
        requirement_ids: ["REQ-1"],
      },
    ],
    workDir: process.cwd(),
    knownResearchEvidenceIDs: ["ev_1"],
  })

  const result = await kit.tools.register_contract.execute!(
    {
      ...contractRef(),
      evidence_refs: ["ev_missing"],
    } as any,
    {} as any,
  )

  expect(result).toContain("unknown or stale research evidence")
  expect(kit.getCollector().contract_graph.contracts).toEqual([])
})

test("contract covered by related essential contract_audit has no audit coverage concern", () => {
  const findings = contractWithoutAuditCoverageFindings({
    graph: baseGraph(),
    uiAcceptanceSpecs: [contractAuditSpec(["contract_order"])],
  })

  expect(findings).toHaveLength(0)
})

test("contract_audit scorer referencing absent graph contract is a blocker", () => {
  const findings = validateArchitectContractGraph({
    goals: graphGoals([contractAuditSpec(["missing_contract"])]),
    graph: baseGraph(["contract_order"]),
  })

  expect(findings).toContainEqual(
    expect.objectContaining({
      code: "contract_audit_unknown_contract",
      severity: "blocker",
      scope: { goal_ids: ["goal_ui"], contract_ids: ["missing_contract"] },
    }),
  )
})

test("known contract_audit ids avoid unknown blocker and audit coverage concern", () => {
  const findings = validateArchitectContractGraph({
    goals: graphGoals([contractAuditSpec(["contract_order"])]),
    graph: baseGraph(["contract_order"]),
  })

  expect(findings.some((finding) => finding.code === "contract_audit_unknown_contract")).toBe(false)
  expect(findings.some((finding) => finding.code === "contract_without_audit_coverage")).toBe(false)
})

test("contract graph validation blocks duplicate semantic surfaces", () => {
  const findings = validateArchitectContractGraph({
    goals: graphGoals([contractAuditSpec(["contract_order"])]),
    graph: baseGraph(["contract_order", "contract_order_copy"]),
  })

  expect(findings).toContainEqual(
    expect.objectContaining({
      code: "duplicate_contract_surface",
      severity: "blocker",
      scope: { goal_ids: ["goal_model"], contract_ids: ["contract_order", "contract_order_copy"] },
    }),
  )
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

test("incident regression flags only drifted contract_audit ids as blockers", () => {
  const graphIDs = [
    "ct-types-viewmodel",
    "ct-types-messageargs",
    "ct-data-accessor",
    "ct-sync-broadcast-fn",
    "ct-mcp-export",
  ]
  const auditIDs = [
    "ct-data-keyvalueitem",
    "ct-data-hookresult",
    "ct-config-accessor",
    "ct-sync-broadcast-fn",
    "ct-types-viewmodel",
  ]
  const findings = validateArchitectContractGraph({
    goals: graphGoals([contractAuditSpec(auditIDs)]),
    graph: baseGraph(graphIDs),
  }).filter((finding) => finding.code === "contract_audit_unknown_contract")

  expect(findings).toHaveLength(3)
  expect(findings.map((finding) => finding.scope.contract_ids?.[0]).sort()).toEqual([
    "ct-config-accessor",
    "ct-data-hookresult",
    "ct-data-keyvalueitem",
  ])
  expect(findings.some((finding) => finding.scope.contract_ids?.[0] === "ct-sync-broadcast-fn")).toBe(false)
  expect(findings.some((finding) => finding.scope.contract_ids?.[0] === "ct-types-viewmodel")).toBe(false)
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

test("submit_architect blocks contract_audit ids absent from graph contracts", async () => {
  const kit = await registerTwoGoalGraph()
  await kit.tools.register_contract.execute!(contractRef() as any, {} as any)
  await kit.tools.register_dependency_contract.execute!(
    {
      from_goal_id: "goal_model",
      to_goal_id: "goal_ui",
      reason: "contract",
      contract_ids: ["contract_order"],
    } as any,
    {} as any,
  )
  const uiGoal = kit.getCollector().goals.find((goal) => goal.id === "goal_ui")
  expect(uiGoal).toBeDefined()
  uiGoal!.acceptance_specs = [acceptance("goal_ui", ["missing_contract"])]

  const out = await kit.tools.submit_architect.execute!(
    {
      summary: "Graph with a drifted audit reference.",
      decomposition_analysis:
        "The model goal owns the reusable data contract, while the UI goal consumes that handoff for rendering. The dependency is necessary and the goals are individually modest, but the audit reference is intentionally drifted for validation.",
    } as any,
    {} as any,
  )

  expect(out).toContain("BLOCKERS")
  expect(out).toContain("contract_audit_unknown_contract")
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

test("register_goal rejects unknown contract_audit ids without mutating collector goals", async () => {
  const kit = await registerTwoGoalGraph()
  const before = JSON.stringify(kit.getCollector().goals)

  const out = await kit.tools.register_goal.execute!(
    {
      id: "goal_ui",
      title: "UI",
      objective: "Render the UI using a graph contract that has not been registered.",
      acceptance_specs: [acceptance("goal_ui", ["missing_contract"])],
      owned_paths: ["src/ui.tsx"],
      depends_on: ["goal_model"],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )

  expect(out).toContain("unknown contract id(s): missing_contract")
  expect(out).toContain("collector unchanged")
  expect(JSON.stringify(kit.getCollector().goals)).toBe(before)
})

test("modify_goal rejects unknown contract_audit ids without mutating prior goal", async () => {
  const kit = await registerTwoGoalGraph()
  const before = JSON.stringify(kit.getCollector().goals.find((goal) => goal.id === "goal_ui"))

  const out = await kit.tools.modify_goal.execute!(
    {
      id: "goal_ui",
      updates: {
        acceptance_specs: [acceptance("goal_ui", ["missing_contract"])],
      },
    } as any,
    {} as any,
  )

  expect(out).toContain("unknown contract id(s): missing_contract")
  expect(out).toContain("collector unchanged")
  expect(JSON.stringify(kit.getCollector().goals.find((goal) => goal.id === "goal_ui"))).toBe(before)
})

test("register_goal and modify_goal accept contract_audit ids after contract registration", async () => {
  const kit = await registerTwoGoalGraph()
  const registerContractOut = await kit.tools.register_contract.execute!(contractRef() as any, {} as any)
  expect(registerContractOut).toContain("Registered contract ids: contract_order")

  const registerGoalOut = await kit.tools.register_goal.execute!(
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
  expect(registerGoalOut).toContain('OK: goal "goal_ui" updated in-place')

  const modifyGoalOut = await kit.tools.modify_goal.execute!(
    {
      id: "goal_ui",
      updates: {
        acceptance_specs: [acceptance("goal_ui", ["contract_order"])],
      },
    } as any,
    {} as any,
  )

  expect(modifyGoalOut).toContain('No changes: goal "goal_ui" already matches the submitted updates')
  expect(kit.getCollector().goals.find((goal) => goal.id === "goal_ui")?.acceptance_specs[0]?.scorers[0]).toMatchObject(
    {
      type: "contract_audit",
      spec: { contract_ids: ["contract_order"] },
    },
  )
})

test("register_goal rejects script_ref acceptance specs whose scripts do not exist", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oc-architect-script-ref-"))
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: tmp })

  const out = await kit.tools.register_goal.execute!(
    {
      id: "goal_missing_script",
      title: "Missing script",
      objective: "Define a goal whose scripted acceptance must reference a real repository script.",
      acceptance_specs: [scriptRefAcceptance("goal_missing_script", "scripts/missing-check.sh")],
      owned_paths: ["src/missing.ts"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )

  expect(out).toContain("references missing script_ref acceptance scorer path(s)")
  expect(out).toContain("script_ref is only for existing repo scripts")
  expect(out).toContain("contract_audit is a scorer type, not a script_ref path")
  expect(out).toContain('Use spec.kind="shell" with cmd for inline page checks')
  expect(kit.getCollector().goals).toEqual([])
})

test("register_goal explains contract_audit is not a script_ref path", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oc-architect-contract-audit-script-ref-"))
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: tmp })

  const out = await kit.tools.register_goal.execute!(
    {
      id: "goal_contract_audit_confusion",
      title: "Contract audit confusion",
      objective: "Define a goal whose acceptance must not mistake contract_audit for a repo script.",
      acceptance_specs: [scriptRefAcceptance("goal_contract_audit_confusion", ".opencorvus/scripts/contract-audit")],
      owned_paths: ["src/page.tsx"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )

  expect(out).toContain(".opencorvus/scripts/contract-audit")
  expect(out).toContain("contract_audit is a scorer type, not a script_ref path")
  expect(out).toContain('type="contract_audit" with registered contract_ids')
  expect(out).toContain("collector unchanged")
  expect(kit.getCollector().goals).toEqual([])
})

test("register_goal accepts existing script_ref and exposes scorer kind in goal snapshot", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "oc-architect-script-ref-"))
  fs.mkdirSync(path.join(tmp, "scripts"))
  fs.writeFileSync(path.join(tmp, "scripts", "check.sh"), "echo ok\n")
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: tmp })

  const out = await kit.tools.register_goal.execute!(
    {
      id: "goal_existing_script",
      title: "Existing script",
      objective: "Define a goal whose scripted acceptance references a real repository script.",
      acceptance_specs: [scriptRefAcceptance("goal_existing_script", "scripts/check.sh")],
      owned_paths: ["src/existing.ts"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )

  expect(out).toContain('OK: goal "goal_existing_script" registered')
  expect(out).toContain("heuristic:script_ref:scripts/check.sh")
})

test("register_goal exposes shell scorer kind and command preview in goal snapshot", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })

  const out = await kit.tools.register_goal.execute!(
    {
      id: "goal_shell_snapshot",
      title: "Shell snapshot",
      objective: "Define a goal whose shell acceptance is visible in architect feedback.",
      acceptance_specs: [acceptance("goal_shell_snapshot")],
      owned_paths: ["src/shell.ts"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-1"],
    } as any,
    {} as any,
  )

  expect(out).toContain("heuristic:shell:bun test")
})

test("modify_goal reports no-op instead of fake changed count for identical updates", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })
  const goal = {
    id: "goal_noop",
    title: "Noop",
    objective: "Define a stable goal whose repeated updates should be reported as unchanged.",
    acceptance_specs: [acceptance("goal_noop")],
    owned_paths: ["src/noop.ts"],
    depends_on: [],
    priority: "blocking" as const,
    kind: "feature" as const,
    requirement_ids: ["REQ-1"],
  }
  await kit.tools.register_goal.execute!(goal as any, {} as any)

  const out = await kit.tools.modify_goal.execute!(
    {
      id: "goal_noop",
      updates: {
        acceptance_specs: goal.acceptance_specs,
      },
    } as any,
    {} as any,
  )

  expect(out).toContain('No changes: goal "goal_noop" already matches the submitted updates')
  expect(out).not.toContain("fields updated")
})

test("register_goal schema rejects malformed scorer type before execute", () => {
  const parsed = GoalContractFieldsSchema.safeParse({
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
  })

  expect(parsed.success).toBe(false)
  if (!parsed.success) {
    expect(
      parsed.error.issues.some(
        (issue) => issue.code === "invalid_union" && issue.path.join(".") === "acceptance_specs.0.scorers.0.type",
      ),
    ).toBe(true)
  }
})

test("register_goal execute normalizes canonical schema defaults before collector mutation", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd() })

  const out = await kit.tools.register_goal.execute!(
    {
      id: "goal_defaults",
      title: "Defaults",
      objective: "Define a goal whose omitted defaulted fields are normalized by the canonical goal contract schema.",
      acceptance_specs: [acceptance("goal_defaults")],
      owned_paths: ["src/defaults.ts"],
    } as any,
    {} as any,
  )

  expect(out).toContain('OK: goal "goal_defaults" registered')
  expect(out).toContain("depends_on=[(none)]")
  expect(kit.getCollector().goals[0]).toMatchObject({
    id: "goal_defaults",
    depends_on: [],
    priority: "blocking",
    kind: "feature",
    requirement_ids: [],
  })
})

test("architect validation blocks acceptance specs whose source requirement is not claimed by the same goal", async () => {
  const kit = createArchitectOutputTools({
    existingGoals: [],
    workDir: process.cwd(),
    knownRequirementIDs: ["REQ-1", "REQ-3"],
  })

  await kit.tools.register_goal.execute!(
    {
      id: "goal_trace",
      title: "Trace",
      objective: "Implement the traceable behavior while preserving exact requirement ownership metadata for review.",
      acceptance_specs: [acceptance("goal_trace", [], "REQ-1")],
      owned_paths: ["src/trace.ts"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-3"],
    } as any,
    {} as any,
  )

  const findings = architectValidationFindings(kit.getCollector(), {
    workDir: process.cwd(),
    knownRequirementIDs: ["REQ-1", "REQ-3"],
  })

  expect(findings).toContainEqual(
    expect.objectContaining({
      code: "acceptance_requirement_not_claimed",
      severity: "blocker",
    }),
  )
})

test("architect validation blocks unknown requirement ids in goals and acceptance specs", async () => {
  const kit = createArchitectOutputTools({ existingGoals: [], workDir: process.cwd(), knownRequirementIDs: ["REQ-1"] })

  await kit.tools.register_goal.execute!(
    {
      id: "goal_unknown_req",
      title: "Unknown requirement",
      objective: "Implement a behavior while intentionally using unknown requirement metadata to exercise validation.",
      acceptance_specs: [acceptance("goal_unknown_req", [], "REQ-999")],
      owned_paths: ["src/unknown.ts"],
      depends_on: [],
      priority: "blocking",
      kind: "feature",
      requirement_ids: ["REQ-999"],
    } as any,
    {} as any,
  )

  const findings = architectValidationFindings(kit.getCollector(), {
    workDir: process.cwd(),
    knownRequirementIDs: ["REQ-1"],
  })

  expect(findings).toContainEqual(
    expect.objectContaining({
      code: "acceptance_unknown_requirement",
      severity: "blocker",
    }),
  )
  expect(findings).toContainEqual(
    expect.objectContaining({
      code: "goal_unknown_requirement",
      severity: "blocker",
    }),
  )
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

test("register_contract rejects duplicate semantic surface under a new id without mutating collector", async () => {
  const kit = await registerTwoGoalGraph()
  await kit.tools.register_contract.execute!(contractRef("contract_order", []) as any, {} as any)

  const out = await kit.tools.register_contract.execute!(
    {
      ...contractRef("contract_order_v2", ["goal_ui"]),
    } as any,
    {} as any,
  )

  expect(out).toContain('duplicates existing contract surface "contract_order"')
  expect(out).toContain('Re-register contract id "contract_order"')
  expect(out).toContain("collector unchanged")
  expect(kit.getCollector().contract_graph.contracts).toHaveLength(1)
  expect(kit.getCollector().contract_graph.contracts[0].consumer_goal_ids).toEqual([])
})

test("register_contract overwrites the same id when repairing contract consumers", async () => {
  const kit = await registerTwoGoalGraph()
  await kit.tools.register_contract.execute!(contractRef("contract_order", []) as any, {} as any)

  const out = await kit.tools.register_contract.execute!(contractRef("contract_order", ["goal_ui"]) as any, {} as any)

  expect(out).toContain('contract "contract_order" overwritten')
  expect(kit.getCollector().contract_graph.contracts).toHaveLength(1)
  expect(kit.getCollector().contract_graph.contracts[0].consumer_goal_ids).toEqual(["goal_ui"])
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
      ir_json: JSON.stringify({
        kind: "type",
        name: "Order",
        fields: [
          {
            name: "status",
            typeExpr: "string",
            valueDomain: { kind: "literal_union", values: ["new", "paid"] },
          },
        ],
      }),
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
  expect(out).toContain('Re-register contract id "contract_order"')
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
