import { describe, expect, test } from "bun:test"
import { architectValidationIssues, type ArchitectCollector } from "@/architect/output-tools"

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
      kind: g.kind ?? "feature",
    })),
    traceability: [],
    source_coverage: [],
    reference_coverage: [],
    assembly_owners: [],
    contracts: [],
    removed_goal_ids: [],
    summary: "",
    finalized: false,
  }
}

describe("architectValidationIssues — owned_paths are collaboration responsibilities", () => {
  test("two goals may share a responsibility path when integration requires coordination", () => {
    const collector = buildCollector([
      { id: "goal_bootstrap", owned_paths: ["src/App.tsx", "src/main.tsx", "package.json"], kind: "bootstrap" },
      { id: "goal_pages", owned_paths: ["src/App.tsx", "src/pages/Home.tsx"] },
    ])
    const issues = architectValidationIssues(collector, { workDir: process.cwd() })
    expect(issues.filter((i) => i.startsWith("Owned path"))).toEqual([])
  })

  test("path normalization no longer creates a hard overlap rejection", () => {
    const collector = buildCollector([
      { id: "goal_a", owned_paths: ["./src/App.tsx"] },
      { id: "goal_b", owned_paths: ["src\\App.tsx"] },
    ])
    const issues = architectValidationIssues(collector, { workDir: process.cwd() })
    expect(issues.find((i) => i.startsWith("Owned path"))).toBeUndefined()
  })
})
