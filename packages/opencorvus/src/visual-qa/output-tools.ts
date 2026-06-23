import { tool } from "ai"
import { limitSummary, markdownList, requireReportString } from "@/agent/report"
import { browserPreviewEvidenceIDFromRef } from "@/acceptance/visual-evidence"
import { findReadableBrowserPreviewEvidenceByID } from "@/browser-preview/persist"
import { VisualQaReportSchema, type VisualQaReport } from "./schema"

export interface VisualQaOutputToolContext {
  taskID?: string
  projectRoot?: string
  referenceParityRequired?: boolean
  requiredReferenceRegions?: string[]
}

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

function parseReferenceRegionKey(key: string): { regionID: string; viewportID: string } | { issue: string } {
  const [regionID, viewportID, extra] = key.split("@")
  if (extra !== undefined || !regionID?.trim() || !viewportID?.trim()) {
    return {
      issue: `reference region "${key}" must use the exact format region_id@viewport_id, for example region_header@desktop.`,
    }
  }
  return { regionID: regionID.trim(), viewportID: viewportID.trim() }
}

async function validateVisualQaReport(report: VisualQaReport, context: VisualQaOutputToolContext): Promise<string[]> {
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
  if (report.accepted && report.follow_up_task) {
    issues.push("accepted=true is incompatible with follow_up_task; follow-up work means visual QA did not accept.")
  }
  if (!report.accepted && report.production_blockers.length === 0 && openBlocking.length === 0) {
    issues.push("accepted=false requires production_blockers or open critical/major findings with actionable evidence.")
  }
  const referenceParityRequired = Boolean(context.referenceParityRequired || report.reference_parity.required)
  if (referenceParityRequired) {
    const comparisonEvidence = report.evidence.filter((item) => item.type === "reference_comparison")
    const refs = new Set(
      [
        ...report.reference_parity.reference_comparison_evidence_refs,
        ...comparisonEvidence.map((item) => item.ref),
        ...report.coverage.flatMap((item) => item.evidence_refs),
      ].flatMap((ref) => {
        const evidenceID = browserPreviewEvidenceIDFromRef(ref)
        return evidenceID ? [evidenceID] : []
      }),
    )
    const requiredRegions = new Set([
      ...(context.requiredReferenceRegions ?? []),
      ...report.reference_parity.required_regions,
    ])
    const requiredRegionKeys = [...requiredRegions].sort()
    if (report.accepted && context.referenceParityRequired && !report.reference_parity.required) {
      issues.push("accepted=true for reference parity requires reference_parity.required=true.")
    }
    if (report.accepted && context.referenceParityRequired && (context.requiredReferenceRegions?.length ?? 0) === 0) {
      issues.push(
        "accepted=true for reference parity requires authoritative requiredReferenceRegions from task evidence; self-reported regions are not enough.",
      )
    }
    if (report.accepted && requiredRegionKeys.length === 0) {
      issues.push(
        "accepted=true for reference parity requires reference_parity.required_regions with region_id@viewport_id entries.",
      )
    }
    if (report.accepted && refs.size === 0) {
      issues.push(
        "accepted=true for reference parity requires browser_preview_compare_regions reference_comparison evidence refs; screenshots are supporting evidence only.",
      )
    }
    if (report.accepted && refs.size > 0) {
      if (!context.taskID || !context.projectRoot) {
        issues.push(
          "accepted=true for reference parity requires task-scoped project context to verify comparison evidence.",
        )
      } else {
        const validEvidence: Array<{ id: string; regionID?: string; viewportID: string }> = []
        for (const evidenceID of refs) {
          const evidence = await findReadableBrowserPreviewEvidenceByID({
            projectRoot: context.projectRoot,
            taskID: context.taskID,
            evidenceID,
          })
          if (evidence?.operationKind === "reference-comparison" && evidence.status === "passed") {
            validEvidence.push({
              id: evidenceID,
              regionID: evidence.regionID,
              viewportID: evidence.viewportID,
            })
          }
        }
        if (validEvidence.length === 0) {
          issues.push(
            "accepted=true for reference parity requires readable passed browser_preview_compare_regions reference-comparison evidence.",
          )
        }
        for (const key of requiredRegionKeys) {
          const parsed = parseReferenceRegionKey(key)
          if ("issue" in parsed) {
            issues.push(parsed.issue)
            continue
          }
          const matched = validEvidence.some(
            (evidence) => evidence.regionID === parsed.regionID && evidence.viewportID === parsed.viewportID,
          )
          if (!matched) {
            issues.push(
              `accepted=true lacks readable passed reference-comparison evidence for ${parsed.regionID}@${parsed.viewportID}.`,
            )
          }
        }
      }
    }
    if (report.accepted && report.reference_parity.missing_regions.length > 0) {
      issues.push(
        `accepted=true cannot leave reference regions without comparison evidence: ${report.reference_parity.missing_regions.join(", ")}.`,
      )
    }
    if (!report.accepted && report.reference_parity.blocker_ids.length > 0) {
      const blockerIDs = new Set(report.production_blockers.map((blocker) => blocker.id))
      const unknown = report.reference_parity.blocker_ids.filter((id) => !blockerIDs.has(id))
      if (unknown.length > 0) {
        issues.push(`reference_parity.blocker_ids references unknown production blockers: ${unknown.join(", ")}.`)
      }
    }
  }
  if (report.follow_up_task) {
    const blockerIDs = new Set(report.production_blockers.map((blocker) => blocker.id))
    const unknown = report.follow_up_task.blocker_ids.filter((id) => !blockerIDs.has(id))
    if (report.production_blockers.length === 0) {
      issues.push(
        "follow_up_task requires production_blockers because the new task must inherit concrete blocker evidence.",
      )
    }
    if (unknown.length > 0) {
      issues.push(`follow_up_task.blocker_ids references unknown production blockers: ${unknown.join(", ")}.`)
    }
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
  const followUpLine = report.follow_up_task
    ? [
        `title=${report.follow_up_task.title}`,
        `priority=${report.follow_up_task.priority}`,
        `blockers=${report.follow_up_task.blocker_ids.join(", ")}`,
        `reason=${report.follow_up_task.reason}`,
        `request=${report.follow_up_task.request}`,
      ].join("; ")
    : "- none"
  return {
    summary: limitSummary(report.summary),
    detail: [
      `## Accepted\n${report.accepted ? "true" : "false"}`,
      `## Summary\n${requireReportString(report.summary, "visual QA summary")}`,
      `## Coverage\n${coverageLines.length ? markdownList(coverageLines) : "- no coverage submitted"}`,
      `## Findings\n${findingLines.length ? markdownList(findingLines) : "- no findings"}`,
      `## Production Blockers\n${blockerLines.length ? markdownList(blockerLines) : "- none"}`,
      `## Follow-up Task\n${followUpLine}`,
      `## Evidence\n${report.evidence.length ? markdownList(report.evidence.map((item) => `${item.type}: ${item.ref} — ${item.note}`)) : "- no evidence submitted"}`,
      `## Repairs\n${report.repairs.length ? markdownList(report.repairs.map((repair) => `${repair.files_changed.join(", ") || "(no files)"}: ${repair.reason}`)) : "- no repairs"}`,
      `## Commands\n${report.commands.length ? markdownList(report.commands.map((command) => `${command.passed ? "passed" : "failed"} ${command.command}: ${command.detail}`)) : "- no commands"}`,
      `## Changed Files\n${report.changed_files.length ? markdownList(report.changed_files) : "- none"}`,
      `## Open Questions\n${report.open_questions.length ? markdownList(report.open_questions) : "- none"}`,
    ].join("\n\n"),
  }
}

export function createVisualQaOutputTools(context: VisualQaOutputToolContext = {}) {
  let collector = emptyCollector()
  const tools = {
    submit_visual_qa_report: tool({
      description:
        "Submit the final frontend visual GUI fidelity and functional QA report. GUI means Graphical User Interface. " +
        "Use accepted=true only with fresh visual and functional evidence, no open critical/major findings, no production_blockers, and no follow_up_task. " +
        "When unrepairable production blockers require a new round, submit accepted=false with follow_up_task.",
      inputSchema: VisualQaReportSchema,
      execute: async (raw) => {
        if (collector.final)
          return "Error: visual QA report already submitted; duplicate submit_visual_qa_report ignored."
        const report = VisualQaReportSchema.parse(raw)
        const issues = await validateVisualQaReport(report, context)
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
