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
  goalProjection: "pending" | "running" | "passed" | "failed"
  workflowProjection: "pending" | "running" | "completed" | "failed" | "aborted"
  terminalKind: "success" | "failure" | "aborted" | null
  activeExecution: boolean
  startedAtImplied: boolean
  satisfiesGoal: boolean
  resettable: boolean
}

type RunStatusMeta = {
  live: boolean
  dispatchable: boolean
  terminal: boolean
  startedAtImplied: boolean
  executorActive: boolean
}

const GOAL_RUN_STATUS_CATALOG = {
  queued: {
    liveness: "live",
    goalProjection: "pending",
    workflowProjection: "pending",
    terminalKind: null,
    activeExecution: false,
    startedAtImplied: false,
    satisfiesGoal: false,
    resettable: true,
  },
  accepted: {
    liveness: "live",
    goalProjection: "pending",
    workflowProjection: "pending",
    terminalKind: null,
    activeExecution: true,
    startedAtImplied: true,
    satisfiesGoal: false,
    resettable: true,
  },
  planning: {
    liveness: "live",
    goalProjection: "pending",
    workflowProjection: "pending",
    terminalKind: null,
    activeExecution: true,
    startedAtImplied: true,
    satisfiesGoal: false,
    resettable: true,
  },
  running: {
    liveness: "live",
    goalProjection: "running",
    workflowProjection: "running",
    terminalKind: null,
    activeExecution: true,
    startedAtImplied: true,
    satisfiesGoal: false,
    resettable: true,
  },
  evaluating: {
    liveness: "live",
    goalProjection: "running",
    workflowProjection: "running",
    terminalKind: null,
    activeExecution: true,
    startedAtImplied: true,
    satisfiesGoal: false,
    resettable: true,
  },
  blocked: {
    liveness: "live",
    goalProjection: "running",
    workflowProjection: "running",
    terminalKind: null,
    activeExecution: true,
    startedAtImplied: true,
    satisfiesGoal: false,
    resettable: true,
  },
  // `completed` is truly terminal: the goal_run succeeded under its contract
  // and its verification evidence is load-bearing for acceptance replay + the
  // overlay timeline. Retry under a new contract or graph repair must create
  // a NEW goal_run and supersede
  // the old one via metadata — never mutate the completed row into aborted,
  // which erases the success record and reverts parent goal.status.
  completed: {
    liveness: "terminal",
    goalProjection: "passed",
    workflowProjection: "completed",
    terminalKind: "success",
    activeExecution: false,
    startedAtImplied: true,
    satisfiesGoal: true,
    resettable: false,
  },
  failed: {
    liveness: "retriable",
    goalProjection: "failed",
    workflowProjection: "failed",
    terminalKind: "failure",
    activeExecution: false,
    startedAtImplied: false,
    satisfiesGoal: false,
    resettable: false,
  },
  aborted: {
    liveness: "retriable",
    goalProjection: "failed",
    workflowProjection: "aborted",
    terminalKind: "aborted",
    activeExecution: false,
    startedAtImplied: false,
    satisfiesGoal: false,
    resettable: false,
  },
} as const satisfies Record<EngineGoalRunStatus, GoalRunStatusMeta>

const RUN_STATUS_CATALOG = {
  queued: { live: true, dispatchable: false, terminal: false, startedAtImplied: false, executorActive: true },
  accepted: { live: true, dispatchable: true, terminal: false, startedAtImplied: true, executorActive: true },
  running: { live: true, dispatchable: true, terminal: false, startedAtImplied: true, executorActive: true },
  blocked: { live: true, dispatchable: true, terminal: false, startedAtImplied: true, executorActive: true },
  completed: { live: false, dispatchable: false, terminal: true, startedAtImplied: true, executorActive: false },
  failed: { live: false, dispatchable: false, terminal: true, startedAtImplied: false, executorActive: false },
  aborted: { live: false, dispatchable: false, terminal: true, startedAtImplied: false, executorActive: false },
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
export const ACTIVE_GOAL_RUN_STATUSES = goalRunStatusesWhere((meta) => meta.activeExecution)
export const GOAL_RUN_RESETTABLE_STATUSES = goalRunStatusesWhere((meta) => meta.resettable)

export const LIVE_RUN_STATUSES = runStatusesWhere((meta) => meta.live)
export const DISPATCHABLE_RUN_STATUSES = runStatusesWhere((meta) => meta.dispatchable)
export const EXECUTOR_ACTIVE_RUN_STATUSES = runStatusesWhere((meta) => meta.executorActive)

export function isGoalRunStatus(status: unknown): status is EngineGoalRunStatus {
  return typeof status === "string" && Object.prototype.hasOwnProperty.call(GOAL_RUN_STATUS_CATALOG, status)
}

export function isRunStatus(status: unknown): status is EngineRunStatus {
  return typeof status === "string" && Object.prototype.hasOwnProperty.call(RUN_STATUS_CATALOG, status)
}

export function isLiveGoalRunStatus(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].liveness === "live"
}

export function isActiveGoalRunStatus(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].activeExecution
}

export function isResettableGoalRunStatus(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].resettable
}

export function isTerminalGoalRunStatus(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].terminalKind !== null
}

export function isSuccessfulGoalRunStatus(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].terminalKind === "success"
}

export function isFailedGoalRunStatus(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].terminalKind === "failure"
}

export function isAbortedGoalRunStatus(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].terminalKind === "aborted"
}

export function doesGoalRunStatusImplyStarted(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].startedAtImplied
}

export function doesGoalRunSatisfyGoal(status?: EngineGoalRunStatus | null): status is EngineGoalRunStatus {
  return !!status && GOAL_RUN_STATUS_CATALOG[status].satisfiesGoal
}

export function goalRunGoalProjectionStatus(status?: EngineGoalRunStatus | null) {
  return status ? GOAL_RUN_STATUS_CATALOG[status].goalProjection : undefined
}

export function goalRunWorkflowProjectionStatus(status?: EngineGoalRunStatus | null) {
  return status ? GOAL_RUN_STATUS_CATALOG[status].workflowProjection : undefined
}

export function isLiveRunStatus(status?: EngineRunStatus | null): status is EngineRunStatus {
  return !!status && RUN_STATUS_CATALOG[status].live
}

export function isDispatchableRunStatus(status?: EngineRunStatus | null): status is EngineRunStatus {
  return !!status && RUN_STATUS_CATALOG[status].dispatchable
}

export function isTerminalRunStatus(status?: EngineRunStatus | null): status is EngineRunStatus {
  return !!status && RUN_STATUS_CATALOG[status].terminal
}

export function doesRunStatusImplyStarted(status?: EngineRunStatus | null): status is EngineRunStatus {
  return !!status && RUN_STATUS_CATALOG[status].startedAtImplied
}

export function isExecutorActiveRunStatus(status?: EngineRunStatus | null): status is EngineRunStatus {
  return !!status && RUN_STATUS_CATALOG[status].executorActive
}
