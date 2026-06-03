import { limitSummary, markdownList, requireReportString } from "@/agent/report"
import type { BuildResult } from "./types"

export interface BuildReportCollector {
  result?: BuildResult
}

export function buildBuildAgentReport(collector: BuildReportCollector) {
  const result = collector.result
  if (!result) throw new Error("agent report build result is missing")
  const summary = requireReportString(result.summary, "build result summary")
  const changedFiles = result.files_changed.map(
    (file) => `${file.path}: ${file.summary}`,
  )
  const detail = [
    `## Summary\n${summary}`,
    result.contract_restatement
      ? `## Contract Restatement\n${result.contract_restatement}`
      : undefined,
    result.followup_workload_guidance
      ? `## Follow-up Workload Guidance\n${result.followup_workload_guidance}`
      : undefined,
    `## Changed Files\n${changedFiles.length ? markdownList(changedFiles) : "- no changed files reported"}`,
  ].filter((section): section is string => Boolean(section))
  return {
    summary: limitSummary(summary),
    detail: detail.join("\n\n"),
  }
}
