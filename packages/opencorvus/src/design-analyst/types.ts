/**
 * Design Analyst Agent — types and schemas.
 *
 * Structured output types for layout/style analysis. Each type corresponds
 * to a registration tool call in output-tools.ts.
 */

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

export interface LayoutSection {
  /** Unique ID within the analysis, e.g., "header", "sidebar-left", "hero" */
  id: string
  /** Semantic type of the section */
  type:
    | "header"
    | "nav"
    | "sidebar"
    | "hero"
    | "content"
    | "card-grid"
    | "list"
    | "form"
    | "footer"
    | "modal"
    | "toolbar"
    | "panel"
    | "custom"
  /** Position description, e.g., "top fixed", "left 280px", "center below hero" */
  position: string
  /** Sizing description, e.g., "full-width 64px height", "280px width 100vh" */
  dimensions: string
  /** Layout method used: flex, grid, absolute, fixed, sticky */
  layoutMethod: "flex" | "grid" | "absolute" | "fixed" | "sticky" | "flow"
  /** Child section IDs (nested layout tree) */
  children: string[]
  /** Free-form notes about this section */
  notes: string
}

// ---------------------------------------------------------------------------
// Style tokens
// ---------------------------------------------------------------------------

export interface StyleToken {
  /** Token category */
  category:
    | "color-primary"
    | "color-secondary"
    | "color-accent"
    | "color-background"
    | "color-surface"
    | "color-text"
    | "color-border"
    | "color-error"
    | "color-success"
    | "color-warning"
    | "typography-heading"
    | "typography-body"
    | "typography-mono"
    | "typography-caption"
    | "spacing"
    | "border-radius"
    | "shadow"
    | "transition"
  /** Human-readable name, e.g., "primary-blue", "heading-xl", "card-shadow" */
  name: string
  /** CSS-ready value, e.g., "#3B82F6", "Inter 24px/32px 700", "0 4px 6px rgba(0,0,0,.1)" */
  value: string
  /** Where this token is used in the layout */
  usage: string
}

// ---------------------------------------------------------------------------
// UI components
// ---------------------------------------------------------------------------

export interface UIComponent {
  /** Unique ID within the analysis */
  id: string
  /** Component type — maps to a real UI primitive or composite */
  type: string
  /** Visual variant, e.g., "primary", "outlined", "ghost", "filled" */
  variant: string
  /** Key props, states, and slots this component exposes */
  props: string
  /** Which layout section contains this component */
  sectionId: string
  /** Implementation notes (content, behavior, constraints) */
  notes: string
}

// ---------------------------------------------------------------------------
// Interaction patterns
// ---------------------------------------------------------------------------

export interface InteractionPattern {
  /** What triggers the interaction: hover, click, scroll, drag, focus, resize */
  trigger: string
  /** Visual effect: dropdown, modal, tooltip, transition, animation, collapse */
  effect: string
  /** Which component(s) are affected */
  targetComponentIds: string[]
  /** Detailed description of the interaction */
  description: string
}

// ---------------------------------------------------------------------------
// Responsive rules
// ---------------------------------------------------------------------------

export interface ResponsiveRule {
  /** Breakpoint expression, e.g., "< 768px", "768px–1024px", "> 1280px" */
  breakpoint: string
  /** What changes at this breakpoint */
  layoutChanges: string
  /** Which sections are affected */
  affectedSectionIds: string[]
}

// ---------------------------------------------------------------------------
// Complete analysis result
// ---------------------------------------------------------------------------

export interface DesignAnalysis {
  /** One-line summary of the design */
  summary: string
  /** Input source type */
  sourceType: "image" | "url" | "both"
  /** Source URL if applicable */
  sourceUrl?: string
  /** Detected overall design style / system */
  designSystem: string
  /** Layout tree */
  layout: LayoutSection[]
  /** Visual design tokens */
  tokens: StyleToken[]
  /** Identified UI components */
  components: UIComponent[]
  /** Interaction/animation patterns */
  interactions: InteractionPattern[]
  /** Responsive breakpoint rules */
  responsive: ResponsiveRule[]
  /** Technical implementation recommendations */
  techStack: string[]
}
