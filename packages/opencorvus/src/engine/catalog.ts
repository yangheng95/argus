import type { EngineGoalRunStatus, EngineRunStatus } from "./engine.sql"

/**
 * Goal-run liveness classification.
 *
 * Three-way split because "in flight" and "terminal-successful" need
 * *different* handling from three call sites that historically shared the
 * same boolean and deadlocked each other:
 *
 *   - **live**    — in flight. The outer task loop waits while any goal_run
 *                   is live so decision turns do not race executors that are
 *                   still writing state.
 *   - **terminal**— succeeded and done. Dispatch-dedup uses this (the
 *                   agent shouldn't redispatch a goal whose run completed)
 *                   but the loop must NOT wait on it — the agent has to wake
 *                   up and decide to `deliver` or keep going.
 *   - **retriable**— failed / aborted. Terminal, but a fresh dispatch is
 *                   allowed.
 *
 * Prior collapse: `completed.liveness = "live"` conflated #1 and #2, so
 * the loop wait stayed clamped after every successful goal and the TaskAgent
 * never woke up to call `deliver`. That's the stall the
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

const GOAL_RUN_STATUS_CATALOG = {
  queued: { liveness: "live", satisfiesGoal: false, resettable: true },
  accepted: { liveness: "live", satisfiesGoal: false, resettable: true },
  planning: { liveness: "live", satisfiesGoal: false, resettable: true },
  running: { liveness: "live", satisfiesGoal: false, resettable: true },
  evaluating: { liveness: "live", satisfiesGoal: false, resettable: true },
  blocked: { liveness: "live", satisfiesGoal: false, resettable: true },
  // `completed` is truly terminal: the goal_run succeeded under its contract
  // and its verification evidence is load-bearing for acceptance replay + the
  // overlay timeline. Retry under a new contract or graph repair must create
  // a NEW goal_run and supersede
  // the old one via metadata — never mutate the completed row into aborted,
  // which erases the success record and reverts parent goal.status.
  completed: { liveness: "terminal", satisfiesGoal: true, resettable: false },
  failed: { liveness: "retriable", satisfiesGoal: false, resettable: false },
  aborted: { liveness: "retriable", satisfiesGoal: false, resettable: false },
} as const satisfies Record<EngineGoalRunStatus, GoalRunStatusMeta>

const RUN_STATUS_CATALOG = {
  queued: { live: true, dispatchable: false },
  accepted: { live: true, dispatchable: true },
  running: { live: true, dispatchable: true },
  blocked: { live: true, dispatchable: true },
  completed: { live: false, dispatchable: false },
  failed: { live: false, dispatchable: false },
  aborted: { live: false, dispatchable: false },
} as const satisfies Record<EngineRunStatus, RunStatusMeta>

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

export const LIVE_GOAL_RUN_STATUSES = goalRunStatusesWhere((meta) => meta.liveness === "live")
export const ACTIVE_GOAL_RUN_STATUSES = LIVE_GOAL_RUN_STATUSES.filter(
  (status) => status !== "queued",
) as EngineGoalRunStatus[]
export const GOAL_RUN_RESETTABLE_STATUSES = goalRunStatusesWhere((meta) => meta.resettable)

export const LIVE_RUN_STATUSES = runStatusesWhere((meta) => meta.live)
export const DISPATCHABLE_RUN_STATUSES = runStatusesWhere((meta) => meta.dispatchable)
export const EXECUTOR_ACTIVE_RUN_STATUSES = ["accepted", "running"] as const satisfies readonly EngineRunStatus[]

export function isLiveGoalRunStatus(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].liveness === "live"
}

export function doesGoalRunSatisfyGoal(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].satisfiesGoal
}

export function isLiveRunStatus(status?: EngineRunStatus | null): status is EngineRunStatus {
  return !!status && RUN_STATUS_CATALOG[status].live
}

export function isDispatchableRunStatus(status?: EngineRunStatus | null): status is EngineRunStatus {
  return !!status && RUN_STATUS_CATALOG[status].dispatchable
}
