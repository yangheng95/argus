import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { runContractAudit } from "@/acceptance/contract-audit"
import type { AcceptanceSpec, ContractAuditScorer } from "@/acceptance/types"
import type { ContractIR } from "@/architect/contract-ir"
import { architectValidationIssues, type ArchitectCollector } from "@/architect/output-tools"

const tempDirs: string[] = []

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await fs.rm(dir, { recursive: true, force: true })
  }
})

describe("contract_audit acceptance scorer", () => {
  test("literal_union reports an invalid field literal with file and line evidence", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": "export const row = { status: \"archived\" }\n",
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("failed")
    expect(result.evidence).toContain("src/status.ts:1")
    expect(result.evidence).toContain("field=status")
    expect(result.evidence).toContain('literal="archived"')
    expect(result.evidence).toContain('expected="new"|"paid"')
  })

  test("literal_union passes when observed field literals are inside the declared domain", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": "export const row = { status: \"paid\" }\n",
    })

    const result = runContractAudit({
      workDir,
      index: new Map([["Order", orderContract()]]),
      goal: boundaryGoal(["Order"]),
      spec: auditSpec(),
      scorer: auditScorer(),
    })

    expect(result.status).toBe("passed")
    expect(result.evidence).toContain("audited_assignments=1")
  })

  test("ref resolves to an enum contract and applies the same literal rule", async () => {
    const workDir = await tempWorkDir({
      "src/status.ts": "const payload = { status: \"archived\" }\n",
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

  test("architect validation rejects cross-boundary goals without essential contract_audit", () => {
    const collector = collectorWithCrossBoundaryGoals()

    const issues = architectValidationIssues(collector, { workDir: process.cwd() }).join("\n")

    expect(issues).toContain("imports/exports require at least one essential on_goal contract_audit")
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
