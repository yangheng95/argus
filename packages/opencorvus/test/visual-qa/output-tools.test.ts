import { describe, expect, test } from "bun:test"
import { createVisualQaOutputTools } from "../../src/visual-qa/output-tools"
import type { VisualQaReport } from "../../src/visual-qa/schema"

function callTool(tools: Record<string, any>, name: string, input: unknown): Promise<string> {
  return tools[name].execute!(input as any, {} as any)
}

function validReport(overrides: Partial<VisualQaReport> = {}): VisualQaReport {
  return {
    accepted: true,
    summary: "Desktop and mobile UI surfaces passed visual QA.",
    coverage: [
      {
        region: "home/table",
        viewports: [{ width: 1440, height: 900 }],
        states: ["default", "narrow"],
        source_refs: ["decision_log:frontend_design/visual_consistency_contract"],
        evidence_refs: ["artifacts/desktop.png"],
        notes: "Checked table density and responsive layout.",
      },
    ],
    findings: [],
    repairs: [],
    evidence: [
      {
        type: "screenshot",
        ref: "artifacts/desktop.png",
        viewport: { width: 1440, height: 900 },
        state: "default",
        note: "Fresh screenshot from the real preview.",
      },
    ],
    commands: [
      {
        command: "node node_modules/playwright/cli.js test visual.spec.ts",
        cwd: ".",
        passed: true,
        detail: "Visual smoke passed.",
      },
    ],
    changed_files: [],
    open_questions: [],
    fact_check_items: [],
    ...overrides,
  }
}

describe("visual-qa output tools", () => {
  test("accepted report requires fresh evidence and coverage", async () => {
    const kit = createVisualQaOutputTools()
    const blocked = await callTool(kit.tools, "submit_visual_qa_report", validReport({ evidence: [], coverage: [] }))
    expect(blocked).toContain("BLOCKERS")
    expect(blocked).toContain("fresh visual and functional evidence")
    expect(blocked).toContain("coverage item")
    expect(kit.getCollector().final).toBeUndefined()
  })

  test("accepted report cannot leave open critical or major findings", async () => {
    const kit = createVisualQaOutputTools()
    const blocked = await callTool(
      kit.tools,
      "submit_visual_qa_report",
      validReport({
        findings: [
          {
            id: "finding_overlap",
            severity: "major",
            status: "open",
            claim: "Header overlaps the table on mobile.",
            reproduction: "Open / at 390x844 and scroll to the table.",
            region: "mobile/header",
            source_refs: ["REQ-1"],
            evidence_refs: ["artifacts/mobile-overlap.png"],
            repair_refs: [],
          },
        ],
      }),
    )
    expect(blocked).toContain("open critical/major findings")
    expect(kit.getCollector().final).toBeUndefined()
  })

  test("failed report may submit actionable findings without pretending acceptance", async () => {
    const kit = createVisualQaOutputTools()
    const result = await callTool(
      kit.tools,
      "submit_visual_qa_report",
      validReport({
        accepted: false,
        coverage: [],
        evidence: [],
        findings: [
          {
            id: "finding_blank",
            severity: "critical",
            status: "open",
            claim: "Preview rendered a blank page.",
            reproduction: "Start preview and open the reported app URL.",
            region: "root",
            source_refs: [],
            evidence_refs: [],
            repair_refs: [],
          },
        ],
      }),
    )
    expect(result).toContain("PASS")
    expect(kit.getCollector().final?.accepted).toBe(false)
    expect(kit.buildReport().detail).toContain("finding_blank")
  })
})
