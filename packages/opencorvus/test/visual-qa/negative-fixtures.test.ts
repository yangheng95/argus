import { describe, expect, test } from "bun:test"
import path from "node:path"
import { createVisualQaOutputTools } from "../../src/visual-qa/output-tools"
import type { VisualQaReport } from "../../src/visual-qa/schema"

const fixtureRoot = path.join(import.meta.dir, "fixtures", "negative-product-grade")
const manifestPath = path.join(fixtureRoot, "manifest.json")

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

function reportForFixture(
  item: NegativeFixtureManifest["cases"][number],
  accepted: boolean,
): VisualQaReport {
  const imageRef = path.join(fixtureRoot, item.image).replaceAll("\\", "/")
  return {
    accepted,
    summary: `${item.id} is a negative product-grade calibration fixture.`,
    coverage: [
      {
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
        source_refs: ["fixture:negative-product-grade"],
        evidence_refs: [imageRef],
      },
    ],
    follow_up_task: null,
    repairs: [],
    evidence: [
      {
        type: "screenshot",
        ref: imageRef,
        viewport: { width: 1366, height: 768 },
        state: "default",
        note: "Negative product-grade fixture screenshot.",
      },
    ],
    commands: [],
    changed_files: [],
    open_questions: [],
    fact_check_items: [],
  }
}

async function callSubmit(report: VisualQaReport): Promise<string> {
  const kit = createVisualQaOutputTools()
  return (await kit.tools.submit_visual_qa_report.execute!(report as never, {} as never)) as string
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

  test("negative fixtures cannot be submitted as accepted visual QA reports", async () => {
    const manifest = await readManifest()

    for (const item of manifest.cases) {
      const result = await callSubmit(reportForFixture(item, true))
      expect(result, item.id).toContain("BLOCKERS")
      expect(result, item.id).toContain("accepted=true is incompatible with production blockers")
      expect(result, item.id).toContain(item.blocker.id)
    }
  })

  test("negative fixtures calibrate failed reports with actionable production blockers", async () => {
    const manifest = await readManifest()

    for (const item of manifest.cases) {
      const result = await callSubmit(reportForFixture(item, false))
      expect(result, item.id).toContain("PASS")
      expect(result, item.id).toContain("accepted=false")
    }
  })
})
