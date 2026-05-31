/**
 * Frontend Design & Replica Agent — output type.
 *
 * A VisualSpec is a visual-contract row extracted from visual references.
 * It is NOT an AcceptanceSpec — no deterministic scorer runs at registration
 * time. The integrity acceptance reviewer reads the list during visual review and may
 * cite a spec id in `rejection_details.visual_spec_id` when a rejection traces
 * back to a violated constraint. That's the enforcement model: delivery
 * verifies the contract from rendered evidence.
 *
 * Kept deliberately flat and free-form on the value side (`requirement`,
 * `applies_to`) so a single type covers colors, typography, spacing,
 * layout, component roles, interactions, responsive rules without per-
 * category schema branching. The tool surface (output-tools.ts) splits
 * registration into seven category-specific tools so the LLM is forced
 * to name the category and fill category-appropriate fields — the
 * persisted row stays uniform.
 */
import z from "zod"

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
  requirement: z.string().min(1).describe("Concrete constraint value — '#3B82F6', 'Inter 700 24px/32px', '64px header height'"),
  applies_to: z.string().min(1).describe("Target description — component id, CSS selector, section reference"),
  severity: VisualSpecSeverity,
  rationale: z.string().optional().describe("Why this matters (only if non-obvious from the constraint itself)"),
})
export type VisualSpec = z.infer<typeof VisualSpecSchema>
