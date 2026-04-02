/**
 * Plan quality validation — configurable scoring.
 *
 * Extracted from planner/agent.ts to make the scoring weights tunable
 * and testable in isolation.
 */

import type { PlannerOutputType } from "./agent"

// ---------------------------------------------------------------------------
// Scoring configuration (single source of truth for all magic numbers)
// ---------------------------------------------------------------------------

export interface QualityConfig {
  /** Minimum tool calls for full exploration credit */
  toolCallsDeep: number
  /** Minimum tool calls for partial exploration credit */
  toolCallsMin: number
  /** Minimum new file paths in PRD for full discovery credit */
  newPathsDeep: number
  /** Minimum PRD length (chars) for detail credit */
  prdMinLength: number
  /** Score threshold below which a retry is triggered */
  retryThreshold: number
  /** Weights for each scoring dimension (must sum to ≤ 1.0) */
  weights: {
    toolCalls: number
    toolCallsPartial: number
    filePaths: number
    filePathsPartial: number
    goalCriteria: number
    subtaskPaths: number
    prdLength: number
  }
}

export const DEFAULT_QUALITY_CONFIG: QualityConfig = {
  toolCallsDeep: 5,
  toolCallsMin: 2,
  newPathsDeep: 2,
  prdMinLength: 300,
  retryThreshold: 0.5,
  weights: {
    toolCalls: 0.3,
    toolCallsPartial: 0.15,
    filePaths: 0.25,
    filePathsPartial: 0.12,
    goalCriteria: 0.2,
    subtaskPaths: 0.15,
    prdLength: 0.1,
  },
}

// ---------------------------------------------------------------------------
// Patterns
// ---------------------------------------------------------------------------

/** Matches file paths in PRD/subtask text */
const FILE_PAT = /(?:[a-zA-Z_@][\w@-]*\/)+[\w.-]+\.(?:ts|tsx|js|jsx|py|rs|go|java|json|yaml|yml|toml|css|html|sql)/g

/** Matches command-like criteria in goal text */
const CMD_PAT = /`[^`]+`|bun |tsc |npm |npx |bunx |eslint |jest /i

// ---------------------------------------------------------------------------
// Scoring function
// ---------------------------------------------------------------------------

export function validatePlanQuality(
  plan: PlannerOutputType,
  request: string,
  toolCallCount: number,
  config: QualityConfig = DEFAULT_QUALITY_CONFIG,
): { score: number; reasons: string[] } {
  let score = 0
  const reasons: string[] = []
  const w = config.weights

  // 1. Tool call count — did the agent actually explore?
  if (toolCallCount >= config.toolCallsDeep) {
    score += w.toolCalls
  } else if (toolCallCount >= config.toolCallsMin) {
    score += w.toolCallsPartial
    reasons.push(`only ${toolCallCount} tool calls (need ≥${config.toolCallsDeep} for deep exploration)`)
  } else {
    reasons.push(`${toolCallCount} tool calls — no codebase exploration`)
  }

  // 2. PRD contains file paths not present in the request
  const requestPaths = new Set(Array.from(request.matchAll(FILE_PAT)).map((m) => m[0]))
  const prdPaths = new Set(Array.from(plan.prd.matchAll(FILE_PAT)).map((m) => m[0]))
  const newPaths = [...prdPaths].filter((p) => !requestPaths.has(p))
  if (newPaths.length >= config.newPathsDeep) {
    score += w.filePaths
  } else if (newPaths.length === 1) {
    score += w.filePathsPartial
    reasons.push("PRD has only 1 file path beyond the request")
  } else {
    reasons.push("PRD contains no file paths discovered from exploration")
  }

  // 3. Goals have concrete criteria (contain command-like patterns)
  const goalsWithCriteria = plan.goals.filter((g) => CMD_PAT.test(g.criteria))
  if (goalsWithCriteria.length >= plan.goals.length * 0.5 && plan.goals.length > 0) {
    score += w.goalCriteria
  } else {
    reasons.push("goals lack concrete/executable criteria")
  }

  // 4. Subtasks reference specific file paths
  const subtaskText = plan.subtasks.map((s) => `${s.title} ${s.description}`).join(" ")
  const subtaskPaths = Array.from(subtaskText.matchAll(FILE_PAT))
  if (subtaskPaths.length >= 2) {
    score += w.subtaskPaths
  } else {
    reasons.push("subtasks don't reference specific file paths")
  }

  // 5. PRD length — detailed specs are longer
  if (plan.prd.length >= config.prdMinLength) {
    score += w.prdLength
  } else {
    reasons.push(`PRD too short (${plan.prd.length} chars)`)
  }

  return { score: Math.min(1, score), reasons }
}
