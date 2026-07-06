import { createDecisionLog, type DecisionEntry } from "@/decision-log"
import { ProjectRuntimePaths } from "@/project/runtime-paths"
import { FrontendProjectToolInputSchema } from "@/frontend-design/schema"
import { VisualRegionBindingManifestSchema, type VisualRegionBindingManifest } from "./visual-region-binding-schema"
import { z } from "zod"

// Single source of truth for the frontend-design materialized-artifact paths.
// The `frontend_design` decision-log phase is the canonical source; these
// files are a regenerated, read-only PROJECTION of it (rule 8 — one source;
// previously `orchestrator/tools.ts` recomputed these strings independently).
export const FRONTEND_DESIGN_RELATIVE_DIR_TEMPLATE = ".opencorvus/r/t/<task-key>/fd"
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

export const FRONTEND_DESIGN_COMPLETION_KEYS = [
  "public_report",
  "frontend_template",
  "fillable_modules",
  "material_inventory",
  "visual_consistency_contract",
  "ui_data_contract",
  "template_iteration_notes",
  "completeness_review",
  "evidence_source_manifest",
] as const

const FRONTEND_DESIGN_ADDITIONAL_HANDOFF_KEYS = [
  "final_acceptance_mode",
  "component_reuse_plan",
  "baseline_replacement_plan",
  "quality_project_contract",
  "frontend_project",
  "reference_artifacts",
  "visual_region_bindings",
] as const

export const FRONTEND_DESIGN_HANDOFF_KEYS = [
  ...FRONTEND_DESIGN_COMPLETION_KEYS,
  ...FRONTEND_DESIGN_ADDITIONAL_HANDOFF_KEYS,
] as const

function cap(value: string, maxChars: number, templatePath: string): string {
  const text = value.trim()
  if (text.length <= maxChars) return text
  return `${text.slice(0, maxChars)}... [+${text.length - maxChars} chars in ${templatePath}]`
}

function latestByKey(entries: DecisionEntry[]): Map<string, DecisionEntry> {
  const result = new Map<string, DecisionEntry>()
  for (const entry of entries) {
    if ((FRONTEND_DESIGN_HANDOFF_KEYS as readonly string[]).includes(entry.key)) result.set(entry.key, entry)
  }
  return result
}

export function parseFrontendProjectDecisionEntry(entry: DecisionEntry | undefined) {
  if (!entry) return undefined
  let raw: unknown
  try {
    raw = JSON.parse(entry.value)
  } catch (err) {
    throw new Error("frontend_design frontend_project decision must be schema JSON, not rendered report text", {
      cause: err,
    })
  }
  return FrontendProjectToolInputSchema.parse(raw)
}

export function parseVisualRegionBindingsDecisionEntry(entry: DecisionEntry | undefined): VisualRegionBindingManifest[] {
  if (!entry) return []
  let raw: unknown
  try {
    raw = JSON.parse(entry.value)
  } catch (err) {
    throw new Error("frontend_design visual_region_bindings decision must be schema JSON", {
      cause: err,
    })
  }
  return z.array(VisualRegionBindingManifestSchema).parse(raw)
}

function renderSourceRegionRefactorGuidance(entries: Map<string, DecisionEntry>): string {
  const frontendProject = parseFrontendProjectDecisionEntry(entries.get("frontend_project"))
  const isVisualBaseline = frontendProject?.role === "visual_baseline_input"
  const isSourceBaseline = frontendProject?.role === "source_baseline_input"
  if (!isSourceBaseline && !isVisualBaseline) return ""

  if (isVisualBaseline) {
    return [
      "## Visual HTML Skeleton Guidance",
      "",
      "Dynamic interpretation from the frontend_design decision log: this webpage handoff delivers a source-derived static HTML/CSS visual skeleton. Treat it as visual evidence input only when the report also records structured `visual_validation_evidence` with no blocking visual debt; otherwise treat it as unfinished frontend_design source debt, not as implementation target source or an independent design source.",
      "",
      "- Requirements: express downstream work as skeleton-to-project transcription from the screenshot-validated HTML skeleton plus original source IR/content/style evidence and `reference.png`; if structured validation evidence is missing, express the missing screenshot/region debt as a blocker.",
      "- Architect: keep ownership inside the frontend-design handoff and downstream implementation. Do not change other agent prompts or communication paths. Decompose later work by named visual/source regions and preserve source traceability.",
      "- Build: transcribe the screenshot-validated visual skeleton into maintainable project source with semantic components, data modules, scoped styles, asset ownership, and mature library choices for hard UI domains while preserving visual parity against both the skeleton and original reference evidence. If the visual skeleton lacks structured screenshot validation or has blocking debt, report that blocker instead of freehand rebuilding.",
      "- Deletion rule: do not delete `web-clone-source/` content until source-derived style evidence and styling obligations have been migrated into the validated downstream project source and verified against the reference evidence.",
      "- Acceptance/Integrity: verify source traceability, visual parity for unchanged reference surfaces, absence of screenshot/base64/iframe replay, and documented handling for every restored/deferred visual region.",
    ].join("\n")
  }

  return [
    "## Source-Region Refactor Guidance",
    "",
    "Dynamic interpretation from the frontend_design decision log: this webpage handoff starts from a captured source-baseline skeleton. Treat that project as captured rawproject evidence and unfinished frontend_design visual/source debt, not as the implementation target.",
    "",
    "- Requirements: express follow-up work as completing the missing visual HTML skeleton or transcribing an accepted skeleton into maintainable source, depending on what the frontend_design report says is missing.",
    "- Architect: keep ownership inside the frontend-design handoff and downstream implementation. Do not change other agent prompts or communication paths. Decompose work by named sourceDomReplacementPlan/source region only when that region is in scope.",
    "- Build: do not treat frontend-design-skeleton as app source. Use it only as captured source evidence; create/repair the visual skeleton first if frontend_design did not provide one, or transcribe the accepted skeleton into maintainable project source in the later workflow.",
    "- Evidence rule: keep source data extraction, structured rendered screenshot review evidence, and source-evidence review facts visible as source-package handoff facts.",
    "- Deletion rule: do not delete `web-clone-source/` content until source-derived style evidence and styling obligations have been migrated into the accepted downstream project source and verified against the reference evidence.",
    "- Acceptance/Integrity: verify source traceability, visual parity for unchanged reference surfaces, absence of screenshot/base64/iframe replay, and documented handling for every restored/deferred source region.",
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
export function renderFrontendDesignHandoffReference(
  taskID: string,
  options?: {
    valueCap?: number
    includeExcerpts?: boolean
    pathMode?: "relative" | "absolute"
    projectDir?: string
    goalScopedBuild?: boolean
  },
): string {
  const valueCap = options?.valueCap ?? 500
  const includeExcerpts = options?.includeExcerpts ?? true
  const mode = options?.pathMode ?? "relative"
  const entries = latestByKey(createDecisionLog(taskID).readByPhase("frontend_design"))
  if (!entries.has("public_report")) return ""
  const present = FRONTEND_DESIGN_HANDOFF_KEYS.filter((key) => entries.has(key))

  const relative = ProjectRuntimePaths.frontendDesignPaths("", taskID)
  let templatePath = relative.templateRelative
  let manifestPath = relative.manifestRelative
  if (mode === "absolute") {
    if (!options?.projectDir) {
      // Hard fail (rule 7) — an external executor given a relative path it
      // cannot resolve is exactly the latent bug this mode fixes; never
      // silently fall back to the unreachable relative form.
      throw new Error("renderFrontendDesignHandoffReference: pathMode 'absolute' requires projectDir")
    }
    const resolved = frontendDesignArtifactPaths(options.projectDir, taskID)
    templatePath = resolved.templateAbsolute
    manifestPath = resolved.manifestAbsolute
  }

  const lines: string[] = []

  lines.push("## Frontend Design Public Report")
  lines.push("")
  lines.push(`Materialized frontend_design public report (read this): ${templatePath}`)
  lines.push("Canonical decision-log phase (source of truth): frontend_design")
  if (options?.goalScopedBuild) {
    lines.push(
      "Goal-scoped Build visual targets come only from Architect reference_coverage crop rows and Build Evidence Pack target references.",
    )
    lines.push(
      "Read the public report for source/component context, but do not use full-page reference images from the source manifest as this goal's visual target.",
    )
  } else {
    lines.push(`Materialized source manifest file (read this): ${manifestPath}`)
    lines.push(
      "Read the public report and source manifest files before implementing or decomposing any visual/reference surface.",
    )
    lines.push(
      "Use file/image/source names from the manifest as readable evidence; do not run webpage evidence tools outside frontend_design.",
    )
  }

  if (!includeExcerpts) return lines.join("\n")

  const sourceRegionGuidance = renderSourceRegionRefactorGuidance(entries)
  if (sourceRegionGuidance) {
    lines.push("")
    lines.push(sourceRegionGuidance)
  }
  const visualRegionBindings = parseVisualRegionBindingsDecisionEntry(entries.get("visual_region_bindings"))
  if (visualRegionBindings.length > 0) {
    lines.push("")
    lines.push("## Visual Region Binding Crop Manifests")
    lines.push("")
    lines.push(
      "Frontend Design completed these model-authored horizontal component-band crops. Architect must bind visible goals to these reference_region_key rows instead of reusing the full-page reference image.",
    )
    for (const binding of visualRegionBindings) {
      lines.push(`- ${binding.manifest_path}: ${binding.slicing_strategy}`)
      lines.push(`  - overlay: ${binding.bbox_overlay_artifact}`)
      lines.push(`  - contact_sheet: ${binding.contact_sheet_artifact}`)
      lines.push(
        `  - reference_region_keys: ${binding.regions.map((region) => region.reference_region_key).join(", ")}`,
      )
    }
  }

  lines.push("")
  lines.push("### Compact Decision-Log Excerpts")
  lines.push(
    "These excerpts orient the next agent only; read the materialized public report file for the complete source.",
  )
  for (const key of present) {
    const entry = entries.get(key)
    if (!entry) continue
    lines.push(`- ${key}: ${cap(entry.value, valueCap, templatePath)}`)
  }

  return lines.join("\n")
}
