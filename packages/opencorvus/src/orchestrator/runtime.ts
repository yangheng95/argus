import { Bus } from "@/bus"
import { selectorList } from "@/check/policy"
import { EvaluatorService } from "@/evaluator/service"
import { type EvaluatorAnalysisType } from "@/evaluator/agent"
import { ExecutorRegistry } from "@/executor/registry"
import { PlannerFailureError } from "@/planner/service"
import { Plugin } from "@/plugin"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { installRuntimeShims } from "@/runtime/shims"
import { Session } from "@/session"
import { MessageV2 } from "@/session/message"
import { Database, and, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import { WorkbenchService } from "@/workbench/service"
import { DeliveryService } from "@/delivery/service"
import type { DeliveryVerdictType } from "@/delivery/agent"
import { mergeTextHooks } from "@/llm/tool-hooks"
import { Publisher } from "./publisher"
import { OrchestratorGit } from "./git"
import { OrchestratorMemoryBridge } from "./memory-bridge"
import {
  OrchestratorInteractionRequestTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "./orchestrator.sql"
import { Event } from "./model"
import { OrchestratorProtocol } from "./protocol"
import { ProtocolStore } from "@/protocol/store"
import {
  buildOperatorPrompt,
  orchestratorState,
} from "./helpers"
import {
  appendExecutorEvent,
  createReplanRun,
  createRetryRun,
  ensureExecutorSession,
  failGoals,
  finalizeDeliveryResult,
  markDeliveryPublishing,
  persistDelivery,
  persistEvaluation,
  persistFailedRunEvaluation,
  updateExecutorSessionStatus,
} from "./persist"
import { advanceTaskStage } from "./pipeline"
import { sessionStreamHooks } from "./session-stream"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { buildRetryContext, decideRetryOrReplan } from "./strategy"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findInteractionByExternal,
  findPendingInteractions,
  findPlan,
  findRun,
  findTask,
  listGoalsByPlan,
  requireRun,
  requireTask,
  type DeliveryRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { Identifier } from "@/id/id"
import { agentStream } from "./agent-stream"
import { OrchestratorArtifactTable } from "./orchestrator.sql"

const log = Log.create({ service: "orchestrator-runtime" })
const EVALUATION_HARD_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes total for entire evaluation phase
const DELIVERY_FETCH_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_DELIVERY_FETCH_TIMEOUT_MS || "300000", 10) // 5 min for executor.delivery() (git operations can be slow on Windows with large repos)
const DELIVERY_SERVICE_TIMEOUT_MS = 60_000 // 60 seconds for Publisher.deliver()
const DELIVERY_VERIFY_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_DELIVERY_VERIFY_TIMEOUT_MS || "600000", 10) // 10 min for delivery agent verification
const SYNC_RUN_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_SYNC_RUN_TIMEOUT_MS || String(EVALUATION_HARD_TIMEOUT_MS + DELIVERY_VERIFY_TIMEOUT_MS + 3 * 60 * 1000), 10) // must exceed eval + delivery verify + buffer
const EXECUTOR_STATUS_TIMEOUT_MS = 30_000 // 30s for executor.status()
const EXECUTOR_SUBMIT_TIMEOUT_MS = 60_000 // 60s for executor.submit()
const evaluatingRuns = new Map<string, number>() // runID → start timestamp, guards against concurrent re-evaluation
const eventBridgeAborts = new Map<string, AbortController>() // runID → AbortController for consumeExecutorEvents
const EVALUATING_STALE_MS = EVALUATION_HARD_TIMEOUT_MS + 60_000 // consider stale after hard timeout + 1 min buffer

// Unattended-mode safeguards
const INTERACTION_STALE_MS = parseInt(process.env.OPENCORVUS_INTERACTION_TIMEOUT_MS || "30000", 10) // auto-reject stale interactions (30s default)
const RUN_MAX_EXECUTION_MS = parseInt(process.env.OPENCORVUS_RUN_TIMEOUT_MS || String(2 * 60 * 60 * 1000), 10) // max run execution time (2h default)
const PIPELINE_STALE_MS = 10 * 60 * 1000 // 10 min — pipeline tasks stuck longer without in-memory tracking are recovered
const PIPELINE_STATUSES = ["queued", "spec_generating", "goal_decomposing", "planning", "planned"] as const
const runningStages = new Map<string, Promise<void>>()

type TranscriptState = {
  message: MessageV2.Assistant
  text?: MessageV2.TextPart
  reasoning?: MessageV2.ReasoningPart
  tools: Map<string, MessageV2.ToolPart>
  usage: {
    input: number
    output: number
    total: number
    cost: number
  }
}

const transcript = new Map<string, TranscriptState>()

async function projectExecutorEventToSession(taskID: string, run: RunRow, event: {
  type: string
  summary?: string
  payload?: Record<string, unknown>
}) {
  if (run.executor === "opencode" || !run.session_id) return
  const payload = event.payload ?? {}
  const sessionID = typeof payload.sessionID === "string" ? payload.sessionID : run.session_id
  if (!sessionID) return
  if (event.type === "executor.status") return

  const state = await ensureTranscriptState(taskID, run, sessionID)
  if (!state) return

  if (event.type === "message.part.delta") {
    if (payload.field !== "text" || typeof payload.delta !== "string" || payload.delta.length === 0) return
    if (!state.text) {
      state.text = await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: state.message.id,
        sessionID,
        type: "text",
        text: "",
      } satisfies MessageV2.TextPart) as MessageV2.TextPart
    }
    state.text!.text += payload.delta
    await Session.updatePartDelta({
      sessionID,
      messageID: state.message.id,
      partID: state.text!.id,
      field: "text",
      delta: payload.delta,
    })
    return
  }

  if (event.type === "reasoning.delta") {
    const delta = typeof event.summary === "string" ? event.summary : ""
    if (!delta) return
    if (!state.reasoning) {
      state.reasoning = await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: state.message.id,
        sessionID,
        type: "reasoning",
        text: "",
        time: {
          start: Date.now(),
        },
      } satisfies MessageV2.ReasoningPart) as MessageV2.ReasoningPart
    }
    state.reasoning!.text += delta
    await Session.updatePartDelta({
      sessionID,
      messageID: state.message.id,
      partID: state.reasoning!.id,
      field: "text",
      delta,
    })
    return
  }

  if (event.type === "tool.call") {
    await flushTranscriptText(state)
    state.text = undefined
    state.reasoning = undefined
    const id = typeof payload.id === "string" ? payload.id : Identifier.ascending("call")
    const part = await Session.updatePart({
      id: state.tools.get(id)?.id ?? Identifier.ascending("part"),
      messageID: state.message.id,
      sessionID,
      type: "tool",
      callID: id,
      tool: typeof payload.name === "string" ? payload.name : "tool",
      state: {
        status: "running",
        input: toolInput(payload.input),
        title: typeof payload.name === "string" ? payload.name : "Tool call",
        metadata: {},
        time: {
          start: Date.now(),
        },
      },
    } satisfies MessageV2.ToolPart) as MessageV2.ToolPart
    state.tools.set(id, part)
    return
  }

  if (event.type === "tool.result") {
    await flushTranscriptText(state)
    state.text = undefined
    state.reasoning = undefined
    const id = typeof payload.id === "string" ? payload.id : ""
    const match = id ? state.tools.get(id) : undefined
    if (!match) return
    const matchState = match.state as { input: Record<string, unknown>; time?: { start: number } }
    const next = await Session.updatePart({
      ...match,
      state: {
        status: "completed",
        input: match.state.input,
        output: typeof payload.output === "string" ? payload.output : "",
        title: match.tool,
        metadata: {},
        time: {
          start: matchState.time?.start ?? Date.now(),
          end: Date.now(),
        },
      },
    } satisfies MessageV2.ToolPart) as MessageV2.ToolPart
    state.tools.set(id, next)
    return
  }

  if (event.type === "usage.updated") {
    state.usage = {
      input: toNumber(payload.inputTokens),
      output: toNumber(payload.outputTokens),
      total: toNumber(payload.totalTokens),
      cost: toNumber(payload.costUSD),
    }
    return
  }

  if (event.type === "session.idle" || event.type === "session.error") {
    await flushTranscriptText(state)
    state.text = undefined
    state.reasoning = undefined
    if (event.type === "session.idle" && !state.text && typeof payload.output === "string" && payload.output.trim()) {
      state.text = await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: state.message.id,
        sessionID,
        type: "text",
        text: payload.output,
      } satisfies MessageV2.TextPart) as MessageV2.TextPart
    }
    if (event.type === "session.error" && typeof payload.error === "string" && payload.error) {
      if (!state.text) {
        state.text = await Session.updatePart({
          id: Identifier.ascending("part"),
          messageID: state.message.id,
          sessionID,
          type: "text",
          text: payload.error,
        } satisfies MessageV2.TextPart) as MessageV2.TextPart
      } else if (!state.text.text.trim()) {
        state.text.text = payload.error
        await Session.updatePart(state.text)
      }
    }
    const completed = Date.now()
    state.message = await Session.updateMessage({
      ...state.message,
      time: {
        ...state.message.time,
        completed,
      },
      cost: state.usage.cost,
      tokens: {
        total: state.usage.total || undefined,
        input: state.usage.input,
        output: state.usage.output,
        reasoning: 0,
        cache: {
          read: 0,
          write: 0,
        },
      },
    } satisfies MessageV2.Assistant) as MessageV2.Assistant
    transcript.delete(run.id)
  }
}

async function ensureTranscriptState(taskID: string, run: RunRow, sessionID: string) {
  const current = transcript.get(run.id)
  if (current) return current
  const parentID = await transcriptParentID(sessionID, taskID, run.id)
  const message = await Session.updateMessage({
    id: Identifier.ascending("message"),
    sessionID,
    role: "assistant",
    parentID,
    modelID: run.executor,
    providerID: run.executor,
    mode: run.executor,
    agent: run.executor,
    path: {
      cwd: Instance.directory,
      root: Instance.worktree,
    },
    time: {
      created: Date.now(),
    },
    cost: 0,
    tokens: {
      input: 0,
      output: 0,
      reasoning: 0,
      cache: {
        read: 0,
        write: 0,
      },
    },
  } satisfies MessageV2.Assistant) as MessageV2.Assistant
  const next = {
    message,
    tools: new Map<string, MessageV2.ToolPart>(),
    usage: {
      input: 0,
      output: 0,
      total: 0,
      cost: 0,
    },
    text: undefined as MessageV2.TextPart | undefined,
    reasoning: undefined as MessageV2.ReasoningPart | undefined,
  }
  transcript.set(run.id, next)
  return next
}

async function transcriptParentID(sessionID: string, taskID: string, runID: string) {
  const rows = await Session.messages({ sessionID, limit: 20 }).catch(() => [])
  const user = rows.findLast((item) => item.info.role === "user")
  if (user?.info.role === "user") return user.info.id
  return `${taskID}:${runID}`
}

async function flushTranscriptText(state: {
  text?: MessageV2.TextPart
  reasoning?: MessageV2.ReasoningPart
}) {
  if (state.text) await Session.updatePart(state.text)
  if (state.reasoning) await Session.updatePart({
    ...state.reasoning,
    time: {
      ...state.reasoning.time,
      end: Date.now(),
    },
  } satisfies MessageV2.ReasoningPart)
}

function toolInput(input: unknown) {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>
  if (typeof input !== "string") return {}
  try {
    const parsed = JSON.parse(input)
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) return parsed as Record<string, unknown>
  } catch {}
  return input ? { value: input } : {}
}

function toNumber(value: unknown) {
  return Number.isFinite(Number(value)) ? Number(value) : 0
}

async function prepareRun(task: TaskRow, run: RunRow, plan: PlanRow | undefined, hooks: RuntimeHooks) {
  if (Instance.project.vcs !== "git") {
    await Project.initGit(Instance.directory)
    await Instance.refresh()
  }
  if (task.time_started) return task
  const prepared = await OrchestratorGit.prepare(task, plan)
  if (!prepared.error) return prepared.task
  const now = Date.now()
  await hooks.updateRun(run, { status: "failed", error: prepared.error, blocking_reason: null, time_completed: now }, prepared.error)
  if (task.active_run_id === run.id) {
    await hooks.updateTask(task, { status: "failed", error: prepared.error, blocking_reason: null, time_completed: now }, prepared.error)
  }
  return
}

/** Check if any executor session is active for the current project. Used as a guard before Instance.dispose(). */
export function hasActiveSessions(): boolean {
  try {
    return Database.use((db) =>
      db.select({ id: OrchestratorRunTable.id })
        .from(OrchestratorRunTable)
        .innerJoin(OrchestratorTaskTable, eq(OrchestratorRunTable.task_id, OrchestratorTaskTable.id))
        .where(and(
          eq(OrchestratorTaskTable.project_id, Instance.project.id),
          inArray(OrchestratorRunTable.status, ["accepted", "running"]),
        ))
        .limit(1)
        .get(),
    ) !== undefined
  } catch {
    return false
  }
}

export namespace OrchestratorRuntime {
  export async function poll(hooks: RuntimeHooks) {
    const current = orchestratorState()

    // Phase 1: Pipeline advancement — always runs, never blocked by slow run sync.
    // Per-task exclusion via runningStages Map; no global guard needed.
    const pipelineTasks = Database.use((db) =>
      db.select({ id: OrchestratorTaskTable.id, status: OrchestratorTaskTable.status })
        .from(OrchestratorTaskTable)
        .where(and(
          eq(OrchestratorTaskTable.project_id, Instance.project.id),
          inArray(OrchestratorTaskTable.status, [...PIPELINE_STATUSES]),
        ))
        .all(),
    )
    for (const row of pipelineTasks) {
      if (runningStages.has(row.id)) continue
      if (row.status !== "queued" && row.status !== "planned") continue
      const p = (async () => {
        const result = await advanceTaskStage(row.id, hooks.updateTask)
        if (result?.runID) await OrchestratorRuntime.dispatch(result.runID, hooks)
      })().catch((err) => {
        log.error("pipeline advancement failed", { taskID: row.id, error: err instanceof Error ? err.message : String(err) })
      }).finally(() => runningStages.delete(row.id))
      runningStages.set(row.id, p)
    }

    // Phase 2: Sync active runs — guarded to prevent overlapping sync waves.
    if (current.syncing) return
    current.syncing = true
    try {
      const rows = Database.use((db) =>
        db
          .select({ id: OrchestratorRunTable.id })
          .from(OrchestratorRunTable)
          .innerJoin(OrchestratorTaskTable, eq(OrchestratorRunTable.task_id, OrchestratorTaskTable.id))
          .where(
            and(
              eq(OrchestratorTaskTable.project_id, Instance.project.id),
              inArray(OrchestratorRunTable.status, ["accepted", "running", "blocked", "completed"]),
            ),
          )
          .all(),
      )
      await Promise.allSettled(
        rows.map((row) =>
          Promise.race([
            syncRun(row.id, hooks),
            new Promise<void>((_, reject) =>
              setTimeout(() => reject(new Error(`syncRun timeout for run ${row.id}`)), SYNC_RUN_TIMEOUT_MS),
            ),
          ]).catch((err) => {
            log.error("syncRun failed or timed out", { runID: row.id, error: err instanceof Error ? err.message : String(err) })
          }),
        ),
      )
      recoverStrandedTasks(hooks)
    } finally {
      current.syncing = false
    }
  }

  export async function dispatch(runID: string, hooks: RuntimeHooks) {
    installRuntimeShims()
    const run = requireRun(runID)
    if (run.status !== "queued") return
    let task = requireTask(run.task_id)
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    if (!task.session_id) throw new Error(`Task ${task.id} has no session`)
    if (!plan) throw new Error(`Task ${task.id} has no plan`)
    const base = typeof run.metadata?.prompt_override === "string" ? run.metadata.prompt_override : plan.prompt
    const brief = WorkbenchService.compileBrief({
      taskID: task.id,
      runID: run.id,
      planVersionID: plan.id,
      sessionID: task.session_id,
    })
    const prompt = [brief.content, base].join("\n\n")
    const strategy = run.metadata?.strategy as string | undefined
    const source: "planner" | "scheduler" | "system" =
      strategy === "operator_note" ? "system" : strategy === "retry_same_plan" ? "scheduler" : "planner"
    const prepared = await prepareRun(task, run, plan, hooks)
    if (!prepared) return
    task = prepared
    const sessionID = task.session_id
    if (!sessionID) throw new Error(`Task ${task.id} has no session`)
    const executor = ExecutorRegistry.require(run.executor)
    const submission = await Promise.race([
      executor.submit({
        sessionID,
        prompt,
        priority: task.priority,
        source,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`executor.submit() timeout (${EXECUTOR_SUBMIT_TIMEOUT_MS}ms)`)), EXECUTOR_SUBMIT_TIMEOUT_MS),
      ),
    ])
    const now = Date.now()
    await hooks.updateRun(
      run,
      {
        status: "accepted",
        executor_ref: {
          session_id: submission.sessionID,
          queue_task_id: submission.queueTaskID,
        },
        time_started: now,
      },
      "Run accepted by executor",
    )
    await hooks.updateTask(
      task,
      {
        status: "running",
        time_started: task.time_started ?? now,
      },
      "Run dispatched",
    )
    const session = ensureExecutorSession({
      taskID: task.id,
      runID: run.id,
      provider: run.executor,
      refs: {
        provider_session_id: submission.sessionID,
        queue_task_id: submission.queueTaskID,
      },
      settings: {
        cwd: Instance.directory,
      },
      started: now,
    })
    appendExecutorEvent(session.id, task.id, run.id, run.executor, undefined, {
      provider: run.executor,
      kind: "lifecycle",
      summary: "Run accepted by executor",
      refs: session.refs ?? undefined,
      payload: {
        queue_task_id: submission.queueTaskID,
        provider_session_id: submission.sessionID,
      },
    })
    // Start executor event bridge (fire-and-forget background coroutine)
    consumeExecutorEvents(task.id, run.id, run.executor, sessionID, session.id)
  }

  export async function syncTask(taskID: string, hooks: RuntimeHooks) {
    const task = findTask(taskID)
    if (!task) throw new Error(`Task not found: ${taskID}`)
    if (!task.active_run_id) return
    await syncRun(task.active_run_id, hooks)
  }

  export async function syncRun(runID: string, hooks: RuntimeHooks) {
    const run = findRun(runID)
    if (!run) throw new Error(`Run not found: ${runID}`)
    const task = requireTask(run.task_id)
    const delivery = findDeliveryByRun(run.id)
    const pending = findPendingInteractions(run.id)
    if (pending.length > 0) {
      // Auto-reject stale interactions for unattended operation
      const now = Date.now()
      const stale = pending.filter((p) => (now - (p.time_created ?? 0)) > INTERACTION_STALE_MS)
      if (stale.length > 0) {
        for (const interaction of stale) {
          log.info("auto-rejecting stale interaction", { id: interaction.id, type: interaction.request_type, ageMs: now - (interaction.time_created ?? 0) })
          Database.use((db) =>
            db.update(OrchestratorInteractionRequestTable)
              .set({ status: "rejected", time_resolved: now, time_updated: now })
              .where(eq(OrchestratorInteractionRequestTable.id, interaction.id))
              .run(),
          )
        }
        // Re-check after auto-rejection
        const stillPending = findPendingInteractions(run.id)
        if (stillPending.length === 0) {
          if (run.status === "blocked") {
            await hooks.updateRun(run, { status: "accepted", blocking_reason: null }, "Stale interactions auto-rejected")
          }
          if (task.status === "blocked") {
            await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Stale interactions auto-rejected")
          }
          // Fall through to continue sync
        } else {
          if (run.status !== "blocked") {
            await hooks.updateRun(run, { status: "blocked", blocking_reason: stillPending[0].request_type }, "Run blocked")
          }
          if (task.status !== "blocked") {
            await hooks.updateTask(task, { status: "blocked", blocking_reason: stillPending[0].request_type }, "Awaiting user input")
          }
          return
        }
      } else {
        if (run.status !== "blocked") {
          await hooks.updateRun(run, { status: "blocked", blocking_reason: pending[0].request_type }, "Run blocked")
        }
        if (task.status !== "blocked") {
          await hooks.updateTask(task, { status: "blocked", blocking_reason: pending[0].request_type }, "Awaiting user input")
        }
        return
      }
    }

    if (run.status === "completed" && delivery) {
      await completeRun(run, hooks)
      return
    }

    if (run.status === "failed" || run.status === "aborted") {
      return
    }

    const queueTaskID = run.executor_ref?.queue_task_id
    if (!queueTaskID) return
    const executor = ExecutorRegistry.require(run.executor)
    const queue = await Promise.race([
      executor.status(queueTaskID),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`executor.status() timeout (${EXECUTOR_STATUS_TIMEOUT_MS}ms)`)), EXECUTOR_STATUS_TIMEOUT_MS),
      ),
    ])

    if (queue.status === "queued" || queue.status === "retrying") {
      if (run.status === "blocked") {
        await hooks.updateRun(run, { status: "accepted", blocking_reason: null }, "Run resumed")
      }
      if (task.status === "blocked") {
        await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Run resumed")
      }
      return
    }

    if (queue.status === "running") {
      // Run execution timeout — fail runs that have been running too long
      const started = run.time_started ?? run.time_created
      if (started && (Date.now() - started) > RUN_MAX_EXECUTION_MS) {
        log.warn("run exceeded max execution time", { runID: run.id, maxMs: RUN_MAX_EXECUTION_MS, elapsedMs: Date.now() - started })
        try { await executor.abort({ sessionID: run.session_id ?? undefined, queueTaskID }) } catch {}
        await failRun(run, `Run exceeded maximum execution time (${Math.round(RUN_MAX_EXECUTION_MS / 60000)}min)`, hooks)
        return
      }
      if (run.status !== "running") {
        await hooks.updateRun(run, { status: "running", blocking_reason: null }, "Run executing")
      }
      if (task.status !== "running") {
        await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Run executing")
      }
      return
    }

    if (queue.status === "failed") {
      await failRun(run, queue.error ?? "Executor run failed", hooks)
      return
    }

    if (queue.status === "completed") {
      await completeRun(run, hooks)
    }
  }

  export async function createOperatorRun(task: TaskRow, run: RunRow, note: string) {
    const nextRunID = Identifier.ascending("run")
    const now = Date.now()
    Database.transaction((db) => {
      db.insert(OrchestratorRunTable)
        .values({
          id: nextRunID,
          task_id: task.id,
          plan_version_id: task.active_plan_version_id,
          session_id: run.session_id,
          executor: run.executor,
          status: "queued",
          phase: "execute",
          retry_count: 0,
          metadata: {
            previous_run_id: run.id,
            strategy: "operator_note",
            prompt_override: buildOperatorPrompt(note),
          },
          time_created: now,
          time_updated: now,
        })
        .run()
      db.update(OrchestratorTaskTable)
        .set({
          active_run_id: nextRunID,
          status: "running",
          error: null,
          blocking_reason: null,
          time_completed: null,
          time_updated: now,
        })
        .where(eq(OrchestratorTaskTable.id, task.id))
        .run()
      Database.effect(() =>
        OrchestratorProtocol.emit(Event.RunCreated, {
          taskID: task.id,
          runID: nextRunID,
          status: "queued",
          summary: "Run queued from operator note",
        }, { taskID: task.id, runID: nextRunID, source: "runtime.operator" }),
      )
      Database.effect(() =>
        OrchestratorProtocol.emit(Event.TaskUpdated, {
          taskID: task.id,
          status: "running",
          summary: "Operator note queued a follow-up run",
        }, { taskID: task.id, source: "runtime.operator" }),
      )
    })
    return nextRunID
  }

  export async function queueRetry(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks) {
    const nextRunID = createRetryRun(task, run, summary)
    await dispatch(nextRunID, hooks)
    return nextRunID
  }

  export async function queueReplan(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks) {
    const planID = task.active_plan_version_id ?? run.plan_version_id
    if (!planID) throw new Error(`Task ${task.id} has no plan to replan`)
    const plan = findPlan(planID)
    if (!plan) throw new Error(`Plan not found: ${planID}`)
    const next = await createReplanRun(task, plan, run, summary)
    if (!next.queued || !next.runID) throw new PlannerFailureError(next.error ?? "replan failed")
    await dispatch(next.runID, hooks)
    return next.runID
  }
}

async function completeRun(run: RunRow, hooks: RuntimeHooks) {
  installRuntimeShims()
  stopEventBridge(run.id)
  updateExecutorSessionStatus(run.id, "completed")
  const existingDelivery = findDeliveryByRun(run.id)
  if (existingDelivery) {
    const task = requireTask(run.task_id)
    const evaluation = findEvaluationByRun(run.id)
    if (run.status !== "completed") {
      await hooks.updateRun(run, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Run completed")
    }
    if (!evaluation) {
      if (task.active_run_id === run.id) {
        await hooks.updateTask(task, { status: "evaluating", blocking_reason: null, error: null }, "Evaluating delivery")
      }
      // Re-run evaluation for this existing delivery (evaluation was interrupted by prior restart)
      // Atomic guard: check-and-set in a single synchronous block to prevent concurrent syncRuns
      // from both starting evaluation for the same run (Promise.allSettled race).
      const evalStart = evaluatingRuns.get(run.id)
      const isStale = evalStart !== undefined && (Date.now() - evalStart) > EVALUATING_STALE_MS
      if (isStale) {
        log.warn("clearing stale evaluatingRuns entry", { runID: run.id, ageMs: Date.now() - evalStart })
        evaluatingRuns.delete(run.id)
      }
      if (task.active_run_id !== run.id || !run.session_id || evaluatingRuns.has(run.id)) return
      // Atomic: set guard immediately in the same microtask as the check
      evaluatingRuns.set(run.id, Date.now())
      {
        try {
          await Promise.race([
            runEvaluation(task, run, existingDelivery, hooks),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error("runEvaluation hard timeout")), EVALUATION_HARD_TIMEOUT_MS),
            ),
          ])
        } catch (timeoutErr) {
          const msg = timeoutErr instanceof Error ? timeoutErr.message : String(timeoutErr)
          log.error("runEvaluation timed out or failed", { runID: run.id, error: msg })
          const now = Date.now()
          await hooks.updateRun(run, { status: "failed", error: msg, blocking_reason: null, time_completed: now }, msg)
          if (task.active_run_id === run.id) {
            await hooks.updateTask(task, { status: "failed", error: msg, blocking_reason: null, time_completed: now }, msg)
          }
        } finally {
          evaluatingRuns.delete(run.id)
        }
      }
      return
    }
    if (task.active_run_id !== run.id) return
    if (evaluation.status === "passed" && existingDelivery.status === "delivered") {
      await publishAcceptedDelivery(task, run, existingDelivery, hooks)
      return
    }
    if (evaluation.status === "passed" && existingDelivery.status !== "delivered") {
      await publishAcceptedDelivery(task, run, existingDelivery, hooks)
      return
    }
    if (evaluation.status !== "passed") {
      await handleEvaluationFailure(task, run, evaluation.summary, hooks)
    }
    return
  }

  if (!run.session_id) throw new Error(`Run ${run.id} has no session`)
  const task = requireTask(run.task_id)
  const completedAt = Date.now()
  await hooks.updateRun(run, { status: "completed", blocking_reason: null, error: null, time_completed: completedAt }, "Run completed")
  await hooks.updateTask(task, { status: "evaluating", blocking_reason: null, error: null }, "Evaluating delivery")
  const executor = ExecutorRegistry.require(run.executor)
  const delivery = await Promise.race([
    executor.delivery({
      sessionID: run.session_id,
      since: run.time_started ?? run.time_created,
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("executor.delivery() timeout")), DELIVERY_FETCH_TIMEOUT_MS),
    ),
  ])
  const now = Date.now()
  const deliveryID = Identifier.ascending("delivery")
  const evaluationID = Identifier.ascending("evaluation")

  persistDelivery({ task, run, deliveryID, delivery, now })

  await Plugin.trigger("delivery.ready", {
    taskID: task.id,
    runID: run.id,
    deliveryID,
    delivery: {
      summary: delivery.summary,
      changedFiles: delivery.diffs.map((item) => item.file),
      diffs: delivery.diffs,
    },
  }, { actions: [] }).catch(() => undefined)

  const hardTimeoutPromise = <T>() =>
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("evaluation hard timeout")), EVALUATION_HARD_TIMEOUT_MS),
    )

  let result: Awaited<ReturnType<typeof EvaluatorService.evaluate>>
  try {
    result = await Promise.race([
      EvaluatorService.evaluate(
        {
          taskID: task.id,
          activeSpecVersionID: task.active_spec_version_id ?? undefined,
          request: task.request,
          metadata: {
            ...(task.metadata ?? {}),
            delivery_changed_files: delivery.diffs.map((item) => item.file),
          },
        },
        {
          summary: delivery.summary,
          diffs: delivery.diffs,
          changedFiles: delivery.diffs.map((item) => item.file),
        },
      ),
      hardTimeoutPromise<typeof result>(),
    ])
  } catch (evalErr) {
    const msg = evalErr instanceof Error ? evalErr.message : String(evalErr)
    log.error("Phase 1 evaluate() threw or timed out", { error: msg })
    const errorSummary = `Evaluator Phase 1 failure: ${msg}`
    persistEvaluation({
      task, run, deliveryID, evaluationID, delivery,
      result: { status: "failed", verdict: "rejected", summary: errorSummary, checks: [], artifacts: [] },
      analysis: fallbackAnalysis({ verdict: "rejected", summary: errorSummary }, 0, msg),
      analysisError: msg,
      finalVerdict: "rejected",
      finalStatus: "failed",
      finalSummary: errorSummary,
      goals: [],
    })
    updateExecutorSessionStatus(run.id, "failed")
    const failNow = Date.now()
    await hooks.updateRun(run, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: failNow }, errorSummary)
    if (task.active_run_id === run.id) {
      await hooks.updateTask(task, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: failNow }, errorSummary)
    }
    return
  }

  // Phase 2: Independent-context EvaluatorAgent analysis
  // Analyzes check results, investigates failures, assesses each goal, classifies failure type
  const goals = run.plan_version_id ? listGoalsByPlan(run.plan_version_id) : []
  const judgeLive = agentStream({ taskID: task.id, runID: run.id, stage: "judge" })
  const judgeSession = await Session.createNext({
    parentID: task.session_id ?? run.session_id ?? undefined,
    title: `Evaluation: ${task.title}`,
    directory: Instance.directory,
  })
  registerGoalRunSession(judgeSession.id, task.id)
  const judgeContentHooks = sessionStreamHooks({ sessionID: judgeSession.id, taskID: task.id, stage: "judge" })
  const judgeStream = mergeTextHooks(judgeContentHooks, judgeLive.hooks)
  let analysis: EvaluatorAnalysisType
  let analysisError: string | undefined
  await judgeLive.start("Evaluator analysis started")
  try {
    analysis = await Promise.race([
      EvaluatorService.analyzeDelivery({
        task: { title: task.title, request: task.request, sessionID: task.session_id ?? undefined },
        goals: goals.map((g) => ({
          description: g.description,
          criteria: g.criteria,
          priority: g.priority as "blocking" | "advisory",
          check_selector: selectorList(g.metadata) as string[],
          requirement_ids: requirementIDsFromMetadata(g.metadata),
        })),
        delivery: {
          summary: delivery.summary,
          changedFiles: delivery.diffs.map((d) => d.file),
          diffs: delivery.diffs,
        },
        checkResults: result.checks.map((c) => ({
          name: c.name,
          status: c.status,
          evidence: c.evidence,
        })),
        stream: judgeStream,
      }),
      hardTimeoutPromise<typeof analysis>(),
    ])
    await judgeLive.finish(`Evaluator analysis: ${analysis.verdict}`)
  } catch (err) {
    analysisError = err instanceof Error ? err.message : String(err)
    log.error("evaluator agent analysis failed or timed out", { error: analysisError })
    await judgeLive.error(err).catch(() => undefined)
    analysis = fallbackAnalysis(result, goals.length, analysisError)
  }

  // If Phase 1 evaluation failed (e.g. strict spec_check or build/test failures),
  // do not let Phase 2 EvaluatorAgent override the verdict
  const phase1Failed = result.status === "failed"
  const finalVerdict = phase1Failed ? "rejected" : analysis.verdict
  const finalStatus =
    (finalVerdict === "accepted" ? "passed" : finalVerdict === "rejected" ? "failed" : "inconclusive") as typeof result.status
  const finalSummary = phase1Failed && analysis.verdict === "accepted"
    ? `Rejected: automated checks failed. ${result.summary}`
    : analysis.summary

  persistEvaluation({
    task,
    run,
    deliveryID,
    evaluationID,
    delivery,
    result,
    analysis,
    analysisError,
    finalVerdict,
    finalStatus,
    finalSummary,
    goals,
  })

  if (finalStatus === "passed" || finalStatus === "inconclusive") {
    const allGoals = run.plan_version_id ? listGoalsByPlan(run.plan_version_id) : []
    const pendingBlocking = allGoals.filter((g) => g.priority === "blocking" && g.status === "pending")

    if (pendingBlocking.length === 0) {
      const accepted = findDeliveryByRun(run.id)
      if (!accepted) {
        await hooks.updateTask(task, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Task completed")
        return
      }
      await publishAcceptedDelivery(task, run, accepted, hooks)
      return
    }
    const remaining = pendingBlocking.map((g) => g.description).join(", ")
    await handleEvaluationFailure(requireTask(task.id), run, `Evaluation ${finalStatus} but blocking goals still pending: ${remaining}`, hooks, analysis)
    return
  }

  await handleEvaluationFailure(requireTask(task.id), run, finalSummary, hooks, analysis)
}

async function runEvaluation(task: TaskRow, run: RunRow, existingDelivery: DeliveryRow, hooks: RuntimeHooks) {
  if (!run.session_id) return

  const executor = ExecutorRegistry.require(run.executor)
  let delivery: Awaited<ReturnType<typeof executor.delivery>>
  try {
    delivery = await Promise.race([
      executor.delivery({
        sessionID: run.session_id,
        since: run.time_started ?? run.time_created,
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("executor.delivery() timeout")), DELIVERY_FETCH_TIMEOUT_MS),
      ),
    ])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error("re-evaluation: failed to fetch delivery from executor", { error: msg })
    // Use minimal delivery from DB row
    delivery = {
      summary: existingDelivery.summary,
      diffs: [],
    }
  }

  const deliveryID = existingDelivery.id
  const evaluationID = Identifier.ascending("evaluation")

  const reEvalHardTimeout = <T>() =>
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("re-evaluation hard timeout")), EVALUATION_HARD_TIMEOUT_MS),
    )

  let result: Awaited<ReturnType<typeof EvaluatorService.evaluate>>
  try {
    result = await Promise.race([
      EvaluatorService.evaluate(
        {
          taskID: task.id,
          activeSpecVersionID: task.active_spec_version_id ?? undefined,
          request: task.request,
          metadata: {
            ...(task.metadata ?? {}),
            delivery_changed_files: delivery.diffs.map((item) => item.file),
          },
        },
        {
          summary: delivery.summary,
          diffs: delivery.diffs,
          changedFiles: delivery.diffs.map((item) => item.file),
        },
      ),
      reEvalHardTimeout<typeof result>(),
    ])
  } catch (evalErr) {
    const msg = evalErr instanceof Error ? evalErr.message : String(evalErr)
    log.error("re-evaluation Phase 1 failed", { error: msg })
    const errorSummary = `Evaluator Phase 1 failure: ${msg}`
    persistEvaluation({
      task, run, deliveryID, evaluationID, delivery,
      result: { status: "failed", verdict: "rejected", summary: errorSummary, checks: [], artifacts: [] },
      analysis: fallbackAnalysis({ verdict: "rejected", summary: errorSummary }, 0, msg),
      analysisError: msg,
      finalVerdict: "rejected",
      finalStatus: "failed",
      finalSummary: errorSummary,
      goals: [],
    })
    updateExecutorSessionStatus(run.id, "failed")
    const failNow = Date.now()
    await hooks.updateRun(run, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: failNow }, errorSummary)
    if (task.active_run_id === run.id) {
      await hooks.updateTask(task, { status: "failed", error: errorSummary, blocking_reason: null, time_completed: failNow }, errorSummary)
    }
    return
  }

  const goals = run.plan_version_id ? listGoalsByPlan(run.plan_version_id) : []
  const judgeLive = agentStream({ taskID: task.id, runID: run.id, stage: "judge" })
  const judgeSession = await Session.createNext({
    parentID: task.session_id ?? run.session_id ?? undefined,
    title: `Evaluation: ${task.title}`,
    directory: Instance.directory,
  })
  registerGoalRunSession(judgeSession.id, task.id)
  const judgeContentHooks = sessionStreamHooks({ sessionID: judgeSession.id, taskID: task.id, stage: "judge" })
  const judgeStream = mergeTextHooks(judgeContentHooks, judgeLive.hooks)
  let analysis: EvaluatorAnalysisType
  let analysisError: string | undefined
  await judgeLive.start("Evaluator analysis started")
  try {
    analysis = await Promise.race([
      EvaluatorService.analyzeDelivery({
        task: { title: task.title, request: task.request, sessionID: task.session_id ?? undefined },
        goals: goals.map((g) => ({
          description: g.description,
          criteria: g.criteria,
          priority: g.priority as "blocking" | "advisory",
          check_selector: selectorList(g.metadata) as string[],
          requirement_ids: requirementIDsFromMetadata(g.metadata),
        })),
        delivery: {
          summary: delivery.summary,
          changedFiles: delivery.diffs.map((d) => d.file),
          diffs: delivery.diffs,
        },
        checkResults: result.checks.map((c) => ({
          name: c.name,
          status: c.status,
          evidence: c.evidence,
        })),
        stream: judgeStream,
      }),
      reEvalHardTimeout<typeof analysis>(),
    ])
    await judgeLive.finish(`Evaluator analysis: ${analysis.verdict}`)
  } catch (err) {
    analysisError = err instanceof Error ? err.message : String(err)
    log.error("re-evaluation agent analysis failed or timed out", { error: analysisError })
    await judgeLive.error(err).catch(() => undefined)
    analysis = fallbackAnalysis(result, goals.length, analysisError)
  }

  const phase1Failed = result.status === "failed"
  const finalVerdict = phase1Failed ? "rejected" : analysis.verdict
  const finalStatus =
    (finalVerdict === "accepted" ? "passed" : finalVerdict === "rejected" ? "failed" : "inconclusive") as typeof result.status
  const finalSummary = phase1Failed && analysis.verdict === "accepted"
    ? `Rejected: automated checks failed. ${result.summary}`
    : analysis.summary

  persistEvaluation({
    task, run, deliveryID, evaluationID, delivery, result,
    analysis, analysisError, finalVerdict, finalStatus, finalSummary, goals,
  })

  if (finalStatus === "passed" || finalStatus === "inconclusive") {
    const allGoals = run.plan_version_id ? listGoalsByPlan(run.plan_version_id) : []
    const pendingBlocking = allGoals.filter((g) => g.priority === "blocking" && g.status === "pending")
    if (pendingBlocking.length === 0) {
      const accepted = findDeliveryByRun(run.id)
      if (!accepted) {
        await hooks.updateTask(task, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Task completed")
        return
      }
      await publishAcceptedDelivery(task, run, accepted, hooks)
      return
    }
    const remaining = pendingBlocking.map((g) => g.description).join(", ")
    await handleEvaluationFailure(requireTask(task.id), run, `Evaluation ${finalStatus} but blocking goals still pending: ${remaining}`, hooks, analysis)
    return
  }

  await handleEvaluationFailure(requireTask(task.id), run, finalSummary, hooks, analysis)
}

function recoverStrandedTasks(hooks: RuntimeHooks) {
  const strandedTasks = Database.use((db) =>
    db.select().from(OrchestratorTaskTable).where(and(
      eq(OrchestratorTaskTable.project_id, Instance.project.id),
      inArray(OrchestratorTaskTable.status, [
        "spec_generating", "goal_decomposing", "planning",  // pipeline
        "evaluating", "delivering",                          // execution
      ]),
    )).all(),
  )
  const now = Date.now()
  for (const task of strandedTasks) {
    const updated = task.time_updated ?? task.time_created ?? 0
    const age = now - updated
    const isPipeline = (PIPELINE_STATUSES as readonly string[]).includes(task.status)
    const threshold = isPipeline ? PIPELINE_STALE_MS : EVALUATING_STALE_MS
    if (age < threshold) continue
    if (isPipeline && runningStages.has(task.id)) continue
    if (task.active_run_id && evaluatingRuns.has(task.active_run_id)) continue
    // Pipeline recovery: re-trigger advancement instead of failing
    if (isPipeline) {
      log.warn("recovering stranded pipeline task", { taskID: task.id, status: task.status, ageMs: age })
      const p = advanceTaskStage(task.id, hooks.updateTask, true)
        .then(async (result) => { if (result?.runID) await OrchestratorRuntime.dispatch(result.runID, hooks) })
        .catch((err) => log.error("pipeline recovery failed", { taskID: task.id, error: String(err) }))
        .finally(() => runningStages.delete(task.id))
      runningStages.set(task.id, p)
      continue
    }
    log.warn("recovering stranded task", { taskID: task.id, status: task.status, ageMs: age })
    const error = `Task was stranded in '${task.status}' state for ${Math.round(age / 60000)}min (server restart recovery)`
    hooks.updateTask(task, { status: "failed", error, blocking_reason: null, time_completed: now }, error)
      .catch((err) => log.error("failed to recover stranded task", { taskID: task.id, error: String(err) }))
  }
}

async function failRun(run: RunRow, error: string, hooks: RuntimeHooks) {
  stopEventBridge(run.id)
  updateExecutorSessionStatus(run.id, "failed")
  const task = requireTask(run.task_id)
  const now = Date.now()
  if (!findEvaluationByRun(run.id)) {
    persistFailedRunEvaluation({ task, run, error, now })
  }
  await hooks.updateRun(run, { status: "failed", error, blocking_reason: null, time_completed: now }, error)
  if (task.active_run_id === run.id) {
    await hooks.updateTask(task, { status: "failed", error, blocking_reason: null, time_completed: now }, error)
  }
}

async function publishAcceptedDelivery(task: TaskRow, run: RunRow, delivery: DeliveryRow, hooks: RuntimeHooks) {
  if (task.active_run_id !== run.id) return
  if (delivery.status === "delivered") {
    const current = requireTask(task.id)
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    const finalized = await OrchestratorGit.complete(current, plan, delivery)
    if (finalized.error) {
      await hooks.updateTask(current, { status: "failed", blocking_reason: null, error: finalized.error, time_completed: Date.now() }, finalized.error)
      return
    }
    if (task.status !== "completed") {
      await hooks.updateTask(finalized.task, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Task completed")
    }
    return
  }

  const now = Date.now()
  await hooks.updateRun(run, { phase: "deliver" }, "Publishing accepted delivery")
  await hooks.updateTask(task, { status: "delivering", blocking_reason: null, error: null }, "Publishing accepted delivery")

  // --- Delivery verification: run the DeliveryAgent to verify runtime behavior ---
  const verifyGoals = run.plan_version_id ? listGoalsByPlan(run.plan_version_id) : []
  if (verifyGoals.length > 0) {
    const deliveryLive = agentStream({ taskID: task.id, runID: run.id, stage: "delivery" })
    // Create a child session so delivery verification output is persisted and streamed
    const deliverySession = await Session.createNext({
      parentID: task.session_id ?? undefined,
      title: `Delivery: ${task.title}`,
      directory: Instance.directory,
    })
    registerGoalRunSession(deliverySession.id, task.id)
    const deliveryContentHooks = sessionStreamHooks({ sessionID: deliverySession.id, taskID: task.id, stage: "delivery" })
    const deliveryStream = mergeTextHooks(deliveryContentHooks, deliveryLive.hooks)
    await deliveryLive.start("Delivery verification started")
    let deliveryVerdict: DeliveryVerdictType | undefined
    try {
      const analysisArtifact = Database.use((db) =>
        db.select().from(OrchestratorArtifactTable)
          .where(and(eq(OrchestratorArtifactTable.run_id, run.id), eq(OrchestratorArtifactTable.label, "evaluator-agent-analysis")))
          .limit(1).get(),
      )
      const analysis = analysisArtifact?.payload as EvaluatorAnalysisType | undefined
      const deliveryResult = delivery.result ?? {}
      const changedFiles = Array.isArray(deliveryResult.changed_files)
        ? (deliveryResult.changed_files as unknown[]).filter((f): f is string => typeof f === "string")
        : Array.isArray(deliveryResult.diffs)
          ? (deliveryResult.diffs as Array<{ file?: string }>).map(d => d.file).filter(Boolean) as string[]
          : []
      deliveryVerdict = await Promise.race([
        DeliveryService.verify({
          task: { title: task.title, request: task.request, sessionID: task.session_id ?? undefined, metadata: task.metadata ?? undefined },
          goals: verifyGoals.map(g => ({
            description: g.description,
            criteria: g.criteria,
            priority: g.priority as "blocking" | "advisory",
            check_selector: selectorList(g.metadata) as string[],
          })),
          delivery: {
            summary: delivery.summary,
            changedFiles,
            diffs: Array.isArray(deliveryResult.diffs) ? deliveryResult.diffs : [],
          },
          analysis,
          stream: deliveryStream,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("delivery verification timeout")), DELIVERY_VERIFY_TIMEOUT_MS),
        ),
      ])
      await deliveryLive.finish(`Delivery verification: ${deliveryVerdict.verdict}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error("delivery verification failed, proceeding with publication", { runID: run.id, error: msg })
      await deliveryLive.error(err).catch(() => undefined)
    }
    // Persist verdict as artifact
    if (deliveryVerdict) {
      try {
        Database.use((db) =>
          db.insert(OrchestratorArtifactTable).values({
            id: Identifier.ascending("artifact"),
            task_id: task.id,
            run_id: run.id,
            delivery_id: delivery.id,
            kind: "report",
            label: "delivery-agent-verdict",
            payload: deliveryVerdict as unknown as Record<string, unknown>,
            time_created: Date.now(),
            time_updated: Date.now(),
          }).run(),
        )
      } catch { /* non-critical */ }
    }
    // If rejected, route to retry/replan instead of publishing
    if (deliveryVerdict?.verdict === "rejected") {
      log.info("delivery verification rejected", { runID: run.id, issues: deliveryVerdict.issues_found })
      const rejectionSummary = `Delivery verification rejected: ${deliveryVerdict.summary}`
      const rejectionAnalysis: EvaluatorAnalysisType = {
        verdict: "rejected",
        classification: "evaluation",
        summary: rejectionSummary,
        goal_statuses: verifyGoals.map((_, i) => ({
          goal_index: i,
          status: "failed" as const,
          evidence: deliveryVerdict!.issues_found.join("; "),
          reasoning: rejectionSummary,
        })),
        replan_guidance: {
          root_cause: deliveryVerdict.issues_found.join("; "),
          what_failed: deliveryVerdict.startup_verification.success ? "Runtime behavior" : "Application startup",
          suggested_strategy: `Fix the runtime issues: ${deliveryVerdict.issues_found.join("; ")}`,
          avoid_approaches: [],
        },
      }
      await handleEvaluationFailure(requireTask(task.id), run, rejectionSummary, hooks, rejectionAnalysis)
      return
    }
  }

  markDeliveryPublishing(delivery.id, Date.now())

  const result = await Promise.race([
    Publisher.deliver({ task, run, delivery }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("Publisher.deliver() timeout")), DELIVERY_SERVICE_TIMEOUT_MS),
    ),
  ]).catch((error) => ({
    status: "failed" as const,
    summary: String(error),
    artifacts: [] as Array<{ kind: "patch" | "report" | "html_trace" | "link" | "git_ref"; label: string; payload: Record<string, unknown> }>,
    publish: {
      mode: "manual" as const,
      adapters: [{
        id: "delivery",
        status: "skipped" as const,
        summary: "Delivery export failed.",
        detail: String(error),
      }],
    },
  }))

  const completed = Date.now()
  finalizeDeliveryResult({
    deliveryId: delivery.id,
    taskId: task.id,
    runId: run.id,
    delivery,
    result,
    now: completed,
  })

  if (result.status === "delivered") {
    const current = requireTask(task.id)
    const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    const published = findDeliveryByRun(run.id) ?? delivery
    const finalized = await OrchestratorGit.complete(current, currentPlan, published)
    if (finalized.error) {
      await hooks.updateTask(current, { status: "failed", blocking_reason: null, error: finalized.error, time_completed: completed }, finalized.error)
      return
    }
    await hooks.updateTask(finalized.task, { status: "completed", blocking_reason: null, error: null, time_completed: completed }, "Task completed")
    await hooks.updateRun(run, { phase: "deliver" }, "Delivery published")
    // Flush task learnings to memory (fire-and-forget)
    const evaluation = findEvaluationByRun(run.id)
    OrchestratorMemoryBridge.flushTaskLearnings({
      task,
      run,
      delivery,
      evaluation,
      plan: currentPlan,
    }).catch((err) => log.warn("failed to flush task learnings", { error: String(err) }))
    return
  }

  await hooks.updateTask(task, { status: "failed", blocking_reason: null, error: result.summary, time_completed: completed }, result.summary)
}

async function handleEvaluationFailure(task: TaskRow, run: RunRow, summary: string, hooks: RuntimeHooks, analysis?: EvaluatorAnalysisType) {
  if (task.active_run_id !== run.id) return

  const retryContext = buildRetryContext(run, summary, analysis)
  const decision = decideRetryOrReplan(task, run, summary, analysis, retryContext)

  const executed = await executeDecision(task, run, decision, hooks).catch(async (error) => {
    const message = error instanceof Error ? error.message : String(error)
    log.error("retry/replan failed", { taskID: task.id, runID: run.id, error: message })
    await hooks.updateTask(
      task,
      {
        status: "failed",
        blocking_reason: null,
        error: `Planner failure: ${message}`,
        time_completed: Date.now(),
      },
      `Planner failure: ${message}`,
    )
    return false
  })
  if (executed) return
  failGoals(run, summary)
  OrchestratorMemoryBridge.flushFailureLearnings({
    task,
    run,
    summary,
    retryContext,
  }).catch((err) => log.warn("failed to flush failure learnings", { error: String(err) }))
  await hooks.updateTask(task, { status: "failed", blocking_reason: null, error: summary, time_completed: Date.now() }, summary)
}

async function executeDecision(
  task: TaskRow,
  run: RunRow,
  decision: import("./strategy").StrategyDecision,
  hooks: RuntimeHooks,
): Promise<boolean> {
  if (decision.action === "fail") return false

  if (decision.action === "retry") {
    const nextRunID = createRetryRun(task, run, decision.summary, decision.retryContext)
    await OrchestratorRuntime.dispatch(nextRunID, hooks)
    return true
  }

  const currentPlan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
  if (!currentPlan) return false
  const next = await createReplanRun(task, currentPlan, run, decision.summary, decision.analysis)
  if (!next.queued) return !!next.error
  if (!next.runID) return false
  await OrchestratorRuntime.dispatch(next.runID, hooks)
  return true
}

function requirementIDsFromMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return []
  const value = (metadata as Record<string, unknown>).source_requirement_ids
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0)
  const ids = (metadata as Record<string, unknown>).requirement_ids
  if (Array.isArray(ids)) return ids.filter((item): item is string => typeof item === "string" && item.length > 0)
  return []
}

function fallbackAnalysis(
  result: {
    verdict: "accepted" | "rejected" | "inconclusive"
    summary: string
  },
  goalCount: number,
  message: string,
): EvaluatorAnalysisType {
  const goalStatus =
    result.verdict === "accepted"
      ? "passed"
      : result.verdict === "rejected"
        ? "failed"
        : "inconclusive"
  const summary =
    result.verdict === "accepted"
      ? result.summary
      : `${result.summary} Evaluator agent unavailable: ${message}`
  const reasoning =
    result.verdict === "accepted"
      ? "Automated evaluator checks passed; fell back because evaluator agent analysis was unavailable."
      : `Fell back to automated evaluator result because evaluator agent analysis failed: ${message}`
  return {
    verdict: result.verdict,
    classification: "evaluation",
    summary,
    goal_statuses: Array.from({ length: goalCount }, (_, goal_index) => ({
      goal_index,
      status: goalStatus,
      evidence: summary,
      reasoning,
    })),
    replan_guidance: result.verdict === "rejected"
      ? {
          root_cause: `Evaluator agent unavailable: ${message}`,
          what_failed: result.summary,
          suggested_strategy: "Fix the failing automated checks and retry the current plan.",
          avoid_approaches: [],
        }
      : null,
  }
}


/** 将 executor 的实时事件桥接到 Bus，供 SSE 转发给前端 */
function consumeExecutorEvents(
  taskID: string,
  runID: string,
  executorName: Parameters<typeof ExecutorRegistry.require>[0],
  sessionID: string,
  executorSessionID: string,
) {
  const executor = ExecutorRegistry.require(executorName)
  if (!executor.capabilities().events) return
  // Create an AbortController so we can stop the event bridge when the run completes/fails
  const ctrl = new AbortController()
  eventBridgeAborts.set(runID, ctrl)
  // 异步消费 — 不阻塞 dispatch 返回
  ;(async () => {
    try {
      for await (const event of executor.events({ sessionID })) {
        if (ctrl.signal.aborted) break
        upsertExecutorInteraction(taskID, runID, sessionID, executorSessionID, executorName, event)
        await projectExecutorEventToSession(taskID, requireRun(runID), event)
        appendExecutorEvent(executorSessionID, taskID, runID, executorName, undefined, {
          provider: executorName,
          kind: protocolEventKind(event.type),
          summary: event.summary ?? event.type,
          payload: event.payload,
          raw: {
            type: event.type,
            summary: event.summary,
            payload: event.payload,
          },
        })
        if (event.type === "text_delta") {
          // text_delta is high-frequency — dispatch ephemeral (no DB write)
          ProtocolStore.dispatchEphemeral({
            type: Event.RunOutput.type,
            aggregate: "task",
            taskID,
            runID,
            source: "executor",
            payload: { taskID, runID, type: "text_delta", text: event.summary ?? "" },
          })
        } else {
          // Non-delta executor events are low-frequency — persist to protocol_event
          void OrchestratorProtocol.emit(Event.RunProgress, {
            taskID,
            runID,
            type: event.type,
            summary: event.summary ?? event.type,
            payload: event.payload,
          }, { taskID, runID, source: "executor" })
        }
      }
    } catch (err) {
      if (!ctrl.signal.aborted) {
        log.warn("executor event bridge ended", { taskID, runID, error: String(err) })
      }
    } finally {
      eventBridgeAborts.delete(runID)
    }
  })()
}

/** Stop the event bridge for a run (called when run completes/fails/aborts). */
function stopEventBridge(runID: string) {
  const ctrl = eventBridgeAborts.get(runID)
  if (ctrl) {
    ctrl.abort()
    eventBridgeAborts.delete(runID)
  }
}

type RuntimeHooks = {
  updateTask: (
    row: TaskRow,
    values: Partial<typeof OrchestratorTaskTable.$inferInsert>,
    summary: string,
  ) => Promise<TaskRow>
  updateRun: (
    row: RunRow,
    values: Partial<typeof OrchestratorRunTable.$inferInsert>,
    summary: string,
  ) => Promise<RunRow>
}

function protocolEventKind(type: string) {
  if (type.includes("tool")) return type.includes("result") ? "tool_result" : "tool_call"
  if (type.includes("reason")) return "reasoning_delta"
  if (type.includes("plan")) return "plan_delta"
  if (type.includes("diff")) return "diff_delta"
  if (type.includes("approval")) return "approval_request"
  if (type.includes("input")) return "input_request"
  if (type.includes("mcp")) return "mcp"
  if (type.includes("command")) return "command"
  if (type.includes("error")) return "error"
  if (type.includes("done") || type.includes("completed")) return "done"
  if (type.includes("delta") || type.includes("message")) return "message_delta"
  return "status"
}

function upsertExecutorInteraction(
  taskID: string,
  runID: string,
  sessionID: string,
  executorSessionID: string,
  provider: RunRow["executor"],
  event: {
    type: string
    summary?: string
    payload?: Record<string, unknown>
  },
) {
  if (event.type !== "approval_request" && event.type !== "input_request") return
  const rawID = event.payload?.id
  const requestID = typeof rawID === "string" || typeof rawID === "number" ? String(rawID) : undefined
  if (!requestID) return
  const externalID = `protocol:${executorSessionID}:${requestID}`
  if (findInteractionByExternal(externalID)) return
  const now = Date.now()
  const interactionID = Identifier.ascending("interaction")
  const title =
    event.type === "approval_request"
      ? `Executor approval: ${String(event.payload?.approval ?? "request")}`
      : firstQuestionHeader(event.payload?.questions) ?? "Executor input required"
  const body =
    event.type === "approval_request"
      ? String(event.summary ?? event.payload?.approval ?? "Approval requested")
      : questionBody(event.payload?.questions) || "The executor requested additional input."
  Database.transaction((db) => {
    db.insert(OrchestratorInteractionRequestTable)
      .values({
        id: interactionID,
        task_id: taskID,
        run_id: runID,
        session_id: sessionID,
        external_id: externalID,
        request_type: event.type === "approval_request" ? "permission" : "question",
        status: "pending",
        title,
        body,
        payload: {
          protocol_request: true,
          provider,
          executor_session_id: executorSessionID,
          request_id: requestID,
          request_kind: event.type,
          ...(event.payload ?? {}),
        },
        time_created: now,
        time_updated: now,
      })
      .run()
    Database.effect(() =>
      OrchestratorProtocol.emit(Event.InteractionRequested, {
        taskID,
        runID,
        interactionID,
        requestType: event.type === "approval_request" ? "permission" : "question",
        summary: title,
      }, { taskID, runID, interactionID, source: "runtime.interaction" }),
    )
  })
}

function firstQuestionHeader(input: unknown) {
  if (!Array.isArray(input)) return
  for (const item of input) {
    if (!item || typeof item !== "object") continue
    const next = item as Record<string, unknown>
    if (typeof next.header === "string" && next.header) return next.header
  }
}

function questionBody(input: unknown) {
  if (!Array.isArray(input)) return ""
  return input.flatMap((item) => {
    if (!item || typeof item !== "object") return []
    const next = item as Record<string, unknown>
    if (typeof next.question !== "string" || !next.question) return []
    return [next.question]
  }).join("\n\n")
}
