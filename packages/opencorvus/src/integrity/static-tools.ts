import { BROWSER_PREVIEW_REPAIR_TOOL_IDS } from "@/tool/browser-preview-tool-ids"
import type { Tool } from "@/tool/tool"

export const INTEGRITY_PREVIEW_TOOL_IDS = [...BROWSER_PREVIEW_REPAIR_TOOL_IDS] as const
export const INTEGRITY_DECLARED_TOOL_IDS = [...INTEGRITY_PREVIEW_TOOL_IDS, "skill"] as const

export async function loadIntegrityPreviewToolInfos(): Promise<readonly Tool.Info[]> {
  const [{ BrowserPreviewTool }, { BrowserPreviewBindLocalModuleTool }, { BrowserPreviewCompareRegionsTool }] =
    await Promise.all([
      import("@/tool/browser-preview"),
      import("@/tool/browser-preview-bind-local-module"),
      import("@/tool/browser-preview-compare-regions"),
    ])
  return [BrowserPreviewTool, BrowserPreviewBindLocalModuleTool, BrowserPreviewCompareRegionsTool] as const
}
