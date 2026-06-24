export const VISUAL_QA_CONTEXT_TOOL_IDS = [
  "read",
  "glob",
  "search_code",
  "list",
  "memory_search",
  "memory_get",
] as const

export const VISUAL_QA_IMPLEMENTATION_TOOL_IDS = [
  "browser_preview",
  "browser_preview_bind_local_module",
  "browser_preview_compare_regions",
  "browser_preview_compare_scroll_slices",
  "bash",
  "edit",
  "write",
  "apply_patch",
] as const

export const VISUAL_QA_UTILITY_TOOL_IDS = ["skill"] as const

export const VISUAL_QA_STATIC_TOOL_IDS = [
  ...VISUAL_QA_CONTEXT_TOOL_IDS,
  ...VISUAL_QA_UTILITY_TOOL_IDS,
  ...VISUAL_QA_IMPLEMENTATION_TOOL_IDS,
] as const

export const VISUAL_QA_SESSION_TOOL_IDS = [...VISUAL_QA_STATIC_TOOL_IDS, "submit_visual_qa_report"] as const

export type VisualQaStaticToolID = (typeof VISUAL_QA_STATIC_TOOL_IDS)[number]
export type VisualQaSessionToolID = (typeof VISUAL_QA_SESSION_TOOL_IDS)[number]
