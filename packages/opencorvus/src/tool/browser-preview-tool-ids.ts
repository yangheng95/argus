export const BrowserPreviewToolID = "browser_preview" as const
export const BrowserPreviewBindLocalModuleToolID = "browser_preview_bind_local_module" as const
export const BrowserPreviewCompareRegionsToolID = "browser_preview_compare_regions" as const
export const BrowserPreviewCompareScrollSlicesToolID = "browser_preview_compare_scroll_slices" as const

export const BROWSER_PREVIEW_REPAIR_TOOL_IDS = [
  BrowserPreviewToolID,
  BrowserPreviewBindLocalModuleToolID,
  BrowserPreviewCompareRegionsToolID,
] as const
