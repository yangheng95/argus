import { describe, expect, test } from "bun:test"
import { architectValidationFindings, type ArchitectCollector } from "@/architect/output-tools"
import { emptyArchitectContractGraph } from "@/architect/contract-graph"

const baseGoal = {
  acceptance_specs: [],
  depends_on: [] as string[],
  exports: [] as string[],
  imports: [] as string[],
  priority: "blocking" as const,
  requirement_ids: [] as string[],
}

function buildCollector(
  goals: Array<{
    id: string
    owned_paths: string[]
    depends_on?: string[]
    kind?: "bootstrap" | "feature" | "verification" | "integration" | "system"
  }>,
): ArchitectCollector {
  return {
    goals: goals.map((g) => ({
      ...baseGoal,
      id: g.id,
      title: g.id,
      objective: `${g.id} objective text long enough to satisfy schema validation min length`,
      owned_paths: g.owned_paths,
      depends_on: g.depends_on ?? [],
      kind: g.kind ?? "feature",
    })),
    traceability: [],
    source_coverage: [],
    reference_coverage: [],
    assembly_owners: [],
    contract_graph: emptyArchitectContractGraph(),
    validation_findings: [],
    removed_goal_ids: [],
    summary: "",
    decomposition_analysis: "",
    fact_check_items: [],
    finalized: false,
  }
}

describe("architectValidationIssues — owned_paths are collaboration responsibilities", () => {
  test("two goals may share a responsibility path when integration requires coordination", () => {
    const collector = buildCollector([
      { id: "goal_bootstrap", owned_paths: ["src/App.tsx", "src/main.tsx", "package.json"], kind: "bootstrap" },
      { id: "goal_pages", owned_paths: ["src/App.tsx", "src/pages/Home.tsx"], depends_on: ["goal_bootstrap"] },
    ])
    const findings = architectValidationFindings(collector, { workDir: process.cwd() })
    expect(findings.find((finding) => finding.code === "owned_paths_overlap_without_dependency")).toBeUndefined()
  })

  test("path normalization detects hard overlap without dependency", () => {
    const collector = buildCollector([
      { id: "goal_a", owned_paths: ["./src/App.tsx"] },
      { id: "goal_b", owned_paths: ["src\\App.tsx"] },
    ])
    const findings = architectValidationFindings(collector, { workDir: process.cwd() })
    expect(findings).toContainEqual(
      expect.objectContaining({
        code: "owned_paths_overlap_without_dependency",
        severity: "blocker",
      }),
    )
  })
})
