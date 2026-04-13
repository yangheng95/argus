/**
 * Decompose data shapes — canonical types shared by the agent and its
 * structured tool collector.
 *
 * These were previously co-located with a YAML-like text parser in
 * `decompose/parse.ts`. The parser has been removed (Zod tool calls are now
 * the only path); the types live here so multiple modules can import the
 * shape without dragging in dead parsing code.
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

export interface ParsedGoalContract {
  id: string
  title: string
  objective: string
  done_definition: string
  owned_paths: string[]
  depends_on: string[]
  exports: string[]
  imports: string[]
  priority: "blocking" | "advisory"
  kind: string
  requirement_ids: string[]
  source: "explicit" | "implicit"
}

export interface TraceabilityEntry {
  requirementID: string
  goalIDs: string[]
}

export interface RequirementsOutput {
  summary: string
  requirements: ParsedRequirement[]
  decisions: RequirementsDecision[]
  goals: ParsedGoalContract[]
  traceability: TraceabilityEntry[]
}
