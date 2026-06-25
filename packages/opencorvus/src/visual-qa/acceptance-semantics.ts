import type { VisualQaReport } from "./schema"

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
  if (report.coverage.length === 0) {
    issues.push("accepted=true was submitted without coverage items naming checked regions/viewports/states.")
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
  if (report.follow_up_task) {
    issues.push("accepted=true was submitted with follow_up_task; that means visual QA did not fully accept.")
  }
  if (report.reference_parity.required) {
    if (report.reference_parity.required_regions.length === 0) {
      issues.push("accepted=true was submitted for reference parity without reference_parity.required_regions entries.")
    }
    const directComparisonRefs = new Set([
      ...report.reference_parity.reference_comparison_evidence_refs,
      ...report.evidence.filter((item) => item.type === "reference_comparison").map((item) => item.ref),
    ])
    if (directComparisonRefs.size === 0) {
      issues.push(
        "accepted=true was submitted for reference parity without browser_preview_compare_regions reference_comparison evidence refs.",
      )
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
