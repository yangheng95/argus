import { describe, expect, test } from "bun:test"
import { buildUserPrompt } from "../../src/build/agent"
import type { WorkloadBrief } from "../../src/goal-workload-analyst/types"

const goalTarget = {
  kind: "goal" as const,
  id: "gol_abc",
  title: "Visual shell",
  objective: "Build the chart workspace shell",
  acceptance_specs: ["renders at 1440x900"],
  owned_paths: ["src/shell"],
  depends_on: [],
}

const brief: WorkloadBrief = {
  goal_id: "gol_abc",
  decomposition_concern: "owns assembly of 5 sibling surfaces",
  why_not_smaller: ["touches 5 render surfaces, not one Header component"],
  underestimation_traps: ["chart region includes grid + price axis + overlay"],
  execution_inventory: { surfaces: 5, states: 3, data_contracts: 2, verification_points: 4 },
  verification_inventory: ["screenshot 1440x900 and compare regions"],
  references: {
    contract_ids: ["ct_chart"],
    reference_coverage_ids: ["rc_hero"],
    acceptance_spec_ids: [],
    visual_spec_ids: [],
    prd_sections: ["Chart workspace"],
  },
}

describe("build prompt — goal workload brief injection", () => {
  test("renders the workload brief before broad upstream context and the goal contract", () => {
    const prompt = buildUserPrompt(goalTarget as any, {
      workloadBrief: brief,
      requirements: [
        {
          id: "REQ-1",
          type: "functional",
          description: "Recreate the chart workspace shell.",
          acceptance: "Workspace visually matches the reference.",
          non_goals: "",
        },
      ],
      collaborationGoals: [
        {
          ...goalTarget,
          status: "pending",
          kind: "feature",
        },
        {
          kind: "feature",
          id: "gol_sidebar",
          title: "Right sidebar",
          objective: "Build the watchlist sidebar.",
          acceptance_specs: ["sidebar renders"],
          owned_paths: ["src/sidebar"],
          depends_on: [],
          status: "pending",
        },
      ],
    } as any)
    expect(prompt).toContain("Goal Workload Brief")
    expect(prompt.match(/Goal Workload Brief/g)?.length).toBe(1)
    expect(prompt).toContain("touches 5 render surfaces") // why_not_smaller
    // index/lens: surfaces/contracts cited by id, not restated as prose (rule 8)
    expect(prompt).toContain("ct_chart")
    expect(prompt).toContain("rc_hero")
    // The brief frames everything else so broad specs and sibling summaries do
    // not bury the work sizing signal.
    const workloadIndex = prompt.indexOf("Goal Workload Brief")
    expect(workloadIndex).toBeLessThan(prompt.indexOf("## Requirements"))
    expect(workloadIndex).toBeLessThan(prompt.indexOf("## Collaboration State"))
    expect(workloadIndex).toBeLessThan(prompt.indexOf("# Goal: Visual shell"))
  })

  test("omits the section entirely when no workload brief is present (no stale/empty render)", () => {
    const prompt = buildUserPrompt(goalTarget as any, {} as any)
    expect(prompt).not.toContain("Goal Workload Brief")
    // the goal contract still renders
    expect(prompt).toContain("# Goal: Visual shell")
  })
})
