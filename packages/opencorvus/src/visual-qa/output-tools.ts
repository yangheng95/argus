import { tool } from "ai"
import z from "zod"
import { limitSummary, markdownList, requireReportString } from "@/agent/report"
import { browserPreviewEvidenceIDFromRef } from "@/acceptance/visual-evidence"
import { findReadableBrowserPreviewEvidenceByID } from "@/browser-preview/persist"
import { FactCheckItemSchema } from "@/fact-check/schema"
import { visualQaOpenBlockingFindings, visualQaReportAcceptanceSemantics } from "./acceptance-semantics"
import {
  VisualQaCheckItemSchema,
  VisualQaCommandSchema,
  VisualQaCoverageSchema,
  VisualQaEvidenceSchema,
  VisualQaFindingSchema,
  VisualQaProblemDomRegionSchema,
  VisualQaProductionBlockerSchema,
  VisualQaReferenceParitySchema,
  VisualQaRepairSchema,
  VisualQaReportSchema,
  VisualQaUnresolvedCodeModuleProblemSchema,
  type VisualQaAcceptance,
  type VisualQaReport,
} from "./schema"

export interface VisualQaOutputToolContext {
  taskID?: string
  projectRoot?: string
  referenceParityRequired?: boolean
  requiredReferenceRegions?: string[]
}

export interface VisualQaCollector {
  check_items: VisualQaReport["check_items"]
  coverage: VisualQaReport["coverage"]
  findings: VisualQaReport["findings"]
  production_blockers: VisualQaReport["production_blockers"]
  unresolved_code_module_problems: VisualQaReport["unresolved_code_module_problems"]
  problem_dom_regions: VisualQaReport["problem_dom_regions"]
  repairs: VisualQaReport["repairs"]
  evidence: VisualQaReport["evidence"]
  reference_parity: VisualQaReport["reference_parity"]
  commands: VisualQaReport["commands"]
  changed_files: VisualQaReport["changed_files"]
  open_questions: VisualQaReport["open_questions"]
  fact_check_items: VisualQaReport["fact_check_items"]
  final?: VisualQaReport
  acceptance?: VisualQaAcceptance
}

function emptyCollector(): VisualQaCollector {
  return {
    check_items: [],
    coverage: [],
    findings: [],
    production_blockers: [],
    unresolved_code_module_problems: [],
    problem_dom_regions: [],
    repairs: [],
    evidence: [],
    reference_parity: {
      required: false,
      required_regions: [],
      reference_comparison_evidence_refs: [],
      missing_regions: [],
      blocker_ids: [],
    },
    commands: [],
    changed_files: [],
    open_questions: [],
    fact_check_items: [],
  }
}

const SubmitVisualQaReportSchema = z
  .object({
    accepted: z.boolean(),
    summary: z.string().min(1),
  })
  .strict()

function parseReferenceRegionKey(key: string): { regionID: string; viewportID: string } | { issue: string } {
  const [regionID, viewportID, extra] = key.split("@")
  if (extra !== undefined || !regionID?.trim() || !viewportID?.trim()) {
    return {
      issue: `reference region "${key}" must use the exact format region_id@viewport_id, for example region_header@desktop.`,
    }
  }
  return { regionID: regionID.trim(), viewportID: viewportID.trim() }
}

function upsertByID<T extends { id: string }>(items: T[], item: T): "registered" | "overwritten" {
  const existingIdx = items.findIndex((row) => row.id === item.id)
  if (existingIdx >= 0) {
    items[existingIdx] = item
    return "overwritten"
  }
  items.push(item)
  return "registered"
}

function unknownCheckIDs(report: VisualQaReport, label: string, id: string, checkIDs: readonly string[]): string[] {
  const known = new Set(report.check_items.map((item) => item.id))
  if (checkIDs.length === 0) return [`${label} "${id}" has no check_ids; register a check item and reference it.`]
  const unknown = checkIDs.filter((checkID) => !known.has(checkID))
  return unknown.length > 0 ? [`${label} "${id}" references unknown check_ids: ${unknown.join(", ")}.`] : []
}

function visualQaCheckGraphIssues(report: VisualQaReport, context: VisualQaOutputToolContext): string[] {
  const issues: string[] = []
  if (report.check_items.length === 0) {
    issues.push("visual QA report has no registered check_items; register each inspected region/problem first.")
    return issues
  }
  const checkByID = new Map(report.check_items.map((item) => [item.id, item]))
  const unresolvedCheckIDs = report.check_items
    .filter((item) => item.status === "failed" || item.status === "inconclusive")
    .map((item) => item.id)
  if (report.accepted && unresolvedCheckIDs.length > 0) {
    issues.push(`accepted=true was submitted with failed/inconclusive check_items: ${unresolvedCheckIDs.join(", ")}.`)
  }
  const checkRows: Array<{ label: string; id: string; checkIDs: string[] }> = [
    ...report.coverage.map((row, index) => ({
      label: "coverage",
      id: `${row.region || "row"}#${index + 1}`,
      checkIDs: row.check_ids,
    })),
    ...report.evidence.map((row) => ({ label: "evidence", id: row.ref, checkIDs: row.check_ids })),
    ...report.findings.map((row) => ({ label: "finding", id: row.id, checkIDs: row.check_ids })),
    ...report.production_blockers.map((row) => ({
      label: "production_blocker",
      id: row.id,
      checkIDs: row.check_ids,
    })),
    ...report.problem_dom_regions.map((row) => ({
      label: "problem_dom_region",
      id: row.id,
      checkIDs: row.check_ids,
    })),
    ...report.unresolved_code_module_problems.map((row) => ({
      label: "unresolved_code_module_problem",
      id: row.id,
      checkIDs: row.check_ids,
    })),
    ...report.repairs.map((row, index) => ({
      label: "repair",
      id: row.finding_ids.join(",") || `repair#${index + 1}`,
      checkIDs: row.check_ids,
    })),
  ]
  for (const row of checkRows) issues.push(...unknownCheckIDs(report, row.label, row.id, row.checkIDs))
  for (const blocker of report.production_blockers) {
    const linked = blocker.check_ids.map((checkID) => checkByID.get(checkID)).filter((item) => item !== undefined)
    if (linked.length > 0 && linked.every((item) => item.status === "passed")) {
      issues.push(`production_blocker "${blocker.id}" references only passed check_items; blockers require a failed or inconclusive check.`)
    }
  }
  const requiredRegions = new Set([
    ...(context.requiredReferenceRegions ?? []),
    ...report.reference_parity.required_regions,
  ])
  if (context.referenceParityRequired || report.reference_parity.required) {
    for (const key of requiredRegions) {
      const hasCheck = report.check_items.some((item) => item.reference_region_key === key)
      if (!hasCheck) {
        issues.push(`reference parity required region ${key} has no registered check_item with reference_region_key=${key}.`)
      }
    }
  }
  return issues
}

async function summarizeVisualQaReportFeedback(
  report: VisualQaReport,
  context: VisualQaOutputToolContext,
): Promise<{ blockers: string[]; advisories: string[] }> {
  const semantics = visualQaReportAcceptanceSemantics(report)
  const blockers: string[] = [...semantics.selfReportIssues, ...visualQaCheckGraphIssues(report, context)]
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
  const checkLines = report.check_items.map(
    (item) =>
      `${item.id} [${item.status}] ${item.category}/${item.region}: ${item.question}; evidence=${item.evidence_refs.join(", ")}`,
  )
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
      `## Check Items\n${checkLines.length ? markdownList(checkLines) : "- no check items registered"}`,
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
    register_visual_qa_check_item: tool({
      description:
        "Register one concrete Visual QA check item before reporting coverage, evidence, findings, blockers, DOM regions, repairs, or final acceptance. Every report row must reference registered check item IDs.",
      inputSchema: VisualQaCheckItemSchema,
      execute: async (raw) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        const item = VisualQaCheckItemSchema.parse(raw)
        const status = upsertByID(collector.check_items, item)
        return `OK: visual QA check_item "${item.id}" ${status} (${collector.check_items.length} total)`
      },
    }),
    register_visual_qa_coverage: tool({
      description: "Register one Visual QA coverage row tied to registered check_ids.",
      inputSchema: VisualQaCoverageSchema,
      execute: async (raw) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        const row = VisualQaCoverageSchema.parse(raw)
        collector.coverage.push(row)
        return `OK: visual QA coverage "${row.region}" registered (${collector.coverage.length} total)`
      },
    }),
    register_visual_qa_evidence: tool({
      description: "Register one fresh Visual QA evidence item tied to registered check_ids.",
      inputSchema: VisualQaEvidenceSchema,
      execute: async (raw) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        const row = VisualQaEvidenceSchema.parse(raw)
        collector.evidence.push(row)
        return `OK: visual QA evidence "${row.ref}" registered (${collector.evidence.length} total)`
      },
    }),
    register_visual_qa_finding: tool({
      description: "Register one Visual QA finding tied to registered check_ids.",
      inputSchema: VisualQaFindingSchema,
      execute: async (raw) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        const row = VisualQaFindingSchema.parse(raw)
        const status = upsertByID(collector.findings, row)
        return `OK: visual QA finding "${row.id}" ${status} (${collector.findings.length} total)`
      },
    }),
    register_visual_qa_production_blocker: tool({
      description:
        "Register one production blocker tied to registered failed or inconclusive check_ids. Do not register blockers without a concrete check item.",
      inputSchema: VisualQaProductionBlockerSchema,
      execute: async (raw) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        const row = VisualQaProductionBlockerSchema.parse(raw)
        const status = upsertByID(collector.production_blockers, row)
        return `OK: visual QA production_blocker "${row.id}" ${status} (${collector.production_blockers.length} total)`
      },
    }),
    register_visual_qa_problem_dom_region: tool({
      description: "Register one DOM-localized visual problem region tied to registered check_ids and blocker_ids.",
      inputSchema: VisualQaProblemDomRegionSchema,
      execute: async (raw) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        const row = VisualQaProblemDomRegionSchema.parse(raw)
        const status = upsertByID(collector.problem_dom_regions, row)
        return `OK: visual QA problem_dom_region "${row.id}" ${status} (${collector.problem_dom_regions.length} total)`
      },
    }),
    register_visual_qa_unresolved_code_module_problem: tool({
      description:
        "Register one unresolved code module problem tied to registered check_ids and production blocker IDs.",
      inputSchema: VisualQaUnresolvedCodeModuleProblemSchema,
      execute: async (raw) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        const row = VisualQaUnresolvedCodeModuleProblemSchema.parse(raw)
        const status = upsertByID(collector.unresolved_code_module_problems, row)
        return `OK: visual QA unresolved_code_module_problem "${row.id}" ${status} (${collector.unresolved_code_module_problems.length} total)`
      },
    }),
    register_visual_qa_repair: tool({
      description: "Register one Visual QA repair or repair verification tied to registered check_ids.",
      inputSchema: VisualQaRepairSchema,
      execute: async (raw) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        const row = VisualQaRepairSchema.parse(raw)
        collector.repairs.push(row)
        return `OK: visual QA repair registered (${collector.repairs.length} total)`
      },
    }),
    register_visual_qa_command: tool({
      description: "Register one command run used by Visual QA.",
      inputSchema: VisualQaCommandSchema,
      execute: async (raw) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        const row = VisualQaCommandSchema.parse(raw)
        collector.commands.push(row)
        return `OK: visual QA command registered (${collector.commands.length} total)`
      },
    }),
    register_visual_qa_changed_file: tool({
      description: "Register one file changed by Visual QA.",
      inputSchema: z.object({ file: z.string().min(1) }).strict(),
      execute: async ({ file }) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        if (!collector.changed_files.includes(file)) collector.changed_files.push(file)
        return `OK: visual QA changed file "${file}" registered (${collector.changed_files.length} total)`
      },
    }),
    register_visual_qa_open_question: tool({
      description: "Register one open question that prevents stronger Visual QA certainty.",
      inputSchema: z.object({ question: z.string().min(1) }).strict(),
      execute: async ({ question }) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        collector.open_questions.push(question)
        return `OK: visual QA open question registered (${collector.open_questions.length} total)`
      },
    }),
    register_visual_qa_fact_check_item: tool({
      description: "Register one factual claim that Visual QA could not verify in-session.",
      inputSchema: FactCheckItemSchema,
      execute: async (raw) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        const item = FactCheckItemSchema.parse(raw)
        collector.fact_check_items.push(item)
        return `OK: visual QA fact_check_item registered (${collector.fact_check_items.length} total)`
      },
    }),
    set_visual_qa_reference_parity: tool({
      description:
        "Set the Visual QA reference parity summary after registering per-region check items. Required regions must also have check_items with matching reference_region_key.",
      inputSchema: VisualQaReferenceParitySchema,
      execute: async (raw) => {
        if (collector.final) return "Error: visual QA report already submitted; collector is closed."
        collector.reference_parity = VisualQaReferenceParitySchema.parse(raw)
        return `OK: visual QA reference_parity set (required=${collector.reference_parity.required}, regions=${collector.reference_parity.required_regions.length})`
      },
    }),
    submit_visual_qa_report: tool({
      description:
        "Finalize the frontend visual GUI fidelity and functional QA report from registered check items and report rows. GUI means Graphical User Interface. " +
        "Do not pass findings, coverage, evidence, blockers, DOM regions, repairs, or reference rows in this final call; register them first through the register_visual_qa_* tools. " +
        "Use accepted=true only with fresh visual and functional evidence, no open critical/major findings, no production_blockers, and no unresolved_code_module_problems. " +
        "When visual blockers map to rendered Document Object Model (DOM) nodes, include problem_dom_regions with selectors, HTML excerpts, computed styles, and code search terms for Build. " +
        "When unrepairable production blockers expose a code-module issue, submit accepted=false and report unresolved_code_module_problems instead of requesting a new task.",
      inputSchema: SubmitVisualQaReportSchema,
      execute: async (raw) => {
        if (collector.final)
          return "Error: visual QA report already submitted; duplicate submit_visual_qa_report ignored."
        const finalParsed = SubmitVisualQaReportSchema.safeParse(raw)
        if (!finalParsed.success) {
          return `Error: submit_visual_qa_report accepts only accepted and summary after register_visual_qa_* calls: ${finalParsed.error.message}`
        }
        const final = finalParsed.data
        const report = VisualQaReportSchema.parse({
          accepted: final.accepted,
          summary: final.summary,
          check_items: collector.check_items,
          coverage: collector.coverage,
          findings: collector.findings,
          production_blockers: collector.production_blockers,
          unresolved_code_module_problems: collector.unresolved_code_module_problems,
          problem_dom_regions: collector.problem_dom_regions,
          repairs: collector.repairs,
          evidence: collector.evidence,
          reference_parity: collector.reference_parity,
          commands: collector.commands,
          changed_files: collector.changed_files,
          open_questions: collector.open_questions,
          fact_check_items: collector.fact_check_items,
        })
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
