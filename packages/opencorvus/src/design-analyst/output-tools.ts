/**
 * Structured output tools for the Design Analyst Agent.
 *
 * Structured output tools for the Design Analyst Agent.
 *
 * The PRD/SPEC submitted through submit_design_prd_spec is the authoritative
 * design-analysis output. VisualSpec registration tools remain available to
 * tests and older collector call sites as optional compact anchors, but
 * design-analysis no longer depends on registering rows before handoff.
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
// a direct PRD/SPEC submit contract. The agent is free to under-register
// optional anchors; callers consume the submitted PRD/SPEC as the source
// of truth.
// ---------------------------------------------------------------------------

export interface DesignOutputCollector {
  specs: VisualSpec[]
  final?: DesignFinal
}

const DESIGN_SPEC_BUDGET = 80

function emptyCollector(): DesignOutputCollector {
  return { specs: [] }
}

function titleFromMarkdown(text: string): string | undefined {
  const line = text.split("\n").map((item) => item.trim()).find((item) => item.startsWith("# "))
  return line?.replace(/^#+\s*/, "").trim()
}

export function buildDesignReport(collector: DesignOutputCollector) {
  if (!collector.final) throw new Error("agent report design final is missing")
  const title = titleFromMarkdown(collector.final.product_spec)
  const summary = title
    ? title
    : `${collector.specs.length} visual spec(s) for ${collector.final.design_system}`
  const specLines = collector.specs.map((spec) => `${spec.id} [${spec.category}]: ${spec.title}`)
  return {
    summary: limitSummary(summary),
    detail: [
      `## Product Spec\n${requireReportString(collector.final.product_spec, "design product_spec")}`,
      `## Frontend Spec\n${collector.final.frontend_spec}`,
      `## Backend Spec\n${collector.final.backend_spec}`,
      `## Visual Anchors\n${specLines.length ? markdownList(specLines) : "- no compact visual anchors submitted"}`,
    ].join("\n\n"),
  }
}

// Terminal JSON-schema: payload submit_design_prd_spec must deliver.
export const DesignFinalSchema = z.object({
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
      "Recommended implementation stack hints for restoring this page, including frontend, backend/API, " +
      "mock-data, and runtime choices when the observed page requires them. For visual page-replica tasks, " +
      "prefer existing repo stack plus local static/mock API data unless the artifacts expose real API needs. " +
      "Do not name backend infrastructure, storage, queues, caches, or realtime systems unless directly observed.",
    ),
  product_spec: z
    .string()
    .min(1)
    .describe(
      "Complete PRD/SPEC for downstream requirements and architect. Include page purpose, sections, " +
      "user-visible behavior, data requirements, edge/loading/error states, and acceptance criteria.",
    ),
  frontend_spec: z
    .string()
    .min(1)
    .describe(
      "Frontend implementation spec: route map, component tree, layout details, visual tokens, " +
      "assets, interactions, responsive behavior, and acceptance criteria.",
    ),
  visual_consistency_spec: z
    .string()
    .min(1)
    .describe(
      "Binding visual-fidelity PRD/SPEC section. Emphasize exact visual consistency: viewport inventory, " +
      "pixel hierarchy, colors, typography, spacing, component states, charts/tables/media, responsive rules, " +
      "comparison criteria, and reference artifacts. This is the primary visual contract for downstream agents.",
    ),
  backend_spec: z
    .string()
    .min(1)
    .describe(
      "Backend/API spec required to reproduce the page: endpoints, request/response shapes, mock data, " +
      "state transitions, and error/loading behavior. For visual clone tasks, specify the minimal mock/static " +
      "data contract needed by the UI. Mark unobservable details as unknown instead of inventing backend architecture.",
    ),
  prd_iteration_notes: z
    .array(z.string().min(1))
    .min(1)
    .describe(
      "PRD/SPEC review-pass notes completed before handoff. One note is enough when assistant.auto_iteration=false; " +
      "include at least two when assistant.auto_iteration=true. Each item must name what was checked, what was missing " +
      "or corrected, and why the resulting PRD/SPEC is now safe for downstream agents.",
    ),
  completeness_review: z
    .string()
    .min(1)
    .describe(
      "Final completeness audit covering inventory, layout, components, interactions, frontend spec, backend/API spec, " +
      "reference artifacts, and remaining open questions. Do not finalize until this audit says the PRD/SPEC is complete enough to hand off.",
    ),
  reference_artifacts: z
    .array(z.string().min(1))
    .default([])
    .describe(
      "Mirror/material artifacts used as evidence, such as mirror/reference.png, mirror/extracted-page.json, " +
      "mirror/page-ir.xml, mirror/scaffold.json, mirror/shared-context.md, captured attachment names, " +
      "and any source file/image names downstream agents should read from the evidence_source_manifest.",
    ),
  open_questions: z
    .array(z.string().min(1))
    .default([])
    .describe("Only truly unobservable product/API facts that downstream agents must not hallucinate."),
  // Required per specs/fact-check-agent-2026-05-25.md §3.1.
  fact_check_items: FactCheckItemListSchema.describe(
    "Every factual claim (third-party design system name, API behaviour, library version) you have NOT verified via tool calls in this session. Empty when only design observations or in-session-verified statements.",
  ),
})
export type DesignFinal = z.infer<typeof DesignFinalSchema>

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
  .describe("'must' for exact visual contracts; 'should' for lower-specificity constraints delivery still verifies")

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

export function createDesignOutputTools(options: { autoIteration?: boolean } = {}) {
  const autoIteration = options.autoIteration === true
  let collector = emptyCollector()

  function assertIdFree(id: string): string | null {
    if (collector.specs.some((s) => s.id === id)) return `Error: spec id "${id}" already registered`
    return null
  }

  function assertIdsExist(ids: readonly string[], label: string): string | null {
    const missing = ids.filter((id) => !collector.specs.some((s) => s.id === id))
    if (missing.length === 0) return null
    return `Error: ${label} not registered: [${missing.join(", ")}] — register them first`
  }

  function push(category: VisualSpecCategory, input: any): string {
    if (collector.specs.length >= DESIGN_SPEC_BUDGET) {
      return (
        `SPEC_BUDGET_REACHED: ${DESIGN_SPEC_BUDGET} visual specs are already registered. ` +
        "Stop registering per-item visual rows; consolidate remaining detail in product_spec/frontend_spec/visual_consistency_spec/backend_spec, " +
        "complete the PRD/SPEC review pass(es) required by assistant.auto_iteration, then call submit_design_prd_spec."
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

    submit_design_prd_spec: tool({
      description:
        "Submit the complete mirror-grounded PRD/SPEC for downstream agents. " +
        "Use this as the final action after visual evidence review and the PRD/SPEC review pass(es) required by assistant.auto_iteration; " +
        "do not register rows or call more mirror tools once this terminal tool is exposed.",
      inputSchema: DesignFinalSchema,
      execute: async (input) => {
        if (autoIteration && input.prd_iteration_notes.length < 2) {
          throw new Error(
            "assistant.auto_iteration=true requires at least two PRD/SPEC review-pass notes before submit_design_prd_spec.",
          )
        }
        collector.final = input
        return "OK: complete design-analysis PRD/SPEC submitted for orchestrator handoff."
      },
    }),

  }

  return {
    tools,
    getCollector(): DesignOutputCollector {
      return { specs: [...collector.specs], final: collector.final }
    },
    buildReport() {
      return buildDesignReport({ specs: [...collector.specs], final: collector.final })
    },
    getSpecs(): VisualSpec[] {
      return [...collector.specs]
    },
    getFinal(): DesignFinal | undefined {
      return collector.final
    },
    reset() {
      collector = emptyCollector()
    },
  }
}
