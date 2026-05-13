import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runContractAudit } from "@/acceptance/contract-audit"
import type { AcceptanceSpec, ContractAuditScorer } from "@/acceptance/types"
import type { ContractIR } from "@/architect/contract-ir"
import { architectValidationIssues, type ArchitectCollector } from "@/architect/output-tools"
import { buildContractAuditReviewEvidence } from "@/delivery/checks/contract-audit-review"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

describe("contract_audit acceptance scorer", () => {
  test("literal_union reports an invalid field literal with file and line evidence", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": "interface Order { status: string }\nexport const row: Order = { status: \"archived\" }\n",
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("failed")
    expect(result.evidence).toContain("src/status.ts:2")
    expect(result.evidence).toContain("field=Order.status")
    expect(result.evidence).toContain('literal="archived"')
    expect(result.evidence).toContain('expected="new"|"paid"')
  })

  test("literal_union passes when observed field literals are inside the declared domain", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": "interface Order { status: string }\nexport const row: Order = { status: \"paid\" }\n",
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("passed")
    expect(result.evidence).toContain("observed_assignments=1")
    expect(result.evidence).toContain("static_inference_inconclusive_for=none")
  })

  test("shorthand property pointing at a literal const is audited", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": [
        "interface Order { status: string }",
        "const status = \"paid\"",
        "export const row: Order = { status }",
        "",
      ].join("\n"),
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("passed")
    expect(result.evidence).toContain("observed_assignments=1")
  })

  test("property assignment initializer identifier pointing at a literal const is audited", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": [
        "interface Order { status: string }",
        "const status = \"paid\"",
        "export const row: Order = { status: status }",
        "",
      ].join("\n"),
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("passed")
    expect(result.evidence).toContain("observed_assignments=1")
  })

  test("default parameter literal backs shorthand property audit", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": [
        "interface Order { status: string }",
        "function row(status: \"new\" | \"paid\" = \"new\") {",
        "  const value: Order = { status }",
        "  return value",
        "}",
        "export const current = row()",
        "",
      ].join("\n"),
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("passed")
    expect(result.evidence).toContain("observed_assignments=1")
  })

  test("bare field-name matches are not audited without a contract owner", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": "export const row = { label: \"paid\" }\n",
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("inconclusive")
    expect(result.evidence).toContain("no owner-bound assignments observed")
  })

  test("regression: unrelated menu label does not fail a SuggestionChipProps label contract", async () => {
    const workDir = await tempWorkDir({
      "src/menu.ts": "export const menu = { label: \"删除\" }\n",
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["SuggestionChipProps", suggestionChipPropsContract()]]),
      goal: boundaryGoal(["SuggestionChipProps"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("inconclusive")
    expect(result.evidence).not.toContain("literal=\"删除\"")
  })

  test("regression: owner-bound SuggestionChipProps label is audited", async () => {
    const workDir = await tempWorkDir({
      "src/chip.ts": "interface SuggestionChipProps { label: string }\nexport const chip: SuggestionChipProps = { label: \"删除\" }\n",
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["SuggestionChipProps", suggestionChipPropsContract()]]),
      goal: boundaryGoal(["SuggestionChipProps"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("failed")
    expect(result.evidence).toContain("field=SuggestionChipProps.label")
    expect(result.evidence).toContain("literal=\"删除\"")
  })

  test("regression: satisfies-bound SuggestionChipProps label concatenation is audited", async () => {
    const workDir = await tempWorkDir({
      "src/chip.ts": "interface SuggestionChipProps { label: string }\nexport const chip = { label: \"删\" + \"除\" } satisfies SuggestionChipProps\n",
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["SuggestionChipProps", suggestionChipPropsContract()]]),
      goal: boundaryGoal(["SuggestionChipProps"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("failed")
    expect(result.evidence).toContain("literal=\"删除\"")
  })

  test("regression: JSX props bind to the component props contract", async () => {
    const workDir = await tempWorkDir({
      "src/chip.tsx": [
        "interface SuggestionChipProps { label: string }",
        "function SuggestionChip(props: SuggestionChipProps) { return null as any }",
        "export const view = <SuggestionChip label=\"删除\" />",
        "",
      ].join("\n"),
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["SuggestionChipProps", suggestionChipPropsContract()]]),
      goal: boundaryGoal(["SuggestionChipProps"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("failed")
    expect(result.evidence).toContain("field=SuggestionChipProps.label")
    expect(result.evidence).toContain("literal=\"删除\"")
  })

  test("unresolved identifier flow is inconclusive evidence and does not fail", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": [
        "interface Order { status: string }",
        "declare function getStatus(): string",
        "const status = getStatus()",
        "export const row: Order = { status }",
        "",
      ].join("\n"),
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("inconclusive")
    expect(result.evidence).toContain("field=status")
    expect(result.evidence).toContain("Identifier 'status'")
    expect(result.evidence).toContain("suggestion:")
  })

  test("regression: BrushKey ternary plus let rebind catches violation", async () => {
    const workDir = await tempWorkDir({
      "src/hooks.ts": [
        "interface AcrossItem { valueBrushKey: string }",
        "export function rows(rise: number) {",
        "  const result: AcrossItem[] = []",
        "  let colorBrushKey: string",
        "  colorBrushKey = rise > 0 ? \"brush-data-rise\" : rise < 0 ? \"brush-data-fall\" : \"brush-data-unchanged\"",
        "  result.push({ valueBrushKey: colorBrushKey })",
        "  return result",
        "}",
        "",
      ].join("\n"),
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["AcrossItem", brushContract()]]),
      goal: boundaryGoal(["AcrossItem"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("failed")
    expect(result.evidence).toContain("brush-data-rise")
    expect(result.evidence).toContain("brush-data-fall")
    expect(result.evidence).toContain("brush-data-unchanged")
  })

  test("regression: let rebind with single literal catches violation", async () => {
    const workDir = await tempWorkDir({
      "src/field.ts": [
        "interface Payload { field: string }",
        "let x: string",
        "x = \"bad\"",
        "export const obj: Payload = { field: x }",
        "",
      ].join("\n"),
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Payload", payloadContract()]]),
      goal: boundaryGoal(["Payload"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("failed")
    expect(result.evidence).toContain('literal="bad"')
  })

  test("regression: ternary with all compliant literals passes", async () => {
    const workDir = await tempWorkDir({
      "src/hooks.ts": [
        "interface AcrossItem { valueBrushKey: string }",
        "export function rows(rise: number) {",
        "  let colorBrushKey: string",
        "  colorBrushKey = rise > 0 ? \"DataRise\" : \"DataFall\"",
        "  const item: AcrossItem = { valueBrushKey: colorBrushKey }",
        "  return item",
        "}",
        "",
      ].join("\n"),
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["AcrossItem", brushContract()]]),
      goal: boundaryGoal(["AcrossItem"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("passed")
    expect(result.evidence).toContain("observed_assignments=2")
    expect(result.evidence).toContain("all compliant")
  })

  test("regression: bootstrap kind goal short-circuits to skipped at runner", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": "export const row = { status: \"archived\" }\n",
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: { ...boundaryGoal(["Order"]), kind: "bootstrap" },
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("skipped")
    expect(result.evidence).toContain("bootstrap")
  })

  test("regression: architect does not require contract_audit on bootstrap goal even with eligible imports", () => {
    const collector = collectorWithImportingBootstrap()

    const issues = architectValidationIssues(collector, { workDir: process.cwd() }).join("\n")

    expect(issues).not.toContain("audit-eligible imports require at least one essential on_goal contract_audit")
  })

  test("regression: cross-function indirection produces inconclusive status", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": [
        "interface Order { status: string }",
        "function helper() { return \"archived\" }",
        "export const row: Order = { status: helper() }",
        "",
      ].join("\n"),
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("inconclusive")
    expect(result.evidence).toContain("unable_to_statically_audit")
    expect(result.evidence).toContain("field=status")
    expect(result.evidence).toContain("src/status.ts:3")
    expect(result.evidence).toContain("Identifier 'helper'")
    expect(result.evidence).toContain("cannot be reduced")
    expect(result.evidence).toContain("suggestion:")
  })

  test("regression: project-gate aggregates inconclusive as advisory", () => {
    const spec = auditSpec()
    const scorer = auditScorer()
    const name = `acceptance:${spec.id}:${scorer.name}`

    const evidence = buildContractAuditReviewEvidence({
      goals: [{
        imports: ["Order"],
        exports: [],
        acceptance_specs: [spec],
      }],
      criteriaResults: [{
        name,
        status: "inconclusive",
        family: "contract_audit",
        evidence: "unable_to_statically_audit: field=status",
      }],
    })

    expect(evidence).toHaveLength(1)
    expect(evidence[0].id).toBe("review:contract_audit")
    expect(evidence[0].status).toBe("failed")
    expect(evidence[0].evidence.join("\n")).toContain("inconclusive evidence does not prove required contract compliance")
    expect(evidence[0].evidence.join("\n")).toContain("unable_to_statically_audit")
  })

  test("regression: delivery ignores superseded contract_audit criteria for older goal runs", () => {
    const spec = auditSpec()
    const scorer = auditScorer()
    const name = `acceptance:${spec.id}:${scorer.name}`

    const evidence = buildContractAuditReviewEvidence({
      goals: [{
        id: "goal_consumer",
        latest_goal_run_id: "goal_run_new",
        imports: ["Order"],
        exports: [],
        acceptance_specs: [spec],
      }],
      criteriaResults: [
        {
          name,
          status: "failed",
          family: "contract_audit",
          evidence: "stale literal failure",
          goal_id: "goal_consumer",
          goal_run_id: "goal_run_old",
        },
        {
          name,
          status: "passed",
          family: "contract_audit",
          evidence: "fresh pass",
          goal_id: "goal_consumer",
          goal_run_id: "goal_run_new",
        },
      ],
    })

    expect(evidence).toHaveLength(1)
    expect(evidence[0].status).toBe("passed")
    expect(evidence[0].evidence.join("\n")).toContain("passed=1")
    expect(evidence[0].evidence.join("\n")).not.toContain("stale literal failure")
  })

  test("ref resolves to an enum contract and applies the same literal rule", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": "interface Order { status: string }\nconst payload: Order = { status: \"archived\" }\n",
    })
    const orderWithRef: ContractIR = {
      kind: "type",
      name: "Order",
      fields: [{
        name: "status",
        typeExpr: "OrderStatus",
        valueDomain: { kind: "ref", contractName: "OrderStatus" },
      }],
    }
    const statusEnum: ContractIR = {
      kind: "enum",
      name: "OrderStatus",
      variants: [
        { value: "new", meaning: "New order" },
        { value: "paid", meaning: "Paid order" },
      ],
    }

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderWithRef], ["OrderStatus", statusEnum]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("failed")
    expect(result.evidence).toContain('expected="new"|"paid"')
  })

  test("branded values skip when the brand does not resolve to a closed contract", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": "const payload = { status: \"anything\" }\n",
    })
    const branded: ContractIR = {
      kind: "type",
      name: "Order",
      fields: [{
        name: "status",
        typeExpr: "OrderStatus",
        valueDomain: {
          kind: "branded",
          brand: "UnregisteredStatusBrand",
          examples: ["new", "paid"],
        },
      }],
    }

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", branded]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("skipped")
    expect(result.evidence).toContain("no literal_union/ref-resolved/branded-resolved fields")
  })

  test("goal without imports or exports is a no-op", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": "const payload = { status: \"archived\" }\n",
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: { id: "goal_local", imports: [], exports: [], owned_paths: ["src"] },
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("skipped")
    expect(result.evidence).toContain("no imports/exports declared")
  })

  test("architect validation rejects audit-eligible imports without essential contract_audit", () => {
    const collector = collectorWithCrossBoundaryGoals()

    const issues = architectValidationIssues(collector, { workDir: process.cwd() }).join("\n")

    expect(issues).toContain("audit-eligible imports require at least one essential on_goal contract_audit")
  })

  test("architect validation rejects props/data shapes registered as function contracts", () => {
    const collector = collectorWithExportOnlyBootstrap()
    collector.contracts.push({
      ir: {
        kind: "function",
        name: "SuggestionChipProps",
        params: [{
          name: "label",
          typeExpr: "string",
          valueDomain: { kind: "literal_union", values: ["新增", "编辑"] },
        }],
        returns: {
          typeExpr: "void",
          valueDomain: { kind: "open", reason: "Callable return is intentionally unrestricted output." },
        },
      },
      goalIDs: ["goal_bootstrap"],
    })

    const issues = architectValidationIssues(collector, { workDir: process.cwd() }).join("\n")

    expect(issues).toContain("Contract \"SuggestionChipProps\": props/data shape contracts must be registered as type_contract")
  })

  test("architect validation allows lower-camel callable hooks ending with data or config", () => {
    const collector = collectorWithExportOnlyBootstrap()
    collector.contracts.push({
      ir: hookFunctionContract("useKeyStatisticsData"),
      goalIDs: ["goal_bootstrap"],
    })
    collector.contracts.push({
      ir: hookFunctionContract("useKeyStatisticsConfig"),
      goalIDs: ["goal_bootstrap"],
    })

    const issues = architectValidationIssues(collector, { workDir: process.cwd() }).join("\n")

    expect(issues).not.toContain("Contract \"useKeyStatisticsData\": props/data shape contracts")
    expect(issues).not.toContain("Contract \"useKeyStatisticsConfig\": props/data shape contracts")
  })

  test("architect validation rejects verification goals that own feature source files", () => {
    const collector = collectorWithExportOnlyBootstrap()
    collector.goals.push({
      id: "goal_verify",
      title: "Verification",
      objective: "Verify final integration without owning feature implementation files.",
      acceptance_specs: [],
      owned_paths: ["src/renderer/shells/fusion/AutoTasksPage.tsx"],
      depends_on: ["goal_bootstrap"],
      exports: [],
      imports: ["Order from goal_bootstrap"],
      priority: "blocking",
      kind: "verification",
      requirement_ids: ["REQ-1"],
    })

    const issues = architectValidationIssues(collector, { workDir: process.cwd() }).join("\n")

    expect(issues).toContain("Goal goal_verify: verification owned_paths may only cover tests")
    expect(issues).toContain("src/renderer/shells/fusion/AutoTasksPage.tsx")
  })

  test("architect validation does not require contract_audit for export-only bootstrap contracts", () => {
    const collector = collectorWithExportOnlyBootstrap()

    const issues = architectValidationIssues(collector, { workDir: process.cwd() }).join("\n")

    expect(issues).not.toContain("contract_audit")
  })
})

async function tempWorkDir(files: Record<string, string>) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "oc-contract-audit-"))
  tempDirs.push(dir)
  for (const [relative, text] of Object.entries(files)) {
    const target = path.join(dir, relative)
    await fs.mkdir(path.dirname(target), { recursive: true })
    await fs.writeFile(target, text)
  }
  return dir
}

function collectorWithExportOnlyBootstrap(): ArchitectCollector {
  return {
    goals: [
      {
        id: "goal_bootstrap",
        title: "Bootstrap types",
        objective: "Export shared type contracts for later goals.",
        acceptance_specs: [{
          id: "acc-bootstrap",
          source_requirement_id: "REQ-1",
          goal_id: "goal_bootstrap",
          title: "Bootstrap checks",
          severity: "essential",
          scorers: [{
            type: "heuristic",
            name: "test",
            spec: { kind: "shell", cmd: "bun test" },
          }],
        }],
        owned_paths: [],
        depends_on: [],
        exports: ["Order"],
        imports: [],
        priority: "blocking",
        kind: "bootstrap",
        requirement_ids: [],
      },
    ],
    traceability: [],
    source_coverage: [],
    reference_coverage: [],
    assembly_owners: [],
    contracts: [{ ir: orderContract(), goalIDs: ["goal_bootstrap"] }],
    removed_goal_ids: [],
    summary: "",
    finalized: false,
  }
}

function auditScorer(): ContractAuditScorer {
  return {
    type: "contract_audit",
    name: "contract-ir",
    spec: { kind: "contract_ir" },
    expect: { status: "passed" },
  }
}

function auditSpec(): AcceptanceSpec {
  return {
    id: "acc-contract",
    source_requirement_id: "REQ-1",
    goal_id: "goal_consumer",
    title: "Contract audit",
    severity: "essential",
    scorers: [auditScorer()],
  }
}

function boundaryGoal(imports: string[]) {
  return {
    id: "goal_consumer",
    imports,
    exports: [],
    owned_paths: ["src"],
  }
}

function orderContract(): ContractIR {
  return {
    kind: "type",
    name: "Order",
    fields: [{
      name: "status",
      typeExpr: "string",
      valueDomain: { kind: "literal_union", values: ["new", "paid"] },
    }],
  }
}

function brushContract(): ContractIR {
  return {
    kind: "type",
    name: "AcrossItem",
    fields: [{
      name: "valueBrushKey",
      typeExpr: "string",
      valueDomain: { kind: "literal_union", values: ["DataRise", "DataFall", "DataUnchanged"] },
    }],
  }
}

function payloadContract(): ContractIR {
  return {
    kind: "type",
    name: "Payload",
    fields: [{
      name: "field",
      typeExpr: "string",
      valueDomain: { kind: "literal_union", values: ["ok"] },
    }],
  }
}

function hookFunctionContract(name: string): ContractIR {
  return {
    kind: "function",
    name,
    params: [],
    returns: {
      typeExpr: "unknown",
      valueDomain: {
        kind: "open",
        reason: "Hook return shape is callable API output owned by the hook contract.",
      },
    },
  }
}

function suggestionChipPropsContract(): ContractIR {
  return {
    kind: "type",
    name: "SuggestionChipProps",
    fields: [{
      name: "label",
      typeExpr: "string",
      valueDomain: { kind: "literal_union", values: ["新增", "编辑"] },
    }],
  }
}

function collectorWithImportingBootstrap(): ArchitectCollector {
  const collector = collectorWithExportOnlyBootstrap()
  collector.goals[0] = {
    ...collector.goals[0],
    imports: ["Order"],
  }
  return collector
}

function collectorWithCrossBoundaryGoals(): ArchitectCollector {
  const heuristicSpec: AcceptanceSpec = {
    id: "acc-heuristic",
    source_requirement_id: "REQ-1",
    goal_id: "goal_producer",
    title: "Heuristic only",
    severity: "essential",
    scorers: [{
      type: "heuristic",
      name: "test",
      spec: { kind: "shell", cmd: "bun test" },
    }],
  }
  return {
    goals: [
      {
        id: "goal_producer",
        title: "Produce status",
        objective: "Produce status",
        acceptance_specs: [heuristicSpec],
        owned_paths: [],
        depends_on: [],
        exports: ["Order"],
        imports: [],
        priority: "blocking",
        kind: "feature",
        requirement_ids: [],
      },
      {
        id: "goal_consumer",
        title: "Consume status",
        objective: "Consume status",
        acceptance_specs: [{ ...heuristicSpec, id: "acc-consumer", goal_id: "goal_consumer" }],
        owned_paths: [],
        depends_on: ["goal_producer"],
        exports: [],
        imports: ["Order"],
        priority: "blocking",
        kind: "feature",
        requirement_ids: [],
      },
    ],
    traceability: [],
    source_coverage: [],
    reference_coverage: [],
    assembly_owners: [],
    contracts: [{ ir: orderContract(), goalIDs: ["goal_producer", "goal_consumer"] }],
    removed_goal_ids: [],
    summary: "",
    finalized: false,
  }
}
