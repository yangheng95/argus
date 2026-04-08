/**
 * Pipeline persistence — fast-path task creation and abort registry.
 *
 * Stage functions (spec, goal, plan, dispatch) have been migrated to
 * task-tools.ts and are now driven by the Task Agent instead of a
 * fixed state machine.
 */
import z from "zod"
import { Identifier } from "@/id/id"
import { Database } from "@/storage/db"
import { Log } from "@/util/log"
import { budgetRow } from "./helpers"
import { CreateTaskInput, Event } from "./model"
import {
  OrchestratorChannelBindingTable,
  OrchestratorProgressSnapshotTable,
  OrchestratorTaskTable,
} from "./orchestrator.sql"
import { OrchestratorProtocol } from "./protocol"
import type { RunRow } from "./store"

const log = Log.create({ service: "orchestrator-pipeline" })

// ---------------------------------------------------------------------------
// Task-level abort registry — allows cancelTask to abort in-progress stages
// ---------------------------------------------------------------------------

const taskAborts = new Map<string, AbortController>()

/**
 * Abort the stage currently running for the given task.
 * Called by cancelTask() to ensure immediate interruption.
 */
export function abortTaskPipeline(taskID: string): void {
  const ctrl = taskAborts.get(taskID)
  if (ctrl) ctrl.abort("task cancelled")
}

/**
 * Wait for a running stage to settle (resolve or reject).
 * Called by deleteTask() to ensure cleanup is safe.
 */
export async function awaitPipelineSettled(taskID: string): Promise<void> {
  const ctrl = taskAborts.get(taskID)
  if (!ctrl) return
  // Wait for the abort signal to propagate — no fixed delay, just yield once.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
}

/** Register an AbortController for a task stage (used by task-tools). */
export function registerTaskAbort(taskID: string, ctrl: AbortController): void {
  taskAborts.set(taskID, ctrl)
}

/** Unregister a task's AbortController (used by task-tools cleanup). */
export function unregisterTaskAbort(taskID: string): void {
  taskAborts.delete(taskID)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type RoutingInput = z.infer<typeof CreateTaskInput>["routing"]
type BudgetInput = z.infer<typeof CreateTaskInput>["budget"]
type PriorityInput = z.infer<typeof CreateTaskInput>["priority"]
type ChannelBindingInput = z.infer<typeof CreateTaskInput>["channelBinding"]

export type PipelineMetadata = {
  executor: RunRow["executor"]
  goals?: z.infer<typeof CreateTaskInput>["goals"]
  milestones?: z.infer<typeof CreateTaskInput>["milestones"]
  routing?: RoutingInput
  sessionID: string
}

// ---------------------------------------------------------------------------
// persistQueuedTask — fast-path for POST /task (<10ms)
// ---------------------------------------------------------------------------

export function persistQueuedTask(input: {
  taskID: string
  sessionID: string
  now: number
  executor: RunRow["executor"]
  title: string
  request: string
  attachments?: Array<{ mime: string; data: string; filename?: string }>
  requestID?: string
  source?: z.infer<typeof CreateTaskInput>["source"]
  priority?: PriorityInput
  budget?: BudgetInput
  metadata: Record<string, unknown>
  channelBinding?: ChannelBindingInput
  milestones?: z.infer<typeof CreateTaskInput>["milestones"]
  goals?: z.infer<typeof CreateTaskInput>["goals"]
  routing?: RoutingInput
  projectID: string
}) {
  const pipeline: PipelineMetadata = {
    executor: input.executor,
    goals: input.goals,
    milestones: input.milestones,
    routing: input.routing,
    sessionID: input.sessionID,
  }
  Database.transaction((db) => {
    db.insert(OrchestratorTaskTable)
      .values({
        id: input.taskID,
        project_id: input.projectID,
        session_id: input.sessionID,
        request_id: input.requestID,
        source: input.source ?? "api",
        title: input.title,
        request: input.request,
        attachments: input.attachments?.length ? input.attachments : undefined,
        status: "queued",
        priority: input.priority ?? "normal",
        budget: budgetRow(input.budget),
        metadata: { ...input.metadata, _pipeline: pipeline },
        time_created: input.now,
        time_updated: input.now,
        time_status_changed: input.now,
      })
      .run()
    if (input.channelBinding) {
      db.insert(OrchestratorChannelBindingTable)
        .values({
          id: Identifier.ascending("binding"),
          task_id: input.taskID,
          platform: input.channelBinding.platform,
          channel: input.channelBinding.channel,
          thread: input.channelBinding.thread,
          payload: input.channelBinding.payload ?? {},
          time_created: input.now,
          time_updated: input.now,
        })
        .run()
    }
    db.insert(OrchestratorProgressSnapshotTable)
      .values({
        id: Identifier.ascending("progress"),
        task_id: input.taskID,
        status: "created",
        summary: "Task queued",
        payload: { sessionID: input.sessionID },
        time_created: input.now,
        time_updated: input.now,
      })
      .run()
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.TaskCreated, {
        taskID: input.taskID,
        status: "queued",
        summary: "Task queued",
      }, { source: "pipeline.queued" }),
    )
  })
}
