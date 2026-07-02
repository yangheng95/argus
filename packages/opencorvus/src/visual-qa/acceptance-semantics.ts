import type { VisualQaAcceptance, VisualQaDecisionRecord, VisualQaReport } from "./schema"

export function visualQaOpenBlockingFindings(report: VisualQaReport): VisualQaReport["findings"] {
  return report.findings.filter(
    (finding) => finding.status === "open" && (finding.severity === "critical" || finding.severity === "major"),
  )
}

export function visualQaReportSelfReportIssues(report: VisualQaReport): string[] {
  if (!report.accepted) return []
  const issues: string[] = []
  if (report.evidence.length === 0) {
    issues.push("accepted=true was submitted without fresh visual or functional evidence items.")
  }
  if (!hasScreenshotBearingEvidence(report)) {
    issues.push("accepted=true was submitted without screenshot comparison or screen-by-screen screenshot evidence.")
  }
  if (report.coverage.length === 0) {
    issues.push("accepted=true was submitted without coverage items naming checked regions/viewports/states.")
  }
  if (report.check_items.length === 0) {
    issues.push("accepted=true was submitted without registered visual QA check_items.")
  }
  const unresolvedChecks = report.check_items
    .filter((item) => item.status === "failed" || item.status === "inconclusive")
    .map((item) => item.id)
  if (unresolvedChecks.length > 0) {
    issues.push(`accepted=true was submitted with failed/inconclusive check_items: ${unresolvedChecks.join(", ")}.`)
  }
  const openBlocking = visualQaOpenBlockingFindings(report)
  if (openBlocking.length > 0) {
    issues.push(
      `accepted=true was submitted with open critical/major findings: ${openBlocking.map((finding) => finding.id).join(", ")}.`,
    )
  }
  if (report.production_blockers.length > 0) {
    issues.push(
      `accepted=true was submitted with production blockers: ${report.production_blockers.map((blocker) => blocker.id).join(", ")}.`,
    )
  }
  if (report.unresolved_code_module_problems.length > 0) {
    issues.push(
      "accepted=true was submitted with unresolved_code_module_problems; that means visual QA did not fully accept.",
    )
  }
  if (report.reference_parity.required) {
    if (report.reference_parity.required_regions.length === 0) {
      issues.push("accepted=true was submitted for reference parity without reference_parity.required_regions entries.")
    }
    if (report.reference_parity.missing_regions.length > 0) {
      issues.push(
        `accepted=true was submitted with reference_parity.missing_regions: ${report.reference_parity.missing_regions.join(", ")}.`,
      )
    }
    if (report.reference_parity.blocker_ids.length > 0) {
      issues.push(
        `accepted=true was submitted with reference_parity.blocker_ids: ${report.reference_parity.blocker_ids.join(", ")}.`,
      )
    }
  }
  return issues
}

function hasScreenshotBearingEvidence(report: VisualQaReport): boolean {
  return report.evidence.some(
    (item) => item.type === "screenshot" || item.type === "reference_comparison" || item.type === "visual_diff",
  )
}

export function visualQaReportAcceptanceSemantics(report: VisualQaReport): {
  submittedAccepted: boolean
  effectiveAccepted: boolean
  selfReportIssues: string[]
} {
  const selfReportIssues = visualQaReportSelfReportIssues(report)
  return {
    submittedAccepted: report.accepted,
    effectiveAccepted: report.accepted && selfReportIssues.length === 0,
    selfReportIssues,
  }
}

export function visualQaDecisionRecordEffectiveAcceptance(record: VisualQaDecisionRecord): VisualQaAcceptance {
  const semantics = visualQaReportAcceptanceSemantics(record.report)
  const blockingIssues = [...new Set([...semantics.selfReportIssues, ...record.acceptance.blockingIssues])]
  return {
    submittedAccepted: semantics.submittedAccepted,
    effectiveAccepted: semantics.effectiveAccepted && record.acceptance.effectiveAccepted,
    selfReportIssues: semantics.selfReportIssues,
    blockingIssues,
  }
}
