/**
 * Shared spec-related type definitions.
 *
 * Migrated from spec/agent.ts so that planner and persist can use these types
 * without depending on the legacy Spec Agent implementation.
 */
import z from "zod"

export const Clarification = z.object({
  reason: z.string(),
  questions: z.array(
    z.object({
      header: z.string(),
      question: z.string(),
      context: z.string().optional(),
      default_assumption: z.string().optional(),
    }),
  ),
})
export type ClarificationResult = z.infer<typeof Clarification>

export const RequirementSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  acceptance: z.array(z.string()).default([]),
  evidence_refs: z.array(z.string()).default([]),
  non_goals: z.array(z.string()).optional(),
  priority: z.enum(["blocking", "advisory"]).optional(),
  check_selector: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
})
export type Requirement = z.infer<typeof RequirementSchema>

export const ArchitecturalLayerSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  depends_on: z.array(z.string()).default([]),
  kind: z.enum(["bootstrap", "feature", "verification", "integration", "system"]).optional(),
  is_verification: z.boolean().optional(),
})
export type ArchitecturalLayer = z.infer<typeof ArchitecturalLayerSchema>

export const SpecDraftSchema = z.object({
  summary: z.string(),
  content: z.string(),
  assumptions: z.array(
    z.object({
      question: z.string(),
      assumption: z.string(),
    }),
  ).default([]),
  risks: z.array(z.string()).default([]),
  evidence_sources: z.array(z.string()).default([]),
  unresolved_questions: z.array(z.string()).default([]),
  requirements: z.array(RequirementSchema).optional(),
  architectural_layers: z.array(ArchitecturalLayerSchema).optional(),
  clarifications: Clarification.shape.questions.optional(),
})
export type SpecDraft = z.infer<typeof SpecDraftSchema>

export const SpecItemSchema = z.object({
  title: z.string().describe("Short title of the spec item"),
  description: z.string().describe("Detailed description of what must be implemented"),
  check_selector: z.array(z.string()).optional().describe("Which checks validate this item"),
  priority: z.enum(["blocking", "advisory"]).default("blocking"),
})
export type SpecItem = z.infer<typeof SpecItemSchema>

export const SpecOutput = z.object({
  summary: z.string(),
  content: z.string(),
  scope: z.string(),
  out_of_scope: z.string().optional(),
  spec_items: z.array(SpecItemSchema),
  assumptions: z.array(z.object({ question: z.string(), assumption: z.string() })).default([]),
  risks: z.array(z.string()).default([]),
  evidence_sources: z.array(z.string()).default([]),
  unresolved_questions: z.array(z.string()).default([]),
  clarifications: z.array(z.object({
    header: z.string(),
    question: z.string(),
    context: z.string().optional(),
    default_assumption: z.string().optional(),
  })).optional(),
})
export type SpecOutputType = z.infer<typeof SpecOutput>
