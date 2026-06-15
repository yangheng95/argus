import { tool } from "ai"
import { limitSummary, markdownList, requireReportString } from "@/agent/report"
import { VisualQaReportSchema, type VisualQaReport } from "./schema"

export interface VisualQaCollector {
  final?: VisualQaReport
}

function emptyCollector(): VisualQaCollector {
  return {}
}

function openBlockingFindings(report: VisualQaReport): VisualQaReport["findings"] {
  return report.findings.filter(
    (finding) => finding.status === "open" && (finding.severity === "critical" || finding.severity === "major"),
  )
}

function validateVisualQaReport(report: VisualQaReport): string[] {
  const issues: string[] = []
  if (report.accepted && report.evidence.length === 0) {
    issues.push("accepted=true requires at least one fresh visual and functional evidence item.")
  }
  if (report.accepted && report.coverage.length === 0) {
    issues.push("accepted=true requires at least one coverage item naming checked regions/viewports/states.")
  }
  const openBlocking = openBlockingFindings(report)
  if (report.accepted && openBlocking.length > 0) {
    issues.push(
      `accepted=true is incompatible with open critical/major findings: ${openBlocking.map((finding) => finding.id).join(", ")}.`,
    )
  }
  if (report.accepted && report.production_blockers.length > 0) {
    issues.push(
      `accepted=true is incompatible with production blockers: ${report.production_blockers.map((blocker) => blocker.id).join(", ")}.`,
    )
  }
  if (!report.accepted && report.production_blockers.length === 0 && openBlocking.length === 0) {
    issues.push("accepted=false requires production_blockers or open critical/major findings with actionable evidence.")
  }
  return issues
}

export function buildVisualQaReport(collector: VisualQaCollector) {
  if (!collector.final) throw new Error("visual QA report is missing")
  const report = collector.final
  const findingLines = report.findings.map(
    (finding) => `${finding.id} [${finding.severity}/${finding.status}] ${finding.region}: ${finding.claim}`,
  )
  const blockerLines = report.production_blockers.map(
    (blocker) =>
      `${blocker.id} [${blocker.principle_ids.join(", ")}] ${blocker.region}: ${blocker.reason}; impact=${blocker.impact}; required=${blocker.required_correction}`,
  )
  const coverageLines = report.coverage.map(
    (coverage) =>
      `${coverage.region}: ${coverage.viewports.length} viewport(s), ${coverage.states.length} state(s), evidence=${coverage.evidence_refs.join(", ") || "(none)"}`,
  )
  return {
    summary: limitSummary(report.summary),
    detail: [
      `## Accepted\n${report.accepted ? "true" : "false"}`,
      `## Summary\n${requireReportString(report.summary, "visual QA summary")}`,
      `## Coverage\n${coverageLines.length ? markdownList(coverageLines) : "- no coverage submitted"}`,
      `## Findings\n${findingLines.length ? markdownList(findingLines) : "- no findings"}`,
      `## Production Blockers\n${blockerLines.length ? markdownList(blockerLines) : "- none"}`,
      `## Evidence\n${report.evidence.length ? markdownList(report.evidence.map((item) => `${item.type}: ${item.ref} — ${item.note}`)) : "- no evidence submitted"}`,
      `## Repairs\n${report.repairs.length ? markdownList(report.repairs.map((repair) => `${repair.files_changed.join(", ") || "(no files)"}: ${repair.reason}`)) : "- no repairs"}`,
      `## Commands\n${report.commands.length ? markdownList(report.commands.map((command) => `${command.passed ? "passed" : "failed"} ${command.command}: ${command.detail}`)) : "- no commands"}`,
      `## Changed Files\n${report.changed_files.length ? markdownList(report.changed_files) : "- none"}`,
      `## Open Questions\n${report.open_questions.length ? markdownList(report.open_questions) : "- none"}`,
    ].join("\n\n"),
  }
}

export function createVisualQaOutputTools() {
  let collector = emptyCollector()
  const tools = {
    submit_visual_qa_report: tool({
      description:
        "Submit the final frontend visual GUI fidelity and functional QA report. GUI means Graphical User Interface. " +
        "Use accepted=true only with fresh visual and functional evidence, no open critical/major findings, and no production_blockers.",
      inputSchema: VisualQaReportSchema,
      execute: async (raw) => {
        if (collector.final)
          return "Error: visual QA report already submitted; duplicate submit_visual_qa_report ignored."
        const report = VisualQaReportSchema.parse(raw)
        const issues = validateVisualQaReport(report)
        if (issues.length > 0) {
          return `BLOCKERS (${issues.length}):\n${issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}\nFix the report or continue testing/repairing, then call submit_visual_qa_report again.`
        }
        collector.final = report
        return `PASS: visual QA report accepted with accepted=${report.accepted}.`
      },
    }),
  }

  return {
    tools,
    getCollector: () => collector,
    buildReport: () => buildVisualQaReport(collector),
    isReadyToFinalize: () => true,
    reset() {
      collector = emptyCollector()
      return collector
    },
  }
}
