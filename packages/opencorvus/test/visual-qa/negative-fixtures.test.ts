import { describe, expect, test } from "bun:test"
import path from "node:path"
import { createVisualQaOutputTools } from "../../src/visual-qa/output-tools"
import type { VisualQaReport } from "../../src/visual-qa/schema"

const fixtureRoot = path.join(import.meta.dir, "fixtures", "negative-product-grade")
const manifestPath = path.join(fixtureRoot, "manifest.json")
const NEGATIVE_CHECK_ID = "check_negative_product_grade_fixture"

interface NegativeFixtureManifest {
  description: string
  cases: Array<{
    id: string
    image: string
    expected_verdict: "fail"
    blocker: {
      id: string
      principle_ids: VisualQaReport["production_blockers"][number]["principle_ids"]
      region: string
      reason: string
      impact: string
      required_correction: string
    }
  }>
}

async function readManifest(): Promise<NegativeFixtureManifest> {
  return (await Bun.file(manifestPath).json()) as NegativeFixtureManifest
}

function reportForFixture(item: NegativeFixtureManifest["cases"][number], accepted: boolean): VisualQaReport {
  const imageRef = path.join(fixtureRoot, item.image).replaceAll("\\", "/")
  return {
    accepted,
    summary: `${item.id} is a negative product-grade calibration fixture.`,
    check_items: [
      {
        id: NEGATIVE_CHECK_ID,
        category: item.blocker.principle_ids[0] ?? "component-truth",
        question: `Does ${item.blocker.region} satisfy the product-grade visual contract?`,
        region: item.blocker.region,
        status: "failed",
        expected: item.blocker.required_correction,
        observed: item.blocker.reason,
        viewports: [{ width: 1366, height: 768 }],
        states: ["default"],
        source_refs: ["fixture:negative-product-grade"],
        evidence_refs: [imageRef],
        required_correction: item.blocker.required_correction,
      },
    ],
    coverage: [
      {
        check_ids: [NEGATIVE_CHECK_ID],
        region: item.blocker.region,
        viewports: [{ width: 1366, height: 768 }],
        states: ["default"],
        source_refs: ["fixture:negative-product-grade"],
        evidence_refs: [imageRef],
        notes: "Checked the captured first viewport fixture.",
      },
    ],
    findings: [],
    production_blockers: [
      {
        ...item.blocker,
        check_ids: [NEGATIVE_CHECK_ID],
        source_refs: ["fixture:negative-product-grade"],
        evidence_refs: [imageRef],
      },
    ],
    unresolved_code_module_problems: [],
    problem_dom_regions: [],
    repairs: [],
    evidence: [
      {
        check_ids: [NEGATIVE_CHECK_ID],
        type: "screenshot",
        ref: imageRef,
        viewport: { width: 1366, height: 768 },
        state: "default",
        note: "Negative product-grade fixture screenshot.",
      },
    ],
    reference_parity: {
      required: false,
      required_regions: [],
      reference_comparison_evidence_refs: [],
      missing_regions: [],
      blocker_ids: [],
    },
    commands: [],
    changed_files: [],
    open_questions: [],
    fact_check_items: [],
  }
}

async function callSubmit(report: VisualQaReport): Promise<string> {
  const kit = createVisualQaOutputTools()
  for (const item of report.check_items) {
    await kit.tools.register_visual_qa_check_item.execute!(item as never, {} as never)
  }
  for (const row of report.coverage) {
    await kit.tools.register_visual_qa_coverage.execute!(row as never, {} as never)
  }
  for (const row of report.production_blockers) {
    await kit.tools.register_visual_qa_production_blocker.execute!(row as never, {} as never)
  }
  for (const row of report.evidence) {
    await kit.tools.register_visual_qa_evidence.execute!(row as never, {} as never)
  }
  return (await kit.tools.submit_visual_qa_report.execute!(
    { accepted: report.accepted, summary: report.summary } as never,
    {} as never,
  )) as string
}

describe("visual-qa negative product-grade fixtures", () => {
  test("calibration screenshots are stored as test fixtures only", async () => {
    const manifest = await readManifest()

    expect(manifest.description).toContain("not prompt examples")
    expect(manifest.cases.map((item) => item.image).sort()).toEqual([
      "clipped-primary-navigation.png",
      "low-fidelity-map-surface.png",
    ])
    for (const item of manifest.cases) {
      expect(item.expected_verdict).toBe("fail")
      expect(await Bun.file(path.join(fixtureRoot, item.image)).exists()).toBe(true)
      expect(item.blocker.principle_ids.length).toBeGreaterThan(0)
      expect(item.blocker.required_correction).toMatch(/Replace|Rebuild|rebuild|replace/)
    }
  })

  test("negative fixtures submitted as accepted reports are recorded with blocker feedback", async () => {
    const manifest = await readManifest()

    for (const item of manifest.cases) {
      const result = await callSubmit(reportForFixture(item, true))
      expect(result, item.id).toContain("RECORDED")
      expect(result, item.id).toContain("effective_accepted=false")
      expect(result, item.id).toContain("BLOCKERS")
      expect(result, item.id).toContain("accepted=true was submitted with production blockers")
      expect(result, item.id).toContain(item.blocker.id)
    }
  })

  test("negative fixtures calibrate failed reports with actionable production blockers", async () => {
    const manifest = await readManifest()

    for (const item of manifest.cases) {
      const result = await callSubmit(reportForFixture(item, false))
      expect(result, item.id).toContain("RECORDED")
      expect(result, item.id).toContain("accepted=false")
    }
  })
})
