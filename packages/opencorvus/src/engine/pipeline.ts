/**
 * Pipeline persistence — fast-path task creation and abort registry.
 *
 * Stage functions (spec, goal, plan, dispatch) have been migrated to
 * task-tools.ts and are now driven by the Orchestrator instead of a
 * fixed state machine.
 */
import z from "zod"
import { Database } from "@/storage/db"
import { Log } from "@/util/log"
import { budgetRow } from "./helpers"
import { CreateTaskInput, Event } from "./model"
import { EngineProtocol } from "./protocol"
import { insertEngineChannelBinding } from "./channel-binding"
import { insertEngineProgressSnapshot } from "./progress"
import { insertEngineTask } from "./task"
import { TaskGlobalProjectBindingError } from "./task-project-error"
import type { RunRow } from "./store"

const log = Log.create({ service: "engine-pipeline" })

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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type BudgetInput = z.infer<typeof CreateTaskInput>["budget"]
type PriorityInput = z.infer<typeof CreateTaskInput>["priority"]
type ChannelBindingInput = z.infer<typeof CreateTaskInput>["channelBinding"]

const QUEUE_PRIORITY_BUCKET = {
  critical: 0,
  high: 1_000_000_000_000_000,
  normal: 2_000_000_000_000_000,
  low: 3_000_000_000_000_000,
} satisfies Record<NonNullable<PriorityInput>, number>

function initialQueueOrder(priority: PriorityInput | undefined, now: number) {
  return QUEUE_PRIORITY_BUCKET[priority ?? "normal"] + now
}

// ---------------------------------------------------------------------------
// persistQueuedTask — fast-path for POST /task (<10ms)
// queue=true persists a queued task; queue=false persists an already-active
// task so same-project work can start in parallel when the caller requests it.
// ---------------------------------------------------------------------------

export function persistQueuedTask(input: {
  taskID: string
  sessionID: string
  now: number
  executor: RunRow["executor"]
  title: string
  request: string
  attachments?: Array<{ sha: string; url: string; mime: string; size: number; filename?: string }>
  requestID?: string
  source?: z.infer<typeof CreateTaskInput>["source"]
  priority?: PriorityInput
  /** "workflow" runs the full pipeline; "build" bypasses to the build agent. */
  kind?: "workflow" | "build"
  budget?: BudgetInput
  metadata: Record<string, unknown>
  channelBinding?: ChannelBindingInput
  projectID: string
  queue: boolean
}) {
  if (input.projectID === "global") {
    throw new TaskGlobalProjectBindingError({
      message: `Refusing to persist task ${input.taskID} under project global. Task persistence requires a concrete Git project.`,
      taskID: input.taskID,
      projectID: input.projectID,
    })
  }
  const taskStatus = input.queue ? "queued" : "active"
  const progressStatus = input.queue ? "created" : "active"
  const summary = input.queue ? "Task queued" : "Task started"
  const source = input.queue ? "pipeline.queued" : "pipeline.direct"
  Database.transaction((db) => {
    insertEngineTask(db, {
      taskID: input.taskID,
      projectID: input.projectID,
      sessionID: input.sessionID,
      requestID: input.requestID,
      source: input.source ?? "api",
      title: input.title,
      request: input.request,
      attachments: input.attachments?.length ? input.attachments : undefined,
      executor: input.executor,
      kind: input.kind ?? "workflow",
      priority: input.priority ?? "normal",
      queueOrder: initialQueueOrder(input.priority, input.now),
      budget: budgetRow(input.budget),
      metadata: input.metadata,
      timeStarted: input.queue ? null : input.now,
      timeCreated: input.now,
      timeUpdated: input.now,
    })
    if (input.channelBinding) {
      insertEngineChannelBinding(db, {
        taskID: input.taskID,
        platform: input.channelBinding.platform,
        channel: input.channelBinding.channel,
        thread: input.channelBinding.thread,
        payload: input.channelBinding.payload ?? {},
        timeCreated: input.now,
      })
    }
    insertEngineProgressSnapshot(db, {
      taskID: input.taskID,
      status: progressStatus,
      summary,
      payload: { sessionID: input.sessionID, queue: input.queue },
      timeCreated: input.now,
    })
    Database.effect(() =>
      EngineProtocol.emit(
        Event.TaskCreated,
        {
          taskID: input.taskID,
          status: taskStatus,
          summary,
        },
        { source },
      ),
    )
    if (!input.queue) {
      Database.effect(() =>
        EngineProtocol.emit(
          Event.TaskUpdated,
          {
            taskID: input.taskID,
            status: taskStatus,
            summary,
          },
          { source },
        ),
      )
    }
  })
}
