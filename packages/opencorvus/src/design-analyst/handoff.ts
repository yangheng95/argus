import { createDecisionLog, type DecisionEntry } from "@/decision-log"
import { ProjectRuntimePaths } from "@/project/runtime-paths"

// Single source of truth for the design-analysis materialized-artifact paths.
// The `design_analysis` decision-log phase is the canonical source; these
// files are a regenerated, read-only PROJECTION of it (rule 8 — one source;
// previously `orchestrator/tools.ts` recomputed these strings independently).
export const DESIGN_ANALYSIS_RELATIVE_DIR_TEMPLATE = ".opencorvus/runtime/tasks/<taskID>/design-analysis"
export const DESIGN_ANALYSIS_PRD_SPEC_PATH_TEMPLATE = `${DESIGN_ANALYSIS_RELATIVE_DIR_TEMPLATE}/prd-spec.md`
export const DESIGN_ANALYSIS_SOURCE_MANIFEST_PATH_TEMPLATE = `${DESIGN_ANALYSIS_RELATIVE_DIR_TEMPLATE}/evidence-source-manifest.md`

/**
 * Resolve design-analysis artifact paths for a project directory.
 *
 * `*Relative` is for consumers whose file tools resolve against
 * `Instance.directory` (the in-process OpenCorvus `read` tool — see
 * tool/read.ts). `*Absolute` is for EXTERNAL executors (codex / claude-code)
 * whose cwd is a goal worktree and which use their own native file tools —
 * a relative `.opencorvus/...` would not resolve there. Both forms are
 * derived from the single relative-path source above.
 */
export function designAnalysisArtifactPaths(projectDir: string, taskID: string) {
  return ProjectRuntimePaths.designAnalysisPaths(projectDir, taskID)
}

const HANDOFF_KEYS = [
  "product_spec",
  "frontend_spec",
  "visual_consistency_spec",
  "backend_spec",
  "completeness_review",
  "evidence_source_manifest",
] as const

function cap(value: string, maxChars: number, prdPath: string): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}... [+${text.length - maxChars} chars in ${prdPath}]`
}

function latestByKey(entries: DecisionEntry[]): Map<string, DecisionEntry> {
  const result = new Map<string, DecisionEntry>()
  for (const entry of entries) {
    if ((HANDOFF_KEYS as readonly string[]).includes(entry.key)) result.set(entry.key, entry)
  }
  return result
}

/**
 * Prompt section pointing the next agent at the materialized design-analysis
 * PRD/SPEC source.
 *
 * `pathMode` selects the path form for the consumer's file-tool resolution
 * model: "relative" (default — in-process build/delivery via OpenCorvus
 * `read`) or "absolute" (external codex/claude-code executors; `projectDir`
 * required). The `design_analysis` decision-log phase is canonical; the
 * files are a materialized read-only projection of it.
 */
export function renderDesignAnalysisHandoffReference(taskID: string, options?: {
  valueCap?: number
  includeExcerpts?: boolean
  pathMode?: "relative" | "absolute"
  projectDir?: string
}): string {
  const valueCap = options?.valueCap ?? 500
  const includeExcerpts = options?.includeExcerpts ?? true
  const mode = options?.pathMode ?? "relative"

  const relative = ProjectRuntimePaths.designAnalysisPaths("", taskID)
  let prdPath = relative.prdRelative
  let manifestPath = relative.manifestRelative
  if (mode === "absolute") {
    if (!options?.projectDir) {
      // Hard fail (rule 7) — an external executor given a relative path it
      // cannot resolve is exactly the latent bug this mode fixes; never
      // silently fall back to the unreachable relative form.
      throw new Error(
        "renderDesignAnalysisHandoffReference: pathMode 'absolute' requires projectDir",
      )
    }
    const resolved = designAnalysisArtifactPaths(options.projectDir, taskID)
    prdPath = resolved.prdAbsolute
    manifestPath = resolved.manifestAbsolute
  }

  const lines: string[] = []

  lines.push("## Design Analysis PRD/SPEC Source")
  lines.push("")
  lines.push(`Materialized PRD/SPEC file (read this): ${prdPath}`)
  lines.push(`Materialized source manifest file (read this): ${manifestPath}`)
  lines.push("Canonical decision-log phase (source of truth): design_analysis")
  lines.push("Read the PRD/SPEC and source manifest files before implementing or decomposing any visual/reference surface.")
  lines.push("Use file/image/source names from the manifest as readable evidence; do not run mirror tools outside design_analysis.")

  if (!includeExcerpts) return lines.join("\n")

  const entries = latestByKey(createDecisionLog(taskID).readByPhase("design_analysis"))
  const present = HANDOFF_KEYS.filter((key) => entries.has(key))
  if (present.length === 0) return lines.join("\n")

  lines.push("")
  lines.push("### Compact Decision-Log Excerpts")
  lines.push("These excerpts orient the next agent only; read the materialized PRD/SPEC file for the complete source.")
  for (const key of present) {
    const entry = entries.get(key)
    if (!entry) continue
    lines.push(`- ${key}: ${cap(entry.value, valueCap, prdPath)}`)
  }

  return lines.join("\n")
}
