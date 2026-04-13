/**
 * Structured output tools for the Design Analyst Agent.
 *
 * Same pattern as requirements/output-tools.ts — the LLM registers each design
 * element via a Zod-validated tool call. Benefits:
 *
 * ① Schema validation per call — required fields, enums, min lengths enforced
 * ② Incremental — LLM registers one section/token/component at a time
 * ③ Completeness checks — finalize validates coverage
 * ④ No text-parsing fallback (CLAUDE.md "no fallback" rule)
 */
import { tool } from "ai"
import z from "zod"
import type {
  LayoutSection,
  StyleToken,
  UIComponent,
  InteractionPattern,
  ResponsiveRule,
  DesignAnalysis,
} from "./types"

// ---------------------------------------------------------------------------
// Collector
// ---------------------------------------------------------------------------

export interface DesignCollector {
  layout: LayoutSection[]
  tokens: StyleToken[]
  components: UIComponent[]
  interactions: InteractionPattern[]
  responsive: ResponsiveRule[]
  summary: string
  sourceType: "image" | "url" | "both"
  sourceUrl?: string
  designSystem: string
  techStack: string[]
  finalized: boolean
}

function emptyCollector(): DesignCollector {
  return {
    layout: [],
    tokens: [],
    components: [],
    interactions: [],
    responsive: [],
    summary: "",
    sourceType: "image",
    sourceUrl: undefined,
    designSystem: "",
    techStack: [],
    finalized: false,
  }
}

// ---------------------------------------------------------------------------
// Zod schemas for tool inputs
// ---------------------------------------------------------------------------

const LayoutSectionSchema = z.object({
  id: z.string().min(1).describe("Unique section ID, e.g., 'header', 'sidebar-left', 'main-content'"),
  type: z.enum([
    "header", "nav", "sidebar", "hero", "content", "card-grid", "list",
    "form", "footer", "modal", "toolbar", "panel", "custom",
  ]).describe("Semantic section type"),
  position: z.string().min(1).describe("Position description, e.g., 'top fixed', 'left 280px'"),
  dimensions: z.string().min(1).describe("Size description, e.g., 'full-width 64px height', '280px width 100vh'"),
  layout_method: z.enum(["flex", "grid", "absolute", "fixed", "sticky", "flow"])
    .describe("CSS layout method used"),
  children: z.array(z.string()).default([]).describe("Child section IDs (for nested layout tree)"),
  notes: z.string().default("").describe("Implementation notes — borders, backgrounds, overflow, z-index"),
})

const StyleTokenSchema = z.object({
  category: z.enum([
    "color-primary", "color-secondary", "color-accent",
    "color-background", "color-surface", "color-text", "color-border",
    "color-error", "color-success", "color-warning",
    "typography-heading", "typography-body", "typography-mono", "typography-caption",
    "spacing", "border-radius", "shadow", "transition",
  ]).describe("Token category"),
  name: z.string().min(1).describe("Human-readable token name, e.g., 'primary-blue', 'heading-xl'"),
  value: z.string().min(1).describe("CSS-ready value, e.g., '#3B82F6', 'Inter 24px/32px 700'"),
  usage: z.string().min(1).describe("Where this token is used"),
})

const UIComponentSchema = z.object({
  id: z.string().min(1).describe("Unique component ID, e.g., 'nav-button', 'user-card', 'search-input'"),
  type: z.string().min(1).describe("Component type, e.g., 'button', 'card', 'data-table', 'chart'"),
  variant: z.string().default("default").describe("Visual variant, e.g., 'primary', 'outlined', 'ghost'"),
  props: z.string().min(1).describe("Key props, states, slots this component needs"),
  section_id: z.string().min(1).describe("Layout section ID that contains this component"),
  notes: z.string().default("").describe("Content, behavior, constraints, styling details"),
})

const InteractionSchema = z.object({
  trigger: z.string().min(1).describe("What triggers it: hover, click, scroll, drag, focus, resize"),
  effect: z.string().min(1).describe("Visual effect: dropdown, modal, tooltip, fade, slide, collapse"),
  target_component_ids: z.array(z.string().min(1)).min(1).describe("Component IDs affected"),
  description: z.string().min(1).describe("Full description of the interaction behavior"),
})

const ResponsiveSchema = z.object({
  breakpoint: z.string().min(1).describe("Breakpoint expression, e.g., '< 768px', '768px-1024px'"),
  layout_changes: z.string().min(1).describe("What changes at this breakpoint"),
  affected_section_ids: z.array(z.string()).min(1).describe("Section IDs that change"),
})

// ---------------------------------------------------------------------------
// Tool factory
// ---------------------------------------------------------------------------

export function createDesignOutputTools() {
  let collector = emptyCollector()

  const tools = {
    register_layout_section: tool({
      description:
        "Register a layout section identified in the design. " +
        "Build the layout tree top-down: register parent sections before children. " +
        "Every visible region must be registered.",
      inputSchema: LayoutSectionSchema,
      execute: async (input) => {
        if (collector.layout.some(s => s.id === input.id)) {
          return `Error: section "${input.id}" already registered`
        }
        // Validate parent references in children
        const missingChildren = input.children.filter(
          c => !collector.layout.some(s => s.id === c),
        )
        const section: LayoutSection = {
          id: input.id,
          type: input.type,
          position: input.position,
          dimensions: input.dimensions,
          layoutMethod: input.layout_method,
          children: input.children,
          notes: input.notes,
        }
        collector.layout.push(section)
        let msg = `OK: section "${input.id}" registered (${collector.layout.length} total)`
        if (missingChildren.length > 0) {
          msg += `\nNote: children [${missingChildren.join(", ")}] not yet registered — register them next.`
        }
        return msg
      },
    }),

    register_style_token: tool({
      description:
        "Register a design token (color, typography, spacing, shadow, etc.). " +
        "Use EXACT values extracted from the visual input. " +
        "Register ALL tokens — a missed color means a wrong implementation.",
      inputSchema: StyleTokenSchema,
      execute: async (input) => {
        const token: StyleToken = {
          category: input.category,
          name: input.name,
          value: input.value,
          usage: input.usage,
        }
        collector.tokens.push(token)
        return `OK: token "${input.name}" (${input.category}) registered (${collector.tokens.length} total)`
      },
    }),

    register_component: tool({
      description:
        "Register a UI component identified in the design. " +
        "Every interactive element, content card, navigation item, form field, " +
        "and data display must be registered as a component.",
      inputSchema: UIComponentSchema,
      execute: async (input) => {
        if (collector.components.some(c => c.id === input.id)) {
          return `Error: component "${input.id}" already registered`
        }
        if (!collector.layout.some(s => s.id === input.section_id)) {
          return `Error: section_id "${input.section_id}" not registered — register the layout section first`
        }
        const component: UIComponent = {
          id: input.id,
          type: input.type,
          variant: input.variant,
          props: input.props,
          sectionId: input.section_id,
          notes: input.notes,
        }
        collector.components.push(component)
        return `OK: component "${input.id}" (${input.type}) registered (${collector.components.length} total)`
      },
    }),

    register_interaction: tool({
      description:
        "Register an interaction pattern (hover effect, click action, animation, etc.). " +
        "Include both observed and inferred interactions.",
      inputSchema: InteractionSchema,
      execute: async (input) => {
        const missing = input.target_component_ids.filter(
          id => !collector.components.some(c => c.id === id),
        )
        if (missing.length > 0) {
          return `Error: target components not registered: ${missing.join(", ")} — register components first`
        }
        const interaction: InteractionPattern = {
          trigger: input.trigger,
          effect: input.effect,
          targetComponentIds: input.target_component_ids,
          description: input.description,
        }
        collector.interactions.push(interaction)
        return `OK: interaction registered (${collector.interactions.length} total)`
      },
    }),

    register_responsive_rule: tool({
      description:
        "Register a responsive breakpoint rule. " +
        "Describe how the layout changes at each breakpoint.",
      inputSchema: ResponsiveSchema,
      execute: async (input) => {
        const missing = input.affected_section_ids.filter(
          id => !collector.layout.some(s => s.id === id),
        )
        if (missing.length > 0) {
          return `Warning: sections not registered: ${missing.join(", ")}`
        }
        const rule: ResponsiveRule = {
          breakpoint: input.breakpoint,
          layoutChanges: input.layout_changes,
          affectedSectionIds: input.affected_section_ids,
        }
        collector.responsive.push(rule)
        return `OK: responsive rule for "${input.breakpoint}" registered (${collector.responsive.length} total)`
      },
    }),

    finalize_design_analysis: tool({
      description:
        "Validate design analysis completeness and finalize. " +
        "Call AFTER registering all layout sections, tokens, components, interactions, and responsive rules.",
      inputSchema: z.object({
        summary: z.string().min(5).describe("One-line summary of the design"),
        source_type: z.enum(["image", "url", "both"]).describe("Input source type"),
        source_url: z.string().optional().describe("Source URL if applicable"),
        design_system: z.string().min(1).describe("Detected design system or style description"),
        tech_stack: z.array(z.string().min(1)).min(1).describe("Recommended tech stack: framework, CSS approach, component library"),
      }),
      execute: async (input) => {
        collector.summary = input.summary
        collector.sourceType = input.source_type
        collector.sourceUrl = input.source_url
        collector.designSystem = input.design_system
        collector.techStack = input.tech_stack

        const issues: string[] = []

        if (collector.layout.length === 0) {
          issues.push("No layout sections registered — every visible region must be a section")
        }
        if (collector.tokens.length < 3) {
          issues.push(`Only ${collector.tokens.length} style tokens — register at least colors + typography + spacing`)
        }
        if (collector.components.length === 0) {
          issues.push("No components registered — every interactive element must be a component")
        }

        // Validate layout tree integrity
        const sectionIds = new Set(collector.layout.map(s => s.id))
        for (const section of collector.layout) {
          for (const childId of section.children) {
            if (!sectionIds.has(childId)) {
              issues.push(`Layout "${section.id}" references child "${childId}" which is not registered`)
            }
          }
        }

        // Check that components reference valid sections
        for (const comp of collector.components) {
          if (!sectionIds.has(comp.sectionId)) {
            issues.push(`Component "${comp.id}" references section "${comp.sectionId}" which is not registered`)
          }
        }

        // Check color token coverage
        const colorTokens = collector.tokens.filter(t => t.category.startsWith("color-"))
        if (colorTokens.length < 2) {
          issues.push("Insufficient color tokens — register at least primary + background colors")
        }

        // Check typography coverage
        const typoTokens = collector.tokens.filter(t => t.category.startsWith("typography-"))
        if (typoTokens.length === 0) {
          issues.push("No typography tokens — register at least heading + body font specifications")
        }

        // Validate interaction → component references
        for (const inter of collector.interactions) {
          for (const cid of inter.targetComponentIds) {
            if (!collector.components.some(c => c.id === cid)) {
              issues.push(`Interaction targeting "${cid}" — component not registered`)
            }
          }
        }

        if (issues.length === 0) {
          collector.finalized = true
          const warnings: string[] = []
          if (collector.interactions.length === 0) {
            warnings.push("Note: no interactions registered — consider if hover/click/scroll behaviors should be captured.")
          }
          if (collector.responsive.length === 0) {
            warnings.push("Note: no responsive rules registered — consider if the design has mobile/tablet breakpoints.")
          }
          const result = [
            "PASS: Design analysis complete.",
            `  ${collector.layout.length} sections, ${collector.tokens.length} tokens,`,
            `  ${collector.components.length} components, ${collector.interactions.length} interactions,`,
            `  ${collector.responsive.length} responsive rules.`,
            `  Design system: ${input.design_system}`,
            `  Tech stack: ${input.tech_stack.join(", ")}`,
          ]
          if (warnings.length > 0) result.push("", ...warnings)
          return result.join("\n")
        }

        return `ISSUES (${issues.length}):\n${issues.map((i, n) => `${n + 1}. ${i}`).join("\n")}\n\nFix and call finalize_design_analysis again.`
      },
    }),
  }

  return {
    tools,
    collector,
    reset() {
      collector = emptyCollector()
      return collector
    },
    getCollector() {
      return collector
    },
  }
}

// ---------------------------------------------------------------------------
// Convert collector → DesignAnalysis
// ---------------------------------------------------------------------------

export function collectorToAnalysis(collector: DesignCollector): DesignAnalysis {
  return {
    summary: collector.summary,
    sourceType: collector.sourceType,
    sourceUrl: collector.sourceUrl,
    designSystem: collector.designSystem,
    layout: [...collector.layout],
    tokens: [...collector.tokens],
    components: [...collector.components],
    interactions: [...collector.interactions],
    responsive: [...collector.responsive],
    techStack: [...collector.techStack],
  }
}
