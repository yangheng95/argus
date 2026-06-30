import { afterEach, describe, expect, test } from "bun:test"
import fs from "node:fs/promises"
import path from "node:path"
import { persistBrowserPreviewEvidence } from "../../src/browser-preview/persist"
import { EngineTaskTable } from "../../src/engine/engine.sql"
import { Instance } from "../../src/project/instance"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"
import { Database } from "../../src/storage/db"
import { createVisualQaOutputTools } from "../../src/visual-qa/output-tools"
import type { VisualQaReport } from "../../src/visual-qa/schema"
import { persistTestBrowserPreviewTarget } from "../fixture/browser-preview"
import { resetDatabase } from "../fixture/db"
import { tmpdir } from "../fixture/fixture"

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
    unresolved_code_module_problems: [],
    problem_dom_regions: [],
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
    reference_parity: {
      required: false,
      required_regions: [],
      reference_comparison_evidence_refs: [],
      missing_regions: [],
      blocker_ids: [],
    },
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

afterEach(async () => {
  await resetDatabase()
})

async function seedReferenceComparisonEvidence(input: {
  projectDirectory: string
  taskID: string
  regionID?: string
  viewportID?: string
  operationKind?: "preview-capture" | "reference-comparison" | "source-binding" | "layout-geometry"
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
  return persistBrowserPreviewEvidence({
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
}

describe("visual-qa output tools", () => {
  test("records accepted report with missing evidence and coverage as effective failure", async () => {
    const kit = createVisualQaOutputTools()
    const result = await callTool(kit.tools, "submit_visual_qa_report", validReport({ evidence: [], coverage: [] }))

    expect(result).toContain("RECORDED")
    expect(result).toContain("effective_accepted=false")
    expect(result).toContain("BLOCKERS")
    expect(result).toContain("without fresh visual or functional evidence")
    expect(result).toContain("without screenshot comparison or screen-by-screen screenshot evidence")
    expect(result).toContain("without coverage items")
    expect(kit.getCollector().final?.accepted).toBe(true)
  })

  test("records accepted report without screenshot-bearing evidence as effective failure", async () => {
    const kit = createVisualQaOutputTools()
    const result = await callTool(
      kit.tools,
      "submit_visual_qa_report",
      validReport({
        evidence: [
          {
            type: "command",
            ref: "node node_modules/playwright/cli.js test visual.spec.ts",
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

  test("records accepted report with blockers and unresolved module problems as effective failure", async () => {
    const kit = createVisualQaOutputTools()
    const result = await callTool(
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
        unresolved_code_module_problems: [
          {
            id: "problem_map_module",
            code_module_reference: {
              entity: "packages/app/src/components/EconomyMap.tsx",
              problem:
                "The map module still renders a low-fidelity placeholder instead of the required choropleth surface.",
            },
            reason: "Visual QA found a module-specific blocker that cannot be safely repaired in this review pass.",
            blocker_ids: ["blocker_map_fidelity"],
            evidence_refs: ["artifacts/map.png"],
          },
        ],
      }),
    )

    expect(result).toContain("RECORDED")
    expect(result).toContain("effective_accepted=false")
    expect(result).toContain("BLOCKERS")
    expect(result).toContain("production blockers")
    expect(result).toContain("unresolved_code_module_problems")
    expect(kit.getCollector().final?.production_blockers[0]?.id).toBe("blocker_map_fidelity")
  })

  test("records reference parity screenshot-only report as effective failure", async () => {
    const kit = createVisualQaOutputTools({
      referenceParityRequired: true,
      requiredReferenceRegions: ["region_header@desktop"],
    })
    const result = await callTool(
      kit.tools,
      "submit_visual_qa_report",
      validReport({
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
    expect(result).toContain("without reference_comparison evidence refs")
    expect(kit.getCollector().final?.reference_parity.required).toBe(true)
  })

  test("records accepted reference parity with non-formal comparison refs as effective failure", async () => {
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
          const result = await callTool(
            kit.tools,
            "submit_visual_qa_report",
            validReport({
              evidence: [
                {
                  type: "reference_comparison",
                  ref: evidenceID,
                  viewport: { width: 1440, height: 900 },
                  state: "default",
                  note: `Submitted ${item.label} as reference comparison evidence.`,
                },
              ],
              coverage: [
                {
                  region: "region_header",
                  viewports: [{ width: 1440, height: 900 }],
                  states: ["default"],
                  source_refs: ["reference.png"],
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
            "no submitted reference comparison refs resolved to readable passed browser_preview_evidence",
          )
          expect(kit.getCollector().acceptance?.effectiveAccepted, item.label).toBe(false)
        }
      },
    })
  }, 30_000)

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
        const result = await callTool(
          kit.tools,
          "submit_visual_qa_report",
          validReport({
            evidence: [
              {
                type: "reference_comparison",
                ref: evidenceID,
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Supporting report evidence cannot replace the dedicated parity refs field.",
              },
            ],
            coverage: [
              {
                region: "region_header",
                viewports: [{ width: 1440, height: 900 }],
                states: ["default"],
                source_refs: ["reference.png"],
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
        expect(result).toContain("without reference_comparison evidence refs")
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
        const result = await callTool(
          kit.tools,
          "submit_visual_qa_report",
          validReport({
            evidence: [
              {
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

  test("records host-required parity without authoritative regions as effective failure", async () => {
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
        const result = await callTool(
          kit.tools,
          "submit_visual_qa_report",
          validReport({
            evidence: [
              {
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

        expect(result).toContain("RECORDED")
        expect(result).toContain("effective_accepted=false")
        expect(result).toContain("no authoritative requiredReferenceRegions")
        expect(kit.getCollector().acceptance?.effectiveAccepted).toBe(false)
      },
    })
  }, 20_000)

  test("records unreadable reference-comparison evidence as effective failure", async () => {
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
        const result = await callTool(
          kit.tools,
          "submit_visual_qa_report",
          validReport({
            evidence: [
              {
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

  test("records host-derived incomplete reference coverage as effective failure", async () => {
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
        const result = await callTool(
          kit.tools,
          "submit_visual_qa_report",
          validReport({
            evidence: [
              {
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

        expect(result).toContain("RECORDED")
        expect(result).toContain("effective_accepted=false")
        expect(result).toContain("BLOCKERS")
        expect(result).toContain("region_table@desktop")
        expect(kit.getCollector().final?.accepted).toBe(true)
        expect(kit.getCollector().acceptance?.effectiveAccepted).toBe(false)
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
        const result = await callTool(
          kit.tools,
          "submit_visual_qa_report",
          validReport({
            evidence: [
              {
                type: "reference_comparison",
                ref: evidenceID,
                viewport: { width: 1440, height: 900 },
                state: "default",
                note: "Fresh task-scoped reference comparison evidence.",
              },
            ],
            coverage: [
              {
                region: "region_header",
                viewports: [{ width: 1440, height: 900 }],
                states: ["default"],
                source_refs: ["reference.png"],
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
    const result = await callTool(
      kit.tools,
      "submit_visual_qa_report",
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

  test("failed report renders production blockers and unresolved module problems in the terminal report", async () => {
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
        unresolved_code_module_problems: [
          {
            id: "problem_hero_hierarchy",
            code_module_reference: {
              entity: "packages/app/src/components/Hero.tsx",
              problem: "The hero component hierarchy no longer matches the authoritative reference.",
            },
            reason: "Visual QA cannot safely complete the reference-structure repair in the current review pass.",
            blocker_ids: ["blocker_density"],
            evidence_refs: ["artifacts/hero.png"],
          },
        ],
        problem_dom_regions: [
          {
            id: "dom_hero_heading",
            blocker_ids: ["blocker_density"],
            region: "hero",
            route: "/",
            viewport: { width: 1440, height: 900 },
            locator: "[data-testid=\"hero-heading\"]",
            dom_path: "main > section.hero > h1",
            outer_html_excerpt:
              '<h1 data-testid="hero-heading" class="hero-title">United States market overview</h1>',
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
            evidence_refs: ["artifacts/hero.png"],
            notes: "The heading node is too small and compressed compared with the required hero hierarchy.",
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

  test("records accepted reference parity with missing regions as effective failure", async () => {
    const kit = createVisualQaOutputTools({
      referenceParityRequired: true,
      requiredReferenceRegions: ["region_header@desktop", "region_footer@desktop"],
    })
    const result = await callTool(
      kit.tools,
      "submit_visual_qa_report",
      validReport({
        evidence: [
          {
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

    expect(result).toContain("RECORDED")
    expect(result).toContain("effective_accepted=false")
    expect(result).toContain("reference_parity.missing_regions")
    expect(kit.getCollector().final?.reference_parity.missing_regions).toEqual(["region_footer@desktop"])
  })

  test("duplicate submit is still rejected after the report is recorded", async () => {
    const kit = createVisualQaOutputTools()
    await callTool(kit.tools, "submit_visual_qa_report", validReport())

    const duplicate = await callTool(kit.tools, "submit_visual_qa_report", validReport({ summary: "second" }))

    expect(duplicate).toContain("duplicate submit_visual_qa_report ignored")
    expect(kit.getCollector().final?.summary).not.toBe("second")
  })
})
