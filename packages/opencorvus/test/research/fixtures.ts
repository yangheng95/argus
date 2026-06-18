import { researchRequestHash, researchSourceDigest, type ResearchBrief } from "../../src/research/schema"
import { ProjectRuntimePaths } from "../../src/project/runtime-paths"

export function validResearchBrief(
  request = "research request",
  overrides: Partial<ResearchBrief> = {},
): ResearchBrief {
  const bundleRoot = ProjectRuntimePaths.deepResearchPaths(
    "",
    "tsk_research_fixture",
    "ses_research_fixture",
  ).relativeDir
  const evidence = [
    {
      id: "ev_1",
      kind: "web" as const,
      pointer: "https://example.com/docs",
      title: "Example docs",
      retrieved_at: "2026-05-31T00:00:00.000Z",
      reliability: "primary" as const,
      excerpt: "Example documentation excerpt.",
      bundle_ref: "research-bundle.md#ev_1",
      volatile: false,
    },
  ]
  const base: ResearchBrief = {
    metadata: {
      research_session_id: "ses_research_1",
      created_for_message_id: "msg_research_1",
      request_hash: researchRequestHash(request),
      source_digest: researchSourceDigest(evidence),
      created_at: "2026-05-31T00:00:00.000Z",
    },
    scope: {
      user_goal: "Prepare an evidence-backed PRD input.",
      deliverable_type: "prd",
      audience: "product and engineering",
      explicit_non_goals: [],
      assumed_non_goals: [],
    },
    bundle: {
      full_markdown_path: `${bundleRoot}/research-bundle.md`,
      evidence_json_path: `${bundleRoot}/evidence.json`,
      citation_map_path: `${bundleRoot}/citation-map.json`,
    },
    summary: "Evidence-backed summary.",
    evidence_index: evidence,
    facts: [
      {
        id: "fact_1",
        statement: "Example docs describe the relevant behavior.",
        evidence_ids: ["ev_1"],
      },
    ],
    inferences: [
      {
        id: "inf_1",
        inference: "The behavior should be reflected as a product constraint.",
        based_on_fact_ids: ["fact_1"],
        confidence: "medium",
      },
    ],
    problem_statements: [
      {
        id: "prob_1",
        statement: "Users need a documented, evidence-backed workflow.",
        fact_ids: ["fact_1"],
      },
    ],
    user_needs: [
      {
        id: "need_1",
        need: "Users need citations for external claims.",
        fact_ids: ["fact_1"],
      },
    ],
    constraints: [
      {
        id: "con_1",
        constraint: "External facts must cite primary evidence.",
        fact_ids: ["fact_1"],
      },
    ],
    document_outline: [
      {
        id: "sec_1",
        title: "Evidence",
        purpose: "Summarize source-backed facts.",
        evidence_ids: ["ev_1"],
      },
    ],
    subpage_research_tasks: [],
    open_questions: [
      {
        id: "oq_1",
        question: "Which audience should own approval?",
        blocking: true,
        related_fact_ids: ["fact_1"],
      },
    ],
  }
  return {
    ...base,
    ...overrides,
    metadata: { ...base.metadata, ...overrides.metadata },
    scope: { ...base.scope, ...overrides.scope },
    bundle: { ...base.bundle, ...overrides.bundle },
  }
}
