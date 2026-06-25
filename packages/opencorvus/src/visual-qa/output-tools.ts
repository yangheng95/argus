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

async function summarizeVisualQaReportAdvisories(
  report: VisualQaReport,
  context: VisualQaOutputToolContext,
): Promise<string[]> {
  const advisories: string[] = []
  if (report.accepted && report.evidence.length === 0) {
    advisories.push("accepted=true was submitted without fresh visual or functional evidence items.")
  }
  if (report.accepted && report.coverage.length === 0) {
    advisories.push("accepted=true was submitted without coverage items naming checked regions/viewports/states.")
  }
  const openBlocking = openBlockingFindings(report)
  if (report.accepted && openBlocking.length > 0) {
    advisories.push(
      `accepted=true was submitted with open critical/major findings: ${openBlocking.map((finding) => finding.id).join(", ")}.`,
    )
  }
  if (report.accepted && report.production_blockers.length > 0) {
    advisories.push(
      `accepted=true was submitted with production blockers: ${report.production_blockers.map((blocker) => blocker.id).join(", ")}.`,
    )
  }
  if (report.accepted && report.follow_up_task) {
    advisories.push("accepted=true was submitted with follow_up_task; that usually means visual QA did not fully accept.")
  }
  if (!report.accepted && report.production_blockers.length === 0 && openBlocking.length === 0) {
    advisories.push("accepted=false was submitted without production_blockers or open critical/major findings.")
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
      advisories.push("accepted=true was submitted while context expects reference parity but report.reference_parity.required=false.")
    }
    if (report.accepted && context.referenceParityRequired && (context.requiredReferenceRegions?.length ?? 0) === 0) {
      advisories.push(
        "context expects reference parity but no authoritative requiredReferenceRegions were available from task evidence.",
      )
    }
    if (report.accepted && requiredRegionKeys.length === 0) {
      advisories.push(
        "accepted=true was submitted for reference parity without reference_parity.required_regions entries.",
      )
    }
    if (report.accepted && refs.size === 0) {
      advisories.push(
        "accepted=true was submitted for reference parity without browser_preview_compare_regions reference_comparison evidence refs.",
      )
    }
    if (report.accepted && refs.size > 0) {
      if (!context.taskID || !context.projectRoot) {
        advisories.push(
          "reference comparison refs were submitted, but task-scoped project context was unavailable for advisory verification.",
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
          advisories.push(
            "no submitted reference comparison refs resolved to readable passed browser_preview_compare_regions evidence.",
          )
        }
        for (const key of requiredRegionKeys) {
          const parsed = parseReferenceRegionKey(key)
          if ("issue" in parsed) {
            advisories.push(parsed.issue)
            continue
          }
          const matched = validEvidence.some(
            (evidence) => evidence.regionID === parsed.regionID && evidence.viewportID === parsed.viewportID,
          )
          if (!matched) {
            advisories.push(
              `accepted=true lacks readable passed reference-comparison evidence for ${parsed.regionID}@${parsed.viewportID}.`,
            )
          }
        }
      }
    }
    if (report.accepted && report.reference_parity.missing_regions.length > 0) {
      advisories.push(
        `accepted=true was submitted with reference_parity.missing_regions: ${report.reference_parity.missing_regions.join(", ")}.`,
      )
    }
    if (!report.accepted && report.reference_parity.blocker_ids.length > 0) {
      const blockerIDs = new Set(report.production_blockers.map((blocker) => blocker.id))
      const unknown = report.reference_parity.blocker_ids.filter((id) => !blockerIDs.has(id))
      if (unknown.length > 0) {
        advisories.push(`reference_parity.blocker_ids references unknown production blockers: ${unknown.join(", ")}.`)
      }
    }
  }
  if (report.follow_up_task) {
    const blockerIDs = new Set(report.production_blockers.map((blocker) => blocker.id))
    const unknown = report.follow_up_task.blocker_ids.filter((id) => !blockerIDs.has(id))
    if (report.production_blockers.length === 0) {
      advisories.push(
        "follow_up_task was submitted without production_blockers for the new task to inherit.",
      )
    }
    if (unknown.length > 0) {
      advisories.push(`follow_up_task.blocker_ids references unknown production blockers: ${unknown.join(", ")}.`)
    }
  }
  return advisories
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
        const advisories = await summarizeVisualQaReportAdvisories(report, context)
        collector.final = report
        const advisoryText =
          advisories.length > 0
            ? `\n\nADVISORIES (${advisories.length}):\n${advisories.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}`
            : ""
        return `RECORDED: visual QA report recorded with accepted=${report.accepted}.${advisoryText}`
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
