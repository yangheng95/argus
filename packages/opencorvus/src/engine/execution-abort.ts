import { ExecutorRegistry } from "@/executor/registry"
import type { ExecutorNameInfo } from "@/executor/contract"
import { Session } from "@/session"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/await-with-timeout"
import {
  assertSessionPromptSubtreeFinished,
  cancelSessionPromptInScope,
  requestSessionPromptSubtreeCancellation,
} from "./cancellation-scope"
import { createTaskCancellationIncomplete } from "./cancellation-error"
import { isLiveGoalRunStatus } from "./catalog"
import { recordAbortedBuildAttemptOutcome, updateGoalRun } from "./persist"
import { findActiveRunForTask, findGoalRun, findRun, listGoalRunsForTask } from "./store"

const log = Log.create({ service: "engine.execution-abort" })

export type AbortChildExecutionResult = {
  cancelled: boolean
  promptCancelled: boolean
  activityGateAborted: boolean
  goalRunAborted: boolean
  executorAbortAttempted: boolean
  executorAbortSucceeded: boolean
}

export async function abortChildExecutionForSession(input: {
  taskID: string
  sessionID: string
  reason: string
  abortTimeoutMs?: number
}): Promise<AbortChildExecutionResult> {
  const result = emptyResult()
  const session = await Session.get(input.sessionID)
  const promptCancellation = await requestSessionPromptSubtreeCancellation({
    sessionID: input.sessionID,
    projectID: session.projectID,
    taskID: input.taskID,
  })
  result.promptCancelled = promptCancellation.cancelledSessions.length > 0
  result.activityGateAborted = true

  const goalRun = listGoalRunsForTask(input.taskID).find(
    (row) => row.session_id === input.sessionID && isLiveGoalRunStatus(row.status),
  )
  if (goalRun) {
    mergeResult(
      result,
      await abortGoalRunExecution({
        taskID: input.taskID,
        goalRunID: goalRun.id,
        reason: input.reason,
        abortTimeoutMs: input.abortTimeoutMs,
      }),
    )
    result.cancelled = true
    await assertSessionPromptSubtreeFinished({
      sessions: promptCancellation.cancelledSessions,
      failures: promptCancellation.failures,
      taskID: input.taskID,
      inactivityTimeoutMs: input.abortTimeoutMs,
    })
    return result
  }

  const run = findActiveRunForTask(input.taskID)
  if (run?.session_id === input.sessionID) {
    const aborted = await abortExecutor({
      provider: run.executor,
      sessionID: run.executor_ref?.session_id ?? input.sessionID,
      queueTaskID: run.executor_ref?.queue_task_id,
      label: `run ${run.id}`,
      timeoutMs: input.abortTimeoutMs,
    })
    result.executorAbortAttempted = aborted.attempted
    result.executorAbortSucceeded = aborted.succeeded
    if (aborted.attempted && !aborted.succeeded) {
      throw createTaskCancellationIncomplete({
        taskID: input.taskID,
        handle: `executor.abort run ${run.id}`,
        cause: new Error("executor.abort returned false"),
      })
    }
  }

  await assertSessionPromptSubtreeFinished({
    sessions: promptCancellation.cancelledSessions,
    failures: promptCancellation.failures,
    taskID: input.taskID,
    inactivityTimeoutMs: input.abortTimeoutMs,
  })
  result.cancelled = true
  return result
}

export async function abortGoalRunExecution(input: {
  taskID: string
  goalRunID: string
  reason: string
  abortTimeoutMs?: number
}): Promise<AbortChildExecutionResult> {
  const result = emptyResult()
  const goalRun = findGoalRun(input.goalRunID)
  if (!goalRun || goalRun.task_id !== input.taskID) return result

  if (goalRun.session_id) {
    const session = await Session.get(goalRun.session_id)
    result.promptCancelled = cancelSessionPromptInScope({
      session,
      taskID: input.taskID,
    })
    result.activityGateAborted = true
  }

  if (isLiveGoalRunStatus(goalRun.status)) {
    const run = findRun(goalRun.coordinator_run_id)
    if (!run) {
      throw createTaskCancellationIncomplete({
        taskID: input.taskID,
        runID: goalRun.coordinator_run_id,
        handle: `goal_run ${goalRun.id} coordinator run`,
        cause: new Error("coordinator run not found"),
      })
    }
    const refs = goalRun.metadata as Record<string, unknown> | null
    const aborted = await abortExecutor({
      provider: run.executor,
      sessionID:
        typeof refs?.provider_session_id === "string"
          ? refs.provider_session_id
          : (run.executor_ref?.session_id ?? goalRun.session_id ?? run.session_id ?? undefined),
      queueTaskID:
        typeof refs?.queue_task_id === "string" ? refs.queue_task_id : (run.executor_ref?.queue_task_id ?? undefined),
      label: `goal_run ${goalRun.id} run ${run.id}`,
      timeoutMs: input.abortTimeoutMs,
    })
    result.executorAbortAttempted = aborted.attempted
    result.executorAbortSucceeded = aborted.succeeded
    if (!aborted.attempted || !aborted.succeeded) {
      throw createTaskCancellationIncomplete({
        taskID: input.taskID,
        runID: run.id,
        handle: `executor.abort goal_run ${goalRun.id}`,
        cause: new Error(aborted.attempted ? "executor.abort returned false" : "coordinator run has no abort handle"),
      })
    }
    updateGoalRun(goalRun.id, {
      status: "aborted",
      error: input.reason,
      blocking_reason: null,
      time_completed: Date.now(),
    })
    recordAbortedBuildAttemptOutcome({ goalRunID: goalRun.id, reason: input.reason })
    result.goalRunAborted = true
  }

  result.cancelled =
    result.promptCancelled || result.activityGateAborted || result.goalRunAborted || result.executorAbortAttempted
  return result
}

async function abortExecutor(input: {
  provider: ExecutorNameInfo
  sessionID?: string
  queueTaskID?: string
  label: string
  timeoutMs?: number
}) {
  if (!input.sessionID && !input.queueTaskID) return { attempted: false, succeeded: false }
  try {
    const adapter = ExecutorRegistry.require(input.provider)
    const succeeded = await withTimeout(
      adapter.abort({
        sessionID: input.sessionID,
        queueTaskID: input.queueTaskID,
      }),
      input.timeoutMs ?? 1_000,
      `executor.abort ${input.label}`,
    )
    return { attempted: true, succeeded }
  } catch (error) {
    log.warn("executor abort failed", {
      provider: input.provider,
      sessionID: input.sessionID,
      queueTaskID: input.queueTaskID,
      label: input.label,
      error: error instanceof Error ? error.message : String(error),
    })
    throw createTaskCancellationIncomplete({
      taskID: undefined,
      handle: `executor.abort ${input.label}`,
      cause: error,
    })
  }
}

function emptyResult(): AbortChildExecutionResult {
  return {
    cancelled: false,
    promptCancelled: false,
    activityGateAborted: false,
    goalRunAborted: false,
    executorAbortAttempted: false,
    executorAbortSucceeded: false,
  }
}

function mergeResult(target: AbortChildExecutionResult, source: AbortChildExecutionResult) {
  target.cancelled ||= source.cancelled
  target.promptCancelled ||= source.promptCancelled
  target.activityGateAborted ||= source.activityGateAborted
  target.goalRunAborted ||= source.goalRunAborted
  target.executorAbortAttempted ||= source.executorAbortAttempted
  target.executorAbortSucceeded ||= source.executorAbortSucceeded
}
