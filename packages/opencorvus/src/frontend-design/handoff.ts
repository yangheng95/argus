import { createDecisionLog, type DecisionEntry } from "@/decision-log"
import { ProjectRuntimePaths } from "@/project/runtime-paths"

// Single source of truth for the frontend-design materialized-artifact paths.
// The `frontend_design` decision-log phase is the canonical source; these
// files are a regenerated, read-only PROJECTION of it (rule 8 — one source;
// previously `orchestrator/tools.ts` recomputed these strings independently).
export const FRONTEND_DESIGN_RELATIVE_DIR_TEMPLATE = ".opencorvus/runtime/tasks/<taskID>/frontend-design"
export const FRONTEND_DESIGN_TEMPLATE_PATH_TEMPLATE = `${FRONTEND_DESIGN_RELATIVE_DIR_TEMPLATE}/frontend-template.md`
export const FRONTEND_DESIGN_SOURCE_MANIFEST_PATH_TEMPLATE = `${FRONTEND_DESIGN_RELATIVE_DIR_TEMPLATE}/evidence-source-manifest.md`

/**
 * Resolve frontend-design artifact paths for a project directory.
 *
 * `*Relative` is for consumers whose file tools resolve against
 * `Instance.directory` (the in-process OpenCorvus `read` tool — see
 * tool/read.ts). `*Absolute` is for EXTERNAL executors (codex / claude-code)
 * whose cwd is a goal worktree and which use their own native file tools —
 * a relative `.opencorvus/...` would not resolve there. Both forms are
 * derived from the single relative-path source above.
 */
export function frontendDesignArtifactPaths(projectDir: string, taskID: string) {
  return ProjectRuntimePaths.frontendDesignPaths(projectDir, taskID)
}

const HANDOFF_KEYS = [
  "frontend_template",
  "final_delivery_mode",
  "fillable_modules",
  "component_inventory",
  "component_reuse_plan",
  "baseline_replacement_plan",
  "quality_project_contract",
  "frontend_project",
  "material_inventory",
  "template_iteration_notes",
  "visual_consistency_contract",
  "ui_data_contract",
  "completeness_review",
  "reference_artifacts",
  "evidence_source_manifest",
] as const

function cap(value: string, maxChars: number, templatePath: string): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}... [+${text.length - maxChars} chars in ${templatePath}]`
}

function latestByKey(entries: DecisionEntry[]): Map<string, DecisionEntry> {
  const result = new Map<string, DecisionEntry>()
  for (const entry of entries) {
    if ((HANDOFF_KEYS as readonly string[]).includes(entry.key)) result.set(entry.key, entry)
  }
  return result
}

/**
 * Prompt section pointing the next agent at the materialized frontend_design
 * template source and evidence manifest.
 *
 * `pathMode` selects the path form for the consumer's file-tool resolution
 * model: "relative" (default — in-process build/delivery via OpenCorvus
 * `read`) or "absolute" (external codex/claude-code executors; `projectDir`
 * required). The `frontend_design` decision-log phase is canonical; the
 * files are a materialized read-only projection of it.
 */
export function renderFrontendDesignHandoffReference(taskID: string, options?: {
  valueCap?: number
  includeExcerpts?: boolean
  pathMode?: "relative" | "absolute"
  projectDir?: string
}): string {
  const valueCap = options?.valueCap ?? 500
  const includeExcerpts = options?.includeExcerpts ?? true
  const mode = options?.pathMode ?? "relative"

  const relative = ProjectRuntimePaths.frontendDesignPaths("", taskID)
  let templatePath = relative.templateRelative
  let manifestPath = relative.manifestRelative
  if (mode === "absolute") {
    if (!options?.projectDir) {
      // Hard fail (rule 7) — an external executor given a relative path it
      // cannot resolve is exactly the latent bug this mode fixes; never
      // silently fall back to the unreachable relative form.
      throw new Error(
        "renderFrontendDesignHandoffReference: pathMode 'absolute' requires projectDir",
      )
    }
    const resolved = frontendDesignArtifactPaths(options.projectDir, taskID)
    templatePath = resolved.templateAbsolute
    manifestPath = resolved.manifestAbsolute
  }

  const lines: string[] = []

  lines.push("## Frontend Design Template Source")
  lines.push("")
  lines.push(`Materialized frontend template file (read this): ${templatePath}`)
  lines.push(`Materialized source manifest file (read this): ${manifestPath}`)
  lines.push("Canonical decision-log phase (source of truth): frontend_design")
  lines.push("Read the frontend template and source manifest files before implementing or decomposing any visual/reference surface.")
  lines.push("Use file/image/source names from the manifest as readable evidence; do not run mirror tools outside frontend_design.")

  if (!includeExcerpts) return lines.join("\n")

  const entries = latestByKey(createDecisionLog(taskID).readByPhase("frontend_design"))
  const present = HANDOFF_KEYS.filter((key) => entries.has(key))
  if (present.length === 0) return lines.join("\n")

  lines.push("")
  lines.push("### Compact Decision-Log Excerpts")
  lines.push("These excerpts orient the next agent only; read the materialized frontend template file for the complete source.")
  for (const key of present) {
    const entry = entries.get(key)
    if (!entry) continue
    lines.push(`- ${key}: ${cap(entry.value, valueCap, templatePath)}`)
  }

  return lines.join("\n")
}
