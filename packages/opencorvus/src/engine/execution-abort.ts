import { ExecutorRegistry } from "@/executor/registry"
import type { ExecutorNameInfo } from "@/executor/contract"
import { SessionPrompt } from "@/session/prompt"
import { SessionStatus } from "@/session/status"
import { Log } from "@/util/log"
import { withTimeout } from "@/util/await-with-timeout"
import { isLiveGoalRunStatus } from "./catalog"
import { updateGoalRun } from "./persist"
import { findActiveRunForTask, findGoalRun, listGoalRunsForTask } from "./store"

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
  SessionPrompt.cancel(input.sessionID)
  result.promptCancelled = true
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
  }

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
    SessionPrompt.cancel(goalRun.session_id)
    SessionStatus.abortActivityGate(goalRun.session_id, new DOMException(input.reason, "AbortError"))
    result.promptCancelled = true
    result.activityGateAborted = true
  }

  if (isLiveGoalRunStatus(goalRun.status)) {
    updateGoalRun(goalRun.id, {
      status: "aborted",
      error: input.reason,
      blocking_reason: null,
      time_completed: Date.now(),
    })
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
    return { attempted: true, succeeded: false }
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
