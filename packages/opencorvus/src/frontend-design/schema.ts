/**
 * Frontend Design & Replica Agent — schema and output types.
 *
 * Mirrors frontend-research: Zod schemas live in this module, while
 * output-tools.ts owns collection, normalization, and report rendering.
 */
import { z } from "zod"
import { FactCheckItemListSchema } from "@/fact-check/schema"

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

export const ComponentReusePlanItemSchema = z.object({
  family_id: z
    .string()
    .min(1)
    .describe(
      "Stable component-family id. Preserve model/source naming when useful; no host-specific prefix is required.",
    ),
  name: z.string().min(1).describe("Human-readable component family name."),
  observed_surface: z.string().min(1).describe("Visible page region or behavior this component family covers."),
  source_refs: z
    .array(z.string().min(1))
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
      "Concrete existing file/component/design-system primitive/library/package to reuse, or inspected paths when a project-specific component is justified.",
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

export const BaselineReplacementPlanItemSchema = z.object({
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
      "Concrete project component/design primitive/library package to reuse, or inspected paths plus reason for project-specific/deferred work.",
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
    .array(z.string().min(1))
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

export const CompactTemplateItemSchema = z.object({
  title: z.string().min(1).describe("Short stable heading for this template item."),
  detail: z
    .string()
    .min(1)
    .describe(
      "Concise implementation detail. Keep this short; refer to source artifacts by path instead of pasting dense content.",
    ),
  source_refs: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Evidence anchors such as web-clone-source paths, source-ir paths, skeleton slots, or screenshot regions.",
    ),
})

export const MaterialInventoryItemSchema = z.object({
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
    .array(z.string().min(1))
    .default([])
    .describe(
      "Evidence anchors or file/path ids for this material group. Reference paths/ids instead of dense payloads.",
    ),
})

const OptionalMarkdownField = (description: string) =>
  z
    .string()
    .default("")
    .describe(
      `${description} Prefer concise markdown. For dense pages, omit this field and use the matching structured *_items field so the tool can render markdown safely.`,
    )

// Terminal JSON-schema: payload submit_frontend_template must deliver.
export const FrontendTemplateFinalSchema = z.object({
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
      "Explicit acceptance mode. For webpage replica first workflows, use visual_baseline_allowed with frontend_project.role=visual_baseline_input; reserve maintainable_replacement_required for a later or explicitly combined skeleton-to-project transcription workflow. This field selects implementation expectations; it is not a standalone pass/fail mechanism.",
    ),
  frontend_template: OptionalMarkdownField(
    "Authoritative frontend template for the frontend_design-delivered visual HTML skeleton: static route/file, layout slots, source-package entrypoints, visible regions, states, viewport matrix, and acceptance anchors.",
  ),
  frontend_template_sections: z
    .array(CompactTemplateItemSchema)
    .default([])
    .describe(
      "Preferred compact replacement for a long frontend_template string. Use one item per route, layout slot, viewport matrix, or acceptance anchor.",
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
    "The skeleton-to-project transcription contract for the later workflow. It explains how the accepted visual HTML skeleton plus source IR/content/style/token evidence becomes maintainable project source with semantic components, data modules, styling, asset ownership, runtime entrypoints, and verification evidence. The current skeleton is not the implementation target or acceptance app root.",
  ),
  quality_project_items: z
    .array(CompactTemplateItemSchema)
    .default([])
    .describe(
      "Preferred compact replacement for a long quality_project_contract string. Use one item per source module, component group, data module, style module, asset strategy, or verification requirement.",
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
      "Concrete frontend-design project output. For webpage replica first workflows, identify the source-editable visual HTML skeleton root, role=visual_baseline_input, entrypoints including index.html and tokens/region CSS, source package, generation tool, completed visual-region restorations, unfinished visual debt, and any materialization defects. frontend-design-skeleton is captured source evidence and must never be the implementation_target.",
    ),
  visual_consistency_contract: OptionalMarkdownField(
    "Binding visual-fidelity frontend template section: viewport inventory, pixel hierarchy, colors, typography, spacing, states, responsive rules, comparison criteria, and reference artifacts.",
  ),
  visual_consistency_items: z
    .array(CompactTemplateItemSchema)
    .default([])
    .describe(
      "Preferred compact replacement for a long visual_consistency_contract string. Use one item per viewport, region, or visual rule.",
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
    .default(
      "Host accepted the submitted frontend template as structurally complete enough for downstream requirements, architecture, build, source audit, and visual diff validation.",
    )
    .describe(
      "Final completeness audit and primary human-readable problem/handoff section. Cover known implementation risks, visual/source gaps, extraction-vs-rewrite uncertainty, project source organization, component/library reuse constraints, reference artifacts, and remaining open questions. Do not finalize until this audit says the frontend template is complete enough to hand off.",
    ),
  reference_artifacts: z
    .array(z.string().min(1))
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
export type FrontendTemplateFinal = z.infer<typeof FrontendTemplateFinalSchema>

export const ToolCompactTemplateItemSchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  source_refs: z.array(z.string().min(1)).default([]),
})

export const ToolMaterialInventoryItemSchema = z.object({
  title: z.string().min(1),
  detail: z.string().min(1),
  source_refs: z.array(z.string().min(1)).default([]),
})

export const ToolComponentReusePlanItemSchema = z.object({
  family_id: z.string().min(1),
  name: z.string().min(1),
  observed_surface: z.string().min(1),
  source_refs: z.array(z.string().min(1)).default([]),
  implementation_strategy: z.enum([
    "existing_project_component",
    "mature_library",
    "extracted_baseline_defer",
    "project_specific_component",
  ]),
  reuse_source: z.string().min(1),
  mature_library_candidates: z.array(z.string().min(1)).default([]),
  props_states: z.string().min(1),
  replacement_boundary: z.string().min(1),
  parity_guard: z.string().min(1),
  project_specific_reason: z.string().default(""),
})

export const ToolBaselineReplacementPlanItemSchema = z.object({
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
  reuse_source: z.string().min(1),
  mature_library_candidates: z.array(z.string().min(1)).default([]),
  deletion_rule: z.string().min(1),
  source_refs: z.array(z.string().min(1)).default([]),
  parity_guard: z.string().min(1),
  project_specific_reason: z.string().default(""),
})

export const FrontendTemplateToolInputSchema = z.object({
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
  material_inventory_items: z.array(ToolMaterialInventoryItemSchema).min(1),
  frontend_project: z
    .object({
      status: z.enum(["created", "not_created", "blocked"]).default("not_created"),
      role: z
        .enum(["source_baseline_input", "implementation_target", "visual_baseline_input", "blocked"])
        .default("source_baseline_input"),
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
