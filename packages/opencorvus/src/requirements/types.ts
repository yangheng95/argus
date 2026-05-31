/**
 * Requirements data shapes — narrow scope: REQ-N list + foundational decisions.
 *
 * The Requirements Agent no longer produces goals, traceability, fidelity
 * coverage, assembly ownership, or cross-goal contracts. The Architect owns
 * decomposition — see @/architect/types for the Architect-emitted types.
 */

export interface ParsedRequirement {
  id: string
  type: "explicit" | "implicit"
  description: string
  acceptance: string
  non_goals: string
  evidence_refs: string[]
}

export interface RequirementsDecision {
  key: string
  value: string
  reason: string
}

export interface RequirementsOutput {
  summary: string
  requirements: ParsedRequirement[]
  decisions: RequirementsDecision[]
}
