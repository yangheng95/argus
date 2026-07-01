/**
 * Frontend Design & Replica Agent — schema and output types.
 *
 * Mirrors frontend-research: Zod schemas live in this module, while
 * output-tools.ts owns collection, normalization, and report rendering.
 */
import { z } from "zod"
import { FactCheckItemListSchema } from "@/fact-check/schema"

function normalizedArtifactPath(input: string): string {
  return input.replaceAll("\\", "/")
}

function artifactBasename(input: string): string {
  const normalized = normalizedArtifactPath(input)
  return normalized.slice(normalized.lastIndexOf("/") + 1).toLowerCase()
}

function isSourceReferenceArtifact(input: string): boolean {
  const normalized = normalizedArtifactPath(input).toLowerCase()
  if (normalized.includes("visual-html-skeleton/")) return false
  const base = artifactBasename(input)
  if (base !== "reference.png" && base !== "reference-mobile.png") return false
  return normalized === `web-clone-source/${base}` || normalized.endsWith(`/web-clone-source/${base}`)
}

function isReferenceNamedArtifact(input: string): boolean {
  return /\breference(?:-[a-z0-9_-]+)?\.png$/i.test(artifactBasename(input))
}

function isTemporaryCaptureArtifact(input: string): boolean {
  const normalized = normalizedArtifactPath(input).toLowerCase()
  return normalized.includes("/opencorvus-capture/") || normalized.startsWith("opencorvus-capture/")
}

function isLocalPreviewUrl(input: string): boolean {
  const normalized = normalizedArtifactPath(input)
  if (/^(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\])(?:[:/?#]|$)/i.test(normalized)) return true
  try {
    const url = new URL(normalized)
    if (url.protocol !== "http:" && url.protocol !== "https:") return false
    return url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1"
  } catch {
    return false
  }
}

function isRenderedPreviewArtifact(input: string): boolean {
  const normalized = normalizedArtifactPath(input).toLowerCase()
  const base = artifactBasename(input)
  if (isTemporaryCaptureArtifact(input)) return true
  if (isLocalPreviewUrl(input)) return true
  if (!normalized.includes("visual-html-skeleton/")) return false
  if (!/\.(?:png|jpe?g|webp|json)$/i.test(base)) return false
  if (/(?:^|\/)(?:screenshots?|previews?|captures?|renders?|diffs?|visual-diffs?)(?:\/|$)/i.test(normalized)) {
    return true
  }
  return /\b(?:screenshot|preview|capture|diff|render|visual-diff)\b/i.test(normalized)
}

function isVisualHtmlSkeletonArtifact(input: string): boolean {
  const normalized = normalizedArtifactPath(input).toLowerCase()
  return (
    normalized === "visual-html-skeleton" ||
    normalized.startsWith("visual-html-skeleton/") ||
    normalized.includes("/visual-html-skeleton/")
  )
}

const SourceReferenceStringSchema = z.string().min(1).refine((value) => !isRenderedPreviewArtifact(value), {
  message:
    "source/reference artifacts must cite source evidence; rendered skeleton previews belong in visual_validation_evidence.screenshot_artifact",
})

const SourceReferenceListSchema = z.array(SourceReferenceStringSchema)

const FrontendProjectEntrypointStringSchema = z.string().min(1).refine((value) => !isRenderedPreviewArtifact(value), {
  message:
    "frontend_project.entrypoints must name source-editable entry files; rendered screenshots/diffs belong in visual_validation_evidence",
})

const RenderedSkeletonPreviewArtifactSchema = z
  .string()
  .min(1)
  .refine(isVisualHtmlSkeletonArtifact, {
    message: "screenshot_artifact must point to a task-scoped visual-html-skeleton artifact",
  })
  .refine((value) => !isReferenceNamedArtifact(value), {
    message: "screenshot_artifact must be a rendered skeleton preview, not a source reference image",
  })
  .refine((value) => !isTemporaryCaptureArtifact(value) && !isLocalPreviewUrl(value), {
    message:
      "screenshot_artifact must point to a task-scoped visual-html-skeleton artifact, not temporary or localhost preview output",
  })
  .refine(isRenderedPreviewArtifact, {
    message: "screenshot_artifact must point to a rendered screenshot/preview under visual-html-skeleton",
  })

const VisualValidationDiffArtifactSchema = z
  .string()
  .refine((value) => value === "" || isVisualHtmlSkeletonArtifact(value), {
    message: "diff_artifact must point to a task-scoped visual-html-skeleton artifact",
  })
  .refine((value) => value === "" || (!isTemporaryCaptureArtifact(value) && !isLocalPreviewUrl(value)), {
    message:
      "diff_artifact must point to a task-scoped visual-html-skeleton artifact, not temporary or localhost preview output",
  })
  .default("")

export const VisualSpecCategory = z.enum([
  "color",
  "typography",
  "spacing",
  "layout",
  "component",
  "interaction",
  "responsive",
])
export type VisualSpecCategory = z.infer<typeof VisualSpecCategory>

export const VisualSpecSeverity = z.enum(["must", "should"])
export type VisualSpecSeverity = z.infer<typeof VisualSpecSeverity>

export const VisualSpecSchema = z.object({
  id: z.string().min(1).describe("Stable spec id, e.g. 'vis-color-primary', 'vis-comp-nav-button'"),
  category: VisualSpecCategory,
  title: z.string().min(1).describe("Short human label, e.g. 'Primary button background'"),
  requirement: z
    .string()
    .min(1)
    .describe("Concrete constraint value — '#3B82F6', 'Inter 700 24px/32px', '64px header height'"),
  applies_to: z.string().min(1).describe("Target description — component id, CSS selector, section reference"),
  severity: VisualSpecSeverity,
  rationale: z.string().optional().describe("Why this matters (only if non-obvious from the constraint itself)"),
})
export type VisualSpec = z.infer<typeof VisualSpecSchema>

export const FlexibleStringListSchema = z.preprocess(
  (value) => {
    if (value == null || value === "") return []
    if (Array.isArray(value)) return value
    if (typeof value !== "string") return [String(value)]
    return value
      .split(/\r?\n/)
      .map((item) => item.replace(/^\s*[-*]\s*/, "").trim())
      .filter(Boolean)
  },
  z.array(z.string().min(1)).default([]),
)

export const ComponentReusePlanItemSchema = z
  .object({
    family_id: z
      .string()
      .min(1)
      .describe(
        "Stable component-family id. Preserve model/source naming when useful; no host-specific prefix is required.",
      ),
    name: z.string().min(1).describe("Human-readable component family name."),
    observed_surface: z.string().min(1).describe("Visible page region or behavior this component family covers."),
    source_refs: z
      .array(SourceReferenceStringSchema)
      .default([])
      .describe("Evidence anchors such as source ids, skeleton files, screenshot regions, or source-ir paths."),
    implementation_strategy: z
      .enum(["existing_project_component", "mature_library", "extracted_baseline_defer", "project_specific_component"])
      .describe(
        "Chosen implementation route. Prefer existing_project_component; use mature_library for hard domains; " +
          "use extracted_baseline_defer when the generated DOM/CSS baseline must remain until a parity-preserving replacement exists; project_specific_component is last resort.",
      ),
    reuse_source: z
      .string()
      .min(1)
      .describe(
        "Concrete reuse target. Name one installed package from package.json, one existing project/source file path, or one design-system primitive identifier the agent actually inspected. Do not write prose such as 'use the table package'; put explanations in project_specific_reason, parity_guard, or notes.",
      ),
    mature_library_candidates: z
      .array(z.string().min(1))
      .default([])
      .describe(
        "Candidate maintained libraries for charts, tables, menus, dialogs, forms, virtualization, drag/drop, maps, editors, or rich media.",
      ),
    props_states: z
      .string()
      .min(1)
      .describe(
        "Props/data/state/variants/interactions frontend_design implemented or Build must preserve during fine-tuning.",
      ),
    replacement_boundary: z
      .string()
      .min(1)
      .describe(
        "What exact skeleton/DOM region can be replaced by this component family, and what must remain intact until parity is proven.",
      ),
    parity_guard: z
      .string()
      .min(1)
      .describe(
        "How frontend_design verified replacement did not regress visual fidelity, plus any Build fine-tuning verification anchors.",
      ),
    project_specific_reason: z
      .string()
      .default("")
      .describe(
        "Optional reason when implementation_strategy=project_specific_component; explain why existing components and mature libraries do not fit when known.",
      ),
  })
  .strict()

export const BaselineReplacementPlanItemSchema = z
  .object({
    boundary_id: z
      .string()
      .min(1)
      .describe(
        "Stable source-region evolution boundary id. Preserve model/source naming when useful; no host-specific prefix is required.",
      ),
    source_region: z
      .string()
      .min(1)
      .describe("Exact skeleton/source region to refine, replace, or defer, with file/source ids when available."),
    action: z
      .enum(["replace_generated_baseline", "delete_generated_region", "defer_baseline_until_parity"])
      .describe(
        "Whether frontend_design replaced a region, deleted genuinely redundant generated coverage, or temporarily deferred it until parity is safe.",
      ),
    component_family_id: z
      .string()
      .min(1)
      .describe("Component family from component_reuse_plan that owns the replacement/deletion boundary."),
    replacement_strategy: z
      .enum(["existing_project_component", "mature_library", "extracted_baseline_defer", "project_specific_component"])
      .describe(
        "Refinement route. Prefer existing_project_component, then mature_library; project_specific_component is last resort.",
      ),
    reuse_source: z
      .string()
      .min(1)
      .describe(
        "Concrete reuse target for this replacement boundary. Name one installed package from package.json, one existing project/source file path, or one design-system primitive identifier the agent actually inspected. Do not use prose as the value; explanations belong in project_specific_reason, deletion_rule, parity_guard, or notes.",
      ),
    mature_library_candidates: z
      .array(z.string().min(1))
      .default([])
      .describe("Maintained library candidates when replacement_strategy=mature_library."),
    deletion_rule: z
      .string()
      .min(1)
      .describe(
        "What redundant generated DOM/CSS/asset coverage, if any, can be removed once the replacement passes, and what evidence should remain input-only.",
      ),
    source_refs: z
      .array(SourceReferenceStringSchema)
      .default([])
      .describe(
        "Evidence anchors such as source-ir paths, skeleton slots, screenshot regions, or web-clone-source files.",
      ),
    parity_guard: z
      .string()
      .min(1)
      .describe("Concrete visual/source checks to run before deleting or replacing a region."),
    project_specific_reason: z
      .string()
      .default("")
      .describe(
        "Optional reason when replacement_strategy=project_specific_component; explain why no project component or mature library fits when known.",
      ),
  })
  .strict()

export const CompactTemplateItemSchema = z
  .object({
    title: z.string().min(1).describe("Short stable heading for this template item."),
    detail: z
      .string()
      .min(1)
      .describe(
        "Concise implementation detail. Keep this short; refer to source artifacts by path instead of pasting dense content.",
      ),
    source_refs: z
      .array(SourceReferenceStringSchema)
      .default([])
      .describe(
        "Evidence anchors such as web-clone-source paths, source-ir paths, skeleton slots, or screenshot regions.",
      ),
  })
  .strict()

export const MaterialInventoryItemSchema = z
  .object({
    title: z
      .string()
      .min(1)
      .describe(
        "Short stable name for a required material group, such as CSS tokens, assets, fixtures, fonts, or icons.",
      ),
    detail: z
      .string()
      .min(1)
      .describe(
        "What this material contains, why the frontend skeleton or later project needs it, and any ownership or extraction note.",
      ),
    source_refs: z
      .array(SourceReferenceStringSchema)
      .default([])
      .describe(
        "Evidence anchors or file/path ids for this material group. Reference paths/ids instead of dense payloads.",
      ),
  })
  .strict()

export const DesignDirectionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^direction-[a-z0-9][a-z0-9-]*$/, "id must start with 'direction-' and contain only [a-z0-9-]"),
    name: z.string().min(1).describe("Short name for the design direction."),
    concept: z.string().min(1).describe("Product/enterprise design concept and audience fit."),
    evidence_refs: SourceReferenceListSchema.default([]).describe("Screenshots, HTML, Figma, or manifest refs inspected."),
    tradeoffs: z.string().min(1).describe("Why this direction is strong or weak against product-grade criteria."),
    implementation_notes: z.string().min(1).describe("What Build would need to implement this direction."),
  })
  .strict()
export type DesignDirection = z.infer<typeof DesignDirectionSchema>

export const AntiSlopReviewItemSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^anti-slop-[a-z0-9][a-z0-9-]*$/, "id must start with 'anti-slop-' and contain only [a-z0-9-]"),
    rejected_trait: z.string().min(1).describe("The shallow, generic, or unfit design trait rejected."),
    evidence: z.string().min(1).describe("Resource-backed reason this trait is wrong for the product."),
    correction: z.string().min(1).describe("The selected design or implementation correction."),
  })
  .strict()
export type AntiSlopReviewItem = z.infer<typeof AntiSlopReviewItemSchema>

export const ImplementationPhase = z.enum([
  "evidence_lock",
  "implementation_scaffold",
  "data_component_transcription",
  "runtime_visual_verification",
  "source_quality_cleanup",
])
export type ImplementationPhase = z.infer<typeof ImplementationPhase>

export const ImplementationPhaseOutcomeSchema = z
  .object({
    id: z.string().min(1).describe("Stable phase outcome id, e.g. phase-evidence-lock."),
    phase: ImplementationPhase.describe(
      "Required maintainable handoff phase: evidence lock, implementation scaffold, transcription, runtime/visual verification, or source-quality cleanup.",
    ),
    title: z.string().min(1).describe("Short phase outcome title."),
    deliverable: z
      .string()
      .min(1)
      .describe("Concrete output downstream agents must create, preserve, verify, or audit for this phase."),
    source_refs: z
      .array(SourceReferenceStringSchema)
      .min(1)
      .describe("Evidence, project, screenshot, package, or source-file refs that bind this phase."),
    acceptance: z
      .string()
      .min(1)
      .describe("Observable acceptance condition for this phase, not a component checklist item."),
  })
  .strict()
export type ImplementationPhaseOutcome = z.infer<typeof ImplementationPhaseOutcomeSchema>

export const VisualValidationEvidenceSchema = z
  .object({
    id: z.string().min(1).describe("Stable visual validation evidence id, e.g. visual-render-desktop."),
    render_target: z
      .enum(["visual-html-skeleton"])
      .describe(
        "The rendered source surface. Visual baseline acceptance only supports the visual HTML skeleton target.",
      ),
    rendered_entrypoint: z
      .string()
      .min(1)
      .describe("Rendered HTML entrypoint, normally visual-html-skeleton/index.html."),
    screenshot_artifact: RenderedSkeletonPreviewArtifactSchema.describe(
      "Task-scoped rendered skeleton preview artifact under visual-html-skeleton produced from rendered_entrypoint; never a copied source reference image or temporary browser capture path.",
    ),
    source_reference_artifact: z
      .string()
      .min(1)
      .refine(isSourceReferenceArtifact, {
        message: "source_reference_artifact must point to the original source reference image",
      })
      .describe("Original source reference screenshot, normally web-clone-source/reference.png."),
    renderer: z
      .enum(["task_scoped_backend_browser", "node_playwright_static_file", "preview_target_browser"])
      .describe("Renderer/provenance used to produce screenshot_artifact from rendered_entrypoint."),
    viewport: z
      .string()
      .min(1)
      .describe("Viewport/device state used for rendering, including explicit dimensions such as desktop-1440x900."),
    capture_mode: z
      .enum(["viewport", "full_page"])
      .describe(
        "Screenshot capture mode used for screenshot_artifact. Use viewport for a single viewport crop and full_page when the screenshot captures the complete document height.",
      ),
    screenshot_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i, "screenshot_sha256 must be a 64 character hex digest")
      .describe("SHA-256 of the rendered skeleton screenshot artifact."),
    source_reference_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i, "source_reference_sha256 must be a 64 character hex digest")
      .describe("SHA-256 of the source reference screenshot artifact."),
    diff_artifact: VisualValidationDiffArtifactSchema.describe(
      "Optional task-scoped visual diff or comparison manifest artifact produced from screenshot_artifact and source_reference_artifact.",
    ),
    review_status: z
      .enum(["reviewed_no_blocking_debt", "reviewed_with_blocking_debt"])
      .describe("Whether screenshot review found blocking visual debt."),
    review_summary: z.string().min(1).describe("Concrete summary of the screenshot review and comparison result."),
  })
  .strict()
export type VisualValidationEvidence = z.infer<typeof VisualValidationEvidenceSchema>

const OptionalMarkdownField = (description: string) =>
  z
    .string()
    .default("")
    .describe(
      `${description} Prefer concise markdown. For dense pages, omit this field and use the matching structured *_items field so the tool can render markdown safely.`,
    )

// Terminal JSON-schema: payload submit_frontend_template must deliver.
export const FrontendTemplateFinalSchema = z
  .object({
    design_system: z
      .string()
      .min(1)
      .describe("Detected design system — e.g. 'Material 3', 'custom dark with teal accents'."),
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
        "Explicit acceptance mode. For webpage replica first workflows, use visual_baseline_allowed with frontend_project.role=visual_baseline_input only when the visual skeleton has rendered screenshot review evidence. Use maintainable_replacement_required when the operator explicitly asks for production-mergeable implementation, target design-system/component reuse, accessibility/component semantics, no primitive/static-image substitutes, or replacement of generated/mechanical output in the same task.",
      ),
    frontend_template: OptionalMarkdownField(
      "Authoritative frontend template for the frontend_design-delivered visual HTML skeleton: static route/file, layout slots, source-package entrypoints, visible regions, states, scoped viewport evidence, and acceptance anchors. For replica tasks this is desktop-only by default unless the current operator explicitly authorizes a separate multi-end migration scope.",
    ),
    frontend_template_sections: z
      .array(CompactTemplateItemSchema)
      .default([])
      .describe(
        "Preferred compact replacement for a long frontend_template string. Use one item per route, layout slot, scoped viewport evidence item, or acceptance anchor.",
      ),
    design_directions: z
      .array(DesignDirectionSchema)
      .default([])
      .describe(
        "Competing named design directions considered before the selected handoff. Frontend Innovate tasks should record at least two resource-backed directions here.",
      ),
    selected_design_direction_id: z
      .string()
      .default("")
      .describe("The id from design_directions selected for downstream implementation, empty when no alternatives were needed."),
    anti_slop_review: z
      .array(AntiSlopReviewItemSchema)
      .default([])
      .describe(
        "Rejected shallow/generic design traits and the resource-backed corrections. Frontend Innovate tasks should use this before handoff.",
      ),
    fillable_modules: OptionalMarkdownField(
      "Modules/slots frontend_design filled or left as explicit source debt: page modules, data modules, interactions, state, adapters, and verification modules.",
    ),
    fillable_module_items: z
      .array(CompactTemplateItemSchema)
      .default([])
      .describe("Preferred compact replacement for a long fillable_modules string. Use one item per module or slot."),
    component_inventory: OptionalMarkdownField(
      "Concise component-family cross-check. Do not use this as a standalone checklist; direct downstream agents to component_reuse_plan, quality_project_contract, completeness_review, open_questions, and named source artifacts. If omitted, it is rendered as a compact reuse-family summary from component_reuse_plan.",
    ),
    component_reuse_plan: z
      .array(ComponentReusePlanItemSchema)
      .min(1)
      .describe(
        "Structured, auditable reuse plan for the implementation surface. Each reusable family must say whether frontend_design reused an existing project component/design-system primitive, used a mature maintained library, kept the extracted DOM/CSS baseline until replacement is safe, or used a justified project-specific component. This keeps complex controls tied to project/library ownership without turning the handoff into a component catalog.",
      ),
    baseline_replacement_plan: z
      .array(BaselineReplacementPlanItemSchema)
      .default([])
      .describe(
        "Optional source-region evolution plan. Use it only when a specific raw/generated skeleton region should be replaced, deleted, or deferred during in-place refinement. It is diagnostic/planning evidence, not a schema requirement and not a requirement to delete the whole skeleton.",
      ),
    quality_project_contract: OptionalMarkdownField(
      "The skeleton-to-project transcription contract for the later workflow. It explains how the screenshot-validated visual HTML skeleton plus source IR/content/style/token evidence becomes maintainable project source with semantic components, data modules, styling, asset ownership, runtime entrypoints, and verification evidence; if screenshot validation is missing, it must name the blocker instead. The current skeleton is not the implementation target or acceptance app root.",
    ),
    quality_project_items: z
      .array(CompactTemplateItemSchema)
      .default([])
      .describe(
        "Preferred compact replacement for a long quality_project_contract string. Use one item per source module, component group, data module, style module, asset strategy, or verification requirement.",
      ),
    implementation_phase_outcomes: z
      .array(ImplementationPhaseOutcomeSchema)
      .default([])
      .describe(
        "Structured phase outcomes for maintainable replacement. Required when final_acceptance_mode=maintainable_replacement_required and must cover evidence_lock, implementation_scaffold, data_component_transcription, runtime_visual_verification, and source_quality_cleanup. Architect consumes this before component_inventory/component_reuse_plan.",
      ),
    material_inventory: OptionalMarkdownField(
      "Material and asset inventory: CSS/tokens, sidecar SVG/image/canvas assets, data fixtures, text samples, icons, fonts, and dense resources.",
    ),
    material_inventory_items: z
      .array(MaterialInventoryItemSchema)
      .min(1)
      .describe(
        "Required compact material inventory. Include at least one item covering the CSS/tokens, sidecar SVG/image/canvas assets, data fixtures, text samples, icons, fonts, or dense resources needed to reproduce the frontend. Reference paths/ids instead of dense payloads.",
      ),
    frontend_project: z
      .object({
        status: z.enum(["created", "not_created", "blocked"]).default("not_created"),
        role: z
          .enum(["source_baseline_input", "implementation_target", "visual_baseline_input", "blocked"])
          .default("source_baseline_input"),
        project_root: z.string().default(""),
        source_package: z.string().default(""),
        entrypoints: z
          .array(FrontendProjectEntrypointStringSchema)
          .default([])
          .describe(
            "Role-specific entrypoint paths. For role=implementation_target, every item must be a real project-root-relative file under project_root. For role=visual_baseline_input, name source-editable visual-html-skeleton entry files such as index.html and token/region CSS. Rendered screenshots, preview captures, and diff outputs belong in visual_validation_evidence, not entrypoints. Do not put .opencorvus report paths or prose here.",
          ),
        generation_tool: z.string().default(""),
        notes: z.array(z.string().min(1)).default([]),
      })
      .strict()
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
        "Concrete frontend-design project output. For webpage replica first workflows, identify the source-editable visual HTML skeleton root, role=visual_baseline_input, entrypoints including index.html and tokens/region CSS, source package, generation tool, completed visual-region restorations, unfinished visual debt, and any materialization defects. frontend-design-skeleton is captured source evidence and must never be the implementation_target.",
      ),
    visual_consistency_contract: OptionalMarkdownField(
      "Binding visual-fidelity frontend template section: desktop viewport inventory by default, pixel hierarchy, colors, typography, spacing, states, explicitly scoped layout rules, comparison criteria, and reference artifacts. Do not add non-desktop viewport rows unless the current operator explicitly authorizes a separate multi-end migration scope.",
    ),
    visual_consistency_items: z
      .array(CompactTemplateItemSchema)
      .default([])
      .describe(
        "Preferred compact replacement for a long visual_consistency_contract string. Use one item per scoped viewport, region, or visual rule.",
      ),
    visual_validation_evidence: z
      .array(VisualValidationEvidenceSchema)
      .default([])
      .describe(
        "Structured rendered-screenshot evidence for visual-html-skeleton acceptance. Required when frontend_project.role=visual_baseline_input. Each item must tie the rendered skeleton entrypoint to a task-scoped renderer, rendered screenshot artifact, source reference screenshot, hashes, viewport dimensions, capture mode, review status, and optional diff artifact. Text-only screenshot paths do not satisfy visual baseline acceptance.",
      ),
    ui_data_contract: OptionalMarkdownField(
      "UI data contract required to reproduce the frontend: local mock/static data, observable endpoints when present, state transitions, and error/loading behavior.",
    ),
    ui_data_contract_items: z
      .array(CompactTemplateItemSchema)
      .default([])
      .describe(
        "Preferred compact replacement for a long ui_data_contract string. Use one item per entity, fixture, endpoint, or state model.",
      ),
    template_iteration_notes: z
      .array(z.string().min(1))
      .min(1)
      .default([
        "Host recorded the submitted frontend template after the model completed its available review pass; downstream visual/source review remains authoritative.",
        "Host recorded the submitted maintainability contract after checking that the payload includes component reuse, source-region planning where needed, visual consistency, and UI data sections.",
      ])
      .describe(
        "At least two frontend template review-pass notes completed before handoff. Each item must name what was checked, what was missing or corrected, and why the resulting frontend template is now safe for downstream agents.",
      ),
    completeness_review: z
      .string()
      .min(1)
      .default(
        "Host recorded the submitted frontend template as structurally complete enough for downstream requirements, architecture, build, source-evidence review, and visual diff validation; screenshot-backed visual validation still controls whether a visual baseline can be consumed.",
      )
      .describe(
        "Final completeness audit and primary human-readable problem/handoff section. Cover known implementation risks, visual/source gaps, extraction-vs-rewrite uncertainty, project source organization, component/library reuse constraints, reference artifacts, and remaining open questions. Do not finalize until this audit says the frontend template is complete enough to hand off.",
      ),
    reference_artifacts: z
      .array(SourceReferenceStringSchema)
      .default([])
      .describe(
        "Compact artifact anchors used as evidence. Prefer small canonical entrypoints such as web-clone-source/README.md, " +
          "implementation-blueprint.md, web-clone-implementation-contract.json, reference.png, source-ir/*, source-skeleton/critical.css, " +
          "visual-html-skeleton/index.html, visual-html-skeleton/styles/tokens.css, visual-html-skeleton/styles/regions/*, frontend-design-skeleton/README.md, frontend-design-skeleton/src/App.tsx, frontend-design-skeleton/src/components/SourceClonePage.tsx, frontend-design-skeleton/src/data/sourceData.ts, and frontend-design-skeleton/src/styles.css. Do not enumerate every dense raw/generated file; " +
          "group public/source.html, src/generated/*, source-skeleton/index.html, page.ir.json, assets/manifest.json, segments.json, and codegen-context.json as targeted-gap evidence when needed.",
      ),
    open_questions: FlexibleStringListSchema.default([]).describe(
      "Only truly unobservable product/API facts that downstream agents must not hallucinate.",
    ),
    // Optional fact-check registration: missing means no items registered.
    fact_check_items: FactCheckItemListSchema.default([]).describe(
      "Every factual claim (third-party design system name, API behaviour, library version) you have NOT verified via tool calls in this session. Empty when only design observations or in-session-verified statements.",
    ),
  })
  .strict()
export type FrontendTemplateFinal = z.infer<typeof FrontendTemplateFinalSchema>

export const ToolCompactTemplateItemSchema = z
  .object({
    title: z.string().min(1),
    detail: z.string().min(1),
    source_refs: SourceReferenceListSchema.default([]),
  })
  .strict()

export const ToolMaterialInventoryItemSchema = z
  .object({
    title: z.string().min(1),
    detail: z.string().min(1),
    source_refs: SourceReferenceListSchema.default([]),
  })
  .strict()

export const ToolDesignDirectionSchema = DesignDirectionSchema
export const ToolDesignDirectionSelectionSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^direction-[a-z0-9][a-z0-9-]*$/, "id must start with 'direction-' and contain only [a-z0-9-]"),
  })
  .strict()
export const ToolAntiSlopReviewItemSchema = AntiSlopReviewItemSchema

export const ToolImplementationPhaseOutcomeSchema = z
  .object({
    id: z.string().min(1),
    phase: ImplementationPhase,
    title: z.string().min(1),
    deliverable: z.string().min(1),
    source_refs: SourceReferenceListSchema.min(1),
    acceptance: z.string().min(1),
  })
  .strict()

export const ToolComponentReusePlanItemSchema = z
  .object({
    family_id: z.string().min(1),
    name: z.string().min(1),
    observed_surface: z.string().min(1),
    source_refs: SourceReferenceListSchema.default([]),
    implementation_strategy: z.enum([
      "existing_project_component",
      "mature_library",
      "extracted_baseline_defer",
      "project_specific_component",
    ]),
    reuse_source: z
      .string()
      .min(1)
      .describe(
        "Concrete reuse target: installed package, existing project/source file path, or inspected design-system primitive identifier. Explanatory prose belongs in project_specific_reason, parity_guard, or notes.",
      ),
    mature_library_candidates: z.array(z.string().min(1)).default([]),
    props_states: z.string().min(1),
    replacement_boundary: z.string().min(1),
    parity_guard: z.string().min(1),
    project_specific_reason: z.string().default(""),
  })
  .strict()

export const ToolBaselineReplacementPlanItemSchema = z
  .object({
    boundary_id: z.string().min(1),
    source_region: z.string().min(1),
    action: z.enum(["replace_generated_baseline", "delete_generated_region", "defer_baseline_until_parity"]),
    component_family_id: z.string().min(1),
    replacement_strategy: z.enum([
      "existing_project_component",
      "mature_library",
      "extracted_baseline_defer",
      "project_specific_component",
    ]),
    reuse_source: z
      .string()
      .min(1)
      .describe(
        "Concrete reuse target for this boundary: installed package, existing project/source file path, or inspected design-system primitive identifier. Explanatory prose belongs in project_specific_reason, deletion_rule, parity_guard, or notes.",
      ),
    mature_library_candidates: z.array(z.string().min(1)).default([]),
    deletion_rule: z.string().min(1),
    source_refs: SourceReferenceListSchema.default([]),
    parity_guard: z.string().min(1),
    project_specific_reason: z.string().default(""),
  })
  .strict()

export const ToolVisualValidationEvidenceSchema = z
  .object({
    id: z.string().min(1),
    render_target: z.enum(["visual-html-skeleton"]),
    rendered_entrypoint: z.string().min(1),
    screenshot_artifact: RenderedSkeletonPreviewArtifactSchema,
    source_reference_artifact: z.string().min(1).refine(isSourceReferenceArtifact, {
      message: "source_reference_artifact must point to the original source reference image",
    }),
    renderer: z.enum(["task_scoped_backend_browser", "node_playwright_static_file", "preview_target_browser"]),
    viewport: z.string().min(1),
    capture_mode: z.enum(["viewport", "full_page"]),
    screenshot_sha256: z.string().regex(/^[a-f0-9]{64}$/i, "screenshot_sha256 must be a 64 character hex digest"),
    source_reference_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/i, "source_reference_sha256 must be a 64 character hex digest"),
    diff_artifact: VisualValidationDiffArtifactSchema,
    review_status: z.enum(["reviewed_no_blocking_debt", "reviewed_with_blocking_debt"]),
    review_summary: z.string().min(1),
  })
  .strict()

export const FrontendTemplateSubmitSchema = z
  .object({
    final: z.literal(true).describe("Explicit confirmation that all frontend template fragments are registered."),
    fact_check_items: FactCheckItemListSchema.default([]),
  })
  .strict()

export const FrontendTemplateBasicsToolInputSchema = z
  .object({
    design_system: z.string().min(1),
    tech_stack: z.array(z.string().min(1)).min(1),
    final_acceptance_mode: z.enum(["visual_baseline_allowed", "maintainable_replacement_required"]),
  })
  .strict()

export const FrontendTemplateMarkdownSectionNameSchema = z.enum([
  "frontend_template",
  "fillable_modules",
  "component_inventory",
  "quality_project_contract",
  "material_inventory",
  "visual_consistency_contract",
  "ui_data_contract",
  "completeness_review",
])

export const FrontendTemplateMarkdownSectionToolInputSchema = z
  .object({
    section: FrontendTemplateMarkdownSectionNameSchema,
    content: z.string().min(1),
  })
  .strict()

export const FrontendTemplateCompactItemTargetSchema = z.enum([
  "frontend_template_sections",
  "fillable_module_items",
  "quality_project_items",
  "visual_consistency_items",
  "ui_data_contract_items",
])

export const FrontendTemplateCompactItemToolInputSchema = z
  .object({
    target: FrontendTemplateCompactItemTargetSchema,
    item: ToolCompactTemplateItemSchema,
  })
  .strict()

export const FrontendProjectToolInputSchema = z
  .object({
    status: z.enum(["created", "not_created", "blocked"]).default("not_created"),
    role: z
      .enum(["source_baseline_input", "implementation_target", "visual_baseline_input", "blocked"])
      .default("source_baseline_input"),
    project_root: z.string().default(""),
    source_package: z.string().default(""),
    entrypoints: z
      .array(FrontendProjectEntrypointStringSchema)
      .default([])
      .describe(
        "Role-specific entrypoint paths. For role=implementation_target, every item must be a real project-root-relative file under project_root. For role=visual_baseline_input, name source-editable visual-html-skeleton entry files only. Rendered screenshots, preview captures, and diff outputs belong in visual_validation_evidence. Do not put .opencorvus report paths or prose here.",
      ),
    generation_tool: z.string().default(""),
    notes: z.array(z.string().min(1)).default([]),
  })
  .strict()

export const FrontendTemplateStringItemToolInputSchema = z
  .object({
    value: z.string().min(1),
  })
  .strict()

export const FrontendReferenceArtifactToolInputSchema = z
  .object({
    value: SourceReferenceStringSchema,
  })
  .strict()

export const FrontendTemplateToolInputSchema = z
  .object({
    design_system: z.string().min(1),
    tech_stack: z.array(z.string().min(1)).min(1),
    final_acceptance_mode: z.enum(["visual_baseline_allowed", "maintainable_replacement_required"]),
    frontend_template: z.string().default(""),
    frontend_template_sections: z.array(ToolCompactTemplateItemSchema).default([]),
    design_directions: z.array(ToolDesignDirectionSchema).default([]),
    selected_design_direction_id: z.string().default(""),
    anti_slop_review: z.array(ToolAntiSlopReviewItemSchema).default([]),
    fillable_modules: z.string().default(""),
    fillable_module_items: z.array(ToolCompactTemplateItemSchema).default([]),
    component_inventory: z.string().default(""),
    component_reuse_plan: z.array(ToolComponentReusePlanItemSchema).min(1),
    baseline_replacement_plan: z.array(ToolBaselineReplacementPlanItemSchema).default([]),
    quality_project_contract: z.string().default(""),
    quality_project_items: z.array(ToolCompactTemplateItemSchema).default([]),
    implementation_phase_outcomes: z.array(ToolImplementationPhaseOutcomeSchema).default([]),
    material_inventory: z.string().default(""),
    material_inventory_items: z.array(ToolMaterialInventoryItemSchema).min(1),
    frontend_project: FrontendProjectToolInputSchema.default({
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
    visual_validation_evidence: z.array(ToolVisualValidationEvidenceSchema).default([]),
    ui_data_contract: z.string().default(""),
    ui_data_contract_items: z.array(ToolCompactTemplateItemSchema).default([]),
    template_iteration_notes: z.array(z.string().min(1)).default([]),
    completeness_review: z.string().default(""),
    reference_artifacts: SourceReferenceListSchema.default([]),
    open_questions: FlexibleStringListSchema,
  })
  .strict()

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

export const ColorSchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Primary button background'"),
  hex: z
    .string()
    .regex(/^#[0-9a-fA-F]{3,8}$/, "hex must be #rgb, #rgba, #rrggbb, or #rrggbbaa")
    .describe("Exact color value in hex"),
  role: z
    .enum([
      "primary",
      "secondary",
      "accent",
      "background",
      "surface",
      "text",
      "border",
      "error",
      "success",
      "warning",
      "other",
    ])
    .describe("Semantic role of the color"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})

export const TypographySchema = z.object({
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

export const SpacingSchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Card inner padding', 'Section gap'"),
  property: z.enum(["margin", "padding", "gap", "inset"]).describe("Which spacing property"),
  value_px: z.number().nonnegative().describe("Value in px"),
  side: z.enum(["all", "top", "right", "bottom", "left", "vertical", "horizontal"]).default("all"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})

export const LayoutSchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Header bar', 'Left sidebar'"),
  section_role: z
    .enum([
      "header",
      "nav",
      "sidebar",
      "hero",
      "content",
      "card-grid",
      "list",
      "form",
      "footer",
      "modal",
      "toolbar",
      "panel",
      "other",
    ])
    .describe("Semantic section role"),
  position: z.string().min(1).describe("e.g. 'top fixed', 'left 280px', 'centered below hero'"),
  dimensions: z.string().min(1).describe("e.g. 'full-width 64px height', '280px width 100vh'"),
  layout_method: z.enum(["flex", "grid", "absolute", "fixed", "sticky", "flow"]),
  coordinate_space: z.enum(["implementation_layout", "source_capture_viewport_px"]),
  implementation_use: z.enum(["visible_layout_constraint", "evidence_only"]),
  parent_id: z.string().optional().describe("Parent layout spec id if this section nests inside another"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})

export const ComponentSchema = z.object({
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

export const InteractionSchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Card hover shadow', 'Dropdown on click'"),
  trigger: z.enum(["hover", "click", "focus", "scroll", "drag", "resize", "keypress"]),
  effect: z.string().min(1).describe("e.g. 'shadow lifts to md', 'dropdown expands 240px', 'card scales 1.02'"),
  target_component_ids: z.array(z.string().min(1)).min(1).describe("Component spec ids affected"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})

export const ResponsiveSchema = z.object({
  id: IdField,
  title: z.string().min(1).describe("Human label, e.g. 'Mobile sidebar collapse'"),
  breakpoint: z.string().min(1).describe("e.g. '< 768px', '768px-1024px', '>= 1280px'"),
  change: z.string().min(1).describe("What changes at this breakpoint"),
  affected_layout_ids: z.array(z.string().min(1)).min(1).describe("Layout spec ids that change"),
  applies_to: AppliesToField,
  severity: SeverityField,
  rationale: RationaleField,
})
