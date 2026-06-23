import type { DecisionEntry } from "@/decision-log"
import type { AcceptanceResult } from "@/engine/engine.sql"
import type { AcceptanceRow } from "@/engine/store"
import type { ResearchBrief } from "@/research/schema"

type VisualQaDecisionEntry = Pick<DecisionEntry, "key" | "value" | "reason">
type VisualQaDelivery = Pick<AcceptanceRow, "id" | "status" | "summary" | "result">
type VisualQaFrontendResearchBrief = {
  artifactID: string
  brief: ResearchBrief
}
type VisualQaIntegrityAttempt = {
  id?: string
  payload?: unknown
}

const FRONTEND_DESIGN_KEYS_FOR_VISUAL_QA = [
  "final_acceptance_mode",
  "visual_consistency_contract",
  "ui_data_contract",
  "reference_artifacts",
  "evidence_source_manifest",
  "frontend_project",
] as const

const FRONTEND_DESIGN_VALUE_LIMITS: Record<(typeof FRONTEND_DESIGN_KEYS_FOR_VISUAL_QA)[number], number> = {
  final_acceptance_mode: 240,
  visual_consistency_contract: 2_400,
  ui_data_contract: 1_000,
  reference_artifacts: 1_200,
  evidence_source_manifest: 1_200,
  frontend_project: 1_000,
}

const REFERENCE_EVIDENCE_SCOPE_SECTION = [
  "## Reference Evidence Scope",
  "Reference artifacts are evidence, not an automatic universal clone requirement.",
  "Enforce reference/parity fidelity only when the task, current goal, visual_consistency_contract, or acceptance evidence explicitly requires it.",
  "When reference parity is explicitly required, cite fresh task-scoped evidence for the affected regions or report a production_blocker.",
].join("\n")

export function renderVisualQaFrontendDesignContext(entries: VisualQaDecisionEntry[]): string {
  const latest = latestDecisionByKey(entries)
  const lines = ["# Frontend Design Pointers", "", "Only the Visual QA-relevant frontend-design fields are included."]
  let included = 0
  if (hasFrontendDesignReferenceArtifacts(latest)) {
    lines.push("", REFERENCE_EVIDENCE_SCOPE_SECTION)
  }
  for (const key of FRONTEND_DESIGN_KEYS_FOR_VISUAL_QA) {
    const entry = latest.get(key)
    if (!entry) continue
    included += 1
    lines.push("", `## ${key}`, limitText(entry.value, FRONTEND_DESIGN_VALUE_LIMITS[key]))
  }
  return included > 0 ? lines.join("\n") : ""
}

export function renderVisualQaFrontendResearchContext(
  input?: VisualQaFrontendResearchBrief | VisualQaFrontendResearchBrief[],
): string {
  const briefs = (Array.isArray(input) ? input : input ? [input] : []).filter(({ brief }) => brief.webpage_contract)
  if (briefs.length === 0) return ""
  const lines = [
    "# Frontend Research Pointers",
    "",
    "Only webpage contract pointers relevant to GUI fidelity and functional testing are included. Use bundle paths only for drilldown.",
  ]

  for (const { artifactID, brief } of briefs) {
    const contract = brief.webpage_contract!
    lines.push("", `## ${contract.source_url}`)
    lines.push(`artifact_id: ${artifactID}`)
    if (contract.reference_image_evidence_ids.length) {
      lines.push(
        `reference_image_evidence_ids: ${frontendResearchEvidenceRefs(artifactID, contract.reference_image_evidence_ids).join(", ")}`,
      )
      lines.push("", REFERENCE_EVIDENCE_SCOPE_SECTION)
    }
    lines.push(
      renderBulletGroup(
        "functional_surfaces",
        contract.functional_surfaces
          .slice(0, 8)
          .map(
            (item) =>
              `${item.id}: ${item.title}; component_kind=${limitText(item.component_kind_hypothesis, 120)}; behavior=${limitText(item.user_visible_behavior, 220)}; interactions=${item.required_interactions.slice(0, 3).join(" | ") || "(none)"}; evidence=${frontendResearchEvidenceRefs(artifactID, item.evidence_ids).join(", ")}`,
          ),
      ),
    )
    lines.push(
      renderBulletGroup(
        "visual_layout",
        contract.visual_layout
          .slice(0, 8)
          .map(
            (item) =>
              `${item.id}: ${item.viewport} ${item.region}; layout=${limitText(item.layout_contract, 220)}; spacing=${limitText(item.spacing_and_alignment, 160)}; evidence=${frontendResearchEvidenceRefs(artifactID, item.evidence_ids).join(", ")}`,
          ),
      ),
    )
    lines.push(
      renderBulletGroup(
        "interaction_states",
        contract.interaction_states
          .slice(0, 8)
          .map(
            (item) =>
              `${item.id}: ${item.component} ${item.state}; behavior=${limitText(item.behavior, 220)}; evidence=${frontendResearchEvidenceRefs(artifactID, item.evidence_ids).join(", ")}`,
          ),
      ),
    )
    lines.push(
      renderBulletGroup(
        "fidelity_acceptance",
        contract.fidelity_acceptance
          .slice(0, 8)
          .map(
            (item) =>
              `${item.id}: ${item.target}; criterion=${limitText(item.criterion, 240)}; evidence=${frontendResearchEvidenceRefs(artifactID, item.evidence_ids).join(", ")}`,
          ),
      ),
    )
    if (brief.bundle) {
      lines.push(
        "",
        "bundle_paths:",
        `- full_markdown_path: ${brief.bundle.full_markdown_path}`,
        `- evidence_json_path: ${brief.bundle.evidence_json_path}`,
        `- citation_map_path: ${brief.bundle.citation_map_path}`,
      )
    }
  }
  return lines.filter((line) => line !== "").join("\n")
}

function frontendResearchEvidenceRef(artifactID: string, evidenceID: string): string {
  return `frontend_research:${artifactID}:${evidenceID}`
}

function frontendResearchEvidenceRefs(artifactID: string, evidenceIDs: string[]): string[] {
  return evidenceIDs.map((id) => frontendResearchEvidenceRef(artifactID, id))
}

export function renderVisualQaBuildEvidenceContext(deliveries: VisualQaDelivery[]): string {
  if (deliveries.length === 0) return ""
  const lines = [
    "# Build Evidence Pointers",
    "",
    "Latest delivery summaries and changed files only. Read files or reports directly if deeper evidence is needed.",
  ]
  for (const delivery of deliveries.slice(0, 8)) {
    const result = delivery.result as AcceptanceResult | null
    const changedFiles = result?.changed_files?.slice(0, 24) ?? []
    const commitRef = typeof result?.commit_ref === "string" ? result.commit_ref : undefined
    lines.push("", `## ${delivery.id}`, `status: ${delivery.status}`, `summary: ${limitText(delivery.summary, 500)}`)
    if (commitRef) lines.push(`commit_ref: ${commitRef}`)
    if (changedFiles.length) lines.push("changed_files:", ...changedFiles.map((file) => `- ${file}`))
  }
  return lines.join("\n")
}

export function renderVisualQaPriorReportContext(entries: VisualQaDecisionEntry[]): string {
  const latest = latestDecisionByKey(entries)
  const summary = latest.get("latest_summary")
  const reports = entries.filter((entry) => entry.key.startsWith("report_"))
  const latestReport = reports[reports.length - 1]
  if (!summary && !latestReport) return ""
  const lines = [
    "# Prior Visual QA Pointers",
    "",
    "Use this only to reproduce prior blocking findings and verify they are gone.",
  ]
  if (summary) lines.push("", "## latest_summary", limitText(summary.value, 1_000))
  if (latestReport) lines.push("", "## latest_report_excerpt", limitText(latestReport.value, 1_800))
  return lines.join("\n")
}

export function renderVisualQaIntegrityContext(row?: VisualQaIntegrityAttempt | null): string {
  const payload = normalizeIntegrityPayload(row?.payload)
  if (!payload) return ""
  const lines = [
    "# Integrity Review Pointers",
    "",
    "Use this post-build integrity review as the repair source. Fix component truth and visible functionality before layout or style polish.",
    "",
    `artifact_id: ${row?.id ?? "(unknown)"}`,
    `verdict: ${payload.verdict ?? "(unknown)"}`,
  ]
  if (payload.reason) lines.push(`summary: ${limitText(payload.reason, 800)}`)
  if (typeof payload.findings_count === "number") lines.push(`findings_count: ${payload.findings_count}`)
  if (typeof payload.required_repairs_count === "number") {
    lines.push(`required_repairs_count: ${payload.required_repairs_count}`)
  }
  const findings = payload.findings.slice(0, 6).map(renderIntegrityItem)
  const repairs = payload.required_repairs.slice(0, 6).map(renderIntegrityItem)
  lines.push(renderBulletGroup("integrity_findings", findings))
  lines.push(renderBulletGroup("integrity_required_repairs", repairs))
  if (payload.team_report_markdown) {
    lines.push("", "team_report_excerpt:", limitText(payload.team_report_markdown, 2_400))
  }
  lines.push(
    "",
    "Repair priority:",
    "- component truth and visible functionality first, including fake/placeholder widgets, static mock charts, dead controls, and missing regions",
    "- layout/composition second",
    "- spacing, typography, color, and state-style polish last",
  )
  return lines.filter((line) => line !== "").join("\n")
}

function latestDecisionByKey(entries: VisualQaDecisionEntry[]): Map<string, VisualQaDecisionEntry> {
  const latest = new Map<string, VisualQaDecisionEntry>()
  for (const entry of entries) latest.set(entry.key, entry)
  return latest
}

function hasFrontendDesignReferenceArtifacts(latest: Map<string, VisualQaDecisionEntry>): boolean {
  const referenceArtifacts = latest.get("reference_artifacts")?.value
  return Boolean(referenceArtifacts?.trim())
}

function renderBulletGroup(title: string, items: string[]): string {
  if (items.length === 0) return ""
  return ["", `${title}:`, ...items.map((item) => `- ${item}`)].join("\n")
}

function normalizeIntegrityPayload(payload: unknown):
  | {
      verdict?: string
      reason?: string
      findings_count?: number
      required_repairs_count?: number
      team_report_markdown?: string
      findings: unknown[]
      required_repairs: unknown[]
    }
  | undefined {
  if (!payload || typeof payload !== "object") return undefined
  const obj = payload as Record<string, unknown>
  return {
    verdict: typeof obj.verdict === "string" ? obj.verdict : undefined,
    reason: typeof obj.reason === "string" ? obj.reason : undefined,
    findings_count: typeof obj.findings_count === "number" ? obj.findings_count : undefined,
    required_repairs_count: typeof obj.required_repairs_count === "number" ? obj.required_repairs_count : undefined,
    team_report_markdown: typeof obj.team_report_markdown === "string" ? obj.team_report_markdown : undefined,
    findings: Array.isArray(obj.findings) ? obj.findings : [],
    required_repairs: Array.isArray(obj.required_repairs) ? obj.required_repairs : [],
  }
}

function renderIntegrityItem(item: unknown): string {
  if (!item || typeof item !== "object") return limitText(String(item), 360)
  const obj = item as Record<string, unknown>
  const parts: string[] = []
  for (const key of ["severity", "title", "description", "summary", "reason", "repair", "goalID"]) {
    const value = obj[key]
    if (typeof value === "string" && value.trim()) parts.push(`${key}=${limitText(value, 220)}`)
  }
  return parts.length > 0 ? parts.join("; ") : limitText(JSON.stringify(obj) ?? String(obj), 360)
}

function limitText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 32))}... [truncated for Visual QA]`
}
