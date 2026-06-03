export const FRONTEND_DESIGN_STATIC_TOOL_IDS = [
  "bash",
  "edit",
  "write",
  "apply_patch",
  "read_file",
  "find_files",
  "search_code",
  "list_directory",
  "memory_search",
  "memory_get",
  "url_screenshot",
  "create_frontend_skeleton_project",
  "record_frontend_region_selection",
  "record_frontend_replacement_result",
  "web_clone_source_audit",
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_runtime_state",
  "webpage_image_extract",
  "webpage_image_compile",
  "webpage_image_analyze",
  "webpage_render",
  "webpage_evaluate",
  "webpage_text_diff",
  "webpage_vision_judge",
] as const

export const FRONTEND_DESIGN_SESSION_TOOL_IDS = [
  "bash",
  "edit",
  "write",
  "apply_patch",
  "read_file",
  "find_files",
  "search_code",
  "list_directory",
  "memory_search",
  "memory_get",
  "url_screenshot",
  "create_frontend_skeleton_project",
  "record_frontend_region_selection",
  "record_frontend_replacement_result",
  "web_clone_source_audit",
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_runtime_state",
  "webpage_image_extract",
  "webpage_image_compile",
  "webpage_image_analyze",
  "webpage_render",
  "webpage_evaluate",
  "webpage_text_diff",
  "webpage_vision_judge",
  "read_attachment",
  "submit_frontend_template",
] as const

export const FRONTEND_DESIGN_CONTEXT_TOOL_IDS = [
  "read_file",
  "find_files",
  "search_code",
  "list_directory",
  "memory_search",
  "memory_get",
] as const

export const FRONTEND_DESIGN_MIRROR_ANALYSIS_TOOL_IDS = [
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_runtime_state",
  "webpage_image_extract",
  "webpage_image_compile",
  "webpage_image_analyze",
] as const

export const FRONTEND_DESIGN_IMPLEMENTATION_TOOL_IDS = [
  "bash",
  "edit",
  "write",
  "apply_patch",
  "web_clone_source_audit",
  "webpage_render",
  "webpage_evaluate",
  "webpage_text_diff",
  "webpage_vision_judge",
] as const

export const FRONTEND_DESIGN_UTILITY_TOOL_IDS = [] as const

export type FrontendDesignStaticToolID = typeof FRONTEND_DESIGN_STATIC_TOOL_IDS[number]
export type FrontendDesignSessionToolID = typeof FRONTEND_DESIGN_SESSION_TOOL_IDS[number]
