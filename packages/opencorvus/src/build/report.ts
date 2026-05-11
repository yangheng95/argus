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
  return {
    summary: limitSummary(summary),
    detail: [
      `## Summary\n${summary}`,
      `## Changed Files\n${changedFiles.length ? markdownList(changedFiles) : "- no changed files reported"}`,
    ].join("\n\n"),
  }
}
