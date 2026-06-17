import { BrowserPreviewTool } from "@/tool/browser-preview"
import { BrowserPreviewBindLocalModuleTool } from "@/tool/browser-preview-bind-local-module"
import { BrowserPreviewCompareRegionsTool } from "@/tool/browser-preview-compare-regions"

export const INTEGRITY_PREVIEW_TOOL_INFOS = [
  BrowserPreviewTool,
  BrowserPreviewBindLocalModuleTool,
  BrowserPreviewCompareRegionsTool,
] as const

export const INTEGRITY_PREVIEW_TOOL_IDS = INTEGRITY_PREVIEW_TOOL_INFOS.map((tool) => tool.id)
