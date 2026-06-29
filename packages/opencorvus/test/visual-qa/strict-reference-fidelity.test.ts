import { describe, expect, test } from "bun:test"
import VISUAL_QA_CORE from "../../src/prompt/core/visual-qa-core.txt"
import { deriveVisualQaReferenceParityContext } from "../../src/visual-qa/reference-parity-context"
import { VisualQaTestHooks } from "../../src/visual-qa"
import { renderVisualQaFrontendDesignContext, renderVisualQaFrontendResearchContext } from "../../src/visual-qa/context"
import { VisualEvidenceBundleSchema } from "../../src/acceptance/visual-evidence"
import type { ResearchBrief } from "../../src/research/schema"

describe("visual-qa final blocker-based acceptance", () => {
  test("core prompt scopes reference parity to explicit task evidence", () => {
    const normalized = VISUAL_QA_CORE.replace(/\s+/g, " ")

    expect(normalized).toContain("final visual GUI and functional product-review agent")
    expect(normalized).toContain("Run once near task completion")
    expect(normalized).toContain(
      "Reference parity is in scope only when the task, goal, or acceptance evidence explicitly requires it",
    )
    expect(normalized).toContain("When explicit reference fidelity is in scope")
    expect(normalized).not.toContain("strict reference-image fidelity mode")
  })

  test("core prompt requires professional design production blockers instead of fixed score verdicts", () => {
    const normalized = VISUAL_QA_CORE.replace(/\s+/g, " ")

    expect(normalized).toContain("professional product designer and design QA reviewer")
    expect(normalized).toContain("production blockers")
    expect(normalized).toContain(
      "Numeric similarity scores, legacy visual metrics, and external judge verdicts are not Visual QA completion signals",
    )
    expect(normalized).toContain("Do not chase, cite, or optimize for a score threshold")
    expect(normalized).toContain("low-fidelity charts/maps/tables")
  })

  test("core prompt requires random preview ports", () => {
    const normalized = VISUAL_QA_CORE.replace(/\s+/g, " ")

    expect(normalized).toContain("use a random or dynamically discovered free high port")
    expect(normalized).toContain("Do not bind default shared ports such as 3000, 5173, or 4173")
    expect(normalized).toContain("unless the task explicitly assigns that exact port")
  })

  test("core prompt requires task-scoped screenshot review and supporting comparison for clone work", () => {
    const normalized = VISUAL_QA_CORE.replace(/\s+/g, " ")

    expect(normalized).toContain("prioritize screenshot comparison")
    expect(normalized).toContain("screen by screen with viewport-sized screenshots or scroll slices")
    expect(normalized).toContain("Do not judge the whole webpage from one full-page screenshot")
    expect(normalized).toContain("one-shot visual judge verdict")
    expect(normalized).toContain("use `browser_preview_reference_regions` for formal bound-region proof")
    expect(normalized).toContain("`browser_preview_compare_scroll_slices` side-by-side evidence for supporting page-slice visual inspection")
    expect(normalized).toContain("do not treat a status flag alone as proof")
    expect(normalized).toContain("fresh `reference-comparison` evidence")
    expect(normalized).toContain("repair the preview target or route first")
    expect(normalized).toContain("Inspect the visible mismatch yourself")
    expect(normalized).toContain("report as a remaining gap")
    expect(normalized).toContain("Do not request, evaluate, or block on mobile/tablet reference evidence")
    expect(normalized).toContain("A passed visual QA report for a bound reference region should cite fresh")
    expect(normalized).toContain("cannot satisfy `reference_parity.reference_comparison_evidence_refs`")
    expect(normalized).toContain("submit the visual QA report with the exact blocker or remaining evidence gap")
    expect(normalized).toContain(
      "A single full-page screenshot or single slice cannot prove the whole page is accepted",
    )
    expect(normalized).toContain("list the uncovered screen as a production blocker")
  })

  test("runtime delegation requires one-to-one reference-image acceptance evidence", () => {
    const prompt = VisualQaTestHooks.buildVisualQaUserPrompt({
      taskTitle: "Clone reference",
      taskRequest: "Copy the attached reference image.",
      reason: "Need strict reference comparison.",
    })

    expect(prompt).toContain("final frontend visual GUI and functional product review")
    expect(prompt).toContain("Reference/clone fidelity is in scope only when")
    expect(prompt).toContain("professional product designer and design QA reviewer")
    expect(prompt).toContain("Do not chase visual scores or external judge verdicts")
    expect(prompt).toContain("prioritize screenshot comparison")
    expect(prompt).toContain("inspect the page screen by screen")
    expect(prompt).toContain("Do not judge the whole webpage from one full-page screenshot")
    expect(prompt).toContain("browser_preview_reference_regions")
    expect(prompt).toContain("formal bound-region proof")
    expect(prompt).toContain("browser_preview_compare_scroll_slices")
    expect(prompt).toContain("Do not request, evaluate, or block on mobile/tablet reference evidence")
    expect(prompt).toContain("`reference-comparison` evidence")
    expect(prompt).toContain("instead of inventing proof or reference-comparison refs")
    expect(prompt).toContain("supporting visual_diff evidence")
    expect(prompt).toContain("per-screen screenshots or scroll-slice comparisons")
    expect(prompt).toContain("no production_blockers")
    expect(prompt).toContain("Product Design QA Principles")
    expect(prompt).toContain("component-truth")
    expect(prompt).toContain("reference-structure")
    expect(prompt).toContain("production blocker must cite at least one principle ID")
  })

  test("frontend design context emits strict instructions only when reference artifacts exist", () => {
    const withoutReference = renderVisualQaFrontendDesignContext([
      {
        key: "visual_consistency_contract",
        value: "Responsive page remains readable.",
        reason: "visual contract",
      },
    ])
    const withReference = renderVisualQaFrontendDesignContext([
      {
        key: "reference_artifacts",
        value: "- .opencorvus/r/t/ab/cdef12/fd/reference.png",
        reason: "reference image",
      },
    ])

    expect(withoutReference).not.toContain("Reference Evidence Scope")
    expect(withReference).toContain("Reference Evidence Scope")
    expect(withReference).toContain("Reference artifacts are evidence, not an automatic universal clone requirement")
    expect(withReference).toContain("Enforce reference/parity fidelity only when")
  })

  test("reference artifacts alone do not require authoritative region parity", () => {
    const artifactOnly = deriveVisualQaReferenceParityContext({
      taskID: "tsk_visual_ref",
      goals: [],
      frontendDesignEntries: [
        {
          key: "reference_artifacts",
          value: "- web-clone-source/reference.png",
        },
      ],
    })
    const evidenceBundle = deriveVisualQaReferenceParityContext({
      taskID: "tsk_visual_ref",
      goals: [],
      visualEvidence: [
        {
          id: "bundle_1",
          taskID: "tsk_visual_ref",
          source: "frontend_design",
          reference: { path: "reference.png", sha256: "ref", width: 1440, height: 900 },
          rendered: {
            path: "rendered.png",
            sha256: "rendered",
            width: 1440,
            height: 900,
            capturedAt: "2026-06-21T00:00:00.000Z",
            viewport: { width: 1440, height: 900 },
            appURL: "http://127.0.0.1:4173/",
            projectDirectory: "/tmp/project",
          },
          inspection: {
            reviewedAt: "2026-06-21T00:00:00.000Z",
            status: "passing",
            blockerCount: 0,
            notes: "Reviewed.",
          },
          regions: [
            {
              id: "region_header",
              label: "Header",
              requirementIDs: ["REQ-1"],
              acceptanceSpecIDs: ["acc-1"],
              sourceRefs: ["reference.png"],
              viewport: "desktop",
              cropIntent: "full-region",
              required: true,
              status: "passing",
              evidenceRefs: ["browser_preview_evidence:art_ref_cmp"],
              notes: "Compared.",
            },
          ],
        },
      ],
    })

    expect(artifactOnly).toEqual({ required: false, regions: [] })
    expect(evidenceBundle).toEqual({ required: true, regions: ["region_header@desktop"] })
  })

  test("frontend research reference image ids trigger strict context", () => {
    const context = renderVisualQaFrontendResearchContext({
      artifactID: "art_frontend_reference",
      brief: researchBriefWithReference(),
    })

    expect(context).toContain("reference_image_evidence_ids: frontend_research:art_frontend_reference:ev_ref")
    expect(context).toContain("Reference Evidence Scope")
    expect(context).toContain("not an automatic universal clone requirement")
  })

  test("VisualEvidenceBundle schema rejects unknown fields instead of stripping parallel evidence sources", () => {
    const bundle = visualEvidenceBundle()

    expect(VisualEvidenceBundleSchema.safeParse(bundle).success).toBe(true)
    expect(VisualEvidenceBundleSchema.safeParse({ ...bundle, sourceUrl: "https://example.com" }).success).toBe(false)
    expect(
      VisualEvidenceBundleSchema.safeParse({
        ...bundle,
        rendered: { ...bundle.rendered, appUrl: "http://127.0.0.1:4173/" },
      }).success,
    ).toBe(false)
    expect(
      VisualEvidenceBundleSchema.safeParse({
        ...bundle,
        regions: [{ ...bundle.regions[0], screenshotArtifact: "standalone.png" }],
      }).success,
    ).toBe(false)
    expect(
      VisualEvidenceBundleSchema.safeParse({
        ...bundle,
        regions: [
          {
            ...bundle.regions[0],
            bounds: { x: 0, y: 0, width: 100, height: 60, sourceUrl: "https://example.com" },
          },
        ],
      }).success,
    ).toBe(false)
  })
})

function visualEvidenceBundle() {
  return {
    id: "bundle_1",
    taskID: "tsk_visual_ref",
    source: "frontend_design",
    reference: { path: "reference.png", sha256: "ref", width: 1440, height: 900 },
    rendered: {
      path: "rendered.png",
      sha256: "rendered",
      width: 1440,
      height: 900,
      capturedAt: "2026-06-21T00:00:00.000Z",
      viewport: { width: 1440, height: 900 },
      appURL: "http://127.0.0.1:4173/",
      projectDirectory: "/tmp/project",
    },
    inspection: {
      reviewedAt: "2026-06-21T00:00:00.000Z",
      status: "passing",
      blockerCount: 0,
      notes: "Reviewed.",
    },
    regions: [
      {
        id: "region_header",
        label: "Header",
        requirementIDs: ["REQ-1"],
        acceptanceSpecIDs: ["acc-1"],
        sourceRefs: ["reference.png"],
        viewport: "desktop",
        cropIntent: "full-region",
        required: true,
        status: "passing",
        evidenceRefs: ["browser_preview_evidence:art_ref_cmp"],
        notes: "Compared.",
      },
    ],
  }
}

function researchBriefWithReference(): ResearchBrief {
  return {
    metadata: {
      research_session_id: "ses_research",
      created_for_message_id: "msg_1",
      request_hash: "hash",
      source_digest: "digest",
      created_at: "2026-06-09T00:00:00.000Z",
    },
    scope: {
      user_goal: "Clone page",
      deliverable_type: "implementation_input",
      audience: "frontend",
      explicit_non_goals: [],
      assumed_non_goals: [],
    },
    bundle: undefined,
    summary: "",
    evidence_index: [],
    facts: [],
    inferences: [],
    problem_statements: [],
    user_needs: [],
    constraints: [],
    document_outline: [],
    webpage_contract: {
      source_url: "https://example.com/page",
      reference_image_evidence_ids: ["ev_ref"],
      functional_surfaces: [],
      visual_layout: [],
      style_requirements: [],
      interaction_states: [],
      data_content_inventory: [],
      fidelity_acceptance: [],
      fidelity_risks: [],
    },
    subpage_research_tasks: [],
    open_questions: [],
  }
}
