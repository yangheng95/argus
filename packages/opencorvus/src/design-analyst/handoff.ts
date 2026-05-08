import { createDecisionLog, type DecisionEntry } from "@/decision-log"

export const DESIGN_ANALYSIS_PRD_SPEC_PATH = ".opencorvus/design-analysis/prd-spec.md"
export const DESIGN_ANALYSIS_SOURCE_MANIFEST_PATH = ".opencorvus/design-analysis/evidence-source-manifest.md"

const HANDOFF_KEYS = [
  "product_spec",
  "frontend_spec",
  "visual_consistency_spec",
  "backend_spec",
  "completeness_review",
  "evidence_source_manifest",
] as const

function cap(value: string, maxChars: number): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}... [+${text.length - maxChars} chars in ${DESIGN_ANALYSIS_PRD_SPEC_PATH}]`
}

function latestByKey(entries: DecisionEntry[]): Map<string, DecisionEntry> {
  const result = new Map<string, DecisionEntry>()
  for (const entry of entries) {
    if ((HANDOFF_KEYS as readonly string[]).includes(entry.key)) result.set(entry.key, entry)
  }
  return result
}

export function renderDesignAnalysisHandoffReference(taskID: string, options?: {
  valueCap?: number
  includeExcerpts?: boolean
}): string {
  const valueCap = options?.valueCap ?? 500
  const includeExcerpts = options?.includeExcerpts ?? true
  const lines: string[] = []

  lines.push("## Design Analysis PRD/SPEC Source")
  lines.push("")
  lines.push(`Canonical PRD/SPEC file: ${DESIGN_ANALYSIS_PRD_SPEC_PATH}`)
  lines.push(`Canonical source manifest file: ${DESIGN_ANALYSIS_SOURCE_MANIFEST_PATH}`)
  lines.push("Canonical decision-log phase: design_analysis")
  lines.push("Read the PRD/SPEC and source manifest files before implementing or decomposing any visual/reference surface.")
  lines.push("Use file/image/source names from the manifest as readable evidence; do not run mirror tools outside design_analysis.")

  if (!includeExcerpts) return lines.join("\n")

  const entries = latestByKey(createDecisionLog(taskID).readByPhase("design_analysis"))
  const present = HANDOFF_KEYS.filter((key) => entries.has(key))
  if (present.length === 0) return lines.join("\n")

  lines.push("")
  lines.push("### Compact Decision-Log Excerpts")
  lines.push("These excerpts orient the next agent only. The materialized PRD/SPEC file remains authoritative.")
  for (const key of present) {
    const entry = entries.get(key)
    if (!entry) continue
    lines.push(`- ${key}: ${cap(entry.value, valueCap)}`)
  }

  return lines.join("\n")
}
