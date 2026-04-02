/**
 * Shared planner type definitions.
 *
 * Migrated from planner/agent.ts and planner/service.ts so that persist,
 * orchestrator service, and route handlers can use these types without
 * depending on the full planner agent implementation.
 */
import PLAN_CORE from "@/prompt/core/plan-core.txt"

// ---------------------------------------------------------------------------
// Replan context — structured failure information from the evaluator agent
// ---------------------------------------------------------------------------

export interface WaveStatus {
  title: string
  waveIndex: number
  status: "passed" | "failed" | "partial" | "pending"
  goals: Array<{
    description: string
    status: string
  }>
}

export interface ReplanContext {
  previousSummary: string
  failureAnalysis: {
    classification: string
    summary: string
    rootCause: string
    suggestedStrategy: string
    avoidApproaches: string[]
  }
  previousGoalStatuses: Array<{
    description: string
    status: string
    evidence: string
    requirement_ids?: string[]
  }>
  failedRequirements?: Array<{
    id: string
    title: string
    reason: string
  }>
  previousWaves?: WaveStatus[]
}

// ---------------------------------------------------------------------------
// PlannerFailureError
// ---------------------------------------------------------------------------

export class PlannerFailureError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = "PlannerFailureError"
  }
}

// ---------------------------------------------------------------------------
// Planner system prompt constant
// ---------------------------------------------------------------------------

/** Full default planner system prompt. Exported for catalog. */
export const PLANNER_SYSTEM_DEFAULT = PLAN_CORE
