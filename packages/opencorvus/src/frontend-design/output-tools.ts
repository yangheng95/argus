/**
 * Structured output tools for the Frontend Design & Replica Agent.
 *
 * The frontend template submitted through submit_frontend_template is the authoritative
 * frontend-design output. VisualSpec registration tools remain available to
 * tests and older collector call sites as optional compact anchors, but
 * frontend-design no longer depends on registering rows before handoff.
 */
import { tool } from "ai"
import z from "zod"
import type { VisualSpec, VisualSpecCategory } from "./types"
import { limitSummary, markdownList, requireReportString } from "@/agent/report"
import { FactCheckItemListSchema } from "@/fact-check/schema"

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

const FlexibleStringListSchema = z.preprocess((value) => {
  if (value == null || value === "") return []
  if (Array.isArray(value)) return value
  if (typeof value !== "string") return [String(value)]
  return value
    .split(/\r?\n/)
    .map((item) => item.replace(/^\s*[-*]\s*/, "").trim())
    .filter(Boolean)
}, z.array(z.string().min(1)).default([]))

function emptyCollector(): FrontendTemplateOutputCollector {
  return { specs: [] }
}

function titleFromMarkdown(text: string): string | undefined {
  const line = text.split("\n").map((item) => item.trim()).find((item) => item.startsWith("# "))
  return line?.replace(/^#+\s*/, "").trim()
}

function renderComponentReusePlan(items: readonly FrontendTemplateFinal["component_reuse_plan"][number][]): string {
  if (items.length === 0) return "- no component reuse plan submitted"
  return items.map((item) => {
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
    if (item.custom_fallback_reason) {
      lines.push(`  - custom_fallback_reason: ${item.custom_fallback_reason}`)
    }
    return lines.join("\n")
  }).join("\n")
}

function renderBaselineReplacementPlan(items: readonly FrontendTemplateFinal["baseline_replacement_plan"][number][]): string {
  if (items.length === 0) return "- no source-region evolution plan submitted"
  return items.map((item) => {
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
    if (item.custom_fallback_reason) {
      lines.push(`  - custom_fallback_reason: ${item.custom_fallback_reason}`)
    }
    return lines.join("\n")
  }).join("\n")
}

function renderNamedItems(title: string, items: readonly {
  title: string
  detail: string
  source_refs?: string[]
}[]): string {
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

function renderComponentInventoryFromReusePlan(items: readonly FrontendTemplateFinal["component_reuse_plan"][number][]): string {
  if (items.length === 0) return ""
  return [
    "Legacy compatibility summary only.",
    "Do not treat this field as a standalone component checklist; use component_reuse_plan, quality_project_contract, completeness_review, open_questions, and named source artifacts for implementation decisions.",
    `Reuse families captured: ${items.map((item) => item.family_id).join(", ")}`,
  ].join("\n")
}

function renderQualityProjectContract(final: FrontendTemplateFinal): string {
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
  next.frontend_template = next.frontend_template.trim() || renderNamedItems("Frontend Template", next.frontend_template_sections)
  next.fillable_modules = next.fillable_modules.trim() || renderNamedItems("Fillable Modules", next.fillable_module_items)
  next.component_inventory = next.component_inventory.trim() || renderComponentInventoryFromReusePlan(next.component_reuse_plan)
  next.quality_project_contract = next.quality_project_contract.trim() || renderNamedItems("Quality Project Contract", next.quality_project_items) || renderQualityProjectContract(next)
  next.material_inventory = next.material_inventory.trim() || renderNamedItems("Material Inventory", next.material_inventory_items)
  next.visual_consistency_contract = next.visual_consistency_contract.trim() || renderNamedItems("Visual Consistency Contract", next.visual_consistency_items)
  next.ui_data_contract = next.ui_data_contract.trim() || renderNamedItems("UI Data Contract", next.ui_data_contract_items)
  return next
}

function normalizeFrontendProject(project: FrontendTemplateFinal["frontend_project"]): FrontendTemplateFinal["frontend_project"] {
  const root = normalizeProjectRootForReport(project.project_root)
  if (isFrontendDesignSkeletonRoot(root) && project.role === "implementation_target") {
    return { ...project, role: "source_baseline_input" }
  }
  return project
}

function normalizeProjectRootForReport(projectRoot: string): string {
  return projectRoot.replaceAll("\\", "/").replace(/^\.\/+/, "").replace(/\/+$/, "")
}

function isFrontendDesignSkeletonRoot(normalizedProjectRoot: string): boolean {
  return normalizedProjectRoot === "frontend-design-skeleton" || normalizedProjectRoot.endsWith("/frontend-design-skeleton")
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
    ...(source.frontend_project && typeof source.frontend_project === "object" && !Array.isArray(source.frontend_project)
      ? source.frontend_project as Record<string, unknown>
      : {}),
  }
  let sawFlattenedFrontendProject = false
  for (const [key, value] of Object.entries(source)) {
    const match = /^frontend_project<arg_key>(.+)$/.exec(key)
    if (!match) continue
    sawFlattenedFrontendProject = true
    const field = match[1]
    frontendProject[field] = field === "entrypoints" || field === "notes"
      ? parseMaybeStringArray(value)
      : value
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
  const summary = title
    ? title
    : `${collector.specs.length} visual spec(s) for ${collector.final.design_system}`
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
      `## Frontend Project\n${renderFrontendProjectReport(collector.final.frontend_project, collector.final.final_acceptance_mode)}`,
      `## Visual Consistency Contract\n${collector.final.visual_consistency_contract}`,
      `## UI Data Contract\n${collector.final.ui_data_contract}`,
      `## Template Iteration Notes\n${markdownList(collector.final.template_iteration_notes)}`,
      `## Reference Artifacts\n${collector.final.reference_artifacts.length ? markdownList(collector.final.reference_artifacts) : "- no reference artifacts submitted"}`,
      `## Open Questions\n${collector.final.open_questions.length ? markdownList(collector.final.open_questions) : "- none"}`,
      `## Visual Anchors\n${specLines.length ? markdownList(specLines) : "- no compact visual anchors submitted"}`,
    ].join("\n\n"),
  }
}

const ComponentReusePlanItemSchema = z.object({
  family_id: z
    .string()
    .min(1)
    .describe("Stable component-family id. Preserve model/source naming when useful; no host-specific prefix is required."),
  name: z.string().min(1).describe("Human-readable component family name."),
  observed_surface: z
    .string()
    .min(1)
    .describe("Visible page region or behavior this component family covers."),
  source_refs: z
    .array(z.string().min(1))
    .default([])
    .describe("Evidence anchors such as source ids, skeleton files, screenshot regions, or source-ir paths."),
  implementation_strategy: z
    .enum(["existing_project_component", "mature_library", "extracted_baseline_defer", "custom_fallback"])
    .describe(
      "Chosen implementation route. Prefer existing_project_component; use mature_library for hard domains; " +
      "use extracted_baseline_defer when the generated DOM/CSS baseline must remain until a parity-preserving replacement exists; custom_fallback is last resort.",
    ),
  reuse_source: z
    .string()
    .min(1)
    .describe(
      "Concrete existing file/component/design-system primitive/library/package to reuse, or 'not found after inspecting <paths>' for a justified fallback.",
    ),
  mature_library_candidates: z
    .array(z.string().min(1))
    .default([])
    .describe("Candidate maintained libraries for charts, tables, menus, dialogs, forms, virtualization, drag/drop, maps, editors, or rich media."),
  props_states: z
    .string()
    .min(1)
    .describe("Props/data/state/variants/interactions frontend_design implemented or Build must preserve during fine-tuning."),
  replacement_boundary: z
    .string()
    .min(1)
    .describe("What exact skeleton/DOM region can be replaced by this component family, and what must remain intact until parity is proven."),
  parity_guard: z
    .string()
    .min(1)
    .describe("How frontend_design verified replacement did not regress visual fidelity, plus any Build fine-tuning verification anchors."),
  custom_fallback_reason: z
    .string()
    .default("")
    .describe("Optional reason when implementation_strategy=custom_fallback; explain why existing components and mature libraries do not fit when known."),
})

const BaselineReplacementPlanItemSchema = z.object({
  boundary_id: z
    .string()
    .min(1)
    .describe("Stable source-region evolution boundary id. Preserve model/source naming when useful; no host-specific prefix is required."),
  source_region: z
    .string()
    .min(1)
    .describe("Exact skeleton/source region to refine, replace, or defer, with file/source ids when available."),
  action: z
    .enum(["replace_generated_baseline", "delete_generated_region", "defer_baseline_until_parity"])
    .describe("Whether frontend_design replaced a region, deleted genuinely redundant generated coverage, or temporarily deferred it until parity is safe."),
  component_family_id: z
    .string()
    .min(1)
    .describe("Component family from component_reuse_plan that owns the replacement/deletion boundary."),
  replacement_strategy: z
    .enum(["existing_project_component", "mature_library", "extracted_baseline_defer", "custom_fallback"])
    .describe("Refinement route. Prefer existing_project_component, then mature_library; custom_fallback is last resort."),
  reuse_source: z
    .string()
    .min(1)
    .describe("Concrete project component/design primitive/library package to reuse, or inspected paths plus reason for fallback/defer."),
  mature_library_candidates: z
    .array(z.string().min(1))
    .default([])
    .describe("Maintained library candidates when replacement_strategy=mature_library."),
  deletion_rule: z
    .string()
    .min(1)
    .describe("What redundant generated DOM/CSS/asset coverage, if any, can be removed once the replacement passes, and what evidence should remain input-only."),
  source_refs: z
    .array(z.string().min(1))
    .default([])
    .describe("Evidence anchors such as source-ir paths, skeleton slots, screenshot regions, or web-clone-source files."),
  parity_guard: z
    .string()
    .min(1)
    .describe("Concrete visual/source checks to run before deleting or replacing a region."),
  custom_fallback_reason: z
    .string()
    .default("")
    .describe("Optional reason when replacement_strategy=custom_fallback; explain why no project component or mature library fits when known."),
})

const CompactTemplateItemSchema = z.object({
  title: z
    .string()
    .min(1)
    .describe("Short stable heading for this template item."),
  detail: z
    .string()
    .min(1)
    .describe("Concise implementation detail. Keep this short; refer to source artifacts by path instead of pasting dense content."),
  source_refs: z
    .array(z.string().min(1))
    .default([])
    .describe("Evidence anchors such as web-clone-source paths, source-ir paths, skeleton slots, or screenshot regions."),
})

const OptionalMarkdownField = (description: string) => z
  .string()
  .default("")
  .describe(`${description} Prefer concise markdown. For dense pages, omit this field and use the matching structured *_items field so the tool can render markdown safely.`)

// Terminal JSON-schema: payload submit_frontend_template must deliver.
export const FrontendTemplateFinalSchema = z.object({
  design_system: z
    .string()
    .min(1)
    .describe(
      "Detected design system — e.g. 'Material 3', 'custom dark with teal accents'.",
    ),
  tech_stack: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "Recommended implementation stack hints for restoring this frontend, including framework, styling, mock-data/API, " +
      "mock-data, and runtime choices when the observed page requires them. For visual page-replica tasks, " +
      "prefer existing repo stack plus local static/mock API data unless the artifacts expose real API needs. " +
      "Do not name backend infrastructure, storage, queues, caches, or realtime systems unless directly observed.",
    ),
  final_acceptance_mode: z
    .enum(["visual_baseline_allowed", "maintainable_replacement_required"])
    .describe(
      "Explicit acceptance mode. Use maintainable_replacement_required whenever the user asks for maintainability, real implementation, component reuse, or replacement of mechanical output; otherwise use visual_baseline_allowed. This field selects implementation expectations; it is not a standalone pass/fail mechanism.",
    ),
  frontend_template: OptionalMarkdownField(
    "Authoritative frontend template for the frontend_design-delivered target project and downstream fine-tuning: routes, layout slots, source-package entrypoints, semantic containers, states, and acceptance anchors.",
  ),
  frontend_template_sections: z
    .array(CompactTemplateItemSchema)
    .default([])
    .describe("Preferred compact replacement for a long frontend_template string. Use one item per route, layout slot, viewport matrix, or acceptance anchor."),
  fillable_modules: OptionalMarkdownField(
    "Modules/slots frontend_design filled or left as explicit source debt: page modules, data modules, interactions, state, adapters, and verification modules.",
  ),
  fillable_module_items: z
    .array(CompactTemplateItemSchema)
    .default([])
    .describe("Preferred compact replacement for a long fillable_modules string. Use one item per module or slot."),
  component_inventory: OptionalMarkdownField(
    "Legacy compatibility summary only. Do not use this as a standalone component checklist; keep it concise and direct downstream agents to component_reuse_plan, quality_project_contract, completeness_review, open_questions, and named source artifacts. If omitted, it is rendered as a compact reuse-family summary from component_reuse_plan.",
  ),
  component_reuse_plan: z
    .array(ComponentReusePlanItemSchema)
    .min(1)
    .describe(
      "Structured, auditable reuse plan for the implementation surface. Each reusable family must say whether frontend_design reused an existing project component/design-system primitive, used a mature maintained library, kept the extracted DOM/CSS baseline until replacement is safe, or used a custom fallback with an explicit reason. This keeps complex controls tied to project/library ownership without turning the handoff into a component catalog.",
    ),
  baseline_replacement_plan: z
    .array(BaselineReplacementPlanItemSchema)
    .default([])
    .describe(
      "Optional source-region evolution plan. Use it only when a specific raw/generated skeleton region should be replaced, deleted, or deferred during in-place refinement. It is diagnostic/planning evidence, not a schema requirement and not a requirement to delete the whole skeleton.",
    ),
  quality_project_contract: OptionalMarkdownField(
      "The high-quality project contract for the target acceptance project frontend_design is delivering before Build fine-tuning. It defines the maintainable target app shape, source ownership, semantic component tree, data modules, styling system, library use, runtime entrypoints, verification commands, measured webpage_evaluate visual evidence, and zero-finding web_clone_source_audit evidence needed before claiming final maintainability. The skeleton project is source evidence only.",
  ),
  quality_project_items: z
    .array(CompactTemplateItemSchema)
    .default([])
    .describe("Preferred compact replacement for a long quality_project_contract string. Use one item per source module, component group, data module, style module, asset strategy, or verification requirement."),
  material_inventory: OptionalMarkdownField(
    "Material and asset inventory: CSS/tokens, sidecar SVG/image/canvas assets, data fixtures, text samples, icons, fonts, and dense resources.",
  ),
  material_inventory_items: z
    .array(CompactTemplateItemSchema)
    .default([])
    .describe("Preferred compact replacement for a long material_inventory string. Reference paths/ids instead of dense payloads."),
  frontend_project: z
    .object({
      status: z.enum(["created", "not_created", "blocked"]).default("not_created"),
      role: z.enum(["source_baseline_input", "implementation_target", "visual_baseline_input", "blocked"]).default("source_baseline_input"),
      project_root: z.string().default(""),
      source_package: z.string().default(""),
      entrypoints: z.array(z.string().min(1)).default([]),
      generation_tool: z.string().default(""),
      notes: z.array(z.string().min(1)).default([]),
    })
    .default({
      status: "not_created",
      role: "source_baseline_input",
      project_root: "",
      source_package: "",
      entrypoints: [],
      generation_tool: "",
      notes: [],
    })
    .describe(
      "Concrete frontend-design project output. For webpage replicas, this should identify the target acceptance project root when role=implementation_target, " +
      "its role, entrypoints, source package, generation tool, completed replacements, unfinished source debt, and any materialization defects. frontend-design-skeleton is source_baseline_input evidence only and must never be the implementation_target. Build starts from the target project for integration and precision fixes.",
    ),
  visual_consistency_contract: OptionalMarkdownField(
    "Binding visual-fidelity frontend template section: viewport inventory, pixel hierarchy, colors, typography, spacing, states, responsive rules, comparison criteria, and reference artifacts.",
  ),
  visual_consistency_items: z
    .array(CompactTemplateItemSchema)
    .default([])
    .describe("Preferred compact replacement for a long visual_consistency_contract string. Use one item per viewport, region, or visual rule."),
  ui_data_contract: OptionalMarkdownField(
    "UI data contract required to reproduce the frontend: local mock/static data, observable endpoints when present, state transitions, and error/loading behavior.",
  ),
  ui_data_contract_items: z
    .array(CompactTemplateItemSchema)
    .default([])
    .describe("Preferred compact replacement for a long ui_data_contract string. Use one item per entity, fixture, endpoint, or state model."),
  template_iteration_notes: z
    .array(z.string().min(1))
    .min(1)
    .default([
      "Host accepted the submitted frontend template after the model completed its available review pass; downstream visual/source review remains authoritative.",
      "Host accepted the submitted maintainability contract after checking that the payload includes component reuse, source-region planning where needed, visual consistency, and UI data sections.",
    ])
    .describe(
      "frontend template review-pass notes completed before handoff. One note is enough when assistant.auto_iteration=false; " +
      "include at least two when assistant.auto_iteration=true. Each item must name what was checked, what was missing " +
      "or corrected, and why the resulting frontend template is now safe for downstream agents.",
    ),
  completeness_review: z
    .string()
    .min(1)
    .default("Host accepted the submitted frontend template as structurally complete enough for downstream requirements, architecture, build, source audit, and visual diff validation.")
    .describe(
      "Final completeness audit and primary human-readable problem/handoff section. Cover known implementation risks, visual/source gaps, extraction-vs-rewrite uncertainty, project source organization, component/library reuse constraints, reference artifacts, and remaining open questions. Do not finalize until this audit says the frontend template is complete enough to hand off.",
    ),
  reference_artifacts: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Compact artifact anchors used as evidence. Prefer small canonical entrypoints such as web-clone-source/README.md, " +
      "implementation-blueprint.md, web-clone-implementation-contract.json, reference.png, source-ir/*, source-skeleton/critical.css, " +
      "frontend-design-skeleton/README.md, frontend-design-skeleton/src/App.tsx, frontend-design-skeleton/src/components/SourceClonePage.tsx, frontend-design-skeleton/src/data/sourceData.ts, and frontend-design-skeleton/src/styles.css. Do not enumerate every dense raw/generated file; " +
      "group public/source.html, src/generated/*, source-skeleton/index.html, page.ir.json, assets/manifest.json, segments.json, and codegen-context.json as targeted-gap evidence when needed.",
    ),
  open_questions: FlexibleStringListSchema
    .default([])
    .describe("Only truly unobservable product/API facts that downstream agents must not hallucinate."),
  // Optional fact-check registration: missing means no items registered.
  fact_check_items: FactCheckItemListSchema.default([]).describe(
    "Every factual claim (third-party design system name, API behaviour, library version) you have NOT verified via tool calls in this session. Empty when only design observations or in-session-verified statements.",
  ),
})
export type FrontendTemplateFinal = z.infer<typeof FrontendTemplateFinalSchema>

const ToolCompactTemplateItemSchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  source_refs: z.array(z.string().min(1)).default([]),
})

const ToolComponentReusePlanItemSchema = z.object({
  family_id: z.string().min(1),
  name: z.string().min(1),
  observed_surface: z.string().min(1),
  source_refs: z.array(z.string().min(1)).default([]),
  implementation_strategy: z.enum(["existing_project_component", "mature_library", "extracted_baseline_defer", "custom_fallback"]),
  reuse_source: z.string().min(1),
  mature_library_candidates: z.array(z.string().min(1)).default([]),
  props_states: z.string().min(1),
  replacement_boundary: z.string().min(1),
  parity_guard: z.string().min(1),
  custom_fallback_reason: z.string().default(""),
})

const ToolBaselineReplacementPlanItemSchema = z.object({
  boundary_id: z.string().min(1),
  source_region: z.string().min(1),
  action: z.enum(["replace_generated_baseline", "delete_generated_region", "defer_baseline_until_parity"]),
  component_family_id: z.string().min(1),
  replacement_strategy: z.enum(["existing_project_component", "mature_library", "extracted_baseline_defer", "custom_fallback"]),
  reuse_source: z.string().min(1),
  mature_library_candidates: z.array(z.string().min(1)).default([]),
  deletion_rule: z.string().min(1),
  source_refs: z.array(z.string().min(1)).default([]),
  parity_guard: z.string().min(1),
  custom_fallback_reason: z.string().default(""),
})

const FrontendTemplateToolInputSchema = z.object({
  design_system: z.string().min(1),
  tech_stack: z.array(z.string().min(1)).min(1),
  final_acceptance_mode: z.enum(["visual_baseline_allowed", "maintainable_replacement_required"]),
  frontend_template: z.string().default(""),
  frontend_template_sections: z.array(ToolCompactTemplateItemSchema).default([]),
  fillable_modules: z.string().default(""),
  fillable_module_items: z.array(ToolCompactTemplateItemSchema).default([]),
  component_inventory: z.string().default(""),
  component_reuse_plan: z.array(ToolComponentReusePlanItemSchema).min(1),
  baseline_replacement_plan: z.array(ToolBaselineReplacementPlanItemSchema).default([]),
  quality_project_contract: z.string().default(""),
  quality_project_items: z.array(ToolCompactTemplateItemSchema).default([]),
  material_inventory: z.string().default(""),
  material_inventory_items: z.array(ToolCompactTemplateItemSchema).default([]),
  frontend_project: z.object({
    status: z.enum(["created", "not_created", "blocked"]).default("not_created"),
    role: z.enum(["source_baseline_input", "implementation_target", "visual_baseline_input", "blocked"]).default("source_baseline_input"),
    project_root: z.string().default(""),
    source_package: z.string().default(""),
    entrypoints: z.array(z.string().min(1)).default([]),
    generation_tool: z.string().default(""),
    notes: z.array(z.string().min(1)).default([]),
  }).default({
    status: "not_created",
    role: "source_baseline_input",
    project_root: "",
    source_package: "",
    entrypoints: [],
    generation_tool: "",
    notes: [],
  }),
  visual_consistency_contract: z.string().default(""),
  visual_consistency_items: z.array(ToolCompactTemplateItemSchema).default([]),
  ui_data_contract: z.string().default(""),
  ui_data_contract_items: z.array(ToolCompactTemplateItemSchema).default([]),
  template_iteration_notes: z.array(z.string().min(1)).default([]),
  completeness_review: z.string().default(""),
  reference_artifacts: z.array(z.string().min(1)).default([]),
  open_questions: FlexibleStringListSchema,
})

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
    if (!value.trim()) throw new Error(`${key} is required; provide concise markdown or the matching structured *_items field`)
  }
}

function renderFrontendProjectReport(
  project: FrontendTemplateFinal["frontend_project"],
  finalAcceptanceMode: FrontendTemplateFinal["final_acceptance_mode"],
): string {
  const normalizedRoot = normalizeProjectRootForReport(project.project_root)
  const isFrontendDesignSkeleton = isFrontendDesignSkeletonRoot(normalizedRoot)
  const maintainableSourceBaseline =
    finalAcceptanceMode === "maintainable_replacement_required" && project.role === "source_baseline_input"
  const lines = [
    `- status: ${project.status}`,
    `- role: ${project.role}`,
    `- project_root: ${project.project_root || "(not created)"}`,
    `- acceptance_root: ${isFrontendDesignSkeleton ? "." : project.role === "implementation_target" ? project.project_root || "." : "."}`,
    `- source_package: ${project.source_package || "(not specified)"}`,
    `- generation_tool: ${project.generation_tool || "(not specified)"}`,
  ]
  if (maintainableSourceBaseline) {
    lines.push("- maintainable_status: incomplete_source_baseline. This is explicit unfinished frontend_design source debt, not a final maintainable implementation target.")
  }
  if (isFrontendDesignSkeleton) {
    lines.push("- adoption_rule: frontend-design-skeleton is source_baseline_input evidence only. frontend_design must extract from it into the target acceptance project; if this remains the named project in maintainable mode, the named source debt is unfinished frontend_design work.")
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

// ---------------------------------------------------------------------------
// Common field pieces
// ---------------------------------------------------------------------------

const IdField = z
  .string()
  .min(1)
  .regex(/^vis-[a-z0-9][a-z0-9-]*$/, "id must start with 'vis-' and contain only [a-z0-9-]")
  .describe("Stable spec id, e.g. 'vis-color-primary', 'vis-comp-nav-button'")

const AppliesToField = z
  .string()
  .min(1)
  .describe("Target description — component id, CSS selector, or section reference the constraint applies to")

const SeverityField = z
  .enum(["must", "should"])
  .describe("'must' for exact visual contracts; 'should' for lower-specificity constraints acceptance still verifies")

const RationaleField = z
  .string()
  .optional()
  .describe("Why this matters (include only when non-obvious from the constraint itself)")

// ---------------------------------------------------------------------------
// Per-category tool input schemas — each compiles to the same VisualSpec row
// ---------------------------------------------------------------------------

const ColorSchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Primary button background'"),
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,8}$/, "hex must be #rgb, #rgba, #rrggbb, or #rrggbbaa")
    .describe("Exact color value in hex"),
  role: z
    .enum([
      "primary", "secondary", "accent",
      "background", "surface", "text", "border",
      "error", "success", "warning", "other",
    ])
    .describe("Semantic role of the color"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})

const TypographySchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Page heading', 'Body text'"),
  font_family: z.string().min(1).describe("e.g. 'Inter', 'SF Pro Display'"),
  font_size_px: z.number().positive().describe("Font size in px"),
  font_weight: z.number().int().min(100).max(900).describe("Font weight, 100-900"),
  line_height_px: z.number().positive().optional().describe("Line height in px, if discernible"),
  letter_spacing: z.string().optional().describe("Letter spacing, e.g. '-0.01em', '0.5px'"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})

const SpacingSchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Card inner padding', 'Section gap'"),
  property: z.enum(["margin", "padding", "gap", "inset"]).describe("Which spacing property"),
  value_px: z.number().nonnegative().describe("Value in px"),
  side: z.enum(["all", "top", "right", "bottom", "left", "vertical", "horizontal"]).default("all"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})

const LayoutSchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Header bar', 'Left sidebar'"),
  section_role: z
    .enum([
      "header", "nav", "sidebar", "hero", "content", "card-grid", "list",
      "form", "footer", "modal", "toolbar", "panel", "other",
    ])
    .describe("Semantic section role"),
  position: z.string().min(1).describe("e.g. 'top fixed', 'left 280px', 'centered below hero'"),
  dimensions: z.string().min(1).describe("e.g. 'full-width 64px height', '280px width 100vh'"),
  layout_method: z.enum(["flex", "grid", "absolute", "fixed", "sticky", "flow"]),
  parent_id: z.string().optional().describe("Parent layout spec id if this section nests inside another"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})

const ComponentSchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Primary CTA button'"),
  component_type: z.string().min(1).describe("e.g. 'button', 'card', 'data-table', 'search-input'"),
  variant: z.string().default("default").describe("e.g. 'primary', 'ghost', 'outlined'"),
  within_layout_id: z
    .string()
    .optional()
    .describe("Layout spec id this component sits inside (should reference a register_layout_spec id)"),
  visual_refs: z
    .array(z.string().min(1))
    .default([])
    .describe("Other spec ids this component MUST satisfy — e.g. color/typography/spacing ids that style it"),
  props: z.string().min(1).describe("Key props / states / slots this component needs"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})

const InteractionSchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Card hover shadow', 'Dropdown on click'"),
  trigger: z.enum(["hover", "click", "focus", "scroll", "drag", "resize", "keypress"]),
  effect: z.string().min(1).describe("e.g. 'shadow lifts to md', 'dropdown expands 240px', 'card scales 1.02'"),
  target_component_ids: z.array(z.string().min(1)).min(1).describe("Component spec ids affected"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})

const ResponsiveSchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Mobile sidebar collapse'"),
  breakpoint: z.string().min(1).describe("e.g. '< 768px', '768px-1024px', '>= 1280px'"),
  change: z.string().min(1).describe("What changes at this breakpoint"),
  affected_layout_ids: z.array(z.string().min(1)).min(1).describe("Layout spec ids that change"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})

// ---------------------------------------------------------------------------
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
      const refs = Array.isArray(input.visual_refs) && input.visual_refs.length > 0
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
        if (collector.final) return "Error: frontend template already submitted; duplicate submit_frontend_template ignored."
        const final = normalizeFrontendTemplateFinal(FrontendTemplateFinalSchema.parse(normalizeFrontendTemplateInput(input)))
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
