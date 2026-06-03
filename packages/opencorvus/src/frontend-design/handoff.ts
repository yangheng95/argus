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
  "public_report",
  "frontend_template",
  "final_acceptance_mode",
  "fillable_modules",
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

function renderSourceRegionRefactorGuidance(entries: Map<string, DecisionEntry>): string {
  const frontendProject = entries.get("frontend_project")?.value ?? ""
  const isSourceBaseline = /\brole:\s*source_baseline_input\b/i.test(frontendProject)
  if (!isSourceBaseline) return ""

  return [
    "## Source-Region Refactor Guidance",
    "",
    "Dynamic interpretation from the frontend_design decision log: this webpage handoff starts from a source_baseline_input skeleton. Treat that project as captured rawproject evidence and the traceable source seed for extraction into the target acceptance project.",
    "",
    "- Requirements: express maintainability as source-region traceability. Every new component, data module, style rule, and boundary cleanup must map to source nodes/regions/assets/reference screenshots. Maintainable mode should report measured webpage_evaluate evidence and zero-finding web_clone_source_audit evidence before claiming final maintainability.",
    "- Architect: keep ownership inside the frontend-design handoff and downstream implementation. Do not change other agent prompts or communication paths. Decompose work by named sourceDomReplacementPlan/source region only when that region is in scope.",
    "- Build: start from the target acceptance project populated by frontend_design. Only finish integration and precision fixes; do not treat frontend-design-skeleton as app source. Reuse project components or mature libraries for hard UI domains; do not hand-roll complex controls.",
    "- Acceptance/Integrity: verify source traceability, visual parity for unchanged reference surfaces, absence of screenshot/base64/iframe replay, and documented handling for every replaced/deferred source region.",
  ].join("\n")
}

/**
 * Prompt section pointing the next agent at the materialized frontend_design
 * template source and evidence manifest.
 *
 * `pathMode` selects the path form for the consumer's file-tool resolution
 * model: "relative" (default — in-process build/acceptance via OpenCorvus
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

  lines.push("## Frontend Design Public Report")
  lines.push("")
  lines.push(`Materialized frontend_design public report (read this): ${templatePath}`)
  lines.push(`Materialized source manifest file (read this): ${manifestPath}`)
  lines.push("Canonical decision-log phase (source of truth): frontend_design")
  lines.push("Read the public report and source manifest files before implementing or decomposing any visual/reference surface.")
  lines.push("Use file/image/source names from the manifest as readable evidence; do not run mirror tools outside frontend_design.")

  if (!includeExcerpts) return lines.join("\n")

  const entries = latestByKey(createDecisionLog(taskID).readByPhase("frontend_design"))
  const present = HANDOFF_KEYS.filter((key) => entries.has(key))
  if (present.length === 0) return lines.join("\n")

  const sourceRegionGuidance = renderSourceRegionRefactorGuidance(entries)
  if (sourceRegionGuidance) {
    lines.push("")
    lines.push(sourceRegionGuidance)
  }

  lines.push("")
  lines.push("### Compact Decision-Log Excerpts")
  lines.push("These excerpts orient the next agent only; read the materialized public report file for the complete source.")
  for (const key of present) {
    const entry = entries.get(key)
    if (!entry) continue
    lines.push(`- ${key}: ${cap(entry.value, valueCap, templatePath)}`)
  }

  return lines.join("\n")
}
