import { describe, expect, test } from "bun:test"
import VISUAL_QA_CORE from "../../src/prompt/core/visual-qa-core.txt"
import { VisualQaTestHooks } from "../../src/visual-qa"
import { renderVisualQaFrontendDesignContext, renderVisualQaFrontendResearchContext } from "../../src/visual-qa/context"
import type { ResearchBrief } from "../../src/research/schema"

describe("visual-qa strict reference image fidelity", () => {
  test("core prompt forbids relaxed reference-image fidelity", () => {
    const normalized = VISUAL_QA_CORE.replace(/\s+/g, " ")

    expect(normalized).toContain("strict reference-image fidelity mode")
    expect(normalized).toContain("authoritative visual truth")
    expect(normalized).toContain("copy its layout and style 1:1")
    expect(normalized).toContain("one-to-one visible geometry and styling")
    expect(normalized).toContain("not a loose similarity target")
  })

  test("core prompt requires professional design production blockers instead of fixed score verdicts", () => {
    const normalized = VISUAL_QA_CORE.replace(/\s+/g, " ")

    expect(normalized).toContain("professional product designer and design QA reviewer")
    expect(normalized).toContain("production blockers")
    expect(normalized).toContain("Numeric similarity or visual-diff scores are evidence, not the verdict")
    expect(normalized).toContain("Do not use a fixed similarity score as the only pass/fail rule")
    expect(normalized).toContain("low-fidelity charts/maps/tables")
  })

  test("core prompt requires random preview ports", () => {
    const normalized = VISUAL_QA_CORE.replace(/\s+/g, " ")

    expect(normalized).toContain("use a random or dynamically discovered free high port")
    expect(normalized).toContain("Do not bind default shared ports such as 3000, 5173, or 4173")
    expect(normalized).toContain("unless the task explicitly assigns that exact port")
  })

  test("core prompt requires task-scoped region bind and comparison for clone work", () => {
    const normalized = VISUAL_QA_CORE.replace(/\s+/g, " ")

    expect(normalized).toContain("task-scoped preview repair chain as primary region evidence")
    expect(normalized).toContain("call `browser_preview_bind_local_module`")
    expect(normalized).toContain("pass that binding to `browser_preview_compare_regions`")
    expect(normalized).toContain("Treat `browser_preview_bind_local_module` evidence as `source-binding`")
    expect(normalized).toContain("cannot be cited as final Reference vs Implementation proof")
    expect(normalized).toContain("fresh `browser_preview_compare_regions` `reference-comparison` evidence")
    expect(normalized).toContain("repair the preview target or route first")
    expect(normalized).toContain("do not hand-normalize source bounding boxes")
    expect(normalized).toContain(
      "Do not substitute `webpage_render`, `webpage_evaluate`, `webpage_vision_judge`, or standalone screenshots as the final region-parity evidence",
    )
    expect(normalized).toContain("task-scoped `reference-comparison` artifacts")
    expect(normalized).toContain("fail the visual QA report with the exact blocker")
  })

  test("runtime delegation requires one-to-one reference-image acceptance evidence", () => {
    const prompt = VisualQaTestHooks.buildVisualQaUserPrompt({
      taskTitle: "Clone reference",
      taskRequest: "Copy the attached reference image.",
      reason: "Need strict reference comparison.",
    })

    expect(prompt).toContain("If any reference image is present")
    expect(prompt).toContain("require 1:1 layout and style fidelity")
    expect(prompt).toContain("not a relaxed similarity standard")
    expect(prompt).toContain("professional product designer and design QA reviewer")
    expect(prompt).toContain("Numeric similarity scores are evidence, not the verdict")
    expect(prompt).toContain("call `browser_preview_bind_local_module`")
    expect(prompt).toContain("pass the binding to `browser_preview_compare_regions`")
    expect(prompt).toContain("Treat `browser_preview_bind_local_module` evidence as `source-binding`")
    expect(prompt).toContain("cannot be cited as final Reference vs Implementation proof")
    expect(prompt).toContain("task-scoped `reference-comparison` evidence from `browser_preview_compare_regions`")
    expect(prompt).toContain("screenshot-only evidence as the final region-parity proof")
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

    expect(withoutReference).not.toContain("Strict Reference Image Fidelity")
    expect(withReference).toContain("Strict Reference Image Fidelity")
    expect(withReference).toContain("authoritative visual truth")
    expect(withReference).toContain("Require 1:1 layout and style fidelity")
  })

  test("frontend research reference image ids trigger strict context", () => {
    const context = renderVisualQaFrontendResearchContext(researchBriefWithReference())

    expect(context).toContain("reference_image_evidence_ids: ev_ref")
    expect(context).toContain("Strict Reference Image Fidelity")
    expect(context).toContain("not a relaxed similarity standard")
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
