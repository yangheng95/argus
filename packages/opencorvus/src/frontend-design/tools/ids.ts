export const WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS = [
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_runtime_state",
] as const

export const WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS = [
  "webpage_render",
  "webpage_evaluate",
  "webpage_text_diff",
  "webpage_vision_judge",
] as const

export const WEBPAGE_EVIDENCE_TOOL_IDS = [
  ...WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS,
  ...WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS,
] as const

export type WebpageEvidenceToolId = typeof WEBPAGE_EVIDENCE_TOOL_IDS[number]
export type WebpageEvidenceAnalysisToolId = typeof WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS[number]
export type WebpageEvidenceAcceptanceToolId = typeof WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS[number]

export function isWebpageEvidenceToolId(id: string): id is WebpageEvidenceToolId {
  return (WEBPAGE_EVIDENCE_TOOL_IDS as readonly string[]).includes(id)
}

export function isWebpageEvidenceAnalysisToolId(id: string): id is WebpageEvidenceAnalysisToolId {
  return (WEBPAGE_EVIDENCE_ANALYSIS_TOOL_IDS as readonly string[]).includes(id)
}

export function isWebpageEvidenceAcceptanceToolId(id: string): id is WebpageEvidenceAcceptanceToolId {
  return (WEBPAGE_EVIDENCE_ACCEPTANCE_TOOL_IDS as readonly string[]).includes(id)
}
