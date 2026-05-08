export const MIRROR_TOOL_IDS = [
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_image_extract",
  "webpage_image_compile",
  "webpage_image_analyze",
  "webpage_render",
  "webpage_evaluate",
  "webpage_text_diff",
  "webpage_vision_judge",
  "figma_extract",
  "figma_compile",
  "figma_analyze",
] as const

export type MirrorToolId = typeof MIRROR_TOOL_IDS[number]

export function isMirrorToolId(id: string): id is MirrorToolId {
  return (MIRROR_TOOL_IDS as readonly string[]).includes(id)
}
