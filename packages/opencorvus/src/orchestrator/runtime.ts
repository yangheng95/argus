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
  OrchestratorGoalTable,
  OrchestratorInteractionRequestTable,
  OrchestratorRunTable,
  OrchestratorTaskTable,
} from "./orchestrator.sql"
import { Event } from "./model"
import { OrchestratorProtocol } from "./protocol"
import { ProtocolStore } from "@/protocol/store"
import {
  buildOperatorPrompt,
  effectiveMaxExecutorGroups,
  orchestratorState,
} from "./helpers"
import {
  appendExecutorEvent,
  createGoalRun,
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
  updateGoalRun,
  updateGoalRunExecutorSessionStatus,
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
  goalRunQueueTaskID,
  listActiveGoalRunsByCoordinator,
  listGoalRunsByCoordinator,
  listGoalsByPlan,
  listPlanNodesByPlan,
  requireRun,
  requireTask,
  type DeliveryRow,
  type GoalRunRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { Worktree } from "@/worktree"
import { readyGoalNodes, pendingBlockingGoals, hasBlockingFailures } from "@/goal/scheduler"
import { buildGoalPrompt, createGoalSession, applyGoalDelivery, cleanupGoalWorkspace } from "@/goal/runner"
import { Identifier } from "@/id/id"
import { agentStream } from "./agent-stream"
import { OrchestratorArtifactTable } from "./orchestrator.sql"

const log = Log.create({ service: "orchestrator-runtime" })
const EVALUATION_HARD_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes total for entire evaluation phase
const DELIVERY_FETCH_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_DELIVERY_FETCH_TIMEOUT_MS || "300000", 10) // 5 min for executor.delivery() (git operations can be slow on Windows with large repos)
const DELIVERY_SERVICE_TIMEOUT_MS = 60_000 // 60 seconds for Publisher.deliver()
const DELIVERY_VERIFY_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_DELIVERY_VERIFY_TIMEOUT_MS || "600000", 10) // 10 min for delivery agent verification
const SYNC_RUN_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_SYNC_RUN_TIMEOUT_MS || String(DELIVERY_FETCH_TIMEOUT_MS + EVALUATION_HARD_TIMEOUT_MS + DELIVERY_VERIFY_TIMEOUT_MS + DELIVERY_SERVICE_TIMEOUT_MS + 3 * 60 * 1000), 10) // must exceed fetch + eval + verify + publish + buffer
const EXECUTOR_STATUS_TIMEOUT_MS = 30_000 // 30s for executor.status()
const EXECUTOR_SUBMIT_TIMEOUT_MS = 60_000 // 60s for executor.submit()
const evaluatingRuns = new Map<string, number>() // runID → start timestamp, guards against concurrent re-evaluation
const eventBridgeAborts = new Map<string, AbortController>() // runID → AbortController for consumeExecutorEvents
// No BROADCAST_EVENT_TYPES whitelist needed — garbage types are no longer
// emitted at the executor level, so every event that arrives is meaningful.
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
  if (event.type === "executor.progress") return

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
      // "queued" and "planned" are normal advancement triggers.
      // Intermediate states (spec_generating, goal_decomposing, planning) indicate
      // a server restart interrupted a running stage — trigger recovery immediately
      // instead of waiting for recoverStrandedTasks (10+ min delay).
      const isRecovery = row.status !== "queued" && row.status !== "planned"
      const p = (async () => {
        const result = await advanceTaskStage(row.id, hooks.updateTask, isRecovery)
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

    // Per-goal parallel dispatch: when maxConcurrentGoals > 1,
    // dispatch each goal individually with its own worktree.
    const maxGoals = effectiveMaxExecutorGroups(task)
    if (maxGoals > 1) {
      const goals = listGoalsByPlan(plan.id)
      if (goals.length > 1) {
        return dispatchGoalRuns(runID, hooks)
      }
    }

    // Single-executor serial dispatch (existing path, maxConcurrentGoals=1 or single goal)
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
    // Register executor session so bridge can resolve sessionID → taskID for SSE
    if (sessionID) registerGoalRunSession(sessionID, task.id)
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

  // ═══════════════════════════════════════════════════════════════════
  // Per-Goal Parallel Dispatch (spec Phase 2)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Dispatch ready goals individually, each with its own worktree and executor session.
   * Called from dispatch() when maxConcurrentGoals > 1 and multiple goals exist.
   */
  async function dispatchGoalRuns(runID: string, hooks: RuntimeHooks) {
    const run = requireRun(runID)
    let task = requireTask(run.task_id)
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    if (!task.session_id) throw new Error(`Task ${task.id} has no session`)
    if (!plan) throw new Error(`Task ${task.id} has no plan`)

    const prepared = await prepareRun(task, run, plan, hooks)
    if (!prepared) return
    task = prepared

    const now = Date.now()
    await hooks.updateRun(run, { status: "accepted", time_started: now }, "Per-goal parallel dispatch")
    await hooks.updateTask(task, { status: "running", time_started: task.time_started ?? now }, "Dispatching goals in parallel")

    await queueReadyGoalRuns(task, run, plan, hooks)
  }

  /**
   * Dispatch up to maxConcurrentGoals ready goals.
   * Each goal gets its own worktree, session, and executor submission.
   */
  async function queueReadyGoalRuns(task: TaskRow, run: RunRow, plan: PlanRow, hooks: RuntimeHooks) {
    const maxGoals = effectiveMaxExecutorGroups(task)
    const active = listActiveGoalRunsByCoordinator(run.id)
    const slots = maxGoals - active.length
    if (slots <= 0) return 0

    const nodes = listPlanNodesByPlan(plan.id)
    const goals = listGoalsByPlan(plan.id)
    const ready = readyGoalNodes(nodes, goals)
    const batch = ready.slice(0, slots)
    if (batch.length === 0) return 0

    let queued = 0
    for (const entry of batch) {
      await queueGoalRun(task, run, plan, entry, hooks)
      queued++
    }
    log.info("queued goal runs", { runID: run.id, queued, active: active.length, ready: ready.length })
    return queued
  }

  /**
   * Dispatch a single goal: worktree → session → executor submit → event bridge.
   */
  async function queueGoalRun(
    task: TaskRow,
    run: RunRow,
    plan: PlanRow,
    entry: { node: { id: string; goal_id: string } & Record<string, unknown>; goal: { id: string; description: string } & Record<string, unknown> },
    hooks: RuntimeHooks,
  ) {
    const sessionID = task.session_id
    if (!sessionID) throw new Error(`Task ${task.id} has no session`)

    // 0. Mark goal as "running" to prevent re-dispatch.
    //    readyGoalNodes() only returns goals with status="pending".
    Database.use((db) =>
      db.update(OrchestratorGoalTable)
        .set({ status: "running", time_updated: Date.now() })
        .where(eq(OrchestratorGoalTable.id, entry.goal.id))
        .run(),
    )

    let worktreeDir: string | undefined
    try {
      // 1. Create isolated worktree with synchronous checkout
      const worktreeInfo = await Worktree.create({
        name: `goal-${entry.goal.id.slice(-8)}`,
        checkout: "sync",
      })
      worktreeDir = worktreeInfo.directory

      // 2. Create goal session scoped to worktree
      const goalSession = await createGoalSession(task as any, entry.goal as any, worktreeDir)

      // 3. Create GoalRun record
      const goalRun = createGoalRun({
        taskID: task.id,
        goalID: entry.goal.id,
        planNodeID: entry.node.id,
        coordinatorRunID: run.id,
        sessionID: goalSession.id,
        executor: run.executor,
        workspaceDir: worktreeDir,
        metadata: {
          worktree_branch: worktreeInfo.branch,
        },
      })

      // 4. Build goal-specific prompt
      const prompt = buildGoalPrompt({
        plan: plan as any,
        node: entry.node as any,
        goal: entry.goal as any,
        taskRequest: plan.prompt,
      })

      // 5. Submit to executor with cwd=worktree
      const executor = ExecutorRegistry.require(run.executor)
      const submission = await Promise.race([
        executor.submit({
          sessionID: goalSession.id,
          prompt,
          priority: task.priority,
          source: "planner",
          cwd: worktreeDir,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`executor.submit() timeout for goal ${entry.goal.id}`)), EXECUTOR_SUBMIT_TIMEOUT_MS),
        ),
      ])

      // 6. Update goal run with executor refs
      updateGoalRun(goalRun.id, {
        status: "accepted",
        time_started: Date.now(),
        metadata: {
          ...((goalRun.metadata as Record<string, unknown>) ?? {}),
          queue_task_id: submission.queueTaskID,
          provider_session_id: submission.sessionID,
        },
      })

      // 7. Create executor session record
      const executorSession = ensureExecutorSession({
        taskID: task.id,
        runID: run.id,
        provider: run.executor,
        refs: {
          provider_session_id: submission.sessionID,
          queue_task_id: submission.queueTaskID,
        },
        settings: { cwd: worktreeDir },
        started: Date.now(),
        goalRunID: goalRun.id,
      })

      // 8. Start event bridge
      registerGoalRunSession(goalSession.id, task.id)
      consumeExecutorEvents(task.id, run.id, run.executor, goalSession.id, executorSession.id)

      log.info("dispatched goal run", {
        runID: run.id,
        goalID: entry.goal.id,
        goalRunID: goalRun.id,
        worktreeDir,
      })
    } catch (err) {
      // Dispatch failed — mark goal as "failed" so it doesn't block dependents forever.
      log.error("goal dispatch failed", { goalID: entry.goal.id, error: err instanceof Error ? err.message : String(err) })
      Database.use((db) =>
        db.update(OrchestratorGoalTable)
          .set({ status: "failed", time_updated: Date.now() })
          .where(eq(OrchestratorGoalTable.id, entry.goal.id))
          .run(),
      )
      if (worktreeDir) await cleanupGoalWorkspace(worktreeDir).catch(() => {})
      throw err // Let caller handle run-level failure
    }
  }

  /**
   * Sync per-goal executor runs: check status of each active goal run,
   * finalize completed ones, dispatch newly-ready goals.
   */
  async function syncGoalRuns(runID: string, hooks: RuntimeHooks) {
    const run = requireRun(runID)
    const task = requireTask(run.task_id)
    const plan = run.plan_version_id ? findPlan(run.plan_version_id) : undefined
    if (!plan) return

    // Run execution timeout
    const started = run.time_started ?? run.time_created
    if (started && (Date.now() - started) > RUN_MAX_EXECUTION_MS) {
      log.warn("per-goal run exceeded max execution time", { runID, maxMs: RUN_MAX_EXECUTION_MS })
      await failRun(run, `Run exceeded maximum execution time (${Math.round(RUN_MAX_EXECUTION_MS / 60000)}min)`, hooks)
      return
    }

    const activeGoalRuns = listActiveGoalRunsByCoordinator(runID)
    if (activeGoalRuns.length === 0) {
      // No active goal runs — check if we need to dispatch more or finalize
      await continueGoalPipeline(task, run, plan, hooks)
      return
    }

    const executor = ExecutorRegistry.require(run.executor)

    for (const goalRun of activeGoalRuns) {
      const queueTaskID = goalRunQueueTaskID(goalRun)
      if (!queueTaskID) continue

      try {
        const queue = await Promise.race([
          executor.status(queueTaskID),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error(`executor.status() timeout for goal run ${goalRun.id}`)), EXECUTOR_STATUS_TIMEOUT_MS),
          ),
        ])

        if (queue.status === "completed") {
          await finalizeGoalRun(task, run, plan, goalRun, hooks)
        } else if (queue.status === "failed") {
          log.error("goal run executor failed", { runID, goalRunID: goalRun.id, error: queue.error })
          updateGoalRun(goalRun.id, { status: "failed", error: queue.error ?? "Executor failed", time_completed: Date.now() })
          updateGoalRunExecutorSessionStatus(goalRun.id, "failed")
          // Update goal status to "failed"
          Database.use((db) =>
            db.update(OrchestratorGoalTable)
              .set({ status: "failed", time_updated: Date.now() })
              .where(eq(OrchestratorGoalTable.id, goalRun.goal_id))
              .run(),
          )
          if (goalRun.workspace_dir) {
            await cleanupGoalWorkspace(goalRun.workspace_dir).catch(() => {})
          }
        }
      } catch (err) {
        log.warn("goal run status check failed", {
          runID,
          goalRunID: goalRun.id,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    // After processing, check if more goals can be dispatched
    await continueGoalPipeline(task, run, plan, hooks)
  }

  /**
   * Finalize a completed goal run:
   * 1. Extract delivery from executor
   * 2. Persist delivery linked to goal run
   * 3. Merge worktree changes to main workspace (serialized)
   * 4. Update goal status
   * 5. Cleanup worktree
   */
  async function finalizeGoalRun(task: TaskRow, run: RunRow, plan: PlanRow, goalRun: GoalRunRow, hooks: RuntimeHooks) {
    stopEventBridge(run.id) // Stop the event bridge for this goal's session
    updateGoalRunExecutorSessionStatus(goalRun.id, "completed")

    // 1. Extract delivery
    const executor = ExecutorRegistry.require(run.executor)
    let delivery: { summary: string; diffs: Array<{ file: string; [key: string]: unknown }> }
    try {
      delivery = await Promise.race([
        executor.delivery({
          sessionID: goalRun.session_id!,
          since: goalRun.time_started ?? goalRun.time_created,
        }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`executor.delivery() timeout for goal run ${goalRun.id}`)), DELIVERY_FETCH_TIMEOUT_MS),
        ),
      ])
    } catch (err) {
      log.error("goal delivery extraction failed", { goalRunID: goalRun.id, error: err instanceof Error ? err.message : String(err) })
      updateGoalRun(goalRun.id, { status: "failed", error: `Delivery extraction failed: ${err instanceof Error ? err.message : String(err)}`, time_completed: Date.now() })
      Database.use((db) => db.update(OrchestratorGoalTable).set({ status: "failed", time_updated: Date.now() }).where(eq(OrchestratorGoalTable.id, goalRun.goal_id)).run())
      if (goalRun.workspace_dir) await cleanupGoalWorkspace(goalRun.workspace_dir).catch(() => {})
      return
    }

    // 2. Persist delivery linked to goal run
    const deliveryID = Identifier.ascending("delivery")
    persistDelivery({ task, run, goalRunID: goalRun.id, deliveryID, delivery, now: Date.now() })

    // 3. Merge worktree to main workspace via git
    if (goalRun.workspace_dir) {
      try {
        await applyGoalDelivery({
          directory: Instance.directory,
          delivery: { diffs: delivery.diffs as any },
        })
      } catch (err) {
        log.error("goal delivery merge failed", { goalRunID: goalRun.id, error: err instanceof Error ? err.message : String(err) })
        updateGoalRun(goalRun.id, { status: "failed", error: `Merge failed: ${err instanceof Error ? err.message : String(err)}`, time_completed: Date.now() })
        Database.use((db) => db.update(OrchestratorGoalTable).set({ status: "failed", time_updated: Date.now() }).where(eq(OrchestratorGoalTable.id, goalRun.goal_id)).run())
        await cleanupGoalWorkspace(goalRun.workspace_dir).catch(() => {})
        return
      }
    }

    // 4. Mark goal run completed and update goal status
    updateGoalRun(goalRun.id, { status: "completed", time_completed: Date.now() })

    // Update the goal's status to "passed" (individual goal success)
    const goal = listGoalsByPlan(plan.id).find((g) => g.id === goalRun.goal_id)
    if (goal) {
      Database.use((db) =>
        db.update(OrchestratorGoalTable)
          .set({ status: "passed", time_updated: Date.now() })
          .where(eq(OrchestratorGoalTable.id, goal.id))
          .run(),
      )
    }

    // 5. Cleanup worktree
    if (goalRun.workspace_dir) {
      await cleanupGoalWorkspace(goalRun.workspace_dir).catch((err) => {
        log.warn("worktree cleanup failed (non-fatal)", { goalRunID: goalRun.id, error: String(err) })
      })
    }

    log.info("goal run finalized", {
      runID: run.id,
      goalRunID: goalRun.id,
      goalID: goalRun.goal_id,
      files: delivery.diffs.length,
    })
  }

  /**
   * After goal runs complete/fail, check if:
   * - More ready goals can be dispatched
   * - All goals are done → finalize the run
   * - Blocking goals failed → handle failure
   */
  async function continueGoalPipeline(task: TaskRow, run: RunRow, plan: PlanRow, hooks: RuntimeHooks) {
    const goals = listGoalsByPlan(plan.id)
    const activeRuns = listActiveGoalRunsByCoordinator(run.id)

    // Try to dispatch more ready goals
    const queued = await queueReadyGoalRuns(task, run, plan, hooks)
    if (queued > 0) return

    // If goals are still executing, wait
    if (activeRuns.length > 0) return

    // Check if blocking goals failed
    if (hasBlockingFailures(goals)) {
      await handleEvaluationFailure(task, run, "Blocking goal(s) failed during parallel execution", hooks)
      return
    }

    // Check if there are pending blocking goals with no ready path
    const pending = pendingBlockingGoals(goals)
    if (pending.length > 0) {
      // Pending goals exist but none are ready — dependency chain broken
      await handleEvaluationFailure(task, run, `${pending.length} blocking goal(s) pending but not ready (dependency failure)`, hooks)
      return
    }

    // All goals done — finalize the run via completeRun
    log.info("all goals completed, finalizing run", { runID: run.id })
    await completeRun(run, hooks)
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

    // Per-goal parallel mode: if this run has ANY goal runs (active or completed),
    // delegate to syncGoalRuns which handles both active-goal polling and pipeline continuation.
    // Using listGoalRunsByCoordinator (ALL statuses) to detect per-goal mode even when
    // all goals have already completed but the run hasn't been finalized yet.
    if (run.status !== "completed" && run.status !== "failed" && run.status !== "aborted") {
      const allGoalRuns = listGoalRunsByCoordinator(runID)
      if (allGoalRuns.length > 0) {
        await syncGoalRuns(runID, hooks)
        return
      }
    }

    const task = requireTask(run.task_id)
    const delivery = findDeliveryByRun(run.id)
    const pending = findPendingInteractions(run.id)
    if (pending.length > 0) {
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
        const stillPending = findPendingInteractions(run.id)
        if (stillPending.length === 0) {
          if (run.status === "blocked") {
            await hooks.updateRun(run, { status: "accepted", blocking_reason: null }, "Stale interactions auto-rejected")
          }
          if (task.status === "blocked") {
            await hooks.updateTask(task, { status: "running", blocking_reason: null }, "Stale interactions auto-rejected")
          }
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

    if (run.status === "completed" && !delivery) {
      log.error("run completed but no delivery found", { runID: run.id, taskID: run.task_id })
      await failRun(run, "Run marked completed but no delivery was persisted", hooks)
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
    if (task.status === "completed" || task.status === "cancelled") {
      throw new Error(`Cannot create operator run: task ${task.id} is in terminal state "${task.status}"`)
    }
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
        const reEvalCtrl = new AbortController()
        const reEvalTimer = setTimeout(() => reEvalCtrl.abort("runEvaluation hard timeout"), EVALUATION_HARD_TIMEOUT_MS)
        try {
          await runEvaluation(task, run, existingDelivery, hooks, reEvalCtrl.signal)
        } catch (timeoutErr) {
          const msg = timeoutErr instanceof Error ? timeoutErr.message : String(timeoutErr)
          log.error("runEvaluation timed out or failed", { runID: run.id, error: msg })
          const now = Date.now()
          await hooks.updateRun(run, { status: "failed", error: msg, blocking_reason: null, time_completed: now }, msg)
          if (task.active_run_id === run.id) {
            await hooks.updateTask(task, { status: "failed", error: msg, blocking_reason: null, time_completed: now }, msg)
          }
        } finally {
          clearTimeout(reEvalTimer)
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
    await judgeContentHooks.flush()
    await judgeLive.finish(`Evaluator analysis: ${analysis.verdict}`)
  } catch (err) {
    analysisError = err instanceof Error ? err.message : String(err)
    log.error("evaluator agent analysis failed or timed out", { error: analysisError })
    await judgeContentHooks.flush().catch(() => undefined)
    judgeLive.error(err)
    analysis = fallbackAnalysis(result, goals.length, analysisError)
  }

  // If Phase 1 evaluation failed (e.g. strict spec_check or build/test failures),
  // Phase 1 (automated checks) is authoritative for hard failures.
  // Phase 2 (LLM agent) cannot override Phase 1 failures or accept when Phase 1 is inconclusive.
  // inconclusive means no real checks ran — we cannot accept on LLM hallucination alone.
  const phase1Failed = result.status === "failed"
  const phase1Inconclusive = result.status === "inconclusive"
  const agentAccepted = analysis.verdict === "accepted"
  const finalVerdict = phase1Failed
    ? "rejected" as const
    : phase1Inconclusive
      ? "rejected" as const  // No checks ran — cannot accept
      : analysis.verdict
  const finalStatus =
    (finalVerdict === "accepted" ? "passed" : finalVerdict === "rejected" ? "failed" : "inconclusive") as typeof result.status
  const finalSummary = phase1Failed
    ? `Rejected: automated checks failed. ${result.summary}`
    : phase1Inconclusive
      ? `Rejected: no automated checks ran (inconclusive). Agent verdict "${analysis.verdict}" cannot be trusted without check evidence. ${result.summary}`
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

  if (finalStatus === "passed") {
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

async function runEvaluation(task: TaskRow, run: RunRow, existingDelivery: DeliveryRow, hooks: RuntimeHooks, signal?: AbortSignal) {
  if (signal?.aborted) throw new Error("runEvaluation aborted before start")
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
    throw new Error(`Cannot re-evaluate: executor.delivery() failed: ${msg}`)
  }

  const deliveryID = existingDelivery.id
  const evaluationID = Identifier.ascending("evaluation")

  // Use the signal from the outer caller (which has its own timer) instead of spawning
  // independent inner timers that can outlive the outer timeout.
  const throwIfAborted = () => { if (signal?.aborted) throw new Error("runEvaluation aborted by caller") }

  let result: Awaited<ReturnType<typeof EvaluatorService.evaluate>>
  try {
    throwIfAborted()
    result = await EvaluatorService.evaluate(
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
    )
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
    throwIfAborted()
    analysis = await EvaluatorService.analyzeDelivery({
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
    })
    await judgeContentHooks.flush()
    await judgeLive.finish(`Evaluator analysis: ${analysis.verdict}`)
  } catch (err) {
    analysisError = err instanceof Error ? err.message : String(err)
    log.error("re-evaluation agent analysis failed or timed out", { error: analysisError })
    await judgeContentHooks.flush().catch(() => undefined)
    judgeLive.error(err)
    analysis = fallbackAnalysis(result, goals.length, analysisError)
  }

  // Phase 1 (automated checks) is authoritative for hard failures.
  // Phase 2 (LLM agent) cannot override Phase 1 failures or accept when Phase 1 is inconclusive.
  // Must match the logic in completeRun's primary evaluation path.
  const phase1Failed = result.status === "failed"
  const phase1Inconclusive = result.status === "inconclusive"
  const finalVerdict = phase1Failed
    ? "rejected" as const
    : phase1Inconclusive
      ? "rejected" as const
      : analysis.verdict
  const finalStatus =
    (finalVerdict === "accepted" ? "passed" : finalVerdict === "rejected" ? "failed" : "inconclusive") as typeof result.status
  const finalSummary = phase1Failed
    ? `Rejected: automated checks failed. ${result.summary}`
    : phase1Inconclusive
      ? `Rejected: no automated checks ran (inconclusive). Agent verdict "${analysis.verdict}" cannot be trusted without check evidence. ${result.summary}`
      : analysis.summary

  persistEvaluation({
    task, run, deliveryID, evaluationID, delivery, result,
    analysis, analysisError, finalVerdict, finalStatus, finalSummary, goals,
  })

  if (finalStatus === "passed") {
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
    const updated = task.time_status_changed ?? task.time_updated ?? task.time_created ?? 0
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
      await deliveryContentHooks.flush()
      await deliveryLive.finish(`Delivery verification: ${deliveryVerdict.verdict}`)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      log.error("delivery verification failed", { runID: run.id, error: msg })
      await deliveryContentHooks.flush().catch(() => undefined)
      deliveryLive.error(err)
      await handleEvaluationFailure(requireTask(task.id), run, `Delivery verification failed: ${msg}`, hooks, {
        verdict: "rejected",
        classification: "evaluation",
        summary: `Delivery verification failed: ${msg}`,
        goal_statuses: verifyGoals.map((_, i) => ({
          goal_index: i,
          status: "failed" as const,
          evidence: msg,
          reasoning: `Delivery agent error: ${msg}`,
        })),
        replan_guidance: {
          root_cause: msg,
          what_failed: "Delivery agent",
          suggested_strategy: `Fix the delivery agent error: ${msg}`,
          avoid_approaches: [],
        },
      })
      return
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
  ])

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
    // Re-read task from DB to avoid clobbering state changes made during executeDecision
    const freshTask = findTask(task.id)
    if (freshTask && freshTask.status !== "failed" && freshTask.status !== "completed" && freshTask.status !== "cancelled") {
      await hooks.updateTask(
        freshTask,
        {
          status: "failed",
          blocking_reason: null,
          error: `Planner failure: ${message}`,
          time_completed: Date.now(),
        },
        `Planner failure: ${message}`,
      )
    }
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
  // Re-read task from DB for final status update
  const freshTask = findTask(task.id)
  if (freshTask && freshTask.status !== "failed" && freshTask.status !== "completed" && freshTask.status !== "cancelled") {
    await hooks.updateTask(freshTask, { status: "failed", blocking_reason: null, error: summary, time_completed: Date.now() }, summary)
  }
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
  if (!next.queued) return false
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
  // When the evaluator agent (Phase 2) crashes, we cannot trust Phase 1's verdict alone.
  // Phase 1 "accepted" only means automated checks passed — without Phase 2 LLM review,
  // we cannot confirm goal completion. Force to "rejected" so the run gets retried.
  const safeVerdict = result.verdict === "accepted" ? "rejected" as const : result.verdict
  const goalStatus = safeVerdict === "rejected" ? "failed" : "inconclusive"
  const summary = `${result.summary} — Evaluator agent unavailable: ${message}. Verdict downgraded to ${safeVerdict}.`
  const reasoning = `Evaluator agent (Phase 2) failed: ${message}. Phase 1 automated checks returned "${result.verdict}" but without LLM goal-level review, acceptance cannot be confirmed.`
  return {
    verdict: safeVerdict,
    classification: "evaluation",
    summary,
    goal_statuses: Array.from({ length: goalCount }, (_, goal_index) => ({
      goal_index,
      status: goalStatus,
      evidence: summary,
      reasoning,
    })),
    replan_guidance: {
      root_cause: `Evaluator agent unavailable: ${message}`,
      what_failed: result.summary,
      suggested_strategy: "Retry evaluation — the evaluator agent crashed but the automated checks may have passed.",
      avoid_approaches: [],
    },
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
        // Route by event type:
        // - text_delta → ephemeral (no persistence)
        // - executor.progress → ephemeral (lifecycle, no persistence)
        // - everything else → persist via OrchestratorProtocol.emit
        if (event.type === "text_delta") {
          ProtocolStore.dispatchEphemeral({
            type: Event.RunOutput.type,
            aggregate: "task",
            taskID,
            runID,
            source: "executor",
            payload: { taskID, runID, type: "text_delta", text: event.summary ?? "" },
          })
        } else if (event.type === "executor.progress") {
          ProtocolStore.dispatchEphemeral({
            type: Event.RunProgress.type,
            aggregate: "task",
            taskID,
            runID,
            source: "executor",
            payload: { taskID, runID, type: event.type, summary: event.summary ?? "", payload: event.payload },
          })
        } else {
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

const PROTOCOL_EVENT_KIND_MAP: Record<string, string> = {
  "tool.call": "tool_call",
  "tool.result": "tool_result",
  "reasoning.delta": "reasoning_delta",
  "plan.delta": "plan_delta",
  "diff.delta": "diff_delta",
  "approval.request": "approval_request",
  "input.request": "input_request",
  "usage.updated": "usage",
  "session.idle": "done",
  "session.error": "error",
  "executor.progress": "lifecycle",
}

function protocolEventKind(type: string) {
  return PROTOCOL_EVENT_KIND_MAP[type] ?? "lifecycle"
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
