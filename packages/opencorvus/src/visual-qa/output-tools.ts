import { tool } from "ai"
import { limitSummary, markdownList, requireReportString } from "@/agent/report"
import { browserPreviewEvidenceIDFromRef } from "@/acceptance/visual-evidence"
import { findReadableBrowserPreviewEvidenceByID } from "@/browser-preview/persist"
import { visualQaOpenBlockingFindings, visualQaReportAcceptanceSemantics } from "./acceptance-semantics"
import { VisualQaReportSchema, type VisualQaAcceptance, type VisualQaReport } from "./schema"

export interface VisualQaOutputToolContext {
  taskID?: string
  projectRoot?: string
  referenceParityRequired?: boolean
  requiredReferenceRegions?: string[]
}

export interface VisualQaCollector {
  final?: VisualQaReport
  acceptance?: VisualQaAcceptance
}

function emptyCollector(): VisualQaCollector {
  return {}
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

async function summarizeVisualQaReportFeedback(
  report: VisualQaReport,
  context: VisualQaOutputToolContext,
): Promise<{ blockers: string[]; advisories: string[] }> {
  const semantics = visualQaReportAcceptanceSemantics(report)
  const blockers: string[] = [...semantics.selfReportIssues]
  const advisories: string[] = []
  const openBlocking = visualQaOpenBlockingFindings(report)
  if (!report.accepted && report.production_blockers.length === 0 && openBlocking.length === 0) {
    blockers.push("accepted=false was submitted without production_blockers or open critical/major findings.")
  }
  const referenceParityRequired = Boolean(context.referenceParityRequired || report.reference_parity.required)
  if (referenceParityRequired) {
    const refs = new Set(
      report.reference_parity.reference_comparison_evidence_refs.flatMap((ref) => {
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
      blockers.push(
        "accepted=true was submitted while context expects reference parity but report.reference_parity.required=false.",
      )
    }
    if (report.accepted && context.referenceParityRequired && (context.requiredReferenceRegions?.length ?? 0) === 0) {
      blockers.push(
        "context expects reference parity but no authoritative requiredReferenceRegions were available from task evidence.",
      )
    }
    if (report.accepted && refs.size === 0) {
      const issue = "accepted=true was submitted for reference parity without reference_comparison evidence refs."
      if (!blockers.includes(issue)) blockers.push(issue)
    }
    if (report.accepted && refs.size > 0) {
      if (!context.taskID || !context.projectRoot) {
        advisories.push(
          "reference comparison refs were submitted, but task-scoped project context was unavailable for advisory verification.",
        )
      } else {
        const validEvidence: Array<{ id: string; regionID?: string; viewportID: string }> = []
        for (const evidenceID of refs) {
          try {
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
          } catch (error) {
            const detail = error instanceof Error ? error.message : String(error)
            const issue = `submitted reference comparison evidence ${evidenceID} is unreadable: ${detail}`
            if (report.accepted) blockers.push(issue)
            else advisories.push(issue)
          }
        }
        if (validEvidence.length === 0) {
          const issue = "no submitted reference comparison refs resolved to readable passed browser_preview_evidence."
          if (report.accepted) blockers.push(issue)
          else advisories.push(issue)
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
            const issue = `accepted=true lacks readable passed reference-comparison evidence for ${parsed.regionID}@${parsed.viewportID}.`
            if (report.accepted) blockers.push(issue)
            else advisories.push(issue)
          }
        }
      }
    }
    if (!report.accepted && report.reference_parity.blocker_ids.length > 0) {
      const blockerIDs = new Set(report.production_blockers.map((blocker) => blocker.id))
      const unknown = report.reference_parity.blocker_ids.filter((id) => !blockerIDs.has(id))
      if (unknown.length > 0) {
        blockers.push(`reference_parity.blocker_ids references unknown production blockers: ${unknown.join(", ")}.`)
      }
    }
  }
  if (report.unresolved_code_module_problems.length > 0) {
    const blockerIDs = new Set(report.production_blockers.map((blocker) => blocker.id))
    const unknown = report.unresolved_code_module_problems.flatMap((problem) =>
      problem.blocker_ids.filter((id) => !blockerIDs.has(id)),
    )
    if (report.production_blockers.length === 0) {
      blockers.push("unresolved_code_module_problems were submitted without production_blockers.")
    }
    if (unknown.length > 0) {
      blockers.push(
        `unresolved_code_module_problems.blocker_ids references unknown production blockers: ${unknown.join(", ")}.`,
      )
    }
  }
  return { blockers, advisories }
}

function visualQaEffectiveAcceptance(report: VisualQaReport, feedback: { blockers: string[] }): VisualQaAcceptance {
  const semantics = visualQaReportAcceptanceSemantics(report)
  return {
    submittedAccepted: semantics.submittedAccepted,
    effectiveAccepted: report.accepted && feedback.blockers.length === 0,
    selfReportIssues: semantics.selfReportIssues,
    blockingIssues: feedback.blockers,
  }
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
  const unresolvedProblemLines = report.unresolved_code_module_problems.map((problem) =>
    [
      `${problem.id}: entity=${problem.code_module_reference.entity}`,
      `problem=${problem.code_module_reference.problem}`,
      `blockers=${problem.blocker_ids.join(", ")}`,
      `reason=${problem.reason}`,
      `evidence=${problem.evidence_refs.join(", ") || "(none)"}`,
    ].join("; "),
  )
  const problemDomLines = report.problem_dom_regions.map((region) =>
    [
      `${region.id}: blockers=${region.blocker_ids.join(", ")}`,
      `region=${region.region}`,
      region.route ? `route=${region.route}` : undefined,
      region.viewport ? `viewport=${region.viewport.width}x${region.viewport.height}` : undefined,
      `locator=${region.locator}`,
      region.dom_path ? `dom_path=${region.dom_path}` : undefined,
      region.bbox
        ? `bbox=x:${region.bbox.x},y:${region.bbox.y},w:${region.bbox.width},h:${region.bbox.height}`
        : undefined,
      region.code_search_terms.length ? `code_search_terms=${region.code_search_terms.join(", ")}` : undefined,
      Object.keys(region.attributes).length ? `attributes=${compactRecord(region.attributes)}` : undefined,
      Object.keys(region.computed_style).length ? `computed_style=${compactRecord(region.computed_style)}` : undefined,
      `outer_html=${compactText(region.outer_html_excerpt, 360)}`,
      region.ancestor_context.length ? `ancestors=${region.ancestor_context.map((item) => compactText(item, 180)).join(" | ")}` : undefined,
      region.sibling_context.length ? `siblings=${region.sibling_context.map((item) => compactText(item, 180)).join(" | ")}` : undefined,
      `evidence=${region.evidence_refs.join(", ") || "(none)"}`,
      `notes=${region.notes}`,
    ]
      .filter((part): part is string => Boolean(part))
      .join("; "),
  )
  return {
    summary: limitSummary(report.summary),
    detail: [
      `## Accepted\n${report.accepted ? "true" : "false"}`,
      `## Summary\n${requireReportString(report.summary, "visual QA summary")}`,
      `## Coverage\n${coverageLines.length ? markdownList(coverageLines) : "- no coverage submitted"}`,
      `## Findings\n${findingLines.length ? markdownList(findingLines) : "- no findings"}`,
      `## Production Blockers\n${blockerLines.length ? markdownList(blockerLines) : "- none"}`,
      `## Unresolved Code Module Problems\n${unresolvedProblemLines.length ? markdownList(unresolvedProblemLines) : "- none"}`,
      `## Problem DOM Regions\n${problemDomLines.length ? markdownList(problemDomLines) : "- none"}`,
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
        "Submit the frontend visual GUI fidelity and functional QA report. GUI means Graphical User Interface. " +
        "Use accepted=true only with fresh visual and functional evidence, no open critical/major findings, no production_blockers, and no unresolved_code_module_problems. " +
        "When visual blockers map to rendered Document Object Model (DOM) nodes, include problem_dom_regions with selectors, HTML excerpts, computed styles, and code search terms for Build. " +
        "When unrepairable production blockers expose a code-module issue, submit accepted=false and report unresolved_code_module_problems instead of requesting a new task.",
      inputSchema: VisualQaReportSchema,
      execute: async (raw) => {
        if (collector.final)
          return "Error: visual QA report already submitted; duplicate submit_visual_qa_report ignored."
        const report = VisualQaReportSchema.parse(raw)
        const feedback = await summarizeVisualQaReportFeedback(report, context)
        const acceptance = visualQaEffectiveAcceptance(report, feedback)
        collector.final = report
        collector.acceptance = acceptance
        const blockerText =
          feedback.blockers.length > 0
            ? `\n\nBLOCKERS (${feedback.blockers.length}):\n${feedback.blockers.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}`
            : ""
        const advisoryText =
          feedback.advisories.length > 0
            ? `\n\nADVISORIES (${feedback.advisories.length}):\n${feedback.advisories.map((issue, index) => `${index + 1}. ${issue}`).join("\n")}`
            : ""
        return `RECORDED: visual QA report recorded with submitted_accepted=${acceptance.submittedAccepted}; effective_accepted=${acceptance.effectiveAccepted}.${blockerText}${advisoryText}`
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

function compactRecord(input: Record<string, string>, max = 320): string {
  return compactText(
    Object.entries(input)
      .map(([key, value]) => `${key}=${value}`)
      .join(", "),
    max,
  )
}

function compactText(input: string, max: number): string {
  const normalized = input.replace(/\s+/g, " ").trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`
}
