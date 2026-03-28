import { ExecutorRegistry } from "@/executor/registry"
import { Database, NotFoundError, eq } from "@/storage/db"
import { OrchestratorExecutorSessionTable } from "./orchestrator.sql"
import { OrchestratorRuntime } from "./runtime"
import { hooks, updateRun, updateTask } from "./state"
import {
  findArtifacts,
  findDeliveryByRun,
  findEvaluations,
  findExecutorSessionByRun,
  findRuns,
  listExecutorEvents as listExecutorProtocolEvents,
  requireRun,
  requireTask,
  viewArtifact,
  viewDelivery,
  viewEvaluation,
  viewExecutorEvent,
  viewExecutorSession,
  viewRun,
} from "./store"

export async function listRuns(taskID: string) {
  await OrchestratorRuntime.syncTask(taskID, hooks())
  requireTask(taskID)
  return findRuns(taskID).map(viewRun)
}

export async function getRun(runID: string) {
  await OrchestratorRuntime.syncRun(runID, hooks())
  return viewRun(requireRun(runID))
}

export async function getDelivery(runID: string) {
  await OrchestratorRuntime.syncRun(runID, hooks())
  const delivery = findDeliveryByRun(runID)
  if (!delivery) throw new NotFoundError({ message: `Delivery not found for run ${runID}` })
  return viewDelivery(delivery)
}

export async function listArtifacts(runID: string) {
  await OrchestratorRuntime.syncRun(runID, hooks())
  requireRun(runID)
  return findArtifacts(runID).map(viewArtifact)
}

export async function listEvaluations(runID: string) {
  await OrchestratorRuntime.syncRun(runID, hooks())
  requireRun(runID)
  return findEvaluations(runID).map(viewEvaluation)
}

export async function getExecutorSession(runID: string) {
  await OrchestratorRuntime.syncRun(runID, hooks())
  requireRun(runID)
  const row = findExecutorSessionByRun(runID)
  if (!row) throw new NotFoundError({ message: `Executor session not found for run ${runID}` })
  return viewExecutorSession(row)
}

export async function listExecutorEvents(runID: string) {
  await OrchestratorRuntime.syncRun(runID, hooks())
  requireRun(runID)
  const row = findExecutorSessionByRun(runID)
  if (!row) return []
  return listExecutorProtocolEvents(row.id).map(viewExecutorEvent)
}

export async function abortRun(runID: string) {
  const run = requireRun(runID)
  await ExecutorRegistry.require(run.executor).abort({
    sessionID: run.session_id ?? undefined,
    queueTaskID: run.executor_ref?.queue_task_id,
  })
  await updateRun(
    run,
    {
      status: "aborted",
      error: "run aborted",
      blocking_reason: null,
      time_completed: Date.now(),
    },
    "Run aborted",
  )
  Database.use((db) =>
    db
      .update(OrchestratorExecutorSessionTable)
      .set({
        status: "aborted",
        time_completed: Date.now(),
        time_updated: Date.now(),
      })
      .where(eq(OrchestratorExecutorSessionTable.run_id, runID))
      .run(),
  )
  const task = requireTask(run.task_id)
  if (task.active_run_id === run.id) {
    await updateTask(task, { status: "failed", error: "run aborted", blocking_reason: null, time_completed: Date.now() }, "Run aborted")
  }
  return true
}
