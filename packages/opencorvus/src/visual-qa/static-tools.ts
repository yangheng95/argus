export const VISUAL_QA_CONTEXT_TOOL_IDS = ["read", "glob", "search_code", "list", "memory"] as const

export const VISUAL_QA_EVIDENCE_TOOL_IDS = ["browser_preview"] as const

export const VISUAL_QA_REFERENCE_EVIDENCE_TOOL_IDS = [
  "browser_preview_reference_regions",
  "browser_preview_compare_scroll_slices",
  "browser_preview_layout_geometry",
] as const

export const VISUAL_QA_RUNTIME_EVIDENCE_TOOL_IDS = [
  ...VISUAL_QA_EVIDENCE_TOOL_IDS,
  ...VISUAL_QA_REFERENCE_EVIDENCE_TOOL_IDS,
] as const

export const VISUAL_QA_UTILITY_TOOL_IDS = ["skill", "request_orchestrator_decision"] as const

export const VISUAL_QA_OUTPUT_TOOL_IDS = [
  "register_visual_qa_check_item",
  "register_visual_qa_coverage",
  "register_visual_qa_evidence",
  "register_visual_qa_finding",
  "register_visual_qa_production_blocker",
  "register_visual_qa_problem_dom_region",
  "register_visual_qa_unresolved_code_module_problem",
  "register_visual_qa_open_question",
  "register_visual_qa_fact_check_item",
  "set_visual_qa_reference_parity",
  "submit_visual_qa_report",
] as const

export const VISUAL_QA_STATIC_TOOL_IDS = [
  ...VISUAL_QA_CONTEXT_TOOL_IDS,
  ...VISUAL_QA_UTILITY_TOOL_IDS,
  ...VISUAL_QA_EVIDENCE_TOOL_IDS,
] as const

export const VISUAL_QA_SESSION_TOOL_IDS = [
  ...VISUAL_QA_STATIC_TOOL_IDS,
  ...VISUAL_QA_REFERENCE_EVIDENCE_TOOL_IDS,
  ...VISUAL_QA_OUTPUT_TOOL_IDS,
] as const

export type VisualQaStaticToolID = (typeof VISUAL_QA_STATIC_TOOL_IDS)[number]
export type VisualQaSessionToolID = (typeof VISUAL_QA_SESSION_TOOL_IDS)[number]
