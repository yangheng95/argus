import {
  isAbortedGoalRunStatus,
  isFailedGoalRunStatus,
  isLiveGoalRunStatus,
  isSuccessfulGoalRunStatus,
} from "./catalog"
import { findAcceptanceByGoalRun, findBuildOutcomeByGoalRun, listGoalRunsByGoal, type GoalRunRow } from "./store"

export type GoalEvidenceLifecycle = "not_started" | "running" | "completed" | "failed" | "aborted" | "cancelled"
export type GoalEvidenceStatus = "satisfied" | "unsatisfied" | "blocked" | "failed"

export type GoalEvidenceState = {
  goal_id: string
  lifecycle: GoalEvidenceLifecycle
  evidence_status: GoalEvidenceStatus
  dependency_ready: boolean
  evidence_refs: string[]
  missing_evidence: string[]
  reason: string
  goal_run_id?: string
}

function goalRunTip(rows: GoalRunRow[]): GoalRunRow | undefined {
  if (rows.length === 0) return undefined
  const supersededIDs = new Set(rows.map((row) => row.supersede_of).filter((id): id is string => !!id))
  return rows.find((row) => !supersededIDs.has(row.id))
}

function manualCompletionReason(row: GoalRunRow): string | undefined {
  const metadata = row.metadata
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined
  const manual = (metadata as Record<string, unknown>).manual_completion
  if (!manual || typeof manual !== "object" || Array.isArray(manual)) return undefined
  const reason = (manual as Record<string, unknown>).reason
  return typeof reason === "string" && reason.trim().length > 0 ? reason.trim() : undefined
}

function lifecycleForGoalRun(row: GoalRunRow): GoalEvidenceLifecycle {
  if (isLiveGoalRunStatus(row.status)) return "running"
  if (isSuccessfulGoalRunStatus(row.status)) return "completed"
  if (isFailedGoalRunStatus(row.status)) return "failed"
  if (isAbortedGoalRunStatus(row.status)) return "aborted"
  return "cancelled"
}

export function deriveGoalEvidenceState(goalID: string): GoalEvidenceState {
  const rows = listGoalRunsByGoal(goalID)
  const tip = goalRunTip(rows)
  if (!tip) {
    return {
      goal_id: goalID,
      lifecycle: "not_started",
      evidence_status: "unsatisfied",
      dependency_ready: false,
      evidence_refs: [],
      missing_evidence: ["goal_run_attempt"],
      reason: "not_started(no goal_run_attempt evidence)",
    }
  }

  const lifecycle = lifecycleForGoalRun(tip)
  if (tip.superseded_reason) {
    return {
      goal_id: goalID,
      goal_run_id: tip.id,
      lifecycle,
      evidence_status: "unsatisfied",
      dependency_ready: false,
      evidence_refs: [],
      missing_evidence: ["replacement_goal_run_evidence"],
      reason: `needs_redispatch(${tip.superseded_reason}; lifecycle=${lifecycle})`,
    }
  }

  if (lifecycle === "running") {
    return {
      goal_id: goalID,
      goal_run_id: tip.id,
      lifecycle,
      evidence_status: "blocked",
      dependency_ready: false,
      evidence_refs: [`goal_run_attempt:${tip.id}`],
      missing_evidence: ["terminal_goal_evidence"],
      reason: `running(goal_run=${tip.id})`,
    }
  }

  if (lifecycle === "failed" || lifecycle === "aborted" || lifecycle === "cancelled") {
    const detail = tip.error ?? tip.blocking_reason ?? tip.status
    return {
      goal_id: goalID,
      goal_run_id: tip.id,
      lifecycle,
      evidence_status: "failed",
      dependency_ready: false,
      evidence_refs: [`goal_run_attempt:${tip.id}`],
      missing_evidence: ["successful_goal_evidence"],
      reason: `${lifecycle}(${detail})`,
    }
  }

  const manualReason = manualCompletionReason(tip)
  if (manualReason) {
    return {
      goal_id: goalID,
      goal_run_id: tip.id,
      lifecycle,
      evidence_status: "satisfied",
      dependency_ready: true,
      evidence_refs: [`goal_run_attempt:${tip.id}:manual_completion`],
      missing_evidence: [],
      reason: `manual_completion(${manualReason})`,
    }
  }

  const buildOutcome = findBuildOutcomeByGoalRun(tip.id)
  if (!buildOutcome) {
    return {
      goal_id: goalID,
      goal_run_id: tip.id,
      lifecycle,
      evidence_status: "unsatisfied",
      dependency_ready: false,
      evidence_refs: [`goal_run_attempt:${tip.id}`],
      missing_evidence: ["build_attempt_outcome_or_manual_evidence"],
      reason: `evidence_unsatisfied(missing goal-scoped delivery evidence; lifecycle=${lifecycle})`,
    }
  }

  if (buildOutcome.evidence_contract_status !== "satisfied") {
    const detail = buildOutcome.no_diff_reason ?? buildOutcome.error ?? "goal_scoped_delivery_evidence_missing"
    return {
      goal_id: goalID,
      goal_run_id: tip.id,
      lifecycle,
      evidence_status: buildOutcome.evidence_contract_status === "failed" ? "failed" : "unsatisfied",
      dependency_ready: false,
      evidence_refs: [`goal_run_attempt:${tip.id}`, `build_attempt_outcome:${buildOutcome.id}`],
      missing_evidence: ["satisfying_delivery_evidence"],
      reason: `evidence_unsatisfied(${buildOutcome.outcome_kind}(${detail}); lifecycle=${lifecycle})`,
    }
  }

  if (buildOutcome.outcome_kind !== "delivered") {
    const evidenceRefs =
      buildOutcome.delivery_evidence_refs.length > 0
        ? buildOutcome.delivery_evidence_refs
        : [`build_attempt_outcome:${buildOutcome.id}`]
    return {
      goal_id: goalID,
      goal_run_id: tip.id,
      lifecycle,
      evidence_status: "satisfied",
      dependency_ready: true,
      evidence_refs: [`goal_run_attempt:${tip.id}`, ...evidenceRefs],
      missing_evidence: [],
      reason: `build_report_evidence(${buildOutcome.outcome_kind}; build_attempt_outcome=${buildOutcome.id})`,
    }
  }

  const acceptance = findAcceptanceByGoalRun(tip.id)
  if (!acceptance) {
    return {
      goal_id: goalID,
      goal_run_id: tip.id,
      lifecycle,
      evidence_status: "unsatisfied",
      dependency_ready: false,
      evidence_refs: [`goal_run_attempt:${tip.id}`, `build_attempt_outcome:${buildOutcome.id}`],
      missing_evidence: ["acceptance"],
      reason: `evidence_unsatisfied(delivered build outcome without acceptance artifact; lifecycle=${lifecycle})`,
    }
  }

  return {
    goal_id: goalID,
    goal_run_id: tip.id,
    lifecycle,
    evidence_status: "satisfied",
    dependency_ready: true,
    evidence_refs: [`goal_run_attempt:${tip.id}`, `build_attempt_outcome:${buildOutcome.id}`, `acceptance:${acceptance.id}`],
    missing_evidence: [],
    reason: `delivered(build_attempt_outcome=${buildOutcome.id}; acceptance=${acceptance.id})`,
  }
}

export function renderGoalEvidenceStateForDependency(state: GoalEvidenceState): string {
  if (state.dependency_ready) return `evidence_satisfied(${state.reason})`
  return `${state.evidence_status}(${state.reason})`
}
