/**
 * Structured output tools for the Frontend Design & Replica Agent.
 *
 * The frontend template submitted through submit_frontend_template is the authoritative
 * frontend-design output. VisualSpec registration tools remain available to
 * tests and older collector call sites as optional compact anchors, but
 * frontend-design no longer depends on registering rows before handoff.
 */
import { tool } from "ai"
import {
  ColorSchema,
  ComponentSchema,
  FrontendTemplateFinalSchema,
  FrontendTemplateToolInputSchema,
  InteractionSchema,
  LayoutSchema,
  ResponsiveSchema,
  SpacingSchema,
  TypographySchema,
  type FrontendTemplateFinal,
  type VisualSpec,
  type VisualSpecCategory,
} from "./schema"
import { limitSummary, markdownList, requireReportString } from "@/agent/report"

export type { FrontendTemplateFinal } from "./schema"

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
  final?: FrontendTemplateFinal
}

const VISUAL_ANCHOR_BUDGET = 80

function emptyCollector(): FrontendTemplateOutputCollector {
  return { specs: [] }
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
  return projectRoot
    .replaceAll("\\", "/")
    .replace(/^\.\/+/, "")
    .replace(/\/+$/, "")
}

function isFrontendDesignSkeletonRoot(normalizedProjectRoot: string): boolean {
  return (
    normalizedProjectRoot === "frontend-design-skeleton" || normalizedProjectRoot.endsWith("/frontend-design-skeleton")
  )
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

  const normalizePlanItems = (value: unknown): unknown => {
    if (!Array.isArray(value)) return value
    return value.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item
      const record = { ...(item as Record<string, unknown>) }
      if (record.parity_guard === undefined && typeof record.replacement_guard === "string") {
        record.parity_guard = record.replacement_guard
      }
      return record
    })
  }

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
  normalized.component_reuse_plan = normalizePlanItems(source.component_reuse_plan)
  normalized.baseline_replacement_plan = normalizePlanItems(source.baseline_replacement_plan)

  return normalized
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
      `## Reuse Constraints\n${renderComponentReusePlan(collector.final.component_reuse_plan)}`,
      `## Source Region Evolution Plan\n${renderBaselineReplacementPlan(collector.final.baseline_replacement_plan)}`,
      `## Quality Project Contract\n${collector.final.quality_project_contract}`,
      `## Material Inventory\n${collector.final.material_inventory}`,
      `## Frontend Project\n${renderFrontendProjectReport(collector.final)}`,
      `## Visual Consistency Contract\n${collector.final.visual_consistency_contract}`,
      `## UI Data Contract\n${collector.final.ui_data_contract}`,
      `## Template Iteration Notes\n${markdownList(collector.final.template_iteration_notes)}`,
      `## Reference Artifacts\n${collector.final.reference_artifacts.length ? markdownList(collector.final.reference_artifacts) : "- no reference artifacts submitted"}`,
      `## Open Questions\n${collector.final.open_questions.length ? markdownList(collector.final.open_questions) : "- none"}`,
      `## Visual Anchors\n${specLines.length ? markdownList(specLines) : "- no compact visual anchors submitted"}`,
    ].join("\n\n"),
  }
}

function assertFrontendTemplateFinal(final: FrontendTemplateFinal): void {
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
  const evidence = inspectVisualBaselineQuality(final)
  if (evidence.status === "evidence_missing") {
    return "- visual_quality_status: evidence_missing. No measured `webpage_evaluate` diagnostic score was reported for the visual HTML skeleton; treat the skeleton as unproven until rendered screenshot evidence and visual review are recorded."
  }
  if (evidence.status === "incomplete_visual_fidelity") {
    const score =
      evidence.lastScore === undefined
        ? ""
        : ` Last reported diagnostic score: ${formatNumber(evidence.lastScore)}/100.`
    const similarity =
      evidence.lastSimilarity === undefined
        ? ""
        : ` Last reported diagnostic similarity: ${formatNumber(evidence.lastSimilarity)}.`
    const debt = evidence.hasRemainingDebt ? " Remaining visual debt is present in the submitted contract." : ""
    return `- visual_quality_status: incomplete_visual_fidelity.${score}${similarity}${debt} This skeleton is unproven and must not be treated as ready for downstream transcription.`
  }
  return "- visual_quality_status: visual_evidence_reported. Render/evaluate evidence was reported; source traceability, screenshot inspection, visual judge findings, and placeholder review remain authoritative."
}

function inspectVisualBaselineQuality(final: FrontendTemplateFinal): {
  status: "high_fidelity_evidence_reported" | "incomplete_visual_fidelity" | "evidence_missing"
  lastScore?: number
  lastSimilarity?: number
  hasRemainingDebt: boolean
} {
  const text = collectVisualBaselineText(final)
  const scores = Array.from(
    text.matchAll(/\b(?:score|overallScore|current score)\s*:?\s*(\d{1,3}(?:\.\d+)?)\s*\/\s*100\b/gi),
  )
    .map((match) => Number(match[1]))
    .filter((score) => Number.isFinite(score))
  const similarities = Array.from(text.matchAll(/\b(?:similarity|mean)\s*(?:=|:)\s*(0(?:\.\d+)?|1(?:\.0+)?)\b/gi))
    .map((match) => Number(match[1]))
    .filter((score) => Number.isFinite(score))
  const lastScore = scores.at(-1)
  const lastSimilarity = similarities.at(-1)
  const hasRemainingDebt = /\bremaining visual debt\s*:\s*(?!\s*(?:none|no|0|\(\s*none\s*\))\b)/i.test(text)

  if (hasRemainingDebt) {
    return { status: "incomplete_visual_fidelity", lastScore, lastSimilarity, hasRemainingDebt }
  }
  if (lastScore !== undefined) {
    return {
      status: "high_fidelity_evidence_reported",
      lastScore,
      lastSimilarity,
      hasRemainingDebt,
    }
  }
  if (lastSimilarity !== undefined) {
    return {
      status: "high_fidelity_evidence_reported",
      lastScore,
      lastSimilarity,
      hasRemainingDebt,
    }
  }
  return { status: "evidence_missing", hasRemainingDebt }
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
    ...final.template_iteration_notes,
    ...final.reference_artifacts,
    ...final.open_questions,
  ].join("\n")
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(4).replace(/0+$/, "").replace(/\.$/, "")
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

export function createFrontendTemplateOutputTools(options: { autoIteration?: boolean } = {}) {
  const autoIteration = options.autoIteration === true
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

    submit_frontend_template: tool({
      description:
        "Submit the complete webpage-evidence-grounded frontend design/replica contract for downstream agents. " +
        "Use this as the final action after visual evidence review and the frontend template review pass(es) required by assistant.auto_iteration; " +
        "do not register rows or call more webpage evidence tools once this terminal tool is exposed.",
      inputSchema: FrontendTemplateToolInputSchema,
      execute: async (input) => {
        if (collector.final)
          return "Error: frontend template already submitted; duplicate submit_frontend_template ignored."
        const final = normalizeFrontendTemplateFinal(
          FrontendTemplateFinalSchema.parse(normalizeFrontendTemplateInput(input)),
        )
        assertFrontendTemplateFinal(final)
        if (autoIteration && final.template_iteration_notes.length < 2) {
          throw new Error(
            "assistant.auto_iteration=true requires at least two frontend template review-pass notes before submit_frontend_template.",
          )
        }
        collector.final = final
        return "OK: complete frontend design/replica contract submitted for orchestrator handoff."
      },
    }),
  }

  return {
    tools,
    getCollector(): FrontendTemplateOutputCollector {
      return { specs: [...collector.specs], final: collector.final }
    },
    buildReport() {
      return buildFrontendTemplateReport({ specs: [...collector.specs], final: collector.final })
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
