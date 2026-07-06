import { describe, expect, test } from "bun:test"
import VISUAL_QA_CORE from "../../src/prompt/core/visual-qa-core.txt"
import { deriveVisualQaReferenceParityContext } from "../../src/visual-qa/reference-parity-context"
import { VisualQaTestHooks } from "../../src/visual-qa"
import { renderVisualQaFrontendDesignContext, renderVisualQaFrontendResearchContext } from "../../src/visual-qa/context"
import type { ResearchBrief } from "../../src/research/schema"

describe("visual-qa final blocker-based acceptance", () => {
  test("core prompt scopes reference parity to explicit task evidence", () => {
    const normalized = VISUAL_QA_CORE.replace(/\s+/g, " ")

    expect(normalized).toContain("visual GUI and functional product-review agent")
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
    expect(normalized).toContain("use `browser_preview_reference_regions` only for module source-binding proof")
    expect(normalized).toContain("single returned source/local module comparison attachment")
    expect(normalized).toContain(
      "`browser_preview_compare_scroll_slices` side-by-side evidence for supporting first-viewport and page-slice visual inspection",
    )
    expect(normalized).toContain("concrete component or module regions")
    expect(normalized).toContain("do not use it to bind a first-viewport slice")
    expect(normalized).toContain("whole-page screenshot, body/main/app root, or page-shell locator")
    expect(normalized).toContain("supporting first-viewport and page-slice visual inspection")
    expect(normalized).toContain("Keep `scrollY` and `sliceHeight` aligned with the source slice")
    expect(normalized).toContain("share the same viewport-slice contract")
    expect(normalized).toContain("comparison_guidance.side_by_side_legend")
    expect(normalized).toContain("LEFT is the source/reference image")
    expect(normalized).toContain("RIGHT is the rendered/local implementation")
    expect(normalized).toContain("missing or wrong icons/assets")
    expect(normalized).toContain("hallucinated or missing content")
    expect(normalized).toContain("chart/table/map scale errors")
    expect(normalized).toContain("do not treat a status flag alone as proof")
    expect(normalized).toContain("Tool execution completion is not acceptance evidence")
    expect(normalized).toContain("`state.status=completed`, a returned attachment, or a registered evidence row")
    expect(normalized).toContain("Cite the returned `browser_preview_evidence:<evidenceID>` ref")
    expect(normalized).toContain("does not run a second `reference-comparison` pass")
    expect(normalized).toContain("Browser MCP screenshot/observe tools")
    expect(normalized).toContain(
      "report the preview-target or route blocker with unresolved code-module details for the current workflow implementation owner",
    )
    expect(normalized).toContain("Inspect the visible mismatch yourself")
    expect(normalized).toContain("as a remaining gap")
    expect(normalized).toContain("record the problem DOM in `problem_dom_regions`")
    expect(normalized).toContain("Document Object Model")
    expect(normalized).toContain("code-search terms")
    expect(normalized).toContain("repair input for the current workflow implementation owner, not visual proof")
    expect(normalized).toContain("Do not request, evaluate, or block on mobile/tablet reference evidence")
    expect(normalized).toContain("register a `multi-viewport-alignment` check item")
    expect(normalized).toContain("Broad heading or section enumeration is only a discovery aid")
    expect(normalized).toContain("shared-rail groups must include every affected downstream section such as `News`")
    expect(normalized).toContain("shared layout anchors")
    expect(normalized).toContain("cross-viewport alignment")
    expect(normalized).toContain("A passed visual QA report for a bound module should cite fresh")
    expect(normalized).toContain("does not replace required task-scoped `reference-comparison` evidence")
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

    expect(prompt).toContain("frontend visual GUI and functional product review")
    expect(prompt).toContain("Reference/clone fidelity is in scope only when")
    expect(prompt).toContain("professional product designer and design QA reviewer")
    expect(prompt).toContain("Do not chase visual scores or external judge verdicts")
    expect(prompt).toContain("prioritize screenshot comparison")
    expect(prompt).toContain("inspect the page screen by screen")
    expect(prompt).toContain("Do not judge the whole webpage from one full-page screenshot")
    expect(prompt).toContain("browser_preview_reference_regions")
    expect(prompt).toContain("one source-binding module comparison")
    expect(prompt).toContain("browser_preview_compare_scroll_slices")
    expect(prompt).toContain("concrete component or module regions")
    expect(prompt).toContain("page-shell locator")
    expect(prompt).toContain("first-viewport")
    expect(prompt).toContain("Do not request, evaluate, or block on mobile/tablet reference evidence")
    expect(prompt).toContain("multi-viewport-alignment")
    expect(prompt).toContain("Geometry alignment discipline")
    expect(prompt).toContain("Tool result acceptance discipline")
    expect(prompt).toContain("`state.status=completed`, returned attachments, job IDs, or registered evidence rows are not acceptance proof")
    expect(prompt).toContain("cite the returned `browser_preview_evidence:<evidenceID>` ref")
    expect(prompt).toContain("every affected downstream section such as `News`")
    expect(prompt).toContain("shared layout anchors")
    expect(prompt).toContain("instead of inventing proof or reference-comparison refs")
    expect(prompt).toContain("supporting visual_diff evidence")
    expect(prompt).toContain("comparison_guidance.side_by_side_legend")
    expect(prompt).toContain("LEFT is the source/reference image")
    expect(prompt).toContain("RIGHT is the rendered/local implementation")
    expect(prompt).toContain("missing or wrong icons/assets")
    expect(prompt).toContain("hallucinated or missing content")
    expect(prompt).toContain("per-screen screenshots or scroll-slice comparisons")
    expect(prompt).toContain("problem_dom_regions")
    expect(prompt).toContain("computed styles")
    expect(prompt).toContain("code-search terms")
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

  test("reference artifacts require rendered visual feedback verification without becoming pass evidence", () => {
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

    expect(artifactOnly).toEqual({ required: true, regions: [] })
  })

  test("frontend final acceptance mode requires rendered visual feedback verification", () => {
    const finalAcceptanceModeOnly = deriveVisualQaReferenceParityContext({
      taskID: "tsk_visual_ref",
      goals: [],
      frontendDesignEntries: [
        {
          key: "final_acceptance_mode",
          value: "visual_baseline_allowed",
        },
      ],
    })

    expect(finalAcceptanceModeOnly).toEqual({ required: true, regions: [] })
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

})

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
