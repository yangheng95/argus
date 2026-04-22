/**
 * Requirements data shapes — narrow scope: REQ-N list + foundational decisions.
 *
 * The Requirements Agent no longer produces goals, metric specs, challenge
 * seeds, traceability, or cross-goal contracts. The Architect owns every
 * part of decomposition — see @/architect/types for the Architect-emitted
 * types (ArchitectChallengeSeed, ArchitectGoalMetricSpec, …).
 */

export interface ParsedRequirement {
  id: string
  type: "explicit" | "implicit"
  description: string
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
