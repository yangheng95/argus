/**
 * Structured output tools for the Design Analyst Agent.
 *
 * Every registered spec ends up as a `VisualSpec` row on
 * `engine_task.design_specs`, read by delivery as a visual contract checklist.
 * There is no scorer or automatic verification at registration time. The tools exist to force the
 * LLM to:
 *
 * ① Name a category up front (pick the right register_*_spec tool)
 * ② Fill category-appropriate fields (hex value, font metric, px value, …)
 * ③ Give a stable id + an actionable applies_to + severity
 * ④ Enumerate every region/token/component (finalize gates coverage)
 *
 * Category splitting is a UX choice for the LLM, not a persistence choice —
 * every tool writes the same `VisualSpec` shape.
 */
import { tool } from "ai"
import z from "zod"
import type { VisualSpec, VisualSpecCategory } from "./types"

// ---------------------------------------------------------------------------
// Collector — private. Callers read through getSpecs() / getStats().
//
// Phase 3-b-2: designSystem / techStack / finalized moved out of the
// collector — they now arrive through SessionLoop's StructuredOutput tool
// via DesignFinalSchema. The cross-field validation formerly in
// `finalize_design_requirements` (≥2 colors, ≥1 typography, layout,
// component) is dropped in favour of trust-the-LLM; the agent is free
// to under-register, and callers must decide whether to accept thin
// contracts or re-dispatch. This aligns with CLAUDE.md rule 23 — no
// FSM-style quality gates inside a tool.
// ---------------------------------------------------------------------------

interface Collector {
  specs: VisualSpec[]
}

function emptyCollector(): Collector {
  return { specs: [] }
}

// Terminal JSON-schema: payload the StructuredOutput tool must deliver.
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
      "Recommended FRONTEND stack only: UI framework, CSS approach, component library, font family. " +
      "Examples: ['React 18', 'Tailwind CSS', 'shadcn/ui', 'Inter font']; " +
      "['Vanilla HTML/CSS/JS', 'CSS variables for design tokens', 'Microsoft YaHei + Arial']. " +
      "Out-of-lane — DO NOT include backend frameworks (Node.js, Express, FastAPI, Spring, Rails, etc.), " +
      "API protocols (REST API, GraphQL, gRPC, etc.), databases, runtimes, or any server-side concern. " +
      "Architect (downstream) owns backend / runtime / data-layer decisions. Stay strictly frontend.",
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

export function createDesignOutputTools() {
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
        "Register an exact color constraint from the visual input. Use EXACT hex values (eyedrop the image — no 'approximately blue'). Every distinct color surface must be registered.",
      inputSchema: ColorSchema,
      execute: async (input) => assertIdFree(input.id) ?? push("color", input),
    }),

    register_typography_spec: tool({
      description:
        "Register an exact typography constraint (font family + size + weight, plus line-height and letter-spacing when discernible). Every distinct typographic role — headings, body, captions, mono, labels — must be registered.",
      inputSchema: TypographySchema,
      execute: async (input) => assertIdFree(input.id) ?? push("typography", input),
    }),

    register_spacing_spec: tool({
      description:
        "Register an exact spacing constraint (margin / padding / gap / inset). Measure from the image; round to the underlying scale the design uses (often 4 / 8 px).",
      inputSchema: SpacingSchema,
      execute: async (input) => assertIdFree(input.id) ?? push("spacing", input),
    }),

    register_layout_spec: tool({
      description:
        "Register a layout section (header, sidebar, hero, etc.) with position + dimensions + layout method. Register parents before children and reference parents via parent_id to build the layout tree.",
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
        "Register a UI component (button, card, nav item, input, badge, chart, etc.). Reference the layout it lives in via within_layout_id and list the color/typography/spacing spec ids that style it via visual_refs.",
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

  }

  return {
    tools,
    getSpecs(): VisualSpec[] {
      return [...collector.specs]
    },
    reset() {
      collector = emptyCollector()
    },
  }
}
