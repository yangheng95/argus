import type { DecisionEntry } from "@/decision-log"
import type { AcceptanceResult } from "@/engine/engine.sql"
import type { AcceptanceRow } from "@/engine/store"
import type { ResearchBrief } from "@/research/schema"

type VisualQaDecisionEntry = Pick<DecisionEntry, "key" | "value" | "reason">
type VisualQaDelivery = Pick<AcceptanceRow, "id" | "status" | "summary" | "result">

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

const STRICT_REFERENCE_IMAGE_FIDELITY_SECTION = [
  "## Strict Reference Image Fidelity",
  "A reference image is present. Treat it as the authoritative visual truth.",
  "Require 1:1 layout and style fidelity. 1:1 means one-to-one visible geometry and styling, not a relaxed similarity standard.",
  "Do not accept differences in layout geometry, spacing, typography, colors, component styling, or visible state styling unless the task explicitly changed that exact element.",
].join("\n")

export function renderVisualQaFrontendDesignContext(entries: VisualQaDecisionEntry[]): string {
  const latest = latestDecisionByKey(entries)
  const lines = ["# Frontend Design Pointers", "", "Only the Visual QA-relevant frontend-design fields are included."]
  let included = 0
  if (hasFrontendDesignReferenceImage(latest)) {
    lines.push("", STRICT_REFERENCE_IMAGE_FIDELITY_SECTION)
  }
  for (const key of FRONTEND_DESIGN_KEYS_FOR_VISUAL_QA) {
    const entry = latest.get(key)
    if (!entry) continue
    included += 1
    lines.push("", `## ${key}`, limitText(entry.value, FRONTEND_DESIGN_VALUE_LIMITS[key]))
  }
  return included > 0 ? lines.join("\n") : ""
}

export function renderVisualQaFrontendResearchContext(brief?: ResearchBrief): string {
  const contract = brief?.webpage_contract
  if (!contract) return ""
  const lines = [
    "# Frontend Research Pointers",
    "",
    "Only webpage contract pointers relevant to GUI fidelity and functional testing are included. Use bundle paths only for drilldown.",
    "",
    `source_url: ${contract.source_url}`,
  ]
  if (contract.reference_image_evidence_ids.length) {
    lines.push(`reference_image_evidence_ids: ${contract.reference_image_evidence_ids.join(", ")}`)
    lines.push("", STRICT_REFERENCE_IMAGE_FIDELITY_SECTION)
  }
  lines.push(
    renderBulletGroup(
      "functional_surfaces",
      contract.functional_surfaces
        .slice(0, 8)
        .map(
          (item) =>
            `${item.id}: ${item.title}; behavior=${limitText(item.user_visible_behavior, 220)}; interactions=${item.required_interactions.slice(0, 3).join(" | ") || "(none)"}; evidence=${item.evidence_ids.join(", ")}`,
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
            `${item.id}: ${item.viewport} ${item.region}; layout=${limitText(item.layout_contract, 220)}; spacing=${limitText(item.spacing_and_alignment, 160)}; evidence=${item.evidence_ids.join(", ")}`,
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
            `${item.id}: ${item.component} ${item.state}; behavior=${limitText(item.behavior, 220)}; evidence=${item.evidence_ids.join(", ")}`,
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
            `${item.id}: ${item.target}; criterion=${limitText(item.criterion, 240)}; evidence=${item.evidence_ids.join(", ")}`,
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
  return lines.filter((line) => line !== "").join("\n")
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

function latestDecisionByKey(entries: VisualQaDecisionEntry[]): Map<string, VisualQaDecisionEntry> {
  const latest = new Map<string, VisualQaDecisionEntry>()
  for (const entry of entries) latest.set(entry.key, entry)
  return latest
}

function hasFrontendDesignReferenceImage(latest: Map<string, VisualQaDecisionEntry>): boolean {
  const referenceArtifacts = latest.get("reference_artifacts")?.value
  return Boolean(referenceArtifacts?.trim())
}

function renderBulletGroup(title: string, items: string[]): string {
  if (items.length === 0) return ""
  return ["", `${title}:`, ...items.map((item) => `- ${item}`)].join("\n")
}

function limitText(value: string, max: number): string {
  const normalized = value.replace(/\s+/g, " ").trim()
  if (normalized.length <= max) return normalized
  return `${normalized.slice(0, Math.max(0, max - 32))}... [truncated for Visual QA]`
}
