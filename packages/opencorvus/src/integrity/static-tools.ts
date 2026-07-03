import { BrowserPreviewToolID } from "@/tool/browser-preview-tool-ids"
import type { Tool } from "@/tool/tool"

export const INTEGRITY_PREVIEW_TOOL_IDS = [BrowserPreviewToolID] as const
export const INTEGRITY_DECLARED_TOOL_IDS = [
  ...INTEGRITY_PREVIEW_TOOL_IDS,
  "skill",
  "request_orchestrator_decision",
] as const

export const INTEGRITY_OUTPUT_TOOL_IDS = [
  "register_integrity_check_item",
  "register_integrity_reviewer_report",
  "register_integrity_coverage_audit",
  "register_integrity_uninspected_risk",
  "register_integrity_finding",
  "register_integrity_round",
  "register_integrity_required_repair",
  "register_integrity_unresolved_disagreement",
  "register_integrity_fact_check_item",
  "submit_integrity_consensus",
] as const

export async function loadIntegrityPreviewToolInfos(): Promise<readonly Tool.Info[]> {
  const { BrowserPreviewTool } = await import("@/tool/browser-preview")
  return [BrowserPreviewTool] as const
}
