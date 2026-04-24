import { existsSync } from "fs"
import path from "path"
import { Config } from "@/config/config"
import { ExecutorRegistry } from "@/executor/registry"

import { Instance } from "@/project/instance"
import { Database, and, eq, inArray } from "@/storage/db"
import { Log } from "@/util/log"
import {
  EngineArtifactTable,
  EngineGoalTable,
  EngineInteractionRequestTable,
  EngineTaskTable,
} from "./engine.sql"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { buildOperatorPrompt } from "./helpers"
import { orchestratorState } from "./orchestrator-state"
import {
  persistFailedRunEvaluation,
  updateExecutorSessionStatus,
  updateGoalRun,
  updateGoalRunExecutorSessionStatus,
} from "./persist"

import {
  findDeliveryByRun,
  findEvaluationByRun,
  findInteractionByExternal,
  findPendingInteractions,
  findRun,
  findActiveRunForTask,
  findTask,
  goalRunQueueTaskID,
  listActiveGoalRunsForRun,
  listGoalRunsForRun,
  listLiveRunsForProject,
  listPlanNodesByPlan,
  requireRun,
  requireTask,
  type GoalRunRow,
  type PlanRow,
  type RunRow,
  type TaskRow,
} from "./store"
import { Worktree } from "@/worktree"
import { Identifier } from "@/id/id"
import { EXECUTOR_ACTIVE_RUN_STATUSES, RUNTIME_MONITORED_RUN_STATUSES } from "./catalog"

const log = Log.create({ service: "engine-runtime" })
const DELIVERY_FETCH_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_DELIVERY_FETCH_TIMEOUT_MS || "300000", 10) // 5 min for executor.delivery() (git operations can be slow on Windows with large repos)
const SYNC_RUN_TIMEOUT_MS = parseInt(process.env.OPENCORVUS_SYNC_RUN_TIMEOUT_MS || String(DELIVERY_FETCH_TIMEOUT_MS + 15 * 60 * 1000), 10) // must exceed fetch + Orchestrator eval/verify/publish time
const EXECUTOR_STATUS_TIMEOUT_MS = 30_000 // 30s for executor.status()

const GOAL_HEARTBEAT_INTERVAL_MS = 30_000 // emit progress heartbeat every 30s per goal
const eventBridgeAborts = new Map<string, AbortController>() // goalRunID or runID → AbortController

import { PerRunState } from "./per-run-state"

async function serializedMerge(runID: string, fn: () => Promise<void>) {
  return PerRunState.serializedMerge(runID, fn)
}


// Stale-interaction thresholds. Per-interaction-type auto-rejection is gated
// by `experimental.auto_permission` / `experimental.auto_question` — this
// constant is just the "how long before an unanswered interaction is
// considered stale" timer. Both auto_* switches can be flipped independently.
const INTERACTION_STALE_MS = parseInt(process.env.OPENCORVUS_INTERACTION_TIMEOUT_MS || "30000", 10) // auto-reject stale interactions (30s default)
const PIPELINE_STALE_MS = 10 * 60 * 1000 // 10 min — pipeline tasks stuck longer without in-memory tracking are recovered


/** Check if any executor session is active for the current project. Used as a guard before Instance.dispose(). */
export function hasActiveSessions(): boolean {
  try {
    const runs = listLiveRunsForProject(Instance.project.id)
    return runs.some((r) =>
      (EXECUTOR_ACTIVE_RUN_STATUSES as readonly string[]).includes(r.status),
    )
  } catch {
    return false
  }
}

export namespace EngineRuntime {
  /**
   * Monitor active runs (executor status). No pipeline advancement.
   * Pipeline advancement is now driven by the Orchestrator.
   */
  export async function monitorRuns(hooks: RuntimeHooks) {
    const current = orchestratorState()

    // Sync active runs — guarded to prevent overlapping sync waves.
    if (current.syncing) return
    current.syncing = true
    try {
      const rows = listLiveRunsForProject(Instance.project.id)
        .filter((r) => (RUNTIME_MONITORED_RUN_STATUSES as readonly string[]).includes(r.status))
        .map((r) => ({ id: r.id }))
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
    } finally {
      current.syncing = false
    }
  }

  /**
   * Per-goal execution is owned by GoalPool + the event bridge.
   *
   * Startup orphan cleanup was moved to engine/recovery.ts so runtime polling
   * no longer tries to reconcile previous-process state here.
   */
  async function syncGoalRuns(runID: string, hooks: RuntimeHooks) {
    void runID
    void hooks
  }

  export async function syncTask(taskID: string, hooks: RuntimeHooks) {
    const task = findTask(taskID)
    if (!task) throw new Error(`Task not found: ${taskID}`)
    const activeRun = findActiveRunForTask(task.id)
    if (!activeRun) return
    await syncRun(activeRun.id, hooks)
  }

  export async function syncRun(runID: string, hooks: RuntimeHooks) {
    const run = findRun(runID)
    if (!run) throw new Error(`Run not found: ${runID}`)

    // Per-goal parallel mode: if this run has ANY goal runs (active or completed),
    // delegate to syncGoalRuns which handles both active-goal polling and pipeline continuation.
    // Using listGoalRunsForRun (ALL statuses) to detect per-goal mode even when
    // all goals have already completed but the run hasn't been finalized yet.
    if (run.status !== "completed" && run.status !== "failed" && run.status !== "aborted") {
      const allGoalRuns = listGoalRunsForRun(runID)
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
      // Stale-interaction auto-reject is gated per-type: permissions need
      // experimental.auto_permission, questions need experimental.auto_question.
      // With the switch off the interaction waits indefinitely for the user.
      const cfg = await Config.get()
      const allowAutoPermission = cfg.experimental?.auto_permission === true
      const allowAutoQuestion = cfg.experimental?.auto_question === true
      const stale = pending.filter((p) => {
        if ((now - (p.time_created ?? 0)) <= INTERACTION_STALE_MS) return false
        if (p.request_type === "permission") return allowAutoPermission
        if (p.request_type === "question") return allowAutoQuestion
        return false
      })
      if (stale.length > 0) {
        for (const interaction of stale) {
          log.info("auto-rejecting stale interaction", { id: interaction.id, type: interaction.request_type, ageMs: now - (interaction.time_created ?? 0) })
          Database.use((db) =>
            db.update(EngineInteractionRequestTable)
              .set({ status: "rejected", time_resolved: now, time_updated: now })
              .where(eq(EngineInteractionRequestTable.id, interaction.id))
              .run(),
          )
        }
        // Phase-6-f-4: task.blocking_reason cache column removed. Blocking is
        // a run-scoped signal now (run.blocking_reason + pending interactions).
        const stillPending = findPendingInteractions(run.id)
        if (stillPending.length === 0) {
          if (run.status === "blocked") {
            await hooks.updateRun(run, { status: "accepted", blocking_reason: null }, "Stale interactions auto-rejected")
          }
        } else {
          if (run.status !== "blocked") {
            await hooks.updateRun(run, { status: "blocked", blocking_reason: stillPending[0].request_type }, "Run blocked")
          }
          return
        }
      } else {
        if (run.status !== "blocked") {
          await hooks.updateRun(run, { status: "blocked", blocking_reason: pending[0].request_type }, "Run blocked")
        }
        return
      }
    }

    if (run.status === "completed") {
      // Already-completed runs reach this branch only when syncRun's downstream
      // path (queue.status === "completed") hasn't yet handled this run. That
      // path claims via PerRunState.claimAgentNotification in the same tick,
      // so by the time we'd otherwise re-enter here the run.status check above
      // already short-circuited. After process restart, completed runs are
      // filtered out before syncRun reaches them (queueTaskID check below).
      // Nothing left for this branch to do — just return.
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
      // Phase-6-f-4: task.blocking_reason cache removed — run-scoped only.
      return
    }

    if (queue.status === "running") {
      // Single-session operator runs: use DB timestamps for inactivity detection.
      // (GoalPool-managed runs don't reach this path.)
      const RUN_STALL_MS = 30 * 60 * 1000 // 30 min
      const lastActivity = run.time_updated ?? run.time_started ?? run.time_created ?? Date.now()
      const inactiveMs = Date.now() - lastActivity
      if (inactiveMs > RUN_STALL_MS) {
        log.warn("run stalled — no activity", { runID: run.id, inactiveMs })
        try { await executor.abort({ sessionID: run.session_id ?? undefined, queueTaskID }) } catch {}
        await failRun(run, `Run stalled — no activity for ${Math.round(inactiveMs / 60000)}min`, hooks)
        return
      }
      if (run.status !== "running") {
        await hooks.updateRun(run, { status: "running", blocking_reason: null }, "Run executing")
      }
      if (task.status !== "active") {
        // Phase-6-f-4: task.blocking_reason cache removed (run-scoped only).
        await hooks.updateTask(task, { status: "active" }, "Run executing")
      }
      return
    }

    if (queue.status === "failed") {
      await failRun(run, queue.error ?? "Executor run failed", hooks)
      return
    }

    if (queue.status === "completed") {
      // Single-executor path: mark run completed and trigger task loop.
      if (PerRunState.claimAgentNotification(run.id)) {
        stopEventBridge(run.id)
        updateExecutorSessionStatus(run.id, "completed")
        // updateRun → engine/state.ts detects the terminal transition and
        // calls PerRunState.finalize(run.id), so no manual cleanup here.
        await hooks.updateRun(run, { status: "completed", blocking_reason: null, error: null, time_completed: Date.now() }, "Run completed")
        // No auto-restart of runTaskLoop here. If the task loop is already
        // in flight it is awaiting pool.drain and will continue naturally.
        // If it is not (rare race on crash recovery), the next user message
        // will start a fresh loop via continueTaskMessage. Silent background
        // restart contradicts the user-message-driven model.
      }
    }
  }

  export async function createOperatorRun(task: TaskRow, run: RunRow, note: string) {
    if (task.status === "completed" || task.status === "cancelled") {
      throw new Error(`Cannot create operator run: task ${task.id} is in terminal state "${task.status}"`)
    }
    const { createRun } = await import("./writer")
    const { updateTask } = await import("./state")
    const { findActivePlanForTask } = await import("./store")
    const created = createRun({
      taskID: task.id,
      planVersionID: findActivePlanForTask(task.id)?.id ?? null,
      sessionID: run.session_id ?? null,
      executor: run.executor,
      status: "queued",
      phase: "execute",
      metadata: {
        previous_run_id: run.id,
        strategy: "operator_note",
        prompt_override: buildOperatorPrompt(note),
      },
      summary: "Run queued from operator note",
    })
    await updateTask(
      task,
      {
        status: "active",
        error: null,
        time_completed: null,
      },
      "Operator note queued a follow-up run",
    )
    return created.id
  }

}



async function failRun(run: RunRow, error: string, hooks: RuntimeHooks) {
  stopEventBridge(run.id) // serial bridge
  // Stop all per-goal event bridges (abort propagates to executor via consumeExecutorEvents)
  // Infrastructure only writes goal_run.status — goal.status is Orchestrator's decision
  const goalRuns = listActiveGoalRunsForRun(run.id)
  for (const gr of goalRuns) {
    stopEventBridge(gr.id) // aborts the controller → consumeExecutorEvents loop breaks → executor.abort() called
    updateGoalRun(gr.id, { status: "failed", error: `Parent run failed: ${error}`, time_completed: Date.now() })
    updateGoalRunExecutorSessionStatus(gr.id, "failed")
  }
  // PerRunState.finalize is driven by updateRun's terminal transition below;
  // executor_session is the only extra cleanup this path owns.
  updateExecutorSessionStatus(run.id, "failed")
  const task = requireTask(run.task_id)
  const now = Date.now()
  if (!findEvaluationByRun(run.id)) {
    persistFailedRunEvaluation({ task, run, error, now })
  }
  await hooks.updateRun(run, { status: "failed", error, blocking_reason: null, time_completed: now }, error)
  // Task loop detects run failure via task status check and re-enters Decision Point.
  // No fire-and-forget trigger needed.
  if (findActiveRunForTask(task.id)?.id === run.id) {
    log.info("run failed, task loop will detect and re-decide", { taskID: task.id, runID: run.id })
  }
}

function requirementIDsFromMetadata(metadata: unknown): string[] {
  if (!metadata || typeof metadata !== "object") return []
  const value = (metadata as Record<string, unknown>).source_requirement_ids
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string" && item.length > 0)
  const ids = (metadata as Record<string, unknown>).requirement_ids
  if (Array.isArray(ids)) return ids.filter((item): item is string => typeof item === "string" && item.length > 0)
  return []
}


/**
 * Merge goal delivery to main workspace (orchestrator responsibility).
 * Serialized per-run. Commits merged files to advance HEAD for subsequent worktrees.
 *
 * Integration is driven by `delivery.commitRef` alone:
 *   - The goal's delivery commit is cherry-picked into the main worktree.
 *   - Owned-paths validation and merge verification read the authoritative file
 *     list via `filesChangedByCommit(commitRef)` — NEVER from `delivery.diffs`.
 *     `delivery.diffs` is display/audit only and must not re-enter the merge path.
 */
export async function mergeGoalDelivery(
  task: TaskRow, run: RunRow, plan: PlanRow, goalRun: GoalRunRow,
  delivery: { commitRef?: string },
  hooks: RuntimeHooks,
) {
  const goalRow = goalRun.goal_id ? Database.use((db) =>
    db.select().from(EngineGoalTable).where(eq(EngineGoalTable.id, goalRun.goal_id)).get(),
  ) : undefined
  const ownedPaths = Array.isArray(goalRow?.owned_paths) ? goalRow.owned_paths : []
  const commitRef = typeof (delivery as { commitRef?: unknown }).commitRef === "string"
    ? (delivery as { commitRef?: string }).commitRef?.trim()
    : undefined

  if (!commitRef) {
    throw new Error(`mergeGoalDelivery: missing commitRef for goalRun ${goalRun.id}`)
  }

  const { filesChangedByCommit, validateOwnedPaths, getMerger } = await import("@/goal/merge")
  const committedFiles = await filesChangedByCommit(commitRef, Instance.directory)

  if (ownedPaths.length > 0) {
    const validation = validateOwnedPaths(
      committedFiles.map((f) => f.file),
      ownedPaths,
    )
    if (!validation.valid) {
      log.warn("goal merge: files outside owned_paths", {
        goalRunID: goalRun.id,
        violations: validation.violations,
        ownedPaths,
      })
    }
  }

  await serializedMerge(run.id, async () => {
    const { $ } = await import("bun")
    await Worktree.lock(async () => {
      const cherryPick = await $`git cherry-pick -x ${commitRef}`.quiet().cwd(Instance.directory).nothrow()
      if (cherryPick.exitCode !== 0) {
        const stderr = cherryPick.stderr.toString().trim() || cherryPick.stdout.toString().trim() || "git cherry-pick failed"

        // Capture main tip BEFORE abort so the resolver has the exact ref
        // executor needs to merge in. `git rev-parse HEAD` in the primary
        // worktree — a --abort'd cherry-pick rewinds to this same HEAD,
        // so we intentionally read it post-conflict for determinism even
        // though in principle pre/post are equivalent here.
        await $`git cherry-pick --abort`.quiet().cwd(Instance.directory).nothrow()
        const mainTipResult = await $`git rev-parse HEAD`.cwd(Instance.directory).quiet().nothrow()
        const mainTip = mainTipResult.stdout.toString().trim()
        if (mainTipResult.exitCode !== 0 || !mainTip) {
          throw new Error(
            `goal merge conflict for ${goalRun.id}: ${stderr} ` +
              `(and failed to read primary worktree HEAD — cannot dispatch resolver)`,
          )
        }

        if (!goalRow) {
          throw new Error(
            `goal merge conflict for ${goalRun.id}: ${stderr} ` +
              `(no goal row found — cannot dispatch resolver)`,
          )
        }
        const goalWorkDir = typeof goalRow.workspace_dir === "string" ? goalRow.workspace_dir : ""
        if (!goalWorkDir) {
          throw new Error(
            `goal merge conflict for ${goalRun.id}: ${stderr} ` +
              `(goal ${goalRow.id} has no workspace_dir — cannot dispatch resolver)`,
          )
        }

        // P2 merge-conflict resolution: hand the goal worktree to executor.
        // Must stay inside the Worktree.lock() window — the resolver does
        // a `git merge --ff-only` back into primary that assumes no other
        // goal has advanced main in the meantime.
        const { resolveMergeConflict } = await import("./merge-resolver")
        const resolved = await resolveMergeConflict({
          task,
          goalRun,
          goal: {
            id: goalRow.id,
            title: goalRow.title ?? "(untitled)",
            objective: goalRow.objective ?? undefined,
            workspace_dir: goalWorkDir,
          },
          commitRef,
          goalWorkDir,
          primaryWorkDir: Instance.directory,
          mainTip,
          initialStderr: stderr,
        })

        if (!resolved.resolved) {
          // Resolver already reset primary to mainTip + wrote decision_log on cap.
          throw new Error(
            `goal merge conflict for ${goalRun.id} unresolved: ${resolved.error ?? "unknown reason"}`,
          )
        }
        log.info("merged goal delivery via conflict resolver", {
          goalRunID: goalRun.id, commitRef, resolvedTip: resolved.newGoalBranchTip,
        })
        return
      }
      log.info("merged goal delivery by cherry-pick", { goalRunID: goalRun.id, commitRef, files: committedFiles.length })
    })
  })

  // Verify merge: every non-deleted, non-skip file in the commit must now
  // exist on disk in the main workspace. Source of truth is the commit itself,
  // not the delivery object.
  const expected = committedFiles
    .filter((f) => f.status !== "deleted" && getMerger(f.file) !== "skip")
    .map((f) => ({ rel: f.file, abs: path.resolve(Instance.directory, f.file) }))
  const missing = expected.filter((f) => !existsSync(f.abs))
  if (missing.length > 0) {
    log.error("merge verification failed", { goalRunID: goalRun.id, missing: missing.length, files: missing.map((m) => m.rel) })
    // Non-fatal for pipeline flow — delivery was already persisted, goal_run already completed
    // The overall evaluator will catch integration issues
  }
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
    values: Partial<typeof EngineTaskTable.$inferInsert>,
    summary: string,
  ) => Promise<TaskRow>
  updateRun: (
    row: RunRow,
    values: Partial<RunRow>,
    summary: string,
  ) => Promise<RunRow>
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
    db.insert(EngineInteractionRequestTable)
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
      EngineProtocol.emit(Event.InteractionRequested, {
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
