export const MIRROR_ANALYSIS_TOOL_IDS = [
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_runtime_state",
  "webpage_image_extract",
  "webpage_image_compile",
  "webpage_image_analyze",
] as const

export const MIRROR_ACCEPTANCE_TOOL_IDS = [
  "webpage_render",
  "webpage_evaluate",
  "webpage_text_diff",
  "webpage_vision_judge",
] as const

export const MIRROR_TOOL_IDS = [
  ...MIRROR_ANALYSIS_TOOL_IDS,
  ...MIRROR_ACCEPTANCE_TOOL_IDS,
] as const

export type MirrorToolId = typeof MIRROR_TOOL_IDS[number]
export type MirrorAnalysisToolId = typeof MIRROR_ANALYSIS_TOOL_IDS[number]
export type MirrorAcceptanceToolId = typeof MIRROR_ACCEPTANCE_TOOL_IDS[number]

export function isMirrorToolId(id: string): id is MirrorToolId {
  return (MIRROR_TOOL_IDS as readonly string[]).includes(id)
}

export function isMirrorAnalysisToolId(id: string): id is MirrorAnalysisToolId {
  return (MIRROR_ANALYSIS_TOOL_IDS as readonly string[]).includes(id)
}

export function isMirrorAcceptanceToolId(id: string): id is MirrorAcceptanceToolId {
  return (MIRROR_ACCEPTANCE_TOOL_IDS as readonly string[]).includes(id)
}
