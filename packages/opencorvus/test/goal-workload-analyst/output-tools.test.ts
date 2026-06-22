import { describe, expect, test } from "bun:test"
import { createGoalWorkloadOutputTools } from "../../src/goal-workload-analyst/output-tools"
import type { WorkloadBrief } from "../../src/goal-workload-analyst/types"

function callTool(tools: Record<string, any>, name: string, input: unknown): Promise<string> {
  return tools[name].execute!(input as any, {} as any)
}

function validBrief(goal_id: string, overrides: Partial<WorkloadBrief> = {}): WorkloadBrief {
  return {
    goal_id,
    why_not_smaller: ["touches 5 render surfaces, not a single component"],
    underestimation_traps: ["chart region includes grid + price axis + overlay"],
    execution_inventory: { surfaces: 5, states: 3, data_contracts: 2, verification_points: 4 },
    verification_inventory: ["render at 1440x900 and compare key regions"],
    references: {
      contract_ids: [],
      reference_coverage_ids: [],
      acceptance_spec_ids: [],
      visual_spec_ids: [],
      prd_sections: [],
    },
    ...overrides,
  }
}

describe("goal-workload-analyst output tools", () => {
  test("register_workload_brief rejects an unknown goal id (rule 6.1 data integrity)", async () => {
    const kit = createGoalWorkloadOutputTools({ knownGoalIDs: ["gol_a"] })
    const result = await callTool(kit.tools, "register_workload_brief", validBrief("gol_unknown"))
    expect(result).toContain("not a registered architect goal")
    expect(kit.getCollector().briefs).toHaveLength(0)
  })

  test("register_workload_brief accepts a known goal and warns on an unknown contract id", async () => {
    const kit = createGoalWorkloadOutputTools({ knownGoalIDs: ["gol_a"], knownContractIDs: ["ct_real"] })
    const ok = await callTool(
      kit.tools,
      "register_workload_brief",
      validBrief("gol_a", {
        references: {
          contract_ids: ["ct_real", "ct_ghost"],
          reference_coverage_ids: [],
          acceptance_spec_ids: [],
          visual_spec_ids: [],
          prd_sections: [],
        },
      }),
    )
    expect(ok).toContain("OK")
    expect(ok).toContain("ct_ghost") // warning names the unknown contract id
    expect(kit.getCollector().briefs).toHaveLength(1)
  })

  test("re-registering the same goal id overwrites in place", async () => {
    const kit = createGoalWorkloadOutputTools({ knownGoalIDs: ["gol_a"] })
    await callTool(kit.tools, "register_workload_brief", validBrief("gol_a"))
    await callTool(kit.tools, "register_workload_brief", validBrief("gol_a", { why_not_smaller: ["updated reason"] }))
    expect(kit.getCollector().briefs).toHaveLength(1)
    expect(kit.getCollector().briefs[0].why_not_smaller).toEqual(["updated reason"])
  })

  test("submit blocks with no briefs and passes once a brief exists, reporting flagged goals", async () => {
    const kit = createGoalWorkloadOutputTools({ knownGoalIDs: ["gol_a"] })
    expect(kit.isReadyToFinalize()).toBe(false)

    const blocked = await callTool(kit.tools, "submit_workload_analysis", { summary: "nothing analyzed yet" })
    expect(blocked).toContain("BLOCKERS")
    expect(kit.getCollector().finalized).toBe(false)

    await callTool(
      kit.tools,
      "register_workload_brief",
      validBrief("gol_a", { decomposition_concern: "owns assembly of 5 sibling surfaces; should be split" }),
    )
    expect(kit.isReadyToFinalize()).toBe(true)

    const passed = await callTool(kit.tools, "submit_workload_analysis", { summary: "1 goal, 1 flagged" })
    expect(passed).toContain("PASS")
    expect(passed).toContain("gol_a") // flagged goal surfaced for architect re-sizing
    expect(kit.getCollector().finalized).toBe(true)
  })

  test("submit blocks until every known architect goal has a workload brief", async () => {
    const kit = createGoalWorkloadOutputTools({ knownGoalIDs: ["gol_a", "gol_b"] })
    await callTool(kit.tools, "register_workload_brief", validBrief("gol_a"))

    expect(kit.isReadyToFinalize()).toBe(false)
    const blocked = await callTool(kit.tools, "submit_workload_analysis", { summary: "only one goal analyzed" })

    expect(blocked).toContain("BLOCKERS")
    expect(blocked).toContain("gol_b")
    expect(kit.getCollector().finalized).toBe(false)

    await callTool(kit.tools, "register_workload_brief", validBrief("gol_b"))
    expect(kit.isReadyToFinalize()).toBe(true)

    const passed = await callTool(kit.tools, "submit_workload_analysis", { summary: "2 goals, none flagged" })
    expect(passed).toContain("PASS")
    expect(passed).not.toContain("without a brief")
    expect(kit.getCollector().finalized).toBe(true)
  })

  test("buildReport fails before terminal submit instead of synthesizing a summary", async () => {
    const kit = createGoalWorkloadOutputTools({ knownGoalIDs: ["gol_a"] })
    await callTool(kit.tools, "register_workload_brief", validBrief("gol_a"))

    expect(() => kit.buildReport()).toThrow("requires submit_workload_analysis")
  })
})
