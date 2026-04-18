import type { EngineExecutorSessionStatus, EngineGoalRunStatus, EngineRunStatus } from "./engine.sql"

/**
 * Goal-run liveness classification.
 *
 * Three-way split because "in flight" and "terminal-successful" need
 * *different* handling from three call sites that historically shared the
 * same boolean and deadlocked each other:
 *
 *   - **live**    — in flight. Orchestrator dispatch gate suppresses the
 *                   TaskAgent while any goal_run is live so the agent can't
 *                   race with an executor that's still writing state.
 *   - **terminal**— succeeded and done. Dispatch-dedup uses this (the
 *                   agent shouldn't redispatch a goal whose run completed)
 *                   but the dispatch gate must NOT wait on it — the agent
 *                   has to wake up and decide to `deliver` or keep going.
 *   - **retriable**— failed / aborted. Terminal, but a fresh dispatch is
 *                   allowed.
 *
 * Prior collapse: `completed.liveness = "live"` conflated #1 and #2, so
 * the dispatch gate stayed clamped after every successful goal and the
 * TaskAgent never woke up to call `deliver`. That's the stall the
 * overlay benchmark hit at iteration 2..26 before timing out.
 */
type GoalRunStatusMeta = {
  liveness: "live" | "terminal" | "retriable"
  satisfiesGoal: boolean
  resettable: boolean
}

type RunStatusMeta = {
  live: boolean
  dispatchable: boolean
}

type ExecutorSessionStatusMeta = {
  live: boolean
}

export const GOAL_RUN_STATUS_CATALOG = {
  queued: { liveness: "live", satisfiesGoal: false, resettable: true },
  accepted: { liveness: "live", satisfiesGoal: false, resettable: true },
  planning: { liveness: "live", satisfiesGoal: false, resettable: true },
  running: { liveness: "live", satisfiesGoal: false, resettable: true },
  evaluating: { liveness: "live", satisfiesGoal: false, resettable: true },
  blocked: { liveness: "live", satisfiesGoal: false, resettable: true },
  completed: { liveness: "terminal", satisfiesGoal: true, resettable: true },
  failed: { liveness: "retriable", satisfiesGoal: false, resettable: false },
  aborted: { liveness: "retriable", satisfiesGoal: false, resettable: false },
} as const satisfies Record<EngineGoalRunStatus, GoalRunStatusMeta>

export const RUN_STATUS_CATALOG = {
  queued: { live: true, dispatchable: false },
  accepted: { live: true, dispatchable: true },
  running: { live: true, dispatchable: true },
  blocked: { live: true, dispatchable: true },
  completed: { live: false, dispatchable: false },
  failed: { live: false, dispatchable: false },
  aborted: { live: false, dispatchable: false },
} as const satisfies Record<EngineRunStatus, RunStatusMeta>

export const EXECUTOR_SESSION_STATUS_CATALOG = {
  active: { live: true },
  completed: { live: false },
  failed: { live: false },
  aborted: { live: false },
} as const satisfies Record<EngineExecutorSessionStatus, ExecutorSessionStatusMeta>

function goalRunStatusesWhere(predicate: (meta: GoalRunStatusMeta) => boolean): EngineGoalRunStatus[] {
  return (Object.entries(GOAL_RUN_STATUS_CATALOG) as Array<[EngineGoalRunStatus, GoalRunStatusMeta]>)
    .filter(([, meta]) => predicate(meta))
    .map(([status]) => status)
}

function runStatusesWhere(predicate: (meta: RunStatusMeta) => boolean): EngineRunStatus[] {
  return (Object.entries(RUN_STATUS_CATALOG) as Array<[EngineRunStatus, RunStatusMeta]>)
    .filter(([, meta]) => predicate(meta))
    .map(([status]) => status)
}

function executorSessionStatusesWhere(
  predicate: (meta: ExecutorSessionStatusMeta) => boolean,
): EngineExecutorSessionStatus[] {
  return (Object.entries(EXECUTOR_SESSION_STATUS_CATALOG) as Array<[EngineExecutorSessionStatus, ExecutorSessionStatusMeta]>)
    .filter(([, meta]) => predicate(meta))
    .map(([status]) => status)
}

export const LIVE_GOAL_RUN_STATUSES = goalRunStatusesWhere((meta) => meta.liveness === "live")
export const RETRIABLE_GOAL_RUN_STATUSES = goalRunStatusesWhere((meta) => meta.liveness === "retriable")
export const GOAL_RUN_RESETTABLE_STATUSES = goalRunStatusesWhere((meta) => meta.resettable)
export const GOAL_RUN_SUCCESS_STATUSES = goalRunStatusesWhere((meta) => meta.satisfiesGoal)

export const LIVE_RUN_STATUSES = runStatusesWhere((meta) => meta.live)
export const DISPATCHABLE_RUN_STATUSES = runStatusesWhere((meta) => meta.dispatchable)
export const EXECUTOR_ACTIVE_RUN_STATUSES = ["accepted", "running"] as const satisfies readonly EngineRunStatus[]
export const RUNTIME_MONITORED_RUN_STATUSES = ["accepted", "running", "blocked", "completed"] as const satisfies readonly EngineRunStatus[]
export const LIVE_EXECUTOR_SESSION_STATUSES = executorSessionStatusesWhere((meta) => meta.live)

export function isLiveGoalRunStatus(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].liveness === "live"
}

export function isRetriableGoalRunStatus(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].liveness === "retriable"
}

export function doesGoalRunSatisfyGoal(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].satisfiesGoal
}

export function isResettableGoalRunStatus(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].resettable
}

export function isLiveRunStatus(status?: EngineRunStatus | null): status is EngineRunStatus {
  return !!status && RUN_STATUS_CATALOG[status].live
}

export function isDispatchableRunStatus(status?: EngineRunStatus | null): status is EngineRunStatus {
  return !!status && RUN_STATUS_CATALOG[status].dispatchable
}

export function isLiveExecutorSessionStatus(
  status?: EngineExecutorSessionStatus | null,
): status is EngineExecutorSessionStatus {
  return !!status && EXECUTOR_SESSION_STATUS_CATALOG[status].live
}
