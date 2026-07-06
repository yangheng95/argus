import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import sharp from "sharp"
import { persistBrowserPreviewEvidence } from "../../src/browser-preview/persist"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { AttachmentStore } from "../../src/storage/attachment-store"
import { createVisualQaOutputTools } from "../../src/visual-qa/output-tools"
import {
  VISUAL_QA_MULTI_VIEWPORT_ALIGNMENT_CATEGORY,
  VisualQaReportSchema,
  type VisualQaReport,
} from "../../src/visual-qa/schema"
import { persistTestBrowserPreviewTarget } from "../fixture/browser-preview"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

const DEFAULT_CHECK_ID = "check_primary_visual_surface"
const DEFAULT_SOURCE_REF = "decision_log:frontend_design/visual_consistency_contract"
const SOURCE_REFERENCE_REF = "frontend_research:art_reference:ev_reference"
const DEFAULT_EVIDENCE_REF = "browser_preview_evidence:art_desktop"
const MOBILE_EVIDENCE_REF = "browser_preview_evidence:art_mobile"
const MAP_EVIDENCE_REF = "browser_preview_evidence:art_map"
const HERO_EVIDENCE_REF = "browser_preview_evidence:art_hero"
const SUPPORTING_VISUAL_DIFF_REF = "frontend_design:side_by_side_png"

function callTool(tools: Record<string, any>, name: string, input: unknown): Promise<string> {
  return tools[name].execute!(input as any, {} as any)
}

function checkItem(
  overrides: Partial<VisualQaReport["check_items"][number]> = {},
): VisualQaReport["check_items"][number] {
  return {
    id: DEFAULT_CHECK_ID,
    category: "component-truth",
    question: "Does the rendered surface match the task-owned visual and functional evidence?",
    region: "home/table",
    status: "passed",
    expected: "The table density, state, and screenshot evidence match the task contract.",
    observed: "Fresh evidence shows the table density, state, and screenshot evidence match the task contract.",
    viewports: [{ width: 1440, height: 900 }],
    states: ["default"],
    source_refs: [DEFAULT_SOURCE_REF],
    evidence_refs: [DEFAULT_EVIDENCE_REF],
    ...overrides,
  }
}

function referenceCheckItem(
  referenceRegionKey: string,
  evidenceRef: string,
  overrides: Partial<VisualQaReport["check_items"][number]> = {},
): VisualQaReport["check_items"][number] {
  return checkItem({
    id: `check_${referenceRegionKey.replace(/[^a-zA-Z0-9]+/g, "_")}`,
    category: "reference-structure",
    question: `Does ${referenceRegionKey} match the authoritative reference region?`,
    region: referenceRegionKey.split("@")[0] || referenceRegionKey,
    reference_region_key: referenceRegionKey,
    expected: "The implementation matches the authoritative reference crop for this region and viewport.",
    observed: "Fresh reference comparison evidence was inspected for this region and viewport.",
    source_refs: [SOURCE_REFERENCE_REF],
    evidence_refs: [evidenceRef],
    ...overrides,
  })
}

function validReport(overrides: Partial<VisualQaReport> = {}): VisualQaReport {
  return {
    accepted: true,
    summary: "Desktop and mobile UI surfaces passed visual QA.",
    check_items: [checkItem()],
    coverage: [
      {
        check_ids: [DEFAULT_CHECK_ID],
        region: "home/table",
        viewports: [{ width: 1440, height: 900 }],
        states: ["default", "narrow"],
        source_refs: [DEFAULT_SOURCE_REF],
        evidence_refs: [DEFAULT_EVIDENCE_REF],
        notes: "Checked table density and responsive layout.",
      },
    ],
    findings: [],
    production_blockers: [],
    unresolved_code_module_problems: [],
    problem_dom_regions: [],
    evidence: [
      {
        check_ids: [DEFAULT_CHECK_ID],
        type: "screenshot",
        ref: DEFAULT_EVIDENCE_REF,
        viewport: { width: 1440, height: 900 },
        state: "default",
        note: "Fresh screenshot from the real preview.",
      },
    ],
    reference_parity: {
      required: false,
      required_regions: [],
      reference_comparison_evidence_refs: [],
      missing_regions: [],
      blocker_ids: [],
    },
    open_questions: [],
    fact_check_items: [],
    ...overrides,
  }
}

test("visual QA report schema rejects legacy self-repair fields", () => {
  const report = validReport()
  expect(VisualQaReportSchema.safeParse({ ...report, repairs: [] }).success).toBe(false)
  expect(VisualQaReportSchema.safeParse({ ...report, changed_files: [] }).success).toBe(false)
  expect(VisualQaReportSchema.safeParse({ ...report, commands: [] }).success).toBe(false)
  expect(
    VisualQaReportSchema.safeParse({
      ...report,
      findings: [
        {
          id: "finding_legacy_repair_ref",
          check_ids: [DEFAULT_CHECK_ID],
          severity: "major",
          status: "open",
          claim: "Legacy repair ref must not be accepted.",
          reproduction: "Submit a finding with repair_refs.",
          region: "main surface",
          evidence_refs: [DEFAULT_EVIDENCE_REF],
          repair_refs: ["src/App.tsx"],
        },
      ],
    }).success,
  ).toBe(false)
})

test("visual QA report schema rejects unknown nested fields", () => {
  const report = validReport()
  expect(
    VisualQaReportSchema.safeParse({
      ...report,
      check_items: [{ ...report.check_items[0]!, extra_nested: true }],
    }).success,
  ).toBe(false)
  expect(
    VisualQaReportSchema.safeParse({
      ...report,
      coverage: [{ ...report.coverage[0]!, extra_nested: true }],
    }).success,
  ).toBe(false)
  expect(
    VisualQaReportSchema.safeParse({
      ...report,
      evidence: [
        {
          ...report.evidence[0]!,
          viewport: { width: 1440, height: 900, unexpected: true },
        },
      ],
    }).success,
  ).toBe(false)
  expect(
    VisualQaReportSchema.safeParse({
      ...report,
      reference_parity: { ...report.reference_parity, unexpected: true },
    }).success,
  ).toBe(false)
  expect(
    VisualQaReportSchema.safeParse({
      ...report,
      unresolved_code_module_problems: [
        {
          id: "ucmp_1",
          check_ids: [DEFAULT_CHECK_ID],
          code_module_reference: {
            entity: "src/App.tsx",
            problem: "Layout overflow remains visible.",
            unexpected: true,
          },
          reason: "The Visual QA blocker maps to this module.",
          blocker_ids: ["blocker_1"],
          evidence_refs: [DEFAULT_EVIDENCE_REF],
        },
      ],
    }).success,
  ).toBe(false)
})

test("visual QA report schema rejects loose reference region keys", () => {
  expect(
    VisualQaReportSchema.safeParse({
      ...validReport(),
      check_items: [referenceCheckItem("main surface", DEFAULT_EVIDENCE_REF)],
    }).success,
  ).toBe(false)
  expect(
    VisualQaReportSchema.safeParse({
      ...validReport(),
      reference_parity: {
        required: true,
        required_regions: ["main surface"],
        reference_comparison_evidence_refs: [],
        missing_regions: [],
        blocker_ids: [],
      },
    }).success,
  ).toBe(false)
})

test("visual QA report schema rejects non-durable evidence refs", () => {
  const report = validReport()
  expect(
    VisualQaReportSchema.safeParse({
      ...report,
      check_items: [checkItem({ evidence_refs: ["artifacts/desktop.png"] })],
    }).success,
  ).toBe(false)
  expect(
    VisualQaReportSchema.safeParse({
      ...report,
      check_items: [checkItem({ source_refs: ["reference.png"] })],
    }).success,
  ).toBe(false)
  expect(
    VisualQaReportSchema.safeParse({
      ...report,
      evidence: [
        {
          check_ids: [DEFAULT_CHECK_ID],
          type: "command",
          ref: "node node_modules/playwright/cli.js test visual.spec.ts",
          note: "Command text is not a portable evidence ref.",
        },
      ],
    }).success,
  ).toBe(false)
  expect(
    VisualQaReportSchema.safeParse({
      ...report,
      evidence: [
        {
          check_ids: [DEFAULT_CHECK_ID],
          type: "screenshot",
          ref: "screenshot://local/top-viewport.png",
          note: "Local screenshot labels are not portable evidence refs.",
        },
      ],
    }).success,
  ).toBe(false)
})

async function submitReport(
  kit: ReturnType<typeof createVisualQaOutputTools>,
  report: VisualQaReport,
): Promise<string> {
  for (const item of report.check_items) await callTool(kit.tools, "register_visual_qa_check_item", item)
  for (const row of report.coverage) await callTool(kit.tools, "register_visual_qa_coverage", row)
  for (const row of report.evidence) await callTool(kit.tools, "register_visual_qa_evidence", row)
  for (const row of report.findings) await callTool(kit.tools, "register_visual_qa_finding", row)
  for (const row of report.production_blockers) await callTool(kit.tools, "register_visual_qa_production_blocker", row)
  for (const row of report.unresolved_code_module_problems) {
    await callTool(kit.tools, "register_visual_qa_unresolved_code_module_problem", row)
  }
  for (const row of report.problem_dom_regions) await callTool(kit.tools, "register_visual_qa_problem_dom_region", row)
  for (const question of report.open_questions)
    await callTool(kit.tools, "register_visual_qa_open_question", { question })
  for (const item of report.fact_check_items) await callTool(kit.tools, "register_visual_qa_fact_check_item", item)
  const referenceParityResult = await callTool(kit.tools, "set_visual_qa_reference_parity", report.reference_parity)
  if (referenceParityResult.startsWith("Error:")) return referenceParityResult
  return callTool(kit.tools, "submit_visual_qa_report", {
    accepted: report.accepted,
    summary: report.summary,
  })
}

afterEach(async () => {
  await resetDatabase()
})

async function seedReferenceComparisonEvidence(input: {
  projectDirectory: string
  taskID: string
  regionID?: string
  viewportID?: string
  operationKind?:
    | "preview-capture"
    | "reference-comparison"
    | "scroll-slice-comparison"
    | "source-binding"
    | "layout-geometry"
  status?: "passed" | "failed"
}): Promise<string> {
  Database.use((db) =>
    db
      .insert(EngineTaskTable)
      .values({
        id: input.taskID,
        project_id: Instance.project.id,
        title: "Reference parity visual QA",
        request: "Verify reference parity",
        source: "test",
        time_created: Date.now(),
        time_updated: Date.now(),
      })
      .run(),
  )
  const artifactDir = ProjectRuntimePaths.taskAbsolute(
    input.projectDirectory,
    input.taskID,
    "bp",
    "visual-qa-reference",
  )
  await fs.mkdir(artifactDir, { recursive: true })
  for (const file of ["source.png", "implementation.png", "side-by-side.png"]) {
    await fs.writeFile(path.join(artifactDir, file), `png:${file}`)
  }
  const target = await persistTestBrowserPreviewTarget({ taskID: input.taskID, url: "http://127.0.0.1:4173/" })
  const evidenceID = await persistBrowserPreviewEvidence({
    projectRoot: input.projectDirectory,
    taskID: input.taskID,
    targetID: target.id,
    viewportID: input.viewportID ?? "desktop",
    operationKind: input.operationKind ?? "reference-comparison",
    regionID: input.regionID ?? "region_header",
    cropIntent: "full-region",
    status: input.status ?? "passed",
    summary: input.status === "failed" ? "Header comparison failed." : "Header comparison passed.",
    artifactPaths: {
      source_crop: path.join(artifactDir, "source.png"),
      implementation_crop: path.join(artifactDir, "implementation.png"),
      side_by_side: path.join(artifactDir, "side-by-side.png"),
    },
    diagnostics: [],
  })
  return `browser_preview_evidence:${evidenceID}`
}

describe("visual-qa output tools", () => {
  test("rejects accepted report with evidence refs that were not registered", async () => {
    const kit = createVisualQaOutputTools()
    const result = await submitReport(kit, validReport({ evidence: [], coverage: [] }))

    expect(result).toContain("check graph is incomplete")
    expect(result).toContain(`unregistered evidence_ref: ${DEFAULT_EVIDENCE_REF}`)
    expect(kit.getCollector().final).toBeUndefined()
  })

  test("records checks registered before evidence when evidence rows cite the check IDs", async () => {
    const kit = createVisualQaOutputTools()
    const result = await submitReport(
      kit,
      validReport({
        check_items: [checkItem({ evidence_refs: [] })],
      }),
    )

    expect(result).toContain("RECORDED")
    expect(result).toContain("effective_accepted=true")
    expect(kit.getCollector().final?.check_items[0]?.evidence_refs).toEqual([])
    expect(kit.getCollector().final?.evidence[0]?.check_ids).toContain(DEFAULT_CHECK_ID)
  })

  test("rejects final reports when a check item has neither refs nor registered evidence rows", async () => {
    const kit = createVisualQaOutputTools()
    const failedCheckID = "check_missing_visual_evidence"
    const result = await submitReport(
      kit,
      validReport({
        accepted: false,
        check_items: [
          checkItem({
            id: failedCheckID,
            status: "failed",
            evidence_refs: [],
            required_correction: "Capture and inspect the missing visual evidence.",
          }),
        ],
        coverage: [],
        evidence: [],
        production_blockers: [
          {
            id: "blocker_missing_visual_evidence",
            check_ids: [failedCheckID],
            principle_ids: ["component-truth"],
            region: "home/table",
            reason: "The failed visual check has no concrete screenshot or functional evidence.",
            impact: "The report cannot prove the visible defect or its scope.",
            required_correction: "Register real visual evidence tied to the failed check.",
            source_refs: [DEFAULT_SOURCE_REF],
            evidence_refs: [],
          },
        ],
      }),
    )

    expect(result).toContain("check graph is incomplete")
    expect(result).toContain(`check_item "${failedCheckID}" has no evidence support`)
    expect(kit.getCollector().final).toBeUndefined()
  })

  test("records accepted report without screenshot-bearing evidence as effective failure", async () => {
    const kit = createVisualQaOutputTools()
    const commandRef = "build_attempt_outcome:out_visual_command"
    const result = await submitReport(
      kit,
      validReport({
        check_items: [checkItem({ evidence_refs: [commandRef] })],
        coverage: [
          {
            check_ids: [DEFAULT_CHECK_ID],
            region: "home/table",
            viewports: [{ width: 1440, height: 900 }],
            states: ["default", "narrow"],
            source_refs: [DEFAULT_SOURCE_REF],
            evidence_refs: [commandRef],
            notes: "Checked table behavior with command output only.",
          },
        ],
        evidence: [
          {
            check_ids: [DEFAULT_CHECK_ID],
            type: "command",
            ref: commandRef,
            note: "Command output only; no screenshot artifact was inspected.",
          },
        ],
      }),
    )

    expect(result).toContain("RECORDED")
    expect(result).toContain("effective_accepted=false")
    expect(result).toContain("BLOCKERS")
    expect(result).toContain("without screenshot comparison or screen-by-screen screenshot evidence")
    expect(kit.getCollector().final?.accepted).toBe(true)
  })

  test("materializes annotated screenshots for registered problem DOM regions in task context", async () => {
    const tmp = await tmpdir()
    try {
      await Instance.provide({
        directory: tmp.path,
        fn: async () => {
          const taskID = `tsk_visual_qa_annotation_${Date.now().toString(16)}`
          const screenshotDir = ProjectRuntimePaths.taskAbsolute(tmp.path, taskID, "bp", "visual-qa-annotation")
          await fs.mkdir(screenshotDir, { recursive: true })
          const screenshotPath = path.join(screenshotDir, "desktop.png")
          await sharp({
            create: {
              width: 320,
              height: 240,
              channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 1 },
            },
          })
            .png()
            .toFile(screenshotPath)
          const screenshotRef = await AttachmentStore.writeFromPath(
            Instance.project.id,
            screenshotPath,
            "image/png",
            "desktop.png",
          )

          const kit = createVisualQaOutputTools({
            taskID,
            projectRoot: tmp.path,
            projectID: Instance.project.id,
          })
          await callTool(
            kit.tools,
            "register_visual_qa_check_item",
            checkItem({
              id: "check_dom_annotation",
              status: "failed",
              region: "hero tabs",
              evidence_refs: [screenshotRef.url],
              required_correction: "Repair the clipped tab row.",
            }),
          )
          const result = await callTool(kit.tools, "register_visual_qa_problem_dom_region", {
            id: "dom-hero-tabs",
            check_ids: ["check_dom_annotation"],
            blocker_ids: ["blocker-hero-tabs"],
            region: "hero tabs",
            route: "/markets/world-stocks/",
            viewport: { width: 320, height: 240 },
            locator: 'main [data-testid="hero-tabs"]',
            dom_path: "body > div#root > main > nav.hero-tabs",
            outer_html_excerpt: '<nav data-testid="hero-tabs" class="hero-tabs is-clipped">Stocks Futures</nav>',
            bbox: { x: 24, y: 32, width: 180, height: 48 },
            computed_style: { display: "flex", overflow: "hidden" },
            attributes: { "data-testid": "hero-tabs", class: "hero-tabs is-clipped" },
            code_search_terms: ["hero-tabs", "is-clipped"],
            evidence_refs: [screenshotRef.url],
            notes: "The current workflow implementation owner should inspect the hero tab container spacing.",
          })

          expect(result).toContain("annotated_evidence_refs=/attachment/")
          const region = kit.getCollector().problem_dom_regions[0]
          expect(region?.annotated_evidence_refs).toHaveLength(1)
          const located = AttachmentStore.nameFromUrl(region!.annotated_evidence_refs[0]!)
          expect(located).toBeDefined()
          const absolute = AttachmentStore.resolveAbsolute(located!.projectID, located!.name)
          expect(absolute).toBeDefined()
          const metadata = await sharp(absolute!).metadata()
          expect(metadata.width).toBe(320)
          expect(metadata.height).toBe(240)
          const raw = await sharp(absolute!).raw().toBuffer({ resolveWithObject: true })
          let redPixels = 0
          for (let offset = 0; offset < raw.data.length; offset += raw.info.channels) {
            const r = raw.data[offset] ?? 0
            const g = raw.data[offset + 1] ?? 0
            const b = raw.data[offset + 2] ?? 0
            if (r > 220 && g < 80 && b < 120) redPixels++
          }
          expect(redPixels).toBeGreaterThan(100)
        },
      })
    } finally {
      await tmp[Symbol.asyncDispose]?.()
    }
  })

  test("records failed report with blockers and unresolved module problems", async () => {
    const kit = createVisualQaOutputTools()
    const result = await submitReport(
      kit,
      validReport({
        accepted: false,
        check_items: [
          checkItem(),
          checkItem({
            id: "check_map_fidelity",
            status: "failed",
            region: "world economy map",
            question: "Is the economy map rendered as the required choropleth surface?",
            expected: "The map uses the source-backed topology implementation.",
            observed: "The rendered map is a low-fidelity placeholder.",
            evidence_refs: [],
            required_correction: "Replace the simplified map with the source-backed topology implementation.",
          }),
        ],
        production_blockers: [
          {
            id: "blocker_map_fidelity",
            check_ids: ["check_map_fidelity"],
            principle_ids: ["component-truth"],
            region: "world economy map",
            reason: "The map is a low-fidelity placeholder instead of the required choropleth surface.",
            impact: "Users would see a product surface that misrepresents the reference implementation.",
            required_correction: "Replace the simplified map with the source-backed topology implementation.",
            source_refs: ["frontend_design:reference_artifacts"],
            evidence_refs: [MAP_EVIDENCE_REF],
          },
        ],
        unresolved_code_module_problems: [
          {
            id: "problem_map_module",
            check_ids: ["check_map_fidelity"],
            code_module_reference: {
              entity: "packages/app/src/components/EconomyMap.tsx",
              problem:
                "The map module still renders a low-fidelity placeholder instead of the required choropleth surface.",
            },
            reason: "Visual QA found a module-specific blocker that cannot be safely repaired in this review pass.",
            blocker_ids: ["blocker_map_fidelity"],
            evidence_refs: [MAP_EVIDENCE_REF],
          },
        ],
        evidence: [
          validReport().evidence[0]!,
          {
            check_ids: ["check_map_fidelity"],
            type: "screenshot",
            ref: MAP_EVIDENCE_REF,
            viewport: { width: 1440, height: 900 },
            state: "default",
            note: "Fresh screenshot shows the low-fidelity map placeholder.",
          },
        ],
      }),
    )

    expect(result).toContain("RECORDED")
    expect(result).toContain("effective_accepted=false")
    expect(kit.getCollector().final?.production_blockers[0]?.id).toBe("blocker_map_fidelity")
    expect(kit.getCollector().final?.unresolved_code_module_problems[0]?.id).toBe("problem_map_module")
  })

  test("rejects accepted reference parity report without comparison refs", async () => {
    const kit = createVisualQaOutputTools({
      referenceParityRequired: true,
      requiredReferenceRegions: ["region_header@desktop"],
    })
    const result = await submitReport(
      kit,
      validReport({
        check_items: [checkItem(), referenceCheckItem("region_header@desktop", DEFAULT_EVIDENCE_REF)],
        evidence: [
          {
            ...validReport().evidence[0]!,
            check_ids: [DEFAULT_CHECK_ID, "check_region_header_desktop"],
          },
        ],
        reference_parity: {
          required: true,
          required_regions: ["region_header@desktop"],
          reference_comparison_evidence_refs: [],
          missing_regions: [],
          blocker_ids: [],
        },
      }),
    )

    expect(result).toContain("RECORDED")
    expect(result).toContain("effective_accepted=false")
    expect(result).toContain("BLOCKERS")
    expect(result).toContain("without reference_comparison_evidence_refs")
    expect(kit.getCollector().final?.reference_parity.required).toBe(true)
  })

  test("rejects reference parity refs that were not registered as evidence rows", async () => {
    const kit = createVisualQaOutputTools({
      referenceParityRequired: true,
      requiredReferenceRegions: ["region_header@desktop"],
    })
    const result = await submitReport(
      kit,
      validReport({
        check_items: [checkItem(), referenceCheckItem("region_header@desktop", DEFAULT_EVIDENCE_REF)],
        evidence: [
          {
            ...validReport().evidence[0]!,
            check_ids: [DEFAULT_CHECK_ID, "check_region_header_desktop"],
          },
        ],
        reference_parity: {
          required: true,
          required_regions: ["region_header@desktop"],
          reference_comparison_evidence_refs: ["browser_preview_evidence:art_missing_reference"],
          missing_regions: [],
          blocker_ids: [],
        },
      }),
    )

    expect(result).toContain("check graph is incomplete")
    expect(result).toContain("reference_parity")
    expect(result).toContain("browser_preview_evidence:art_missing_reference")
    expect(kit.getCollector().final).toBeUndefined()
  })

  test("rejects accepted reference parity with non-formal comparison refs", async () => {
    await using tmp = await tmpdir({ git: true })
    const cases: Array<{
      label: string
      operationKind?: "source-binding" | "layout-geometry" | "reference-comparison"
      status?: "failed"
      seed: boolean
    }> = [
      { label: "source-binding", operationKind: "source-binding", seed: true },
      { label: "layout-geometry", operationKind: "layout-geometry", seed: true },
      { label: "failed-reference-comparison", operationKind: "reference-comparison", status: "failed", seed: true },
      { label: "missing-reference-comparison", seed: false },
    ]
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        for (const item of cases) {
          const taskID = `tsk_visualqa_invalid_ref_${item.label}_${Date.now()}`
          const evidenceID = item.seed
            ? await seedReferenceComparisonEvidence({
                projectDirectory: tmp.path,
                taskID,
                regionID: "region_header",
                viewportID: "desktop",
                operationKind: item.operationKind,
                status: item.status,
              })
            : "browser_preview_evidence:art_missing_reference_comparison"
          const kit = createVisualQaOutputTools({
            taskID,
            projectRoot: tmp.path,
            referenceParityRequired: true,
            requiredReferenceRegions: ["region_header@desktop"],
          })
          const result = await submitReport(
            kit,
            validReport({
              check_items: [checkItem(), referenceCheckItem("region_header@desktop", evidenceID)],
              evidence: [
                validReport().evidence[0]!,
                {
                  check_ids: ["check_region_header_desktop"],
                  type: "reference_comparison",
                  ref: evidenceID,
                  viewport: { width: 1440, height: 900 },
                  state: "default",
                  note: `Submitted ${item.label} as reference comparison evidence.`,
                },
              ],
              coverage: [
                {
                  check_ids: ["check_region_header_desktop"],
                  region: "region_header",
                  viewports: [{ width: 1440, height: 900 }],
                  states: ["default"],
                  source_refs: [SOURCE_REFERENCE_REF],
                  evidence_refs: [evidenceID],
                  notes: `Checked ${item.label}.`,
                },
              ],
              reference_parity: {
                required: true,
                required_regions: ["region_header@desktop"],
                reference_comparison_evidence_refs: [evidenceID],
                missing_regions: [],
                blocker_ids: [],
              },
            }),
          )

          expect(result, item.label).toContain("RECORDED")
          expect(result, item.label).toContain("effective_accepted=false")
          expect(result, item.label).toContain("BLOCKERS")
          expect(result, item.label).toContain(
            "no submitted reference comparison refs resolved to readable passed reference-comparison evidence",
          )
          expect(kit.getCollector().acceptance?.effectiveAccepted, item.label).toBe(false)
        }
      },
    })
  }, 30_000)

  test("records accepted visual diff backed by failed browser preview evidence as effective failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = `tsk_visualqa_failed_visual_diff_${Date.now()}`
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const evidenceRef = await seedReferenceComparisonEvidence({
          projectDirectory: tmp.path,
          taskID,
          operationKind: "scroll-slice-comparison",
          status: "failed",
        })
        const kit = createVisualQaOutputTools({
          taskID,
          projectRoot: tmp.path,
        })
        const result = await submitReport(
          kit,
          validReport({
            check_items: [
              checkItem({
                evidence_refs: [evidenceRef],
                observed: "The page-slice visual diff was submitted as proof.",
              }),
            ],
            coverage: [
              {
                check_ids: [DEFAULT_CHECK_ID],
                region: "home/table",
                viewports: [{ width: 1440, height: 900 }],
                states: ["default"],
                source_refs: [DEFAULT_SOURCE_REF],
                evidence_refs: [evidenceRef],
                notes: "Checked the rendered page slice.",
              },
            ],
            evidence: [
              {
                check_ids: [DEFAULT_CHECK_ID],
                type: "visual_diff",
                ref: evidenceRef,
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Scroll-slice visual diff tool result.",
              },
            ],
          }),
        )

        expect(result).toContain("RECORDED")
        expect(result).toContain("effective_accepted=false")
        expect(result).toContain("resolved to browser preview status=failed")
        expect(result).toContain("tool execution completion is not acceptance")
        expect(kit.getCollector().acceptance?.effectiveAccepted).toBe(false)
      },
    })
  }, 20_000)

  test("records multi-viewport acceptance backed only by layout geometry as effective failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = `tsk_visualqa_layout_geometry_multi_viewport_${Date.now()}`
    const alignmentCheckID = "check_multi_viewport_alignment"
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const evidenceRef = await seedReferenceComparisonEvidence({
          projectDirectory: tmp.path,
          taskID,
          operationKind: "layout-geometry",
        })
        const kit = createVisualQaOutputTools({
          taskID,
          projectRoot: tmp.path,
        })
        const result = await submitReport(
          kit,
          validReport({
            check_items: [
              checkItem({ evidence_refs: [evidenceRef] }),
              checkItem({
                id: alignmentCheckID,
                category: VISUAL_QA_MULTI_VIEWPORT_ALIGNMENT_CATEGORY,
                question: "Do desktop rails stay aligned at both claimed widths?",
                region: "home/table",
                expected: "The shared desktop content rail remains coherent across scoped desktop widths.",
                observed: "Layout geometry was submitted as the only cross-viewport proof.",
                viewports: [
                  { width: 1440, height: 900 },
                  { width: 1280, height: 900 },
                ],
                evidence_refs: [evidenceRef],
              }),
            ],
            coverage: [
              {
                check_ids: [alignmentCheckID],
                region: "home/table multi-viewport alignment",
                viewports: [
                  { width: 1440, height: 900 },
                  { width: 1280, height: 900 },
                ],
                states: ["default"],
                source_refs: [DEFAULT_SOURCE_REF],
                evidence_refs: [evidenceRef],
                notes: "Submitted layout geometry as the cross-viewport visual proof.",
              },
            ],
            evidence: [
              {
                check_ids: [DEFAULT_CHECK_ID, alignmentCheckID],
                type: "visual_diff",
                ref: evidenceRef,
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Layout geometry diagnostic cannot prove rendered visual acceptance.",
              },
              {
                check_ids: [alignmentCheckID],
                type: "visual_diff",
                ref: evidenceRef,
                viewport: { width: 1280, height: 900 },
                state: "default",
                note: "Layout geometry diagnostic cannot prove rendered visual acceptance.",
              },
            ],
          }),
        )

        expect(result).toContain("RECORDED")
        expect(result).toContain("effective_accepted=false")
        expect(result).toContain("operationKind=layout-geometry")
        expect(result).toContain("expected reference-comparison or scroll-slice-comparison passed evidence")
        expect(kit.getCollector().acceptance?.effectiveAccepted).toBe(false)
      },
    })
  }, 20_000)

  test("rejects side-by-side PNG paths as formal reference parity refs", async () => {
    const sideBySidePath = SUPPORTING_VISUAL_DIFF_REF
    const kit = createVisualQaOutputTools({
      referenceParityRequired: true,
      requiredReferenceRegions: ["region_header@desktop"],
    })
    const result = await submitReport(
      kit,
      validReport({
        check_items: [checkItem(), referenceCheckItem("region_header@desktop", sideBySidePath)],
        evidence: [
          validReport().evidence[0]!,
          {
            check_ids: ["check_region_header_desktop"],
            type: "visual_diff",
            ref: sideBySidePath,
            viewport: { width: 1440, height: 900 },
            state: "default",
            note: "Side-by-side page slice comparison for visual inspection.",
          },
        ],
        coverage: [
          {
            check_ids: ["check_region_header_desktop"],
            region: "region_header",
            viewports: [{ width: 1440, height: 900 }],
            states: ["default"],
            source_refs: [SOURCE_REFERENCE_REF],
            evidence_refs: [sideBySidePath],
            notes: "Checked the side-by-side slice as supporting evidence.",
          },
        ],
        reference_parity: {
          required: true,
          required_regions: ["region_header@desktop"],
          reference_comparison_evidence_refs: [sideBySidePath],
          missing_regions: [],
          blocker_ids: [],
        },
      }),
    )

    expect(result).toContain("reference_comparison_evidence_refs must contain formal reference-comparison evidence refs")
    expect(result).toContain("side-by-side PNG paths are supporting visual_diff evidence only")
    expect(result).not.toContain("without reference_comparison_evidence_refs")
    expect(kit.getCollector().final).toBeUndefined()
  })

  test("does not accept supporting evidence as formal reference comparison refs", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = `tsk_visualqa_supporting_refs_${Date.now()}`
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const evidenceID = await seedReferenceComparisonEvidence({
          projectDirectory: tmp.path,
          taskID,
          regionID: "region_header",
          viewportID: "desktop",
        })
        const kit = createVisualQaOutputTools({
          taskID,
          projectRoot: tmp.path,
          referenceParityRequired: true,
          requiredReferenceRegions: ["region_header@desktop"],
        })
        const result = await submitReport(
          kit,
          validReport({
            check_items: [referenceCheckItem("region_header@desktop", evidenceID)],
            evidence: [
              {
                check_ids: ["check_region_header_desktop"],
                type: "reference_comparison",
                ref: evidenceID,
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Supporting report evidence cannot replace the dedicated parity refs field.",
              },
            ],
            coverage: [
              {
                check_ids: ["check_region_header_desktop"],
                region: "region_header",
                viewports: [{ width: 1440, height: 900 }],
                states: ["default"],
                source_refs: [SOURCE_REFERENCE_REF],
                evidence_refs: [evidenceID],
                notes: "Coverage references supporting evidence only.",
              },
            ],
            reference_parity: {
              required: true,
              required_regions: ["region_header@desktop"],
              reference_comparison_evidence_refs: [],
              missing_regions: [],
              blocker_ids: [],
            },
          }),
        )

        expect(result).toContain("RECORDED")
        expect(result).toContain("effective_accepted=false")
        expect(result).toContain("without reference_comparison_evidence_refs")
        expect(kit.getCollector().acceptance?.effectiveAccepted).toBe(false)
      },
    })
  }, 20_000)

  test("records host-required parity report with required=false as effective failure", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = `tsk_visualqa_host_required_false_${Date.now()}`
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const evidenceID = await seedReferenceComparisonEvidence({
          projectDirectory: tmp.path,
          taskID,
          regionID: "region_header",
          viewportID: "desktop",
        })
        const kit = createVisualQaOutputTools({
          taskID,
          projectRoot: tmp.path,
          referenceParityRequired: true,
          requiredReferenceRegions: ["region_header@desktop"],
        })
        const result = await submitReport(
          kit,
          validReport({
            check_items: [checkItem(), referenceCheckItem("region_header@desktop", evidenceID)],
            evidence: [
              validReport().evidence[0]!,
              {
                check_ids: ["check_region_header_desktop"],
                type: "reference_comparison",
                ref: evidenceID,
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Fresh task-scoped reference comparison evidence.",
              },
            ],
            reference_parity: {
              required: false,
              required_regions: ["region_header@desktop"],
              reference_comparison_evidence_refs: [evidenceID],
              missing_regions: [],
              blocker_ids: [],
            },
          }),
        )

        expect(result).toContain("RECORDED")
        expect(result).toContain("effective_accepted=false")
        expect(result).toContain("report.reference_parity.required=false")
        expect(kit.getCollector().acceptance?.effectiveAccepted).toBe(false)
      },
    })
  }, 20_000)

  test("rejects host-required parity without required reference regions", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = `tsk_visualqa_no_authoritative_regions_${Date.now()}`
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const evidenceID = await seedReferenceComparisonEvidence({
          projectDirectory: tmp.path,
          taskID,
          regionID: "region_header",
          viewportID: "desktop",
        })
        const kit = createVisualQaOutputTools({
          taskID,
          projectRoot: tmp.path,
          referenceParityRequired: true,
        })
        const result = await submitReport(
          kit,
          validReport({
            check_items: [checkItem(), referenceCheckItem("region_header@desktop", evidenceID)],
            evidence: [
              validReport().evidence[0]!,
              {
                check_ids: ["check_region_header_desktop"],
                type: "reference_comparison",
                ref: evidenceID,
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Fresh task-scoped reference comparison evidence.",
              },
            ],
            reference_parity: {
              required: true,
              required_regions: [],
              reference_comparison_evidence_refs: [evidenceID],
              missing_regions: [],
              blocker_ids: [],
            },
          }),
        )

        expect(result).toContain("RECORDED")
        expect(result).toContain("effective_accepted=false")
        expect(result).toContain("without required reference regions")
        expect(kit.getCollector().acceptance?.effectiveAccepted).toBe(false)
      },
    })
  }, 20_000)

  test("records unreadable reference-comparison evidence as a blocking failed acceptance", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = `tsk_visualqa_unreadable_ref_${Date.now()}`
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const evidenceID = await seedReferenceComparisonEvidence({
          projectDirectory: tmp.path,
          taskID,
          regionID: "region_header",
          viewportID: "desktop",
        })
        const artifactDir = ProjectRuntimePaths.taskAbsolute(tmp.path, taskID, "bp", "visual-qa-reference")
        await fs.unlink(path.join(artifactDir, "side-by-side.png"))
        const kit = createVisualQaOutputTools({
          taskID,
          projectRoot: tmp.path,
          referenceParityRequired: true,
          requiredReferenceRegions: ["region_header@desktop"],
        })
        const result = await submitReport(
          kit,
          validReport({
            check_items: [checkItem(), referenceCheckItem("region_header@desktop", evidenceID)],
            evidence: [
              validReport().evidence[0]!,
              {
                check_ids: ["check_region_header_desktop"],
                type: "reference_comparison",
                ref: evidenceID,
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Corrupt task-scoped reference comparison evidence.",
              },
            ],
            reference_parity: {
              required: true,
              required_regions: ["region_header@desktop"],
              reference_comparison_evidence_refs: [evidenceID],
              missing_regions: [],
              blocker_ids: [],
            },
          }),
        )

        expect(result).toContain("RECORDED")
        expect(result).toContain("effective_accepted=false")
        expect(result).toContain("unreadable")
        expect(kit.getCollector().acceptance?.effectiveAccepted).toBe(false)
      },
    })
  }, 20_000)

  test("rejects host-derived incomplete reference coverage as an incomplete check graph", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = `tsk_visualqa_context_regions_${Date.now()}`
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const evidenceID = await seedReferenceComparisonEvidence({
          projectDirectory: tmp.path,
          taskID,
          regionID: "region_header",
          viewportID: "desktop",
        })
        const kit = createVisualQaOutputTools({
          taskID,
          projectRoot: tmp.path,
          referenceParityRequired: true,
          requiredReferenceRegions: ["region_header@desktop", "region_table@desktop"],
        })
        const result = await submitReport(
          kit,
          validReport({
            check_items: [checkItem(), referenceCheckItem("region_header@desktop", evidenceID)],
            evidence: [
              validReport().evidence[0]!,
              {
                check_ids: ["check_region_header_desktop"],
                type: "reference_comparison",
                ref: evidenceID,
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Fresh task-scoped reference comparison evidence.",
              },
            ],
            reference_parity: {
              required: true,
              required_regions: ["region_header@desktop"],
              reference_comparison_evidence_refs: [evidenceID],
              missing_regions: [],
              blocker_ids: [],
            },
          }),
        )

        expect(result).toContain("check graph is incomplete")
        expect(result).toContain("region_table@desktop")
        expect(kit.getCollector().final).toBeUndefined()
      },
    })
  }, 20_000)

  test("records readable reference-comparison evidence without advisory", async () => {
    await using tmp = await tmpdir({ git: true })
    const taskID = `tsk_visualqa_ref_${Date.now()}`
    await Instance.provide({
      directory: tmp.path,
      fn: async () => {
        const evidenceID = await seedReferenceComparisonEvidence({
          projectDirectory: tmp.path,
          taskID,
          regionID: "region_header",
          viewportID: "desktop",
        })
        const kit = createVisualQaOutputTools({
          taskID,
          projectRoot: tmp.path,
          referenceParityRequired: true,
          requiredReferenceRegions: ["region_header@desktop"],
        })
        const result = await submitReport(
          kit,
          validReport({
            check_items: [referenceCheckItem("region_header@desktop", evidenceID)],
            evidence: [
              {
                check_ids: ["check_region_header_desktop"],
                type: "reference_comparison",
                ref: evidenceID,
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Fresh task-scoped reference comparison evidence.",
              },
            ],
            coverage: [
              {
                check_ids: ["check_region_header_desktop"],
                region: "region_header",
                viewports: [{ width: 1440, height: 900 }],
                states: ["default"],
                source_refs: [SOURCE_REFERENCE_REF],
                evidence_refs: [evidenceID],
                notes: "Checked header reference comparison.",
              },
            ],
            reference_parity: {
              required: true,
              required_regions: ["region_header@desktop"],
              reference_comparison_evidence_refs: [evidenceID],
              missing_regions: [],
              blocker_ids: [],
            },
          }),
        )

        expect(result).toContain("RECORDED")
        expect(result).toContain("effective_accepted=true")
        expect(result).not.toContain("ADVISORIES")
        expect(kit.getCollector().acceptance?.effectiveAccepted).toBe(true)
        expect(kit.getCollector().final?.accepted).toBe(true)
      },
    })
  }, 20_000)

  test("records failed report without blockers as blocker feedback", async () => {
    const kit = createVisualQaOutputTools()
    const result = await submitReport(
      kit,
      validReport({
        accepted: false,
        findings: [],
        production_blockers: [],
      }),
    )

    expect(result).toContain("RECORDED")
    expect(result).toContain("effective_accepted=false")
    expect(result).toContain("BLOCKERS")
    expect(result).toContain("accepted=false was submitted without production_blockers")
    expect(kit.getCollector().final?.accepted).toBe(false)
  })

  test("rejects multi-viewport report without a multi-viewport alignment check item", async () => {
    const kit = createVisualQaOutputTools()
    const result = await submitReport(
      kit,
      validReport({
        coverage: [
          {
            check_ids: [DEFAULT_CHECK_ID],
            region: "home/table",
            viewports: [
              { width: 1440, height: 900 },
              { width: 390, height: 844 },
            ],
            states: ["default"],
            source_refs: [DEFAULT_SOURCE_REF],
            evidence_refs: [DEFAULT_EVIDENCE_REF, MOBILE_EVIDENCE_REF],
            notes: "Checked the table in two scoped viewports but did not register cross-viewport alignment.",
          },
        ],
        evidence: [
          {
            check_ids: [DEFAULT_CHECK_ID],
            type: "screenshot",
            ref: DEFAULT_EVIDENCE_REF,
            viewport: { width: 1440, height: 900 },
            state: "default",
            note: "Fresh desktop screenshot.",
          },
          {
            check_ids: [DEFAULT_CHECK_ID],
            type: "screenshot",
            ref: MOBILE_EVIDENCE_REF,
            viewport: { width: 390, height: 844 },
            state: "default",
            note: "Fresh narrow viewport screenshot.",
          },
        ],
      }),
    )

    expect(result).toContain("check graph is incomplete")
    expect(result).toContain(VISUAL_QA_MULTI_VIEWPORT_ALIGNMENT_CATEGORY)
    expect(kit.getCollector().final).toBeUndefined()
  })

  test("records multi-viewport report with a registered alignment check item", async () => {
    const alignmentCheckID = "check_multi_viewport_alignment"
    const kit = createVisualQaOutputTools()
    const result = await submitReport(
      kit,
      validReport({
        check_items: [
          checkItem(),
          checkItem({
            id: alignmentCheckID,
            category: VISUAL_QA_MULTI_VIEWPORT_ALIGNMENT_CATEGORY,
            question: "Do shared layout anchors and critical controls remain aligned across scoped viewports?",
            region: "home/table",
            expected:
              "The table heading, gutters, action controls, text wrapping, and overflow behavior stay coherent across desktop and narrow viewports.",
            observed:
              "Fresh desktop and narrow screenshots show coherent table anchors, gutters, controls, wrapping, and overflow behavior.",
            viewports: [
              { width: 1440, height: 900 },
              { width: 390, height: 844 },
            ],
            evidence_refs: [DEFAULT_EVIDENCE_REF, MOBILE_EVIDENCE_REF],
          }),
        ],
        coverage: [
          {
            check_ids: [DEFAULT_CHECK_ID],
            region: "home/table",
            viewports: [{ width: 1440, height: 900 }],
            states: ["default"],
            source_refs: [DEFAULT_SOURCE_REF],
            evidence_refs: [DEFAULT_EVIDENCE_REF],
            notes: "Checked the default desktop table.",
          },
          {
            check_ids: [alignmentCheckID],
            region: "home/table multi-viewport alignment",
            viewports: [
              { width: 1440, height: 900 },
              { width: 390, height: 844 },
            ],
            states: ["default"],
            source_refs: [DEFAULT_SOURCE_REF],
            evidence_refs: [DEFAULT_EVIDENCE_REF, MOBILE_EVIDENCE_REF],
            notes:
              "Checked shared layout anchors, gutters, wrapping, overflow, and control placement across both viewports.",
          },
        ],
        evidence: [
          {
            check_ids: [DEFAULT_CHECK_ID, alignmentCheckID],
            type: "screenshot",
            ref: DEFAULT_EVIDENCE_REF,
            viewport: { width: 1440, height: 900 },
            state: "default",
            note: "Fresh desktop screenshot.",
          },
          {
            check_ids: [alignmentCheckID],
            type: "screenshot",
            ref: MOBILE_EVIDENCE_REF,
            viewport: { width: 390, height: 844 },
            state: "default",
            note: "Fresh narrow viewport screenshot.",
          },
        ],
      }),
    )

    expect(result).toContain("RECORDED")
    expect(result).toContain("effective_accepted=true")
    expect(kit.getCollector().final?.check_items.map((item) => item.category)).toContain(
      VISUAL_QA_MULTI_VIEWPORT_ALIGNMENT_CATEGORY,
    )
  })

  test("failed report renders production blockers and unresolved module problems in the terminal report", async () => {
    const kit = createVisualQaOutputTools()
    const result = await submitReport(
      kit,
      validReport({
        accepted: false,
        check_items: [
          checkItem(),
          checkItem({
            id: "check_hero_hierarchy",
            category: "reference-structure",
            question: "Does the hero hierarchy match the authoritative reference?",
            region: "hero",
            status: "failed",
            expected: "The hero heading scale, spacing, and section order match the reference.",
            observed: "The hero heading is too small and compressed compared with the reference.",
            source_refs: [SOURCE_REFERENCE_REF],
            evidence_refs: [HERO_EVIDENCE_REF],
            required_correction: "Restore the reference heading scale, spacing, and section order.",
          }),
        ],
        production_blockers: [
          {
            id: "blocker_density",
            check_ids: ["check_hero_hierarchy"],
            principle_ids: ["reference-structure", "visual-hierarchy-readability"],
            region: "hero",
            reason: "The visual hierarchy no longer matches the authoritative reference.",
            impact: "The first viewport reads as a different product surface.",
            required_correction: "Restore the reference heading scale, spacing, and section order.",
            source_refs: [SOURCE_REFERENCE_REF],
            evidence_refs: [HERO_EVIDENCE_REF],
          },
        ],
        unresolved_code_module_problems: [
          {
            id: "problem_hero_hierarchy",
            check_ids: ["check_hero_hierarchy"],
            code_module_reference: {
              entity: "packages/app/src/components/Hero.tsx",
              problem: "The hero component hierarchy no longer matches the authoritative reference.",
            },
            reason: "Visual QA cannot safely complete the reference-structure repair in the current review pass.",
            blocker_ids: ["blocker_density"],
            evidence_refs: [HERO_EVIDENCE_REF],
          },
        ],
        problem_dom_regions: [
          {
            id: "dom_hero_heading",
            check_ids: ["check_hero_hierarchy"],
            blocker_ids: ["blocker_density"],
            region: "hero",
            route: "/",
            viewport: { width: 1440, height: 900 },
            locator: '[data-testid="hero-heading"]',
            dom_path: "main > section.hero > h1",
            outer_html_excerpt: '<h1 data-testid="hero-heading" class="hero-title">United States market overview</h1>',
            ancestor_context: ['<section class="hero">...</section>'],
            sibling_context: ['<p class="hero-subtitle">...</p>'],
            text_content: "United States market overview",
            role: "heading",
            accessible_name: "United States market overview",
            bbox: { x: 120, y: 96, width: 540, height: 64 },
            computed_style: {
              display: "block",
              fontSize: "32px",
              marginTop: "0px",
              marginBottom: "12px",
            },
            attributes: {
              class: "hero-title",
              "data-testid": "hero-heading",
            },
            code_search_terms: ["hero-heading", "hero-title", "United States market overview"],
            evidence_refs: [HERO_EVIDENCE_REF],
            notes: "The heading node is too small and compressed compared with the required hero hierarchy.",
          },
        ],
        evidence: [
          validReport().evidence[0]!,
          {
            check_ids: ["check_hero_hierarchy"],
            type: "screenshot",
            ref: HERO_EVIDENCE_REF,
            viewport: { width: 1440, height: 900 },
            state: "default",
            note: "Fresh screenshot shows the compressed hero heading hierarchy.",
          },
        ],
      }),
    )

    expect(result).toContain("RECORDED")
    expect(result).toContain("effective_accepted=false")
    expect(kit.getCollector().final?.accepted).toBe(false)
    expect(kit.buildReport().detail).toContain("## Production Blockers")
    expect(kit.buildReport().detail).toContain("blocker_density")
    expect(kit.buildReport().detail).toContain("reference-structure")
    expect(kit.buildReport().detail).toContain("## Unresolved Code Module Problems")
    expect(kit.buildReport().detail).toContain("problem_hero_hierarchy")
    expect(kit.buildReport().detail).toContain("packages/app/src/components/Hero.tsx")
    expect(kit.buildReport().detail).toContain("blockers=blocker_density")
    expect(kit.buildReport().detail).toContain("## Problem DOM Regions")
    expect(kit.buildReport().detail).toContain("dom_hero_heading")
    expect(kit.buildReport().detail).toContain('[data-testid="hero-heading"]')
    expect(kit.buildReport().detail).toContain("code_search_terms=hero-heading, hero-title")
    expect(kit.buildReport().detail).toContain("computed_style=display=block")
  })

  test("rejects accepted reference parity with missing regions as an incomplete check graph", async () => {
    const kit = createVisualQaOutputTools({
      referenceParityRequired: true,
      requiredReferenceRegions: ["region_header@desktop", "region_footer@desktop"],
    })
    const result = await submitReport(
      kit,
      validReport({
        check_items: [checkItem(), referenceCheckItem("region_header@desktop", "browser_preview_evidence:art_header")],
        evidence: [
          validReport().evidence[0]!,
          {
            check_ids: ["check_region_header_desktop"],
            type: "reference_comparison",
            ref: "browser_preview_evidence:art_header",
            viewport: { width: 1440, height: 900 },
            state: "default",
            note: "Header reference comparison was produced.",
          },
        ],
        reference_parity: {
          required: true,
          required_regions: ["region_header@desktop", "region_footer@desktop"],
          reference_comparison_evidence_refs: ["browser_preview_evidence:art_header"],
          missing_regions: ["region_footer@desktop"],
          blocker_ids: [],
        },
      }),
    )

    expect(result).toContain("check graph is incomplete")
    expect(result).toContain("region_footer@desktop")
    expect(kit.getCollector().final).toBeUndefined()
  })

  test("duplicate submit is still rejected after the report is recorded", async () => {
    const kit = createVisualQaOutputTools()
    await submitReport(kit, validReport())

    const duplicate = await callTool(kit.tools, "submit_visual_qa_report", {
      accepted: true,
      summary: "second",
    })

    expect(duplicate).toContain("duplicate submit_visual_qa_report ignored")
    expect(kit.getCollector().final?.summary).not.toBe("second")
  })

  test("register tools reject unknown visual QA check ids before final submit", async () => {
    const kit = createVisualQaOutputTools()
    await callTool(kit.tools, "register_visual_qa_check_item", checkItem())

    const result = await callTool(kit.tools, "register_visual_qa_evidence", {
      check_ids: ["missing-check"],
      type: "screenshot",
      ref: "browser_preview_evidence:art_missing_check",
      viewport: { width: 1440, height: 900 },
      state: "default",
      note: "This evidence points at an unregistered check.",
    })

    expect(result).toContain("references unregistered check items")
    expect(kit.getCollector().evidence).toHaveLength(0)
  })

  test("submit_visual_qa_report rejects the old full-report payload", async () => {
    const kit = createVisualQaOutputTools()
    const schema = kit.tools.submit_visual_qa_report.inputSchema as {
      shape: Record<string, unknown>
      safeParse(input: unknown): { success: boolean }
    }

    expect(Object.keys(schema.shape)).toEqual(["accepted", "summary"])
    expect(schema.safeParse(validReport()).success).toBe(false)
    const result = await callTool(kit.tools, "submit_visual_qa_report", validReport())
    expect(result).toContain("accepts only accepted and summary")
    expect(kit.getCollector().final).toBeUndefined()
  })
})
