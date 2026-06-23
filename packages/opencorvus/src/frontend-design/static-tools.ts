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
  "skill",
  "url_screenshot",
  "create_frontend_skeleton_project",
  "create_visual_region_coordinate_atlas",
  "create_visual_region_binding_package",
  "record_frontend_region_selection",
  "record_frontend_replacement_result",
  "web_clone_source_audit",
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_runtime_state",
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
  "skill",
  "url_screenshot",
  "create_frontend_skeleton_project",
  "create_visual_region_coordinate_atlas",
  "create_visual_region_binding_package",
  "record_frontend_region_selection",
  "record_frontend_replacement_result",
  "web_clone_source_audit",
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_runtime_state",
  "read_attachment",
  "update_frontend_basics",
  "update_frontend_text",
  "update_frontend_item",
  "update_frontend_material",
  "update_frontend_project",
  "update_frontend_component_reuse",
  "update_frontend_baseline",
  "update_frontend_phase",
  "update_frontend_visual_evidence",
  "update_frontend_iteration_note",
  "update_frontend_reference",
  "update_frontend_question",
  "inspect_frontend_result_status",
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

export const FRONTEND_DESIGN_WEBPAGE_EVIDENCE_TOOL_IDS = [
  "webpage_extract",
  "webpage_compile",
  "webpage_analyze",
  "webpage_runtime_state",
] as const

export const FRONTEND_DESIGN_IMPLEMENTATION_TOOL_IDS = [
  "bash",
  "edit",
  "write",
  "apply_patch",
  "web_clone_source_audit",
] as const

export const FRONTEND_DESIGN_UTILITY_TOOL_IDS = ["skill"] as const

export type FrontendDesignStaticToolID = (typeof FRONTEND_DESIGN_STATIC_TOOL_IDS)[number]
export type FrontendDesignSessionToolID = (typeof FRONTEND_DESIGN_SESSION_TOOL_IDS)[number]
