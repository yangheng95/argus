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
    production_blockers: [],
    follow_up_task: null,
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

  test("accepted report cannot include production blockers", async () => {
    const kit = createVisualQaOutputTools()
    const blocked = await callTool(
      kit.tools,
      "submit_visual_qa_report",
      validReport({
        production_blockers: [
          {
            id: "blocker_map_fidelity",
            principle_ids: ["component-truth"],
            region: "world economy map",
            reason: "The map is a low-fidelity placeholder instead of the required choropleth surface.",
            impact: "Users would see a product surface that misrepresents the reference implementation.",
            required_correction: "Replace the simplified map with the source-backed topology implementation.",
            source_refs: ["frontend_design:reference_artifacts"],
            evidence_refs: ["artifacts/map.png"],
          },
        ],
      }),
    )
    expect(blocked).toContain("production blockers")
    expect(blocked).toContain("blocker_map_fidelity")
    expect(kit.getCollector().final).toBeUndefined()
  })

  test("accepted report cannot include follow-up task requests", async () => {
    const kit = createVisualQaOutputTools()
    const blocked = await callTool(
      kit.tools,
      "submit_visual_qa_report",
      validReport({
        production_blockers: [
          {
            id: "blocker_unfinished_surface",
            principle_ids: ["production-completeness"],
            region: "dashboard",
            reason: "The primary surface still reads as an unfinished draft.",
            impact: "Users would not receive a production-grade product surface.",
            required_correction: "Complete the primary dashboard regions and verify fresh screenshots.",
            source_refs: ["REQ-1"],
            evidence_refs: ["artifacts/dashboard.png"],
          },
        ],
        follow_up_task: {
          title: "Complete production dashboard surface",
          request: "Continue from the current task evidence and complete the dashboard production blockers.",
          reason: "Visual QA found blockers that require a new implementation round.",
          priority: "high",
          blocker_ids: ["blocker_unfinished_surface"],
        },
      }),
    )
    expect(blocked).toContain("accepted=true is incompatible with follow_up_task")
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

  test("failed report must explain blockers or open critical and major findings", async () => {
    const kit = createVisualQaOutputTools()
    const blocked = await callTool(
      kit.tools,
      "submit_visual_qa_report",
      validReport({
        accepted: false,
        findings: [],
        production_blockers: [],
      }),
    )
    expect(blocked).toContain("accepted=false requires production_blockers")
    expect(kit.getCollector().final).toBeUndefined()
  })

  test("follow-up task request must reference submitted production blockers", async () => {
    const kit = createVisualQaOutputTools()
    const blocked = await callTool(
      kit.tools,
      "submit_visual_qa_report",
      validReport({
        accepted: false,
        production_blockers: [
          {
            id: "blocker_known",
            principle_ids: ["component-truth"],
            region: "chart",
            reason: "The chart component family is not truthful to the product requirement.",
            impact: "The page communicates the wrong data product.",
            required_correction: "Replace the placeholder with the real chart implementation.",
            source_refs: ["REQ-2"],
            evidence_refs: ["artifacts/chart.png"],
          },
        ],
        follow_up_task: {
          title: "Replace placeholder chart implementation",
          request: "Use the visual QA evidence to replace the placeholder chart with a real data-bound chart.",
          reason: "Visual QA cannot safely complete the chart implementation in this review pass.",
          priority: "high",
          blocker_ids: ["blocker_unknown"],
        },
      }),
    )
    expect(blocked).toContain("follow_up_task.blocker_ids references unknown production blockers")
    expect(blocked).toContain("blocker_unknown")
    expect(kit.getCollector().final).toBeUndefined()
  })

  test("failed report renders production blockers in the terminal report", async () => {
    const kit = createVisualQaOutputTools()
    const result = await callTool(
      kit.tools,
      "submit_visual_qa_report",
      validReport({
        accepted: false,
        production_blockers: [
          {
            id: "blocker_density",
            principle_ids: ["reference-structure", "visual-hierarchy-readability"],
            region: "hero",
            reason: "The visual hierarchy no longer matches the authoritative reference.",
            impact: "The first viewport reads as a different product surface.",
            required_correction: "Restore the reference heading scale, spacing, and section order.",
            source_refs: ["reference.png"],
            evidence_refs: ["artifacts/hero.png"],
          },
        ],
        follow_up_task: {
          title: "Restore reference hero hierarchy",
          request: "Continue from visual QA evidence and restore the reference hero hierarchy before final acceptance.",
          reason: "Visual QA cannot safely complete the reference-structure repair in the current review pass.",
          priority: "high",
          blocker_ids: ["blocker_density"],
        },
      }),
    )
    expect(result).toContain("PASS")
    expect(kit.getCollector().final?.accepted).toBe(false)
    expect(kit.buildReport().detail).toContain("## Production Blockers")
    expect(kit.buildReport().detail).toContain("blocker_density")
    expect(kit.buildReport().detail).toContain("reference-structure")
    expect(kit.buildReport().detail).toContain("## Follow-up Task")
    expect(kit.buildReport().detail).toContain("Restore reference hero hierarchy")
    expect(kit.buildReport().detail).toContain("blockers=blocker_density")
  })
})
