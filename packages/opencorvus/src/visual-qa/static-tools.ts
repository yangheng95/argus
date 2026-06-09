import { WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS } from "@/frontend-design/tools/ids"

export const VISUAL_QA_CONTEXT_TOOL_IDS = [
  "read_file",
  "find_files",
  "search_code",
  "list_directory",
  "memory_search",
  "memory_get",
] as const

export const VISUAL_QA_IMPLEMENTATION_TOOL_IDS = [
  "bash",
  "edit",
  "write",
  "apply_patch",
  ...WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS,
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
