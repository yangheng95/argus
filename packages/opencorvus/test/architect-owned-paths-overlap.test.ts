import { describe, expect, test } from "bun:test"
import { architectValidationIssues, type ArchitectCollector } from "@/architect/output-tools"

// Phase A3 — owned_paths overlap detection.
//
// pipeline/goal-contract.schema.ts: owned_paths is described as "Files this
// goal has EXCLUSIVE write access to." Pre-fix, architectValidationIssues
// did not check this exclusivity across goals. Bench gemini reproducer:
// goal_bootstrap and goal_pages both registered src/App.tsx + src/main.tsx.
// The plan finalised, then dispatch hit a fidelity wall once goal_bootstrap
// merged its scaffold to the project root.
//
// Post-fix: any path claimed by ≥2 goals becomes a finalize-blocking issue.

const baseGoal = {
  acceptance_specs: [],
  depends_on: [] as string[],
  exports: [] as string[],
  imports: [] as string[],
  priority: "blocking" as const,
  requirement_ids: [] as string[],
}

function buildCollector(
  goals: Array<{ id: string; owned_paths: string[]; kind?: "bootstrap" | "feature" | "verification" | "integration" | "system" }>,
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
    goal_metric_specs: [],
    global_metric_specs: [],
    challenge_seeds: [],
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

describe("architectValidationIssues — owned_paths overlap", () => {
  test("two goals owning the same file is reported", () => {
    const collector = buildCollector([
      { id: "goal_bootstrap", owned_paths: ["src/App.tsx", "src/main.tsx", "package.json"], kind: "bootstrap" },
      { id: "goal_pages", owned_paths: ["src/App.tsx", "src/main.tsx", "src/pages/Home.tsx"] },
    ])
    const issues = architectValidationIssues(collector)
    const overlapIssues = issues.filter((i) => i.startsWith("Owned path"))
    expect(overlapIssues.length).toBeGreaterThanOrEqual(2)
    expect(overlapIssues.some((i) => i.includes("src/App.tsx"))).toBe(true)
    expect(overlapIssues.some((i) => i.includes("src/main.tsx"))).toBe(true)
    expect(overlapIssues.some((i) => i.includes("goal_bootstrap"))).toBe(true)
    expect(overlapIssues.some((i) => i.includes("goal_pages"))).toBe(true)
  })

  test("disjoint owned_paths produce no overlap issue", () => {
    const collector = buildCollector([
      { id: "goal_a", owned_paths: ["src/lib/a.ts"] },
      { id: "goal_b", owned_paths: ["src/lib/b.ts"] },
    ])
    const issues = architectValidationIssues(collector)
    expect(issues.filter((i) => i.startsWith("Owned path"))).toEqual([])
  })

  test("path normalisation: ./src/App.tsx and src\\App.tsx collide", () => {
    const collector = buildCollector([
      { id: "goal_a", owned_paths: ["./src/App.tsx"] },
      { id: "goal_b", owned_paths: ["src\\App.tsx"] },
    ])
    const issues = architectValidationIssues(collector)
    const overlap = issues.find((i) => i.startsWith("Owned path"))
    expect(overlap).toBeDefined()
    expect(overlap).toContain("src/App.tsx")
  })

  test("three-way overlap lists all owners deduped and sorted", () => {
    const collector = buildCollector([
      { id: "goal_c", owned_paths: ["shared.ts"] },
      { id: "goal_a", owned_paths: ["shared.ts"] },
      { id: "goal_b", owned_paths: ["shared.ts"] },
    ])
    const issues = architectValidationIssues(collector)
    const overlap = issues.find((i) => i.startsWith("Owned path"))
    expect(overlap).toBeDefined()
    expect(overlap).toContain("3 goals")
    // Sorted asc.
    expect(overlap).toContain("goal_a, goal_b, goal_c")
  })
})
