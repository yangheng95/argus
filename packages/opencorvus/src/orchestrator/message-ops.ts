import z from "zod"
import { Bus } from "@/bus"
import { ExecutorRegistry } from "@/executor/registry"
import { Identifier } from "@/id/id"
import { Database } from "@/storage/db"
import { WorkbenchService } from "@/workbench/service"
import {
  OrchestratorProgressSnapshotTable,
} from "./orchestrator.sql"
import { Event, TaskMessageInput as TaskMessageInputSchema } from "./model"
import { progressStatus } from "./helpers"
import { OrchestratorRuntime } from "./runtime"
import { hooks, updateRun } from "./state"
import {
  findRun,
  requireTask,
} from "./store"

export async function recordOperatorNote(taskID: string, note: string) {
  const task = requireTask(taskID)
  const run = task.active_run_id ? findRun(task.active_run_id) : undefined
  const now = Date.now()
  Database.use((db) =>
    db
      .insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: task.id,
        status: progressStatus(task.status),
        summary: "Operator note recorded",
        payload: {
          note,
          activeRunID: run?.id,
        },
        time_created: now,
        time_updated: now,
      })
      .run(),
  )
  if (!run) {
    return { resumed: false, status: task.status }
  }
  if (["completed", "cancelled"].includes(task.status)) {
    return { resumed: false, status: task.status }
  }
  if (["accepted", "running"].includes(run.status)) {
    return { resumed: false, status: run.status }
  }
  const nextRunID = await OrchestratorRuntime.createOperatorRun(task, run, note)
  await OrchestratorRuntime.dispatch(nextRunID, hooks())
  return { resumed: true, status: "running" as const }
}

export async function handleTaskMessage(taskID: string, raw: z.input<typeof TaskMessageInputSchema>) {
  const input = TaskMessageInputSchema.parse(raw)
  const result = await WorkbenchService.ingestTaskMessage({
    taskID,
    text: input.text,
    source: input.source ?? "user_message",
    userID: input.user_id,
  })
  await Bus.publish(Event.TaskMessageRecorded, {
    taskID,
    kind: result.kind,
    source: input.source ?? "user_message",
    text: input.text,
    summary: result.message,
  })
  if (!result.should_resume) {
    return result
  }
  const note = await recordOperatorNote(taskID, input.text)
  return {
    ...result,
    message: result.kind === "note" && note.resumed
      ? "Operator note recorded. Queued a follow-up run."
      : result.message,
  }
}

/**
 * 向正在运行的 task 注入消息。
 * 如果当前 run 正在执行且 executor 支持 resume，直接注入到 session；
 * 否则退化为 operator note（创建新 run）。
 */
export async function injectMessage(taskID: string, message: string) {
  const task = requireTask(taskID)
  const run = task.active_run_id ? findRun(task.active_run_id) : undefined
  if (!run) throw new Error(`No active run for task ${taskID}`)

  // 只有运行中的 run 才能注入
  if (!["accepted", "running"].includes(run.status)) {
    return recordOperatorNote(taskID, message)
  }
  if (!run.session_id) throw new Error(`Run ${run.id} has no session`)

  const executor = ExecutorRegistry.require(run.executor)
  if (!executor.capabilities().resume) {
    return recordOperatorNote(taskID, message)
  }

  const submission = await executor.resume({
    sessionID: run.session_id,
    message,
  })

  // 更新 executor ref（queueTaskID 可能变化）
  if (submission.queueTaskID !== run.executor_ref?.queue_task_id) {
    await updateRun(
      run,
      {
        executor_ref: {
          session_id: submission.sessionID,
          queue_task_id: submission.queueTaskID,
        },
      },
      "Message injected into running session",
    )
  }

  await Bus.publish(Event.MessageInjected, {
    taskID: task.id,
    runID: run.id,
    text: message,
    summary: "Operator message injected into running session",
  })

  return { resumed: true, status: "running" as const }
}
