/**
 * Structured output tools for the Frontend Design & Replica Agent.
 *
 * The frontend template submitted through submit_frontend_template is the authoritative
 * frontend-design output. VisualSpec registration tools remain available to
 * tests and older collector call sites as optional compact anchors, but
 * frontend-design no longer depends on registering rows before handoff.
 */
import { tool } from "ai"
import { createHash } from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { z } from "zod"
import { BrowserRuntime } from "@/browser/runtime"
import { runBrowserNodeSidecar } from "@/browser/runtime/node-executor"
import { requireRuntimePackage } from "@/runtime/package-require"
import {
  ColorSchema,
  ComponentSchema,
  FrontendTemplateFinalSchema,
  FrontendTemplateBasicsToolInputSchema,
  FrontendTemplateCompactItemToolInputSchema,
  FrontendTemplateMarkdownSectionToolInputSchema,
  FrontendTemplateStringItemToolInputSchema,
  FrontendTemplateSubmitSchema,
  FrontendTemplateToolInputSchema,
  FrontendProjectToolInputSchema,
  InteractionSchema,
  LayoutSchema,
  ResponsiveSchema,
  SpacingSchema,
  ToolBaselineReplacementPlanItemSchema,
  ToolComponentReusePlanItemSchema,
  ToolImplementationPhaseOutcomeSchema,
  ToolMaterialInventoryItemSchema,
  ToolVisualValidationEvidenceSchema,
  TypographySchema,
  type FrontendTemplateFinal,
  type VisualSpec,
  type VisualSpecCategory,
} from "./schema"
import { limitSummary, markdownList, requireReportString } from "@/agent/report"

export type { FrontendTemplateFinal } from "./schema"

const sharp = requireRuntimePackage<typeof import("sharp")>("sharp")
type FrontendTemplateToolInput = z.infer<typeof FrontendTemplateToolInputSchema>
type FrontendTemplateDraft = Partial<FrontendTemplateToolInput>

const StaticHtmlScreenshotScript = String.raw`
const { chromium } = require(process.env.OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH || "playwright");

function decodePayload() {
  const raw = Buffer.from(process.env.OPENCORVUS_FRONTEND_RENDER_PAYLOAD || "", "base64").toString("utf8");
  return JSON.parse(raw);
}

(async () => {
  const payload = decodePayload();
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: payload.executablePath,
      headless: true,
      args: payload.launchArgs,
      timeout: payload.timeoutMs,
    });
    const page = await browser.newPage({
      viewport: { width: payload.viewport.width, height: payload.viewport.height },
      deviceScaleFactor: 1,
    });
    await page.goto(payload.url, { waitUntil: "networkidle", timeout: payload.timeoutMs });
    const bytes = await page.screenshot({ type: "png", fullPage: false });
    process.stdout.write(JSON.stringify({ ok: true, screenshotBase64: bytes.toString("base64") }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
})();
`

// ---------------------------------------------------------------------------
// Collector — private. Callers read through getSpecs() / getStats().
//
// The cross-field validation formerly in `finalize_design_requirements`
// (≥2 colors, ≥1 typography, layout, component) is dropped in favour of
// a direct frontend template submit contract. The agent is free to under-register
// optional anchors; callers consume the submitted frontend template as the source
// of truth.
// ---------------------------------------------------------------------------

export interface FrontendTemplateOutputCollector {
  specs: VisualSpec[]
  draft: FrontendTemplateDraft
  final?: FrontendTemplateFinal
  semantic_error?: string
}

const VISUAL_ANCHOR_BUDGET = 80
const REQUIRED_IMPLEMENTATION_PHASES = [
  "evidence_lock",
  "implementation_scaffold",
  "data_component_transcription",
  "runtime_visual_verification",
  "source_quality_cleanup",
] as const
const artifactValidatedVisualFinals = new WeakSet<FrontendTemplateFinal>()

function emptyCollector(): FrontendTemplateOutputCollector {
  return { specs: [], draft: {} }
}

function titleFromMarkdown(text: string): string | undefined {
  const line = text
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith("# "))
  return line?.replace(/^#+\s*/, "").trim()
}

function renderComponentReusePlan(items: readonly FrontendTemplateFinal["component_reuse_plan"][number][]): string {
  if (items.length === 0) return "- no component reuse plan submitted"
  return items
    .map((item) => {
      const lines = [
        `- ${item.family_id} — ${item.name}`,
        `  - strategy: ${item.implementation_strategy}`,
        `  - surface: ${item.observed_surface}`,
        `  - reuse_source: ${item.reuse_source}`,
        `  - props_states: ${item.props_states}`,
        `  - replacement_boundary: ${item.replacement_boundary}`,
        `  - parity_guard: ${item.parity_guard}`,
      ]
      if (item.mature_library_candidates.length > 0) {
        lines.push(`  - mature_library_candidates: ${item.mature_library_candidates.join(", ")}`)
      }
      if (item.source_refs.length > 0) {
        lines.push(`  - source_refs: ${item.source_refs.join(", ")}`)
      }
      if (item.project_specific_reason) {
        lines.push(`  - project_specific_reason: ${item.project_specific_reason}`)
      }
      return lines.join("\n")
    })
    .join("\n")
}

function renderBaselineReplacementPlan(
  items: readonly FrontendTemplateFinal["baseline_replacement_plan"][number][],
): string {
  if (items.length === 0) return "- no source-region evolution plan submitted"
  return items
    .map((item) => {
      const lines = [
        `- ${item.boundary_id} — ${item.source_region}`,
        `  - action: ${item.action}`,
        `  - component_family_id: ${item.component_family_id}`,
        `  - replacement_strategy: ${item.replacement_strategy}`,
        `  - reuse_source: ${item.reuse_source}`,
        `  - deletion_rule: ${item.deletion_rule}`,
        `  - parity_guard: ${item.parity_guard}`,
      ]
      if (item.mature_library_candidates.length > 0) {
        lines.push(`  - mature_library_candidates: ${item.mature_library_candidates.join(", ")}`)
      }
      if (item.source_refs.length > 0) {
        lines.push(`  - source_refs: ${item.source_refs.join(", ")}`)
      }
      if (item.project_specific_reason) {
        lines.push(`  - project_specific_reason: ${item.project_specific_reason}`)
      }
      return lines.join("\n")
    })
    .join("\n")
}

function renderImplementationPhaseOutcomes(
  items: readonly FrontendTemplateFinal["implementation_phase_outcomes"][number][],
): string {
  if (items.length === 0) return "- no implementation phase outcomes submitted"
  return items
    .map((item) =>
      [
        `- ${item.id} — ${item.title}`,
        `  - phase: ${item.phase}`,
        `  - deliverable: ${item.deliverable}`,
        `  - acceptance: ${item.acceptance}`,
        `  - source_refs: ${item.source_refs.join(", ")}`,
      ].join("\n"),
    )
    .join("\n")
}

function renderNamedItems(
  title: string,
  items: readonly {
    title: string
    detail: string
    source_refs?: string[]
  }[],
): string {
  if (items.length === 0) return ""
  const lines = [`## ${title}`]
  for (const item of items) {
    lines.push(`- ${item.title}: ${item.detail}`)
    if (item.source_refs && item.source_refs.length > 0) {
      lines.push(`  - source_refs: ${item.source_refs.join(", ")}`)
    }
  }
  return lines.join("\n")
}

function renderVisualValidationEvidence(
  items: readonly FrontendTemplateFinal["visual_validation_evidence"][number][],
): string {
  if (items.length === 0) return "- no structured rendered screenshot evidence submitted"
  return items
    .map((item) =>
      [
        `- ${item.id}: ${item.review_status}`,
        `  - render_target: ${item.render_target}`,
        `  - rendered_entrypoint: ${item.rendered_entrypoint}`,
        `  - renderer: ${item.renderer}`,
        `  - viewport: ${item.viewport}`,
        `  - screenshot_artifact: ${item.screenshot_artifact}`,
        `  - source_reference_artifact: ${item.source_reference_artifact}`,
        `  - screenshot_sha256: ${item.screenshot_sha256}`,
        `  - source_reference_sha256: ${item.source_reference_sha256}`,
        item.diff_artifact ? `  - diff_artifact: ${item.diff_artifact}` : undefined,
        `  - review_summary: ${item.review_summary}`,
      ]
        .filter((line): line is string => typeof line === "string")
        .join("\n"),
    )
    .join("\n")
}

function renderComponentInventoryFromReusePlan(
  items: readonly FrontendTemplateFinal["component_reuse_plan"][number][],
): string {
  if (items.length === 0) return ""
  return [
    "Component-family cross-check.",
    "Do not treat this field as a standalone component checklist; use component_reuse_plan, quality_project_contract, completeness_review, open_questions, and named source artifacts for implementation decisions.",
    `Reuse families captured: ${items.map((item) => item.family_id).join(", ")}`,
  ].join("\n")
}

function renderQualityProjectContract(final: FrontendTemplateFinal): string {
  if (final.frontend_project.role === "visual_baseline_input") {
    return [
      "## Visual HTML Skeleton Workflow",
      "- Current workflow deliverable: a source-editable static HTML/CSS design skeleton whose visual fidelity is verified against the original reference artifacts.",
      "- Token rule: `visual-html-skeleton/styles/tokens.css` should contain source-backed CSS custom properties for colors, typography, spacing/density, radii, borders, shadows, media/icon sizing, chart/table/map range colors, and responsive widths; regional CSS should consume those tokens or document source-backed exceptions.",
      "- This skeleton is the workflow target for Requirements, Architect, Build, and Integrity in this round; they should improve and verify HTML/CSS visual parity, not convert it into a complete application source tree in the same workflow unless the active task explicitly says to combine both rounds.",
      "- Later workflow deliverable: transcribe the accepted HTML skeleton plus source IR/content/style evidence into maintainable project source with semantic components, data modules, scoped styles, asset ownership, and runtime verification.",
      "- Conflict rule: `web-clone-source/source-ir/*`, `web-clone-source/source-skeleton/*`, source assets, and `web-clone-source/reference.png` remain authoritative if the HTML skeleton conflicts with source evidence or visible pixels.",
      "- The HTML skeleton is not an implementation target, not the acceptance app root, and not an independent design source.",
    ].join("\n")
  }
  if (final.final_acceptance_mode === "visual_baseline_allowed") {
    return [
      "## Visual HTML Skeleton Workflow Incomplete",
      "- Current workflow expectation: frontend_design must deliver `frontend_project.role=visual_baseline_input` with a separate source-editable static HTML/CSS skeleton rooted at `visual-html-skeleton/`.",
      "- Submitted project is not the visual HTML skeleton baseline. Treat it as frontend_design decision-log evidence that the source-evidence baseline still has to be restored into editable HTML/CSS before downstream workflow work begins.",
      "- Required next frontend_design action: restore `visual-html-skeleton/index.html`, `visual-html-skeleton/styles/tokens.css`, regional CSS/assets, rendered screenshots, and visual comparison evidence from the task-runtime `web-clone-source/` package and reference pixels.",
      "- Do not ask other agents to reinterpret `frontend-design-skeleton`, framework source, compiled output, raw source DOM replay, or screenshot-only HTML as the visual baseline.",
    ].join("\n")
  }
  const lines = [
    "## Maintainable Target Project",
    "- The frontend-design high-fidelity skeleton project is source evidence, not the implementation target.",
    "- Build should preserve the readable target-project source ownership frontend_design delivered: React/Vue components, data modules, CSS modules/sidecars, asset references, runtime entrypoints, and verification commands.",
    "- Repeated rows/cards/items must be rendered from arrays and component loops.",
    "- Complex controls must follow component_reuse_plan; use baseline_replacement_plan only for specifically named raw/generated regions that need in-place evolution.",
  ]
  if (final.component_reuse_plan.length > 0) {
    lines.push("", "## Component Targets")
    for (const item of final.component_reuse_plan) {
      lines.push(`- ${item.family_id}: ${item.name} via ${item.implementation_strategy} (${item.reuse_source})`)
    }
  }
  if (final.baseline_replacement_plan.length > 0) {
    lines.push("", "## Baseline Replacement Boundaries")
    for (const item of final.baseline_replacement_plan) {
      lines.push(`- ${item.boundary_id}: ${item.action} using ${item.component_family_id}`)
    }
  }
  return lines.join("\n")
}

function normalizeFrontendTemplateFinal(final: FrontendTemplateFinal): FrontendTemplateFinal {
  const next = {
    ...final,
    frontend_project: normalizeFrontendProject(final.frontend_project),
  }
  next.frontend_template =
    next.frontend_template.trim() || renderNamedItems("Frontend Template", next.frontend_template_sections)
  next.fillable_modules =
    next.fillable_modules.trim() || renderNamedItems("Fillable Modules", next.fillable_module_items)
  next.component_inventory =
    next.component_inventory.trim() || renderComponentInventoryFromReusePlan(next.component_reuse_plan)
  next.quality_project_contract =
    next.quality_project_contract.trim() ||
    renderNamedItems("Quality Project Contract", next.quality_project_items) ||
    renderQualityProjectContract(next)
  next.material_inventory =
    next.material_inventory.trim() || renderNamedItems("Material Inventory", next.material_inventory_items)
  next.visual_consistency_contract =
    next.visual_consistency_contract.trim() ||
    renderNamedItems("Visual Consistency Contract", next.visual_consistency_items)
  next.ui_data_contract =
    next.ui_data_contract.trim() || renderNamedItems("UI Data Contract", next.ui_data_contract_items)
  return next
}

function normalizeFrontendProject(
  project: FrontendTemplateFinal["frontend_project"],
): FrontendTemplateFinal["frontend_project"] {
  const root = normalizeProjectRootForReport(project.project_root)
  if (isFrontendDesignSkeletonRoot(root) && project.role === "implementation_target") {
    return { ...project, role: "source_baseline_input" }
  }
  return project
}

function normalizeProjectRootForReport(projectRoot: string): string {
  return normalizeReportPath(projectRoot)
}

function normalizeReportPath(value: string): string {
  const normalized = path.posix.normalize(value.replaceAll("\\", "/").trim())
  if (normalized === ".") return ""
  return normalized.replace(/^\.\/+/, "").replace(/\/+$/, "")
}

function isFrontendDesignSkeletonRoot(normalizedProjectRoot: string): boolean {
  const root = normalizedProjectRoot.toLowerCase()
  return root.split("/").includes("frontend-design-skeleton")
}

function referencesVisualHtmlSkeletonRoot(normalizedProjectRoot: string): boolean {
  const root = normalizedProjectRoot.toLowerCase()
  const windowsEquivalentRoot = stripWindowsEquivalentSegmentSuffixes(root)
  return (
    root.split("/").includes("visual-html-skeleton") ||
    windowsEquivalentRoot.split("/").includes("visual-html-skeleton")
  )
}

function isValidVisualHtmlSkeletonRoot(normalizedProjectRoot: string, artifactRootRelative?: string): boolean {
  const root = normalizedProjectRoot.toLowerCase()
  if (root === ".." || root.startsWith("../")) return false
  if (root === "visual-html-skeleton") return true
  if (!artifactRootRelative) return false
  const fdRoot = normalizeReportPath(artifactRootRelative).toLowerCase()
  return root === `${fdRoot}/visual-html-skeleton`
}

function stripWindowsEquivalentSegmentSuffixes(normalizedPath: string): string {
  return normalizedPath
    .split("/")
    .map((segment) => segment.replace(/[ .]+$/g, ""))
    .join("/")
}

function parseMaybeStringArray(value: unknown): unknown {
  if (Array.isArray(value)) return value
  if (typeof value !== "string") return value
  const trimmed = value.trim()
  if (!trimmed) return []
  if (!trimmed.startsWith("[")) return value
  try {
    const parsed = JSON.parse(trimmed)
    return Array.isArray(parsed) ? parsed : value
  } catch {
    return value
  }
}

function normalizeFrontendTemplateInput(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input
  const source = input as Record<string, unknown>
  const normalized: Record<string, unknown> = { ...source }

  // Some providers flatten a nested tool object into keys like
  // `frontend_project<arg_key>status`; rebuild that object before Zod parsing.
  const frontendProject: Record<string, unknown> = {
    ...(source.frontend_project &&
    typeof source.frontend_project === "object" &&
    !Array.isArray(source.frontend_project)
      ? (source.frontend_project as Record<string, unknown>)
      : {}),
  }
  let sawFlattenedFrontendProject = false
  for (const [key, value] of Object.entries(source)) {
    const match = /^frontend_project<arg_key>(.+)$/.exec(key)
    if (!match) continue
    sawFlattenedFrontendProject = true
    const field = match[1]
    frontendProject[field] = field === "entrypoints" || field === "notes" ? parseMaybeStringArray(value) : value
    delete normalized[key]
  }
  if (sawFlattenedFrontendProject || source.frontend_project) {
    normalized.frontend_project = frontendProject
  }
  return normalized
}

function hasText(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0
}

function hasItems(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0
}

function arrayField<T>(draft: FrontendTemplateDraft, key: keyof FrontendTemplateToolInput): T[] {
  const record = draft as Record<string, unknown>
  const existing = record[key as string]
  if (Array.isArray(existing)) return existing as T[]
  const created: T[] = []
  record[key as string] = created
  return created
}

function upsertByStringKey<T extends Record<string, unknown>>(
  items: T[],
  item: T,
  key: keyof T,
): "registered" | "overwritten" {
  const value = item[key]
  const idx = items.findIndex((existing) => existing[key] === value)
  if (idx >= 0) {
    items[idx] = item
    return "overwritten"
  }
  items.push(item)
  return "registered"
}

function appendUniqueString(list: string[], value: string): "registered" | "already_registered" {
  if (list.includes(value)) return "already_registered"
  list.push(value)
  return "registered"
}

function requiredImplementationPhaseMissingActions(draft: FrontendTemplateDraft): string[] {
  if (draft.final_acceptance_mode !== "maintainable_replacement_required") return []
  const covered = new Set((draft.implementation_phase_outcomes ?? []).map((item) => item.phase))
  return REQUIRED_IMPLEMENTATION_PHASES.filter((phase) => !covered.has(phase)).map(
    (phase) =>
      `update_frontend_phase({ phase: "${phase}", id, title, deliverable, source_refs, acceptance })`,
  )
}

function frontendDraftMissingActions(collector: FrontendTemplateOutputCollector, autoIteration: boolean): string[] {
  const draft = collector.draft
  const actions: string[] = []

  if (!hasText(draft.design_system) || !hasItems(draft.tech_stack) || !hasText(draft.final_acceptance_mode)) {
    actions.push(
      'update_frontend_basics({ design_system, tech_stack, final_acceptance_mode: "visual_baseline_allowed" | "maintainable_replacement_required" })',
    )
  }
  if (!hasText(draft.frontend_template) && !hasItems(draft.frontend_template_sections)) {
    actions.push(
      'update_frontend_text({ section: "frontend_template", content }) or update_frontend_item({ target: "frontend_template_sections", item })',
    )
  }
  if (!hasText(draft.fillable_modules) && !hasItems(draft.fillable_module_items)) {
    actions.push(
      'update_frontend_text({ section: "fillable_modules", content }) or update_frontend_item({ target: "fillable_module_items", item })',
    )
  }
  if (!hasItems(draft.component_reuse_plan)) {
    actions.push("update_frontend_component_reuse({ family_id, name, observed_surface, implementation_strategy, reuse_source, props_states, replacement_boundary, parity_guard, ... })")
  }
  if (!hasItems(draft.material_inventory_items)) {
    actions.push("update_frontend_material({ title, detail, source_refs })")
  }
  if (!hasText(draft.visual_consistency_contract) && !hasItems(draft.visual_consistency_items)) {
    actions.push(
      'update_frontend_text({ section: "visual_consistency_contract", content }) or update_frontend_item({ target: "visual_consistency_items", item })',
    )
  }
  if (!hasText(draft.ui_data_contract) && !hasItems(draft.ui_data_contract_items)) {
    actions.push(
      'update_frontend_text({ section: "ui_data_contract", content }) or update_frontend_item({ target: "ui_data_contract_items", item })',
    )
  }
  if (!hasText(draft.completeness_review)) {
    actions.push('update_frontend_text({ section: "completeness_review", content })')
  }
  if (!hasItems(draft.template_iteration_notes) || (autoIteration && (draft.template_iteration_notes?.length ?? 0) < 2)) {
    actions.push("update_frontend_iteration_note({ value })")
  }
  actions.push(...requiredImplementationPhaseMissingActions(draft))
  if (draft.frontend_project?.role === "visual_baseline_input" && !hasItems(draft.visual_validation_evidence)) {
    actions.push("update_frontend_visual_evidence({ id, rendered_entrypoint, screenshot_artifact, source_reference_artifact, renderer, viewport, hashes, review_status, review_summary })")
  }
  return actions
}

function frontendTemplateStatus(collector: FrontendTemplateOutputCollector, autoIteration: boolean): string {
  if (collector.final) return "FRONTEND_TEMPLATE_RESULT_STATUS: finalized"
  const missing = frontendDraftMissingActions(collector, autoIteration)
  const draft = collector.draft
  const lines = [
    `FRONTEND_TEMPLATE_RESULT_STATUS: ${missing.length > 0 ? "incomplete" : "ready_for_submit_validation"}`,
    `registered: template_items=${draft.frontend_template_sections?.length ?? 0}, fillable_items=${draft.fillable_module_items?.length ?? 0}, component_reuse=${draft.component_reuse_plan?.length ?? 0}, material_items=${draft.material_inventory_items?.length ?? 0}, quality_items=${draft.quality_project_items?.length ?? 0}, visual_items=${draft.visual_consistency_items?.length ?? 0}, data_items=${draft.ui_data_contract_items?.length ?? 0}, phase_outcomes=${draft.implementation_phase_outcomes?.length ?? 0}, visual_evidence=${draft.visual_validation_evidence?.length ?? 0}, iteration_notes=${draft.template_iteration_notes?.length ?? 0}`,
  ]
  if (collector.semantic_error) lines.push(`last_validation_error: ${collector.semantic_error}`)
  if (missing.length > 0) {
    lines.push("next_required_update_calls:", markdownList(missing))
  } else {
    lines.push('next: call submit_frontend_template({ "final": true })')
  }
  return lines.join("\n")
}

async function submitFrontendTemplateDraft(input: {
  collector: FrontendTemplateOutputCollector
  rawInput: unknown
  autoIteration: boolean
  artifactRoot: string
  artifactRootRelative?: string
  workspaceRoot: string
}): Promise<string> {
  if (input.collector.final)
    return "Error: frontend template already submitted; duplicate submit_frontend_template ignored."
  const { fact_check_items } = FrontendTemplateSubmitSchema.parse(input.rawInput)
  const missing = frontendDraftMissingActions(input.collector, input.autoIteration)
  if (missing.length > 0) {
    input.collector.semantic_error = "frontend template fragments are incomplete"
    return [
      "MISSING_FRONTEND_TEMPLATE_RESULT: finalizer kept the collector open.",
      "Call the listed update_* tools with the missing fragments, then call submit_frontend_template({ final: true }) again.",
      markdownList(missing),
    ].join("\n")
  }

  let final: FrontendTemplateFinal
  try {
    const parsed = FrontendTemplateToolInputSchema.parse(normalizeFrontendTemplateInput(input.collector.draft))
    final = normalizeFrontendTemplateFinal(
      FrontendTemplateFinalSchema.parse({
        ...parsed,
        fact_check_items,
      }),
    )
    await assertFrontendTemplateFinal(final, {
      artifactRoot: input.artifactRoot,
      artifactRootRelative: input.artifactRootRelative,
      workspaceRoot: input.workspaceRoot,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    input.collector.semantic_error = msg
    return [
      `Error: frontend template failed final validation: ${msg}`,
      "Collector remains open. Correct the specific fragment with the matching update_* tool, or call inspect_frontend_result_status for current fragment counts.",
    ].join("\n")
  }
  if (input.autoIteration && final.template_iteration_notes.length < 2) {
    input.collector.semantic_error =
      "assistant.auto_iteration=true requires at least two frontend template review-pass notes before submit_frontend_template."
    return [
      "MISSING_FRONTEND_TEMPLATE_RESULT: finalizer kept the collector open.",
      input.collector.semantic_error,
      "Call update_frontend_iteration_note({ value }) with the second review pass, then call submit_frontend_template({ final: true }) again.",
    ].join("\n")
  }
  if (final.frontend_project.role === "visual_baseline_input") {
    artifactValidatedVisualFinals.add(final)
  }
  input.collector.final = final
  input.collector.semantic_error = undefined
  return "OK: complete frontend design/replica contract submitted for orchestrator handoff."
}

export function buildFrontendTemplateReport(collector: FrontendTemplateOutputCollector) {
  if (!collector.final) throw new Error("agent report design final is missing")
  const title = titleFromMarkdown(collector.final.frontend_template)
  const summary = title ? title : `${collector.specs.length} visual spec(s) for ${collector.final.design_system}`
  const specLines = collector.specs.map((spec) => `${spec.id} [${spec.category}]: ${spec.title}`)
  return {
    summary: limitSummary(summary),
    detail: [
      `## Design System\n${collector.final.design_system}`,
      `## Recommended Stack\n${collector.final.tech_stack.length ? markdownList(collector.final.tech_stack) : "- not specified"}`,
      `## Frontend Template\n${requireReportString(collector.final.frontend_template, "frontend_template")}`,
      `## Final Acceptance Mode\n${collector.final.final_acceptance_mode}`,
      `## Fillable Modules\n${collector.final.fillable_modules}`,
      `## Implementation Problems And Agent Handoff\n${collector.final.completeness_review}`,
      `## Implementation Phase Outcomes\n${renderImplementationPhaseOutcomes(collector.final.implementation_phase_outcomes)}`,
      `## Reuse Constraints\n${renderComponentReusePlan(collector.final.component_reuse_plan)}`,
      `## Source Region Evolution Plan\n${renderBaselineReplacementPlan(collector.final.baseline_replacement_plan)}`,
      `## Quality Project Contract\n${collector.final.quality_project_contract}`,
      `## Material Inventory\n${collector.final.material_inventory}`,
      `## Frontend Project\n${renderFrontendProjectReport(collector.final)}`,
      `## Visual Consistency Contract\n${collector.final.visual_consistency_contract}`,
      `## Visual Validation Evidence\n${renderVisualValidationEvidence(collector.final.visual_validation_evidence)}`,
      `## UI Data Contract\n${collector.final.ui_data_contract}`,
      `## Template Iteration Notes\n${markdownList(collector.final.template_iteration_notes)}`,
      `## Reference Artifacts\n${collector.final.reference_artifacts.length ? markdownList(collector.final.reference_artifacts) : "- no reference artifacts submitted"}`,
      `## Open Questions\n${collector.final.open_questions.length ? markdownList(collector.final.open_questions) : "- none"}`,
      `## Visual Anchors\n${specLines.length ? markdownList(specLines) : "- no compact visual anchors submitted"}`,
    ].join("\n\n"),
  }
}

async function assertFrontendTemplateFinal(
  final: FrontendTemplateFinal,
  options: { artifactRoot: string; artifactRootRelative?: string; workspaceRoot: string },
): Promise<void> {
  const requiredRenderedFields = [
    ["frontend_template", final.frontend_template],
    ["fillable_modules", final.fillable_modules],
    ["quality_project_contract", final.quality_project_contract],
    ["material_inventory", final.material_inventory],
    ["visual_consistency_contract", final.visual_consistency_contract],
    ["ui_data_contract", final.ui_data_contract],
  ] as const
  for (const [key, value] of requiredRenderedFields) {
    if (!value.trim())
      throw new Error(`${key} is required; provide concise markdown or the matching structured *_items field`)
  }
  if (
    final.final_acceptance_mode === "maintainable_replacement_required" &&
    final.frontend_project.role === "visual_baseline_input"
  ) {
    throw new Error(
      "final_acceptance_mode=maintainable_replacement_required cannot submit frontend_project.role=visual_baseline_input; " +
        "report a real implementation_target scaffold or role=blocked with the missing implementation/screenshot evidence.",
    )
  }
  const normalizedProjectRoot = normalizeProjectRootForReport(final.frontend_project.project_root)
  if (
    final.frontend_project.role === "implementation_target" &&
    referencesVisualHtmlSkeletonRoot(normalizedProjectRoot)
  ) {
    throw new Error(
      "frontend_project.role=implementation_target cannot point at visual-html-skeleton; " +
        "visual-html-skeleton is a static visual baseline/source artifact. Use role=visual_baseline_input for a validated visual-baseline workflow, or report a real maintainable implementation target / role=blocked for production tasks.",
    )
  }
  if (
    final.frontend_project.role === "visual_baseline_input" &&
    !isValidVisualHtmlSkeletonRoot(normalizedProjectRoot, options.artifactRootRelative)
  ) {
    throw new Error(
      "frontend_project.role=visual_baseline_input requires frontend_project.project_root to point at visual-html-skeleton; " +
        "do not submit web-clone-source, traversed paths, source skeletons, or other evidence packages as the visual baseline project root.",
    )
  }
  if (final.frontend_project.role === "visual_baseline_input") {
    const quality = await inspectVisualBaselineQualityForSubmit(final, {
      ...options,
      requireArtifactVerification: true,
    })
    if (quality.status === "evidence_missing") {
      throw new Error(
        "frontend_project.role=visual_baseline_input requires artifact-backed rendered screenshot review evidence for the visual-html-skeleton output; " +
          "submit structured visual_validation_evidence whose rendered_entrypoint, screenshot_artifact, source_reference_artifact, optional diff_artifact, and sha256 digests match real files under the task artifact root, or report the visual baseline as blocked/incomplete source debt instead of submitting an unproven skeleton.",
      )
    }
    if (quality.status === "incomplete_visual_fidelity") {
      throw new Error(
        "frontend_project.role=visual_baseline_input cannot be submitted with blocking visual debt; " +
          "repair the visual-html-skeleton until structured screenshot review has no blocking debt, or report frontend_project.role=blocked/source_baseline_input with the named unfinished visual debt.",
      )
    }
  }
  if (final.final_acceptance_mode === "maintainable_replacement_required") {
    assertMaintainablePhaseOutcomes(final)
  }
  if (final.frontend_project.role === "implementation_target") {
    const projectRoot = assertImplementationTargetEntrypoints(final, options.workspaceRoot)
    assertConcreteReuseSourceEvidence(final, projectRoot)
  }
}

function assertMaintainablePhaseOutcomes(final: FrontendTemplateFinal): void {
  const present = new Set(final.implementation_phase_outcomes.map((item) => item.phase))
  const missing = REQUIRED_IMPLEMENTATION_PHASES.filter((phase) => !present.has(phase))
  if (missing.length > 0) {
    throw new Error(
      "final_acceptance_mode=maintainable_replacement_required requires structured implementation_phase_outcomes covering " +
        `${REQUIRED_IMPLEMENTATION_PHASES.join(", ")}; missing ${missing.join(", ")}. ` +
        "Do not force Architect to derive phase goals from component_inventory or component_reuse_plan.",
    )
  }
}

function assertImplementationTargetEntrypoints(final: FrontendTemplateFinal, workspaceRoot: string): string {
  const project = final.frontend_project
  if (!project.project_root.trim()) {
    throw new Error("frontend_project.role=implementation_target requires a non-empty project_root.")
  }
  if (project.entrypoints.length === 0) {
    throw new Error("frontend_project.role=implementation_target requires at least one project-root-relative entrypoint.")
  }
  const projectRoot = resolveWorkspaceReportPath(workspaceRoot, project.project_root)
  if (!projectRoot || !isDirectory(projectRoot)) {
    throw new Error(
      `frontend_project.role=implementation_target requires project_root to resolve to an existing directory under the workspace: ${project.project_root}`,
    )
  }
  const missingEntrypoints = project.entrypoints.filter((entrypoint) => {
    const entrypointFile = resolveProjectRootRelativeFile(projectRoot, entrypoint)
    return !entrypointFile || !isReadableFile(entrypointFile)
  })
  if (missingEntrypoints.length > 0) {
    throw new Error(
      "frontend_project.role=implementation_target requires every entrypoint to be a real project-root-relative file; missing or invalid: " +
        missingEntrypoints.join(", "),
    )
  }
  return projectRoot
}

function assertConcreteReuseSourceEvidence(final: FrontendTemplateFinal, projectRoot: string): void {
  const packageDeps = readPackageDependencies(projectRoot)
  const invalid: string[] = []
  for (const item of final.component_reuse_plan) {
    if (item.implementation_strategy === "mature_library") {
      if (!reuseSourceNamesInstalledPackageOrExistingPath(item.reuse_source, projectRoot, packageDeps)) {
        invalid.push(`component_reuse_plan.${item.family_id}.reuse_source=${item.reuse_source}`)
      }
    }
    if (item.implementation_strategy === "existing_project_component") {
      if (!reuseSourceNamesInstalledPackageOrExistingPath(item.reuse_source, projectRoot, packageDeps)) {
        invalid.push(`component_reuse_plan.${item.family_id}.reuse_source=${item.reuse_source}`)
      }
    }
  }
  for (const item of final.baseline_replacement_plan) {
    if (item.replacement_strategy === "mature_library" || item.replacement_strategy === "existing_project_component") {
      if (!reuseSourceNamesInstalledPackageOrExistingPath(item.reuse_source, projectRoot, packageDeps)) {
        invalid.push(`baseline_replacement_plan.${item.boundary_id}.reuse_source=${item.reuse_source}`)
      }
    }
  }
  if (invalid.length > 0) {
    throw new Error(
      "maintainable implementation reuse sources must bind to an installed package in project_root/package.json or an existing project source file; invalid: " +
        invalid.join(", "),
    )
  }
}

function resolveWorkspaceReportPath(workspaceRoot: string, reportPath: string): string | undefined {
  const root = path.resolve(workspaceRoot)
  if (reportPath.replaceAll("\\", "/").trim().replace(/\/+$/, "") === ".") return root
  const normalized = normalizeReportPath(reportPath)
  if (!normalized) return undefined
  const absolute = path.isAbsolute(reportPath) ? path.resolve(reportPath) : path.resolve(root, ...normalized.split("/"))
  const relative = path.relative(root, absolute)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
  return absolute
}

function resolveProjectRootRelativeFile(projectRoot: string, reportPath: string): string | undefined {
  if (path.isAbsolute(reportPath)) return undefined
  const normalized = normalizeReportPath(reportPath)
  if (!normalized || normalized === ".." || normalized.startsWith("../")) return undefined
  const absolute = path.resolve(projectRoot, ...normalized.split("/"))
  const relative = path.relative(projectRoot, absolute)
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) return undefined
  return absolute
}

function isDirectory(file: string): boolean {
  try {
    return fs.statSync(file).isDirectory()
  } catch {
    return false
  }
}

function readPackageDependencies(projectRoot: string): Set<string> {
  const packageFile = path.join(projectRoot, "package.json")
  if (!isReadableFile(packageFile)) return new Set()
  try {
    const parsed = JSON.parse(fs.readFileSync(packageFile, "utf8")) as {
      dependencies?: Record<string, unknown>
      devDependencies?: Record<string, unknown>
      peerDependencies?: Record<string, unknown>
      optionalDependencies?: Record<string, unknown>
    }
    return new Set([
      ...Object.keys(parsed.dependencies ?? {}),
      ...Object.keys(parsed.devDependencies ?? {}),
      ...Object.keys(parsed.peerDependencies ?? {}),
      ...Object.keys(parsed.optionalDependencies ?? {}),
    ])
  } catch {
    return new Set()
  }
}

function reuseSourceNamesInstalledPackageOrExistingPath(
  reuseSource: string,
  projectRoot: string,
  packageDeps: ReadonlySet<string>,
): boolean {
  const projectFile = resolveProjectRootRelativeFile(projectRoot, reuseSource)
  if (projectFile && isReadableFile(projectFile)) return true
  const packageName = packageNameFromReuseSource(reuseSource)
  return packageName ? packageDeps.has(packageName) : false
}

function packageNameFromReuseSource(reuseSource: string): string | undefined {
  const trimmed = reuseSource.trim()
  const scoped = /^(@[a-z0-9._-]+\/[a-z0-9._-]+)/i.exec(trimmed)
  if (scoped) return scoped[1]
  const bare = /^([a-z0-9._-]+)(?:\/[a-z0-9._-]+)?$/i.exec(trimmed)
  return bare ? bare[1] : undefined
}

async function inspectVisualBaselineQualityForSubmit(
  final: FrontendTemplateFinal,
  options: { artifactRoot: string; artifactRootRelative?: string; requireArtifactVerification: boolean },
): Promise<{
  status: "high_fidelity_evidence_reported" | "incomplete_visual_fidelity" | "evidence_missing"
  hasRemainingDebt: boolean
}> {
  const text = collectVisualBaselineText(final)
  const hasRemainingDebt = hasBlockingVisualDebt(text)
  const hasRenderedScreenshotEvidence = await hasStructuredRenderedScreenshotEvidenceForSubmit(final, options)
  const hasStructuredDebt = final.visual_validation_evidence.some(
    (item) => item.review_status === "reviewed_with_blocking_debt",
  )

  if (hasRemainingDebt || hasStructuredDebt) {
    return { status: "incomplete_visual_fidelity", hasRemainingDebt: hasRemainingDebt || hasStructuredDebt }
  }
  if (hasRenderedScreenshotEvidence) return { status: "high_fidelity_evidence_reported", hasRemainingDebt }
  return { status: "evidence_missing", hasRemainingDebt }
}

function renderFrontendProjectReport(final: FrontendTemplateFinal): string {
  const project = final.frontend_project
  const finalAcceptanceMode = final.final_acceptance_mode
  const normalizedRoot = normalizeProjectRootForReport(project.project_root)
  const isFrontendDesignSkeleton = isFrontendDesignSkeletonRoot(normalizedRoot)
  const maintainableSourceBaseline =
    finalAcceptanceMode === "maintainable_replacement_required" && project.role === "source_baseline_input"
  const visualSourceBaseline =
    finalAcceptanceMode === "visual_baseline_allowed" && project.role !== "visual_baseline_input"
  const lines = [
    `- status: ${project.status}`,
    `- role: ${project.role}`,
    `- project_root: ${project.project_root || "(not created)"}`,
    `- acceptance_root: ${isFrontendDesignSkeleton ? "." : project.role === "implementation_target" ? project.project_root || "." : "."}`,
    `- source_package: ${project.source_package || "(not specified)"}`,
    `- generation_tool: ${project.generation_tool || "(not specified)"}`,
  ]
  if (maintainableSourceBaseline) {
    lines.push(
      "- maintainable_status: incomplete_source_baseline. This is explicit unfinished frontend_design source debt, not a final maintainable implementation target.",
    )
  }
  if (visualSourceBaseline) {
    lines.push(
      "- visual_status: incomplete_visual_baseline. This visual-only workflow has not delivered the required `visual-html-skeleton/` static HTML/CSS baseline.",
    )
    lines.push(
      "- visual_next_action: frontend_design must restore and verify `visual-html-skeleton/index.html`, `visual-html-skeleton/styles/tokens.css`, external region CSS/assets, screenshots, and visual-diff evidence before handoff.",
    )
  }
  if (project.role === "visual_baseline_input") {
    lines.push(
      "- visual_baseline_rule: this project is a derived static HTML/CSS visual baseline input, not an implementation target and not the acceptance app root.",
    )
    lines.push(
      "- visual_authority: original `web-clone-source/source-ir/*`, `web-clone-source/source-skeleton/*`, and `web-clone-source/reference.png` remain authoritative if this skeleton conflicts with source evidence or visible pixels.",
    )
    lines.push(
      "- transcription_rule: future maintainable project work must transcribe this skeleton into semantic components/data/style modules while preserving the original source IR, assets, and reference screenshot as verification evidence.",
    )
    lines.push(renderVisualBaselineQualityStatus(final))
  }
  if (isFrontendDesignSkeleton) {
    lines.push(
      "- adoption_rule: frontend-design-skeleton is captured source evidence only. frontend_design must restore a separate static HTML/CSS visual skeleton from it; if this remains the named project, the named visual/source debt is unfinished frontend_design work.",
    )
  }
  if (project.entrypoints.length > 0) {
    lines.push("- entrypoints:")
    for (const item of project.entrypoints) lines.push(`  - ${item}`)
  }
  if (project.notes.length > 0) {
    lines.push("- notes:")
    for (const item of project.notes) lines.push(`  - ${item}`)
  }
  return lines.join("\n")
}

function renderVisualBaselineQualityStatus(final: FrontendTemplateFinal): string {
  const evidence = inspectVisualBaselineQuality(final, {
    artifactRoot: process.cwd(),
    requireArtifactVerification: !artifactValidatedVisualFinals.has(final),
  })
  if (evidence.status === "evidence_missing") {
    return "- visual_quality_status: evidence_missing. No structured rendered screenshot review evidence was submitted for the visual HTML skeleton; treat the skeleton as unproven until `visual_validation_evidence` and visual review are recorded."
  }
  if (evidence.status === "incomplete_visual_fidelity") {
    const debt = evidence.hasRemainingDebt ? " Remaining visual debt is present in the submitted contract." : ""
    return `- visual_quality_status: incomplete_visual_fidelity.${debt} This skeleton is unproven and must not be treated as ready for downstream transcription.`
  }
  return "- visual_quality_status: visual_evidence_reported. Structured rendered screenshot review evidence was submitted; source traceability, screenshot inspection, and placeholder review remain authoritative."
}

function inspectVisualBaselineQuality(
  final: FrontendTemplateFinal,
  options: { artifactRoot: string; artifactRootRelative?: string; requireArtifactVerification: boolean },
): {
  status: "high_fidelity_evidence_reported" | "incomplete_visual_fidelity" | "evidence_missing"
  hasRemainingDebt: boolean
} {
  const text = collectVisualBaselineText(final)
  const hasRemainingDebt = hasBlockingVisualDebt(text)
  const hasRenderedScreenshotEvidence = hasStructuredRenderedScreenshotEvidence(final, options)
  const hasStructuredDebt = final.visual_validation_evidence.some(
    (item) => item.review_status === "reviewed_with_blocking_debt",
  )

  if (hasRemainingDebt || hasStructuredDebt) {
    return { status: "incomplete_visual_fidelity", hasRemainingDebt: hasRemainingDebt || hasStructuredDebt }
  }
  if (hasRenderedScreenshotEvidence) return { status: "high_fidelity_evidence_reported", hasRemainingDebt }
  return { status: "evidence_missing", hasRemainingDebt }
}

function hasBlockingVisualDebt(text: string): boolean {
  const positiveText = text
    .replace(
      /\b(?:no|none|without|not|zero|0)\s+(?:blocking|remaining|unresolved|open|deferred)\s+(?:visual\s+)?(?:debt|mismatch(?:es)?|gap(?:s)?|defect(?:s)?|blocker(?:s)?)\b/gi,
      "",
    )
    .replace(
      /\b(?:no|none|without|not|zero|0)\s+(?:visual\s+)?(?:debt|mismatch(?:es)?|gap(?:s)?|defect(?:s)?|blocker(?:s)?)\s+(?:remain(?:s|ing)?|blocking|unresolved|open|deferred)\b/gi,
      "",
    )
  const labelDebt =
    /\b(?:remaining|blocking|unresolved|open|deferred)\s+(?:visual\s+)?(?:debt|mismatch(?:es)?|gap(?:s)?|defect(?:s)?|blocker(?:s)?)\s*[:\-]\s*(?!\s*(?:none|no|0|n\/a|\(\s*none\s*\))\b)/i.test(
      positiveText,
    )
  const reversedLabelDebt =
    /\b(?:visual\s+)?(?:debt|mismatch(?:es)?|gap(?:s)?|defect(?:s)?|blocker(?:s)?)\s+(?:remain(?:s|ing)?|blocking|unresolved|open|deferred)\s*[:\-]\s*(?!\s*(?:none|no|0|n\/a|\(\s*none\s*\))\b)/i.test(
      positiveText,
    )
  const sentenceDebt =
    /\b(?:rendered screenshot|screenshot review|task-scoped preview|preview evidence|visual diff)\b[^\n.]{0,160}\b(?:blocking|remaining|unresolved|open|deferred)\s+(?:visual\s+)?(?:debt|mismatch(?:es)?|gap(?:s)?|defect(?:s)?|blocker(?:s)?)\b/i.test(
      positiveText,
    )
  const reversedSentenceDebt =
    /\b(?:rendered screenshot|screenshot review|task-scoped preview|preview evidence|visual diff)\b[^\n.]{0,160}\b(?:visual\s+)?(?:debt|mismatch(?:es)?|gap(?:s)?|defect(?:s)?|blocker(?:s)?)\s+(?:remain(?:s|ing)?|blocking|unresolved|open|deferred)\b/i.test(
      positiveText,
    )
  return labelDebt || reversedLabelDebt || sentenceDebt || reversedSentenceDebt
}

function hasStructuredRenderedScreenshotEvidence(
  final: FrontendTemplateFinal,
  options: { artifactRoot: string; artifactRootRelative?: string; requireArtifactVerification: boolean },
): boolean {
  return final.visual_validation_evidence.some((item) => isUsableRenderedScreenshotEvidence(item, options))
}

async function hasStructuredRenderedScreenshotEvidenceForSubmit(
  final: FrontendTemplateFinal,
  options: { artifactRoot: string; artifactRootRelative?: string; requireArtifactVerification: boolean },
): Promise<boolean> {
  for (const item of final.visual_validation_evidence) {
    if (await isUsableRenderedScreenshotEvidenceForSubmit(item, options)) return true
  }
  return false
}

function isUsableRenderedScreenshotEvidence(
  item: FrontendTemplateFinal["visual_validation_evidence"][number],
  options: { artifactRoot: string; artifactRootRelative?: string; requireArtifactVerification: boolean },
): boolean {
  if (item.render_target !== "visual-html-skeleton") return false
  if (item.review_status !== "reviewed_no_blocking_debt") return false
  if (item.screenshot_sha256.toLowerCase() === item.source_reference_sha256.toLowerCase()) return false

  const entrypoint = resolveEvidenceArtifactPath(options, item.rendered_entrypoint, "visual-html-skeleton")
  const screenshot = resolveEvidenceArtifactPath(options, item.screenshot_artifact, "visual-html-skeleton")
  const sourceReference = resolveEvidenceArtifactPath(options, item.source_reference_artifact, "web-clone-source")
  const diff = item.diff_artifact
    ? resolveEvidenceArtifactPath(options, item.diff_artifact, "visual-html-skeleton")
    : undefined
  if (!entrypoint || !screenshot || !sourceReference || (item.diff_artifact && !diff)) return false
  if (!entrypoint.relativePath.endsWith(".html")) return false
  if (!isRenderedVisualSkeletonArtifactRelativePath(screenshot.relativePath)) return false
  if (diff && !isRenderedVisualSkeletonArtifactRelativePath(diff.relativePath)) return false
  if (options.requireArtifactVerification) return false
  return true
}

async function isUsableRenderedScreenshotEvidenceForSubmit(
  item: FrontendTemplateFinal["visual_validation_evidence"][number],
  options: { artifactRoot: string; artifactRootRelative?: string; requireArtifactVerification: boolean },
): Promise<boolean> {
  if (item.render_target !== "visual-html-skeleton") return false
  if (item.review_status !== "reviewed_no_blocking_debt") return false
  if (item.screenshot_sha256.toLowerCase() === item.source_reference_sha256.toLowerCase()) return false

  const entrypoint = resolveEvidenceArtifactPath(options, item.rendered_entrypoint, "visual-html-skeleton")
  const screenshot = resolveEvidenceArtifactPath(options, item.screenshot_artifact, "visual-html-skeleton")
  const sourceReference = resolveEvidenceArtifactPath(options, item.source_reference_artifact, "web-clone-source")
  const diff = item.diff_artifact
    ? resolveEvidenceArtifactPath(options, item.diff_artifact, "visual-html-skeleton")
    : undefined
  if (!entrypoint || !screenshot || !sourceReference || (item.diff_artifact && !diff)) return false
  if (!entrypoint.relativePath.endsWith(".html")) return false
  if (!isRenderedVisualSkeletonArtifactRelativePath(screenshot.relativePath)) return false
  if (diff && !isRenderedVisualSkeletonArtifactRelativePath(diff.relativePath)) return false
  if (!options.requireArtifactVerification) return true

  const verifiedEntrypoint = verifyEvidenceFile(options.artifactRoot, entrypoint, "visual-html-skeleton")
  const verifiedScreenshot = verifyEvidenceFile(options.artifactRoot, screenshot, "visual-html-skeleton")
  const verifiedSourceReference = verifyEvidenceFile(options.artifactRoot, sourceReference, "web-clone-source")
  if (!verifiedEntrypoint || !verifiedScreenshot || !verifiedSourceReference) return false
  if (diff && !verifyEvidenceFile(options.artifactRoot, diff, "visual-html-skeleton")) return false
  if (!(await isDecodedRasterImageFile(verifiedScreenshot))) return false
  if (!(await isDecodedRasterImageFile(verifiedSourceReference))) return false

  const screenshotSha = sha256File(verifiedScreenshot)
  const sourceReferenceSha = sha256File(verifiedSourceReference)
  return (
    screenshotSha === item.screenshot_sha256.toLowerCase() &&
    sourceReferenceSha === item.source_reference_sha256.toLowerCase() &&
    screenshotSha !== sourceReferenceSha &&
    (await renderedEntrypointMatchesScreenshot({
      entrypointFile: verifiedEntrypoint,
      expectedScreenshotSha256: screenshotSha,
      viewportLabel: item.viewport,
      fallbackScreenshotFile: verifiedScreenshot,
    }))
  )
}

function isRenderedVisualSkeletonArtifactRelativePath(relativePath: string): boolean {
  const normalizedPath = normalizeReportPath(relativePath).toLowerCase()
  const basename = normalizedPath.split("/").pop() ?? normalizedPath
  if (/(?:^|[-_.])(reference|source|original)(?:[-_.]|$)/i.test(basename)) return false
  return (
    /(?:^|\/)(?:screenshots?|previews?|renders?|visual-diffs?|diffs?)(?:\/|$)/i.test(normalizedPath) ||
    /(?:screenshot|preview|render|visual-diff|diff)/i.test(basename)
  )
}

function resolveEvidenceArtifactPath(
  options: { artifactRoot: string; artifactRootRelative?: string },
  artifactPath: string,
  expectedRoot: "visual-html-skeleton" | "web-clone-source",
): { absolutePath: string; relativePath: string } | undefined {
  const root = path.resolve(options.artifactRoot)
  const normalizedArtifactPath = normalizeReportPath(artifactPath)
  const normalizedArtifactRootRelative = options.artifactRootRelative
    ? normalizeReportPath(options.artifactRootRelative)
    : ""
  const rootRelativePath =
    normalizedArtifactRootRelative &&
    (normalizedArtifactPath === normalizedArtifactRootRelative ||
      normalizedArtifactPath.startsWith(`${normalizedArtifactRootRelative}/`))
      ? normalizeReportPath(normalizedArtifactPath.slice(normalizedArtifactRootRelative.length).replace(/^\/+/, ""))
      : normalizedArtifactPath
  const file = path.isAbsolute(artifactPath)
    ? path.resolve(artifactPath)
    : path.resolve(root, ...rootRelativePath.split("/"))
  const relative = path.relative(root, file)
  if (relative === "") return undefined
  if (relative.startsWith("..") || path.isAbsolute(relative)) return undefined
  const relativePath = normalizeReportPath(relative)
  if (!isPathInsideExpectedEvidenceRoot(relativePath, expectedRoot)) return undefined
  return { absolutePath: file, relativePath }
}

function isPathInsideExpectedEvidenceRoot(relativePath: string, expectedRoot: string): boolean {
  const normalized = normalizeReportPath(relativePath)
  return normalized === expectedRoot || normalized.startsWith(`${expectedRoot}/`)
}

function verifyEvidenceFile(
  artifactRoot: string,
  resolved: { absolutePath: string; relativePath: string },
  expectedRoot: "visual-html-skeleton" | "web-clone-source",
): string | undefined {
  if (!isReadableFile(resolved.absolutePath)) return undefined
  let rootReal: string
  let fileReal: string
  try {
    rootReal = fs.realpathSync(artifactRoot)
    fileReal = fs.realpathSync(resolved.absolutePath)
  } catch {
    return undefined
  }
  const realRelativePath = normalizeReportPath(path.relative(rootReal, fileReal))
  if (!realRelativePath || realRelativePath.startsWith("..") || path.isAbsolute(realRelativePath)) return undefined
  if (!isPathInsideExpectedEvidenceRoot(realRelativePath, expectedRoot)) return undefined
  return fileReal
}

function isReadableFile(file: string): boolean {
  try {
    return fs.statSync(file).isFile()
  } catch {
    return false
  }
}

function sha256File(file: string): string {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex")
}

async function isDecodedRasterImageFile(file: string): Promise<boolean> {
  try {
    const metadata = await sharp(file).metadata()
    return (
      (metadata.format === "png" || metadata.format === "jpeg" || metadata.format === "webp") &&
      typeof metadata.width === "number" &&
      metadata.width > 0 &&
      typeof metadata.height === "number" &&
      metadata.height > 0
    )
  } catch {
    return false
  }
}

async function renderedEntrypointMatchesScreenshot(input: {
  entrypointFile: string
  expectedScreenshotSha256: string
  viewportLabel: string
  fallbackScreenshotFile: string
}): Promise<boolean> {
  try {
    const viewport =
      viewportDimensionsFromLabel(input.viewportLabel) ?? (await rasterDimensions(input.fallbackScreenshotFile))
    if (!viewport) return false
    const rendered = await renderVisualHtmlSkeletonScreenshotForValidation({
      entrypointFile: input.entrypointFile,
      viewport,
    })
    return createHash("sha256").update(rendered).digest("hex") === input.expectedScreenshotSha256
  } catch {
    return false
  }
}

function viewportDimensionsFromLabel(label: string): { width: number; height: number } | undefined {
  const match = /(?:^|[^0-9])([1-9][0-9]{1,4})\s*x\s*([1-9][0-9]{1,4})(?:[^0-9]|$)/i.exec(label)
  if (!match) return undefined
  const width = Number(match[1])
  const height = Number(match[2])
  if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) return undefined
  return { width, height }
}

async function rasterDimensions(file: string): Promise<{ width: number; height: number } | undefined> {
  try {
    const metadata = await sharp(file).metadata()
    if (
      typeof metadata.width === "number" &&
      metadata.width > 0 &&
      typeof metadata.height === "number" &&
      metadata.height > 0
    ) {
      return { width: metadata.width, height: metadata.height }
    }
  } catch {}
  return undefined
}

export async function renderVisualHtmlSkeletonScreenshotForValidation(input: {
  entrypointFile: string
  viewport: { width: number; height: number }
  timeoutMs?: number
}): Promise<Buffer> {
  const timeoutMs = input.timeoutMs ?? 60_000
  const executablePath = await BrowserRuntime.findBrowserExecutable()
  const sidecar = await runBrowserNodeSidecar<{ ok: true; screenshotBase64: string } | { ok: false; error: string }>({
    script: StaticHtmlScreenshotScript,
    payload: {
      executablePath,
      launchArgs: BrowserRuntime.defaultLaunchArgs(),
      timeoutMs,
      url: pathToFileURL(input.entrypointFile).href,
      viewport: input.viewport,
    },
    payloadEnvName: "OPENCORVUS_FRONTEND_RENDER_PAYLOAD",
    hardTimeoutMs: timeoutMs + 10_000,
    label: "frontend visual baseline static render",
  })
  if (!sidecar.result.ok) {
    throw new Error(`frontend visual baseline static render failed: ${sidecar.result.error}`)
  }
  return Buffer.from(sidecar.result.screenshotBase64, "base64")
}

function collectVisualBaselineText(final: FrontendTemplateFinal): string {
  return [
    final.frontend_template,
    final.fillable_modules,
    final.component_inventory,
    final.quality_project_contract,
    final.material_inventory,
    final.visual_consistency_contract,
    final.ui_data_contract,
    final.completeness_review,
    ...final.frontend_project.entrypoints,
    ...final.frontend_project.notes,
    ...final.visual_validation_evidence.map((item) => `${item.review_status}: ${item.review_summary}`),
    ...final.template_iteration_notes,
    ...final.reference_artifacts,
    ...final.open_questions,
  ].join("\n")
}

// Row builders — each flattens its category-specific schema into a VisualSpec
// ---------------------------------------------------------------------------

function buildRequirement(category: VisualSpecCategory, input: Record<string, unknown>): string {
  switch (category) {
    case "color":
      return `${input.role} = ${input.hex}`
    case "typography": {
      const lh = input.line_height_px ? `/${input.line_height_px}px` : ""
      const ls = input.letter_spacing ? ` ${input.letter_spacing}` : ""
      return `${input.font_family} ${input.font_weight} ${input.font_size_px}px${lh}${ls}`
    }
    case "spacing":
      return `${input.property}-${input.side} = ${input.value_px}px`
    case "layout": {
      const parent = input.parent_id ? ` inside ${input.parent_id}` : ""
      return `${input.section_role} [${input.layout_method}] @ ${input.position}, ${input.dimensions}${parent}`
    }
    case "component": {
      const refs =
        Array.isArray(input.visual_refs) && input.visual_refs.length > 0
          ? ` · refs=[${(input.visual_refs as string[]).join(", ")}]`
          : ""
      const layout = input.within_layout_id ? ` · in=${input.within_layout_id}` : ""
      return `${input.component_type}/${input.variant} — ${input.props}${layout}${refs}`
    }
    case "interaction":
      return `${input.trigger} → ${input.effect} on [${(input.target_component_ids as string[]).join(", ")}]`
    case "responsive":
      return `${input.breakpoint}: ${input.change} (layouts=[${(input.affected_layout_ids as string[]).join(", ")}])`
  }
}

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createFrontendTemplateOutputTools(
  options: {
    autoIteration?: boolean
    artifactRoot?: string
    artifactRootRelative?: string
    workspaceRoot?: string
  } = {},
) {
  const autoIteration = options.autoIteration === true
  const artifactRoot = path.resolve(options.artifactRoot ?? process.cwd())
  const artifactRootRelative = options.artifactRootRelative
  const workspaceRoot = path.resolve(options.workspaceRoot ?? process.cwd())
  let collector = emptyCollector()

  function assertIdFree(id: string): string | null {
    if (collector.final) return "Error: frontend template already submitted; collector is closed."
    if (collector.specs.some((s) => s.id === id)) return `Error: spec id "${id}" already registered`
    return null
  }

  function assertIdsExist(ids: readonly string[], label: string): string | null {
    const missing = ids.filter((id) => !collector.specs.some((s) => s.id === id))
    if (missing.length === 0) return null
    return `Error: ${label} not registered: [${missing.join(", ")}] — register them first`
  }

  function push(category: VisualSpecCategory, input: any): string {
    if (collector.specs.length >= VISUAL_ANCHOR_BUDGET) {
      return (
        `VISUAL_ANCHOR_BUDGET_REACHED: ${VISUAL_ANCHOR_BUDGET} visual anchors are already registered. ` +
        "Stop registering per-item visual rows; consolidate remaining detail in frontend_template/fillable_modules/completeness_review/material_inventory/visual_consistency_contract/ui_data_contract, " +
        "complete the frontend template review pass(es) required by assistant.auto_iteration, then call submit_frontend_template."
      )
    }
    const spec: VisualSpec = {
      id: input.id,
      category,
      title: input.title,
      requirement: buildRequirement(category, input),
      applies_to: input.applies_to,
      severity: input.severity,
      rationale: input.rationale,
    }
    collector.specs.push(spec)
    return `OK: ${category} spec "${input.id}" registered (${collector.specs.length} total)`
  }

  const tools = {
    register_color_spec: tool({
      description:
        "Register an exact reusable color constraint from the visual input. Use exact hex values and consolidate repeated rows/items under one role spec instead of per-item specs.",
      inputSchema: ColorSchema,
      execute: async (input) => assertIdFree(input.id) ?? push("color", input),
    }),

    register_typography_spec: tool({
      description:
        "Register an exact reusable typography constraint (font family + size + weight, plus line-height and letter-spacing when discernible). Register roles, not every repeated text instance.",
      inputSchema: TypographySchema,
      execute: async (input) => assertIdFree(input.id) ?? push("typography", input),
    }),

    register_spacing_spec: tool({
      description:
        "Register an exact reusable spacing constraint (margin / padding / gap / inset). Measure from the image and consolidate repeated grids/lists/tables under one spacing role.",
      inputSchema: SpacingSchema,
      execute: async (input) => assertIdFree(input.id) ?? push("spacing", input),
    }),

    register_layout_spec: tool({
      description:
        "Register a reusable layout section (header, sidebar, hero, chart panel, data row group, etc.) with position + dimensions + layout method. Register parents before children and avoid one spec per repeated row/card.",
      inputSchema: LayoutSchema,
      execute: async (input) => {
        const existErr = assertIdFree(input.id)
        if (existErr) return existErr
        if (input.parent_id) {
          const parentErr = assertIdsExist([input.parent_id], "parent layout")
          if (parentErr) return parentErr
          const parent = collector.specs.find((s) => s.id === input.parent_id)
          if (parent && parent.category !== "layout") {
            return `Error: parent_id "${input.parent_id}" is category "${parent.category}" — must be a layout spec`
          }
        }
        return push("layout", input)
      },
    }),

    register_component_spec: tool({
      description:
        "Register a reusable UI component (button, card, nav item, input, badge, chart, repeated list row, etc.). Reference the layout it lives in and avoid one spec per repeated data item.",
      inputSchema: ComponentSchema,
      execute: async (input) => {
        const existErr = assertIdFree(input.id)
        if (existErr) return existErr
        if (input.within_layout_id) {
          const layoutErr = assertIdsExist([input.within_layout_id], "within_layout_id")
          if (layoutErr) return layoutErr
          const layout = collector.specs.find((s) => s.id === input.within_layout_id)
          if (layout && layout.category !== "layout") {
            return `Error: within_layout_id "${input.within_layout_id}" is category "${layout.category}" — must be a layout spec`
          }
        }
        if (input.visual_refs.length > 0) {
          const refErr = assertIdsExist(input.visual_refs, "visual_refs")
          if (refErr) return refErr
        }
        return push("component", input)
      },
    }),

    register_interaction_spec: tool({
      description:
        "Register an interaction pattern (hover / click / focus / scroll effect). target_component_ids must all reference registered component specs.",
      inputSchema: InteractionSchema,
      execute: async (input) => {
        const existErr = assertIdFree(input.id)
        if (existErr) return existErr
        const refErr = assertIdsExist(input.target_component_ids, "target_component_ids")
        if (refErr) return refErr
        for (const cid of input.target_component_ids) {
          const comp = collector.specs.find((s) => s.id === cid)
          if (comp && comp.category !== "component") {
            return `Error: target_component_id "${cid}" is category "${comp.category}" — must be a component spec`
          }
        }
        return push("interaction", input)
      },
    }),

    register_responsive_spec: tool({
      description:
        "Register a responsive rule — what changes at a given breakpoint. affected_layout_ids must reference registered layout specs.",
      inputSchema: ResponsiveSchema,
      execute: async (input) => {
        const existErr = assertIdFree(input.id)
        if (existErr) return existErr
        const refErr = assertIdsExist(input.affected_layout_ids, "affected_layout_ids")
        if (refErr) return refErr
        for (const lid of input.affected_layout_ids) {
          const layout = collector.specs.find((s) => s.id === lid)
          if (layout && layout.category !== "layout") {
            return `Error: affected_layout_id "${lid}" is category "${layout.category}" — must be a layout spec`
          }
        }
        return push("responsive", input)
      },
    }),

    update_frontend_basics: tool({
      description:
        "Update the required top-level frontend result basics: design system, implementation stack hints, and final acceptance mode.",
      inputSchema: FrontendTemplateBasicsToolInputSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        const input = FrontendTemplateBasicsToolInputSchema.parse(rawInput)
        collector.draft.design_system = input.design_system
        collector.draft.tech_stack = input.tech_stack
        collector.draft.final_acceptance_mode = input.final_acceptance_mode
        collector.semantic_error = undefined
        return "OK: frontend basics updated"
      },
    }),

    update_frontend_text: tool({
      description:
        "Update one markdown/text section of the frontend result. Use compact, evidence-grounded prose; use update_frontend_item for repeatable rows.",
      inputSchema: FrontendTemplateMarkdownSectionToolInputSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        const input = FrontendTemplateMarkdownSectionToolInputSchema.parse(rawInput)
        collector.draft[input.section] = input.content
        collector.semantic_error = undefined
        return `OK: frontend text section "${input.section}" updated`
      },
    }),

    update_frontend_item: tool({
      description:
        "Update one compact frontend result item for template sections, fillable modules, quality project requirements, visual consistency, or UI data. Items are keyed by title.",
      inputSchema: FrontendTemplateCompactItemToolInputSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        const input = FrontendTemplateCompactItemToolInputSchema.parse(rawInput)
        const items = arrayField<typeof input.item>(collector.draft, input.target)
        const mode = upsertByStringKey(items, input.item, "title")
        collector.semantic_error = undefined
        return `OK: frontend item "${input.item.title}" ${mode} in ${input.target} (${items.length} total)`
      },
    }),

    update_frontend_material: tool({
      description:
        "Update one material/asset inventory item. Include CSS/tokens, assets, data fixtures, text samples, icons, fonts, or dense resources needed for reproduction.",
      inputSchema: ToolMaterialInventoryItemSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        const input = ToolMaterialInventoryItemSchema.parse(rawInput)
        const items = arrayField<typeof input>(collector.draft, "material_inventory_items")
        const mode = upsertByStringKey(items, input, "title")
        collector.semantic_error = undefined
        return `OK: frontend material "${input.title}" ${mode} (${items.length} total)`
      },
    }),

    update_frontend_project: tool({
      description:
        "Update the concrete frontend project/skeleton output metadata, including role, root, source package, entrypoints, generation tool, and notes.",
      inputSchema: FrontendProjectToolInputSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        collector.draft.frontend_project = FrontendProjectToolInputSchema.parse(rawInput)
        collector.semantic_error = undefined
        return `OK: frontend project updated (${collector.draft.frontend_project.role})`
      },
    }),

    update_frontend_component_reuse: tool({
      description:
        "Update one structured component-family reuse plan item. Items are keyed by family_id.",
      inputSchema: ToolComponentReusePlanItemSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        const input = ToolComponentReusePlanItemSchema.parse(rawInput)
        const items = arrayField<typeof input>(collector.draft, "component_reuse_plan")
        const mode = upsertByStringKey(items, input, "family_id")
        collector.semantic_error = undefined
        return `OK: component reuse "${input.family_id}" ${mode} (${items.length} total)`
      },
    }),

    update_frontend_baseline: tool({
      description:
        "Update one source-region baseline replacement/evolution plan item. Items are keyed by boundary_id.",
      inputSchema: ToolBaselineReplacementPlanItemSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        const input = ToolBaselineReplacementPlanItemSchema.parse(rawInput)
        const items = arrayField<typeof input>(collector.draft, "baseline_replacement_plan")
        const mode = upsertByStringKey(items, input, "boundary_id")
        collector.semantic_error = undefined
        return `OK: baseline replacement "${input.boundary_id}" ${mode} (${items.length} total)`
      },
    }),

    update_frontend_phase: tool({
      description:
        "Update one maintainable-replacement implementation phase outcome. Required phases are keyed by phase.",
      inputSchema: ToolImplementationPhaseOutcomeSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        const input = ToolImplementationPhaseOutcomeSchema.parse(rawInput)
        const items = arrayField<typeof input>(collector.draft, "implementation_phase_outcomes")
        const mode = upsertByStringKey(items, input, "phase")
        collector.semantic_error = undefined
        return `OK: implementation phase "${input.phase}" ${mode} (${items.length} total)`
      },
    }),

    update_frontend_visual_evidence: tool({
      description:
        "Update one structured rendered screenshot validation evidence row for a visual HTML skeleton. Items are keyed by id.",
      inputSchema: ToolVisualValidationEvidenceSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        const input = ToolVisualValidationEvidenceSchema.parse(rawInput)
        const items = arrayField<typeof input>(collector.draft, "visual_validation_evidence")
        const mode = upsertByStringKey(items, input, "id")
        collector.semantic_error = undefined
        return `OK: visual validation evidence "${input.id}" ${mode} (${items.length} total)`
      },
    }),

    update_frontend_iteration_note: tool({
      description: "Update frontend review-pass notes. Repeated identical notes are ignored.",
      inputSchema: FrontendTemplateStringItemToolInputSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        const input = FrontendTemplateStringItemToolInputSchema.parse(rawInput)
        const items = arrayField<string>(collector.draft, "template_iteration_notes")
        const mode = appendUniqueString(items, input.value)
        collector.semantic_error = undefined
        return `OK: frontend iteration note ${mode} (${items.length} total)`
      },
    }),

    update_frontend_reference: tool({
      description: "Update one canonical reference artifact path/id used as evidence. Repeated identical references are ignored.",
      inputSchema: FrontendTemplateStringItemToolInputSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        const input = FrontendTemplateStringItemToolInputSchema.parse(rawInput)
        const items = arrayField<string>(collector.draft, "reference_artifacts")
        const mode = appendUniqueString(items, input.value)
        collector.semantic_error = undefined
        return `OK: frontend reference ${mode} (${items.length} total)`
      },
    }),

    update_frontend_question: tool({
      description: "Update one truly unobservable open question. Repeated identical questions are ignored.",
      inputSchema: FrontendTemplateStringItemToolInputSchema,
      execute: async (rawInput) => {
        if (collector.final) return "Error: frontend template already submitted; collector is closed."
        const input = FrontendTemplateStringItemToolInputSchema.parse(rawInput)
        const items = arrayField<string>(collector.draft, "open_questions")
        const mode = appendUniqueString(items, input.value)
        collector.semantic_error = undefined
        return `OK: frontend open question ${mode} (${items.length} total)`
      },
    }),

    inspect_frontend_result_status: tool({
      description:
        "Inspect frontend result collector status after update_* calls. Use when submit_frontend_template reports missing fragments or validation errors.",
      inputSchema: z.object({}).strict(),
      execute: async () => frontendTemplateStatus(collector, autoIteration),
    }),

    submit_frontend_template: tool({
      description:
        "Finalize the frontend result after all update_* calls are complete. Call only with final=true; include fact_check_items only for unverified factual claims. If this reports missing fragments, call the listed update_* tools instead of retrying a giant payload.",
      inputSchema: FrontendTemplateSubmitSchema,
      execute: async (rawInput) =>
        submitFrontendTemplateDraft({
          collector,
          rawInput,
          autoIteration,
          artifactRoot,
          artifactRootRelative,
          workspaceRoot,
        }),
    }),
  }

  return {
    tools,
    getCollector(): FrontendTemplateOutputCollector {
      return { specs: [...collector.specs], draft: { ...collector.draft }, final: collector.final, semantic_error: collector.semantic_error }
    },
    buildReport() {
      return buildFrontendTemplateReport({
        specs: [...collector.specs],
        draft: { ...collector.draft },
        final: collector.final,
        semantic_error: collector.semantic_error,
      })
    },
    getSpecs(): VisualSpec[] {
      return [...collector.specs]
    },
    getFinal(): FrontendTemplateFinal | undefined {
      return collector.final
    },
    reset() {
      collector = emptyCollector()
    },
  }
}
