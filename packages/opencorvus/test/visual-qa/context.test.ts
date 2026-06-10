import { describe, expect, test } from "bun:test"
import {
  renderVisualQaBuildEvidenceContext,
  renderVisualQaFrontendDesignContext,
  renderVisualQaFrontendResearchContext,
  renderVisualQaIntegrityContext,
  renderVisualQaPriorReportContext,
} from "../../src/visual-qa/context"
import type { ResearchBrief } from "../../src/research/schema"

describe("visual-qa context rendering", () => {
  test("frontend-design context keeps only visual QA pointers", () => {
    const context = renderVisualQaFrontendDesignContext([
      {
        key: "frontend_template",
        value: "DO_NOT_INLINE_TEMPLATE_BODY",
        reason: "too broad for visual QA startup",
      },
      {
        key: "visual_consistency_contract",
        value: "Desktop hero aligns to reference screenshot; mobile nav remains visible.",
        reason: "visual contract",
      },
      {
        key: "reference_artifacts",
        value: "- .opencorvus/runtime/tasks/tsk/frontend-design/webpage-evidence/reference.png",
        reason: "reference image",
      },
    ])

    expect(context).toContain("Frontend Design Pointers")
    expect(context).toContain("visual_consistency_contract")
    expect(context).toContain("reference.png")
    expect(context).toContain("Strict Reference Image Fidelity")
    expect(context).toContain("authoritative visual truth")
    expect(context).toContain("Require 1:1 layout and style fidelity")
    expect(context).toContain("not a relaxed similarity standard")
    expect(context).not.toContain("DO_NOT_INLINE_TEMPLATE_BODY")
    expect(context).not.toContain("frontend_template")
  })

  test("frontend-design context does not add strict reference-image instructions without reference artifacts", () => {
    const context = renderVisualQaFrontendDesignContext([
      {
        key: "visual_consistency_contract",
        value: "Desktop hero remains readable and mobile nav remains visible.",
        reason: "visual contract",
      },
    ])

    expect(context).toContain("visual_consistency_contract")
    expect(context).not.toContain("Strict Reference Image Fidelity")
  })

  test("frontend-research context omits full research JSON and non-QA sections", () => {
    const context = renderVisualQaFrontendResearchContext(validResearchBrief())

    expect(context).toContain("Frontend Research Pointers")
    expect(context).toContain("https://example.com/page")
    expect(context).toContain("functional_surfaces")
    expect(context).toContain("Primary search")
    expect(context).toContain("visual_layout")
    expect(context).toContain("Hero")
    expect(context).toContain("fidelity_acceptance")
    expect(context).toContain("bundle_paths")
    expect(context).toContain("Strict Reference Image Fidelity")
    expect(context).toContain("authoritative visual truth")
    expect(context).toContain("Require 1:1 layout and style fidelity")
    expect(context).not.toContain("```json")
    expect(context).not.toContain("SHOULD_NOT_APPEAR_RESEARCH_FACT")
    expect(context).not.toContain("SHOULD_NOT_APPEAR_OPEN_QUESTION")
    expect(context).not.toContain('"webpage_contract"')
  })

  test("build evidence context keeps summaries and changed files instead of diffs", () => {
    const context = renderVisualQaBuildEvidenceContext([
      {
        id: "acc_1",
        task_id: "tsk_1",
        run_id: "run_1",
        goal_run_id: null,
        status: "delivered",
        summary: "Implemented the table and filter controls.",
        result: {
          changed_files: ["src/App.tsx", "src/App.css"],
          commit_ref: "abc123",
          diffs: [{ file: "src/App.tsx", diff: "GIANT_DIFF_SHOULD_NOT_APPEAR" }],
        },
        time_created: 1,
        time_updated: 1,
      },
    ])

    expect(context).toContain("Build Evidence Pointers")
    expect(context).toContain("Implemented the table and filter controls")
    expect(context).toContain("src/App.tsx")
    expect(context).toContain("abc123")
    expect(context).not.toContain("GIANT_DIFF_SHOULD_NOT_APPEAR")
  })

  test("prior visual QA context keeps latest summary and latest report excerpt only", () => {
    const context = renderVisualQaPriorReportContext([
      { key: "report_1", value: "OLD_REPORT_SHOULD_NOT_APPEAR", reason: "old" },
      { key: "latest_summary", value: "accepted=false\nfindings=1", reason: "latest summary" },
      { key: "report_2", value: "finding_mobile_overlap", reason: "latest report" },
    ])

    expect(context).toContain("Prior Visual QA Pointers")
    expect(context).toContain("accepted=false")
    expect(context).toContain("finding_mobile_overlap")
    expect(context).not.toContain("OLD_REPORT_SHOULD_NOT_APPEAR")
  })

  test("integrity context keeps bounded post-build repair priorities", () => {
    const context = renderVisualQaIntegrityContext({
      id: "artifact_integrity",
      payload: {
        verdict: "needs_correction",
        reason: "The dashboard uses a fake static chart and a dead filter.",
        findings_count: 2,
        required_repairs_count: 1,
        findings: [
          {
            severity: "major",
            title: "Fake chart",
            description: "Replace the placeholder bars with a real chart bound to the app data contract.",
          },
        ],
        required_repairs: [
          {
            reason: "Static mock chart does not satisfy the visible data requirement.",
            repair: "Implement a real chart component and verify the filter updates it.",
          },
        ],
        team_report_markdown: "TEAM_REPORT_WITH_FAKE_CHART_FINDING",
      },
    })

    expect(context).toContain("Integrity Review Pointers")
    expect(context).toContain("verdict: needs_correction")
    expect(context).toContain("Fake chart")
    expect(context).toContain("component truth and visible functionality first")
    expect(context).toContain("static mock charts")
    expect(context).toContain("layout/composition second")
    expect(context).toContain("state-style polish last")
  })
})

function validResearchBrief(): ResearchBrief {
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
    bundle: {
      full_markdown_path: ".opencorvus/runtime/tasks/tsk/frontend-research/ses/research-bundle.md",
      evidence_json_path: ".opencorvus/runtime/tasks/tsk/frontend-research/ses/evidence.json",
      citation_map_path: ".opencorvus/runtime/tasks/tsk/frontend-research/ses/citations.json",
    },
    summary: "SHOULD_NOT_APPEAR_RESEARCH_SUMMARY",
    evidence_index: [
      {
        id: "ev_ref",
        kind: "web",
        pointer: "reference.png",
        title: "Reference screenshot",
        retrieved_at: "2026-06-09T00:00:00.000Z",
        reliability: "primary",
        excerpt: "Reference screenshot evidence.",
        volatile: false,
      },
    ],
    facts: [{ id: "fact_1", statement: "SHOULD_NOT_APPEAR_RESEARCH_FACT", evidence_ids: ["ev_ref"] }],
    inferences: [],
    problem_statements: [],
    user_needs: [],
    constraints: [],
    document_outline: [],
    webpage_contract: {
      source_url: "https://example.com/page",
      reference_image_evidence_ids: ["ev_ref"],
      functional_surfaces: [
        {
          id: "fn_search",
          title: "Primary search",
          user_visible_behavior: "Typing filters visible rows.",
          required_interactions: ["type query", "clear query"],
          evidence_ids: ["ev_ref"],
        },
      ],
      visual_layout: [
        {
          id: "layout_hero",
          viewport: "desktop",
          region: "Hero",
          layout_contract: "Hero occupies the top band with dense controls aligned right.",
          spacing_and_alignment: "24px vertical rhythm.",
          evidence_ids: ["ev_ref"],
        },
      ],
      style_requirements: [
        {
          id: "style_button",
          token_or_selector: ".primary",
          requirement: "Primary button uses the source blue.",
          evidence_ids: ["ev_ref"],
        },
      ],
      interaction_states: [
        {
          id: "state_focus",
          component: "Search input",
          state: "focus",
          behavior: "Focus ring remains visible.",
          evidence_ids: ["ev_ref"],
        },
      ],
      data_content_inventory: [
        {
          id: "data_rows",
          surface: "Results table",
          content_contract: "Rows show company name and status.",
          evidence_ids: ["ev_ref"],
        },
      ],
      fidelity_acceptance: [
        {
          id: "fid_hero",
          target: "Hero",
          criterion: "Desktop screenshot should match reference hierarchy and spacing.",
          evidence_ids: ["ev_ref"],
        },
      ],
      fidelity_risks: [],
    },
    subpage_research_tasks: [],
    open_questions: [
      {
        id: "q_1",
        question: "SHOULD_NOT_APPEAR_OPEN_QUESTION",
        blocking: false,
        related_fact_ids: [],
      },
    ],
  }
}
