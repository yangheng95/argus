// ID: Identifier. These tool IDs are host capabilities that must not be imported through role_base.
export const NON_BASE_FRONTEND_TOOL_IDS = [
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_runtime_state",
  "web_clone_prepare_context",
  "web_clone_generate_source_project",
  "create_frontend_skeleton_project",
  "create_visual_region_coordinate_atlas",
  "create_visual_region_binding_package",
  "record_frontend_region_selection",
  "record_frontend_replacement_result",
  "browser_preview_reference_regions",
  "browser_preview_compare_scroll_slices",
  "browser_preview_layout_geometry",
] as const

export const HOST_PREPARED_WEBPAGE_TOOL_IDS = [
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_runtime_state",
  "web_clone_prepare_context",
] as const

export const FRONTEND_EXPERT_DEFAULT_TOOL_IDS = [
  "web_clone_generate_source_project",
  "create_frontend_skeleton_project",
  "create_visual_region_coordinate_atlas",
  "create_visual_region_binding_package",
  "record_frontend_region_selection",
  "record_frontend_replacement_result",
  "browser_preview_reference_regions",
  "browser_preview_compare_scroll_slices",
  "browser_preview_layout_geometry",
] as const

export const RETIRED_WEBPAGE_VISUAL_TOOL_IDS = [
  "webpage_render",
  "webpage_evaluate",
  "webpage_text_diff",
  "webpage_vision_judge",
] as const

export const EXECUTOR_MCP_DENIED_TOOL_IDS = [
  ...NON_BASE_FRONTEND_TOOL_IDS,
  ...RETIRED_WEBPAGE_VISUAL_TOOL_IDS,
] as const

export type NonBaseFrontendToolID = (typeof NON_BASE_FRONTEND_TOOL_IDS)[number]
export type FrontendExpertDefaultToolID = (typeof FRONTEND_EXPERT_DEFAULT_TOOL_IDS)[number]
export type RetiredWebpageVisualToolID = (typeof RETIRED_WEBPAGE_VISUAL_TOOL_IDS)[number]
export type ExecutorMcpDeniedToolID = (typeof EXECUTOR_MCP_DENIED_TOOL_IDS)[number]
