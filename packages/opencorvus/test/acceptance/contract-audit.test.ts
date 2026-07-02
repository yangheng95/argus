import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { contractAuditBlocksBuild, runContractAudit } from "@/acceptance/contract-audit"
import type { AcceptanceSpec, ContractAuditScorer } from "@/acceptance/types"
import type { ContractIR } from "@/architect/contract-ir"
import { contractGraphIRIndex, type ArchitectContractGraph } from "@/architect/contract-graph"
import { buildContractAuditReviewEvidence } from "@/acceptance/checks/contract-audit-review"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

describe("contract_audit graph scorer", () => {
  test("audits closed literal domains by graph contract id without goal imports or exports", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": 'interface Order { status: string }\nexport const row: Order = { status: "archived" }\n',
    })

    const graph = orderGraph()
    const result = runContractAudit({
      workDir,
      index: contractGraphIRIndex(graph),
      goal: { id: "goal_ui", owned_paths: ["src"] },
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("failed")
    expect(result.evidence).toContain("src/status.ts:2")
    expect(result.evidence).toContain("field=Order.status")
    expect(result.evidence).toContain('literal="archived"')
    expect(result.evidence).toContain('expected="new"|"paid"')
  })

  test("passes when graph contract literals are respected", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": 'interface Order { status: string }\nexport const row: Order = { status: "paid" }\n',
    })

    const result = runContractAudit({
      workDir,
      index: contractGraphIRIndex(orderGraph()),
      goal: { id: "goal_ui", owned_paths: ["src"] },
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("passed")
    expect(result.evidence).toContain("observed_assignments=1")
  })

  test("materializes non-IR graph contract artifact paths and rejects blocker-only scaffold", async () => {
    const workDir = await tempWorkDir({
      "docs/blank-template-blocker.md": "Requested scaffold template was unavailable.\n",
    })
    const graph = scaffoldGraph(["package.json", "index.html", "src/**", "public/**", "docs/blank-template-blocker.md"])

    const result = runContractAudit({
      workDir,
      index: contractGraphIRIndex(graph),
      graph,
      goal: { id: "goal_scaffold", owned_paths: ["package.json", "index.html", "src", "public", "docs"] },
      spec: scaffoldAuditSpec(),
      scorer: scaffoldAuditScorer(),
    })

    expect(result.status).toBe("failed")
    expect(result.evidence).toContain("goal contract artifact materialization failed")
    expect(result.evidence).toContain('artifact_path="package.json"')
    expect(result.evidence).toContain('artifact_path="index.html"')
    expect(result.evidence).toContain('artifact_path="src/**"')
    expect(result.evidence).toContain('artifact_path="public/**"')
  })

  test("passes non-IR graph contract artifact path audit when scaffold exists", async () => {
    const workDir = await tempWorkDir({
      "package.json": '{"scripts":{"build":"vite"}}\n',
      "index.html": '<div id="root"></div>\n',
      "src/main.tsx": "export const mounted = true\n",
      "public/.keep": "",
    })
    const graph = scaffoldGraph(["package.json", "index.html", "src/**", "public/**"])

    const result = runContractAudit({
      workDir,
      index: contractGraphIRIndex(graph),
      graph,
      goal: { id: "goal_scaffold", owned_paths: ["package.json", "index.html", "src", "public"] },
      spec: scaffoldAuditSpec(),
      scorer: scaffoldAuditScorer(),
    })

    expect(result.status).toBe("passed")
    expect(result.evidence).toContain("materialized_contract_artifact_paths=4")
  })

  test("review evidence requires declared graph contract audit criteria", () => {
    const spec = auditSpec()
    const scorer = spec.scorers[0] as ContractAuditScorer
    const name = `acceptance:${spec.id}:${scorer.name}`

    const evidence = buildContractAuditReviewEvidence({
      goals: [
        {
          id: "goal_ui",
          latest_goal_run_id: "goal_run_1",
          acceptance_specs: [spec],
        },
      ],
      criteriaResults: [
        {
          name,
          status: "passed",
          family: "contract_audit",
          goal_id: "goal_ui",
          goal_run_id: "goal_run_1",
        },
      ],
    })

    expect(evidence).toHaveLength(1)
    expect(evidence[0].status).toBe("passed")
  })

  test("only concrete contract audit failures block build finalization", () => {
    expect(contractAuditBlocksBuild("failed")).toBe(true)
    expect(contractAuditBlocksBuild("passed")).toBe(false)
    expect(contractAuditBlocksBuild("skipped")).toBe(false)
    expect(contractAuditBlocksBuild("inconclusive")).toBe(false)
  })
})

function orderGraph(): ArchitectContractGraph {
  return {
    version: 1,
    contracts: [
      {
        id: "contract_order",
        kind: "type",
        name: "Order",
        producer_goal_id: "goal_model",
        consumer_goal_ids: ["goal_ui"],
        summary: "Shared order status values for rendering.",
        ir: orderContract(),
        artifact_paths: [],
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
  }
}

function orderContract(): ContractIR {
  return {
    kind: "type",
    name: "Order",
    fields: [
      {
        name: "status",
        typeExpr: "string",
        valueDomain: { kind: "literal_union", values: ["new", "paid"] },
      },
    ],
  }
}

function auditSpec(): AcceptanceSpec {
  return {
    id: "acc-order-contract",
    source_requirement_id: "REQ-1",
    goal_id: "goal_ui",
    title: "Order graph contract is respected",
    severity: "essential",
    scorers: [auditScorer()],
  }
}

function auditScorer(): ContractAuditScorer {
  return {
    type: "contract_audit",
    name: "order-contract",
    spec: { kind: "contract_graph", contract_ids: ["contract_order"] },
    expect: { status: "passed" },
  }
}

function scaffoldGraph(artifactPaths: string[]): ArchitectContractGraph {
  return {
    version: 1,
    contracts: [
      {
        id: "contract_scaffold_app_root",
        kind: "render_surface",
        name: "Production app root scaffold",
        producer_goal_id: "goal_scaffold",
        consumer_goal_ids: ["goal_ui"],
        summary: "Production app root files consumed by downstream UI goals.",
        artifact_paths: artifactPaths,
      },
    ],
    dependency_contracts: [
      {
        from_goal_id: "goal_scaffold",
        to_goal_id: "goal_ui",
        reason: "contract",
        contract_ids: ["contract_scaffold_app_root"],
      },
    ],
  }
}

function scaffoldAuditSpec(): AcceptanceSpec {
  return {
    id: "acc-scaffold-contract",
    source_requirement_id: "REQ-scaffold",
    goal_id: "goal_scaffold",
    title: "Production scaffold graph contract is materialized",
    severity: "essential",
    scorers: [scaffoldAuditScorer()],
  }
}

function scaffoldAuditScorer(): ContractAuditScorer {
  return {
    type: "contract_audit",
    name: "scaffold-contract",
    spec: { kind: "contract_graph", contract_ids: ["contract_scaffold_app_root"] },
    expect: { status: "passed" },
  }
}

async function tempWorkDir(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencorvus-contract-audit-"))
  tempDirs.push(dir)
  for (const [file, content] of Object.entries(files)) {
    const abs = path.join(dir, file)
    await fs.mkdir(path.dirname(abs), { recursive: true })
    await fs.writeFile(abs, content)
  }
  return dir
}
