import { describe, expect, test } from "bun:test"
import { createRequirementsOutputTools } from "../../src/requirements/output-tools"

function callTool(tools: Record<string, any>, name: string, input: unknown): Promise<string> {
  return tools[name].execute!(input as any, {} as any)
}

describe("requirements evidence refs", () => {
  test("register_requirement preserves research evidence refs structurally", async () => {
    const kit = createRequirementsOutputTools({ allowedResearchEvidenceIDs: ["ev_1", "ev_2"] })
    await callTool(kit.tools, "register_requirement", {
      id: "REQ-1",
      type: "explicit",
      description: "Generate an evidence-backed PRD input.",
      acceptance: "The PRD input includes cited external facts.",
      non_goals: "It does not publish the final document directly.",
      evidence_refs: ["ev_1", "ev_2"],
    })

    for (const [key, value] of [
      ["runtime", "node"],
      ["framework", "existing project"],
      ["test_framework", "bun:test"],
      ["affected_modules", "requirements"],
      ["affected_concepts", "research evidence"],
      ["impact_size", "medium"],
    ] as const) {
      await callTool(kit.tools, "register_decision", {
        key,
        value,
        reason: "test setup",
      })
    }

    const submit = await callTool(kit.tools, "submit_requirements", { final: true, fact_check_items: [] })
    expect(submit).toContain("PASS")
    expect(kit.getCollector().requirements[0].evidence_refs).toEqual(["ev_1", "ev_2"])
  })

  test("register_requirement rejects unknown research evidence refs", async () => {
    const kit = createRequirementsOutputTools({ allowedResearchEvidenceIDs: ["ev_1"] })
    const result = await callTool(kit.tools, "register_requirement", {
      id: "REQ-1",
      type: "explicit",
      description: "Generate an evidence-backed PRD input.",
      acceptance: "The PRD input includes cited external facts.",
      non_goals: "It does not publish the final document directly.",
      evidence_refs: ["ev_missing"],
    })

    expect(result).toContain("unknown research evidence")
    expect(kit.getCollector().requirements).toEqual([])
  })
})
