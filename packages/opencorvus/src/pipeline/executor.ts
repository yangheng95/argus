/**
 * Goal Executor — thin execution wrapper for a single goal.
 *
 * NOT a pipeline. NOT a state machine. Just executes a goal and returns delivery.
 * All decisions (when to plan, when to eval, how to retry) are made by the
 * Orchestrator (LLM), not by this code.
 *
 * What this module does:
 *   1. Stream executor events (for session projection)
 *   2. Extract delivery diffs from worktree
 *   3. Update goal_run status in DB
 *   4. That's it. No planning, no evaluation, no retry logic.
 *
 * IMPORTANT: This is INFRASTRUCTURE. Per the architecture spec:
 *   - goal_run writer: Infrastructure (this file)
 *   - goal writer: Orchestrator ONLY
 *   - Infrastructure NEVER writes goal.status — that's the Orchestrator's decision.
 */

import { Log } from "@/util/log"
import { Event, EngineProtocol, updateGoalRun, updateGoalRunExecutorSessionStatus, persistGoalDelivery } from "@/engine"
import { Database, eq, and } from "@/storage/db"
import { Identifier } from "@/id/id"
import { deliveryFromWorktree } from "@/goal/runner"
import { extractGoalReport } from "@/tool/goal-report"
import { Instance } from "@/project/instance"

import type { GoalContract, GoalContractFields, PipelineEvent, PipelineDelivery, PipelineDeps } from "./types"

/** Result from streamExecutorEvents — always carries the real error reason when delivery is absent. */
type StreamResult = { delivery: PipelineDelivery; error?: undefined } | { delivery?: undefined; error: string }

function goalLabel(goal: GoalContractFields & Record<string, unknown>): string {
  return goal.title || goal.id
}

const log = Log.create({ service: "goal-executor" })

const EXECUTOR_STATUS_TIMEOUT_MS = 30_000
const HEARTBEAT_INTERVAL_MS = 30_000

/**
 * Pick the applicable inactivity threshold based on current tool state.
 * Exported for unit tests — production callers read env vars directly.
 *
 * Design: while a tool is actively running (e.g. bash spawning `npm install`)
 * the session may legitimately go silent for minutes during subprocess work
 * that doesn't produce stdout/stderr. Applying the plain ~90s threshold in
 * that window causes false-positive "session dead" failures that kill real
 * progress (observed on glr_d9b9f58d0 — bash `npm install` ran 114s before
 * completing successfully, 22s after the watchdog had already aborted).
 *
 * When no tool is running the plain threshold still fires — that window
 * genuinely should be tight because an idle LLM with no tool in flight is
 * the canonical "stuck callback chain" symptom.
 */
export function pickInactivityThreshold(
  runningToolCount: number,
  plainMs: number,
  toolRunningMs: number,
): number {
  return runningToolCount > 0 ? toolRunningMs : plainMs
}

/**
 * Execute a single goal: stream executor events, extract delivery.
 *
 * Returns an async generator of PipelineEvents.
 * Infrastructure only writes goal_run status. Goal status is the Orchestrator's decision.
 */
export async function* runGoalPipeline(
  contract: GoalContract,
  deps: PipelineDeps,
): AsyncGenerator<PipelineEvent> {
  const { goal, run, task } = contract
  const { executor, workDir, sessionID, executorSessionID, queueTaskID, signal } = deps
  const goalRunID = await findGoalRunByGoalAndRun(goal.id, run.id)
  if (!goalRunID) {
    yield { type: "failed", error: "No goal_run record found", failureClass: "goal_wrong" }
    return
  }

  try {
    // ── Execute (stream events from executor, extract delivery) ──
    yield { type: "executing" }
    updateGoalRun(goalRunID, { status: "running" })

    const result = yield* streamExecutorEvents(contract, deps, goalRunID)

    if (signal.aborted) {
      yield { type: "aborted" }
      return
    }

    if (!result.delivery) {
      // Only update goal_run — NOT goal.status (that's the Orchestrator's job)
      updateGoalRun(goalRunID, {
        status: "failed",
        error: result.error,
        time_completed: Date.now(),
      })
      updateGoalRunExecutorSessionStatus(goalRunID, "failed")
      yield { type: "failed", error: result.error, failureClass: "bug" }
      return
    }

    const delivery = result.delivery

    yield { type: "executed", delivery }

    // Persist delivery to DB — goal-scoped variant, does NOT create an
    // evaluation row (see persist.ts: per-goal evals have no updater).
    const deliveryID = Identifier.ascending("delivery")
    persistGoalDelivery({
      task, run, goalRunID, deliveryID,
      delivery: { summary: delivery.summary, commitRef: delivery.commitRef, diffs: delivery.diffs, report: delivery.report },
      now: Date.now(),
    })

    // Executor finished — move to `evaluating`, not `completed`. goal-pool
    // is the only caller; it hands the delivery to the delivery agent which
    // settles the row to completed/failed. Keeping the row in `evaluating`
    // at this point means engine_goal.status can be derived from goal_run
    // alone (Phase 4 invariant) — a delivered-but-rejected goal no longer
    // requires a separate UPDATE on engine_goal.
    updateGoalRun(goalRunID, { status: "evaluating" })
    updateGoalRunExecutorSessionStatus(goalRunID, "completed")

    log.info("goal_run moved to evaluating", {
      goalRunID, goalID: goal.id, files: delivery.diffs.length,
    })

    yield { type: "completed", delivery }

  } catch (err) {
    if (signal.aborted) {
      yield { type: "aborted" }
      return
    }
    const error = err instanceof Error ? err.message : String(err)
    log.error("goal_run failed", { goalRunID, goalID: goal.id, error })
    updateGoalRun(goalRunID, {
      status: "failed",
      error: `Execution error: ${error}`,
      time_completed: Date.now(),
    })
    updateGoalRunExecutorSessionStatus(goalRunID, "failed")
    yield { type: "failed", error, failureClass: "bug" }
  }
}

// ---------------------------------------------------------------------------
// Stream executor events and extract delivery
// ---------------------------------------------------------------------------

async function* streamExecutorEvents(
  contract: GoalContract,
  deps: PipelineDeps,
  goalRunID: string,
): AsyncGenerator<PipelineEvent, StreamResult> {
  const { goal, run, task } = contract
  const { executor, workDir, sessionID, executorSessionID, queueTaskID, signal, baseRef } = deps

  if (!executor.capabilities().events) {
    const status = await executor.status(queueTaskID).catch(() => ({
      status: "failed" as const, error: "status check failed",
    }))
    if (status.status === "failed") {
      return { error: status.error ?? "Executor failed (no event stream)" }
    }
    return { delivery: await extractDelivery(goalRunID, workDir, goal.id, baseRef, sessionID) }
  }

  // Completion detection (multi-signal):
  // 1. Primary: task-queue.completed event → for-await loop exits
  // 2. Secondary: session.idle event → LLM turn finished; grace-window then exit
  //    Rationale: task-queue.completed depends on SessionPrompt.prompt() returning
  //    after flushCallbacks. Under parallel load this chain sometimes breaks
  //    (callback promise does not resolve), leaving the queue task stuck in
  //    "running". session.idle is emitted synchronously when the session enters
  //    standby, so it's a more reliable LLM-turn-done signal.
  // 3. Fallback: status poller detects executor finished every 5s
  // 4. Safety net: inactivity timeout — no events for this period → dead.
  //    TOOL_RUNNING timeout applies while at least one tool is in the `running`
  //    state; long-running subprocesses (e.g. `npm install`) can go silent for
  //    90s+ of stdout/stderr, so the plain inactivity timeout would incorrectly
  //    kill them. The extended threshold keeps the watchdog useful for genuinely
  //    dead sessions while letting legitimately long tool invocations complete.
  const INACTIVITY_TIMEOUT_MS = Number(process.env.OPENCORVUS_GOAL_INACTIVITY_TIMEOUT_MS) || 90_000
  const TOOL_RUNNING_INACTIVITY_TIMEOUT_MS = Number(process.env.OPENCORVUS_GOAL_TOOL_RUNNING_INACTIVITY_TIMEOUT_MS) || 600_000
  const STATUS_POLL_INTERVAL_MS = 5_000
  const IDLE_GRACE_MS = Number(process.env.OPENCORVUS_GOAL_IDLE_GRACE_MS) || 15_000

  const streamAbort = new AbortController()
  const combinedSignal = AbortSignal.any([signal, streamAbort.signal])
  let streamDone = false
  let lastActivityAt = Date.now()
  let idleSince: number | undefined
  let idleGraceExceeded = false
  let inactivityTimeoutExceeded = false
  // Tracks callIDs of tools currently in the `running` state. While non-empty,
  // the inactivity watchdog uses the extended TOOL_RUNNING threshold. Populated
  // from message.part.updated events whose part.type === "tool".
  const runningTools = new Set<string>()

  // Status poller + inactivity watchdog + idle-grace detector
  const poller = (async () => {
    while (!streamDone && !combinedSignal.aborted) {
      await new Promise(r => setTimeout(r, STATUS_POLL_INTERVAL_MS))
      if (streamDone || combinedSignal.aborted) break
      try {
        const s = await executor.status(queueTaskID)
        if (s.status === "completed" || s.status === "failed") {
          log.info("status poller detected executor completion", { goalRunID, status: s.status })
          streamAbort.abort("executor completed (poller)")
          break
        }
      } catch (err) {
        log.warn("status poller error", { goalRunID, error: err instanceof Error ? err.message : String(err) })
      }
      // Idle-grace detector: session signalled idle → LLM turn done.
      // If queue task doesn't complete within IDLE_GRACE_MS, the callback chain
      // is stuck — trust the session.idle signal and break out.
      if (idleSince !== undefined) {
        const idleMs = Date.now() - idleSince
        if (idleMs >= IDLE_GRACE_MS) {
          log.warn("session idle + queue task still running — forcing completion", { goalRunID, idleMs })
          idleGraceExceeded = true
          streamAbort.abort("session idle grace exceeded")
          break
        }
      }
      // Inactivity watchdog: if no event activity for the applicable threshold,
      // abort. When a tool is executing (runningTools non-empty) the threshold
      // is extended because tools like `npm install` can go silent for 90s+
      // during dependency resolution without the session being dead.
      const inactiveMs = Date.now() - lastActivityAt
      const threshold = pickInactivityThreshold(
        runningTools.size, INACTIVITY_TIMEOUT_MS, TOOL_RUNNING_INACTIVITY_TIMEOUT_MS,
      )
      if (inactiveMs >= threshold) {
        log.warn("inactivity timeout — forcing completion", {
          goalRunID, inactiveMs, threshold, runningTools: runningTools.size,
        })
        inactivityTimeoutExceeded = true
        streamAbort.abort("inactivity timeout")
        break
      }
    }
  })()

  let lastHeartbeat = Date.now()
  for await (const event of executor.events({ goalID: goal.id, sessionID, queueTaskID, signal: combinedSignal })) {
    if (combinedSignal.aborted) break

    lastActivityAt = Date.now()
    if (event.type === "session.idle" && idleSince === undefined) {
      idleSince = Date.now()
      log.info("session idle detected — starting grace window", { goalRunID, graceMs: IDLE_GRACE_MS })
    }
    // Track tool lifecycle for the extended-threshold rule. The opencode
    // executor wrapper re-emits Message.PartUpdated events as
    // `message.part.updated` with payload.part. ToolPart carries callID +
    // state.status (pending | running | completed | error).
    if (event.type === "message.part.updated") {
      const payload = (event as { payload?: unknown }).payload as { part?: unknown } | undefined
      const part = payload?.part as {
        type?: string
        callID?: string
        state?: { status?: string }
      } | undefined
      if (part?.type === "tool" && typeof part.callID === "string") {
        const status = part.state?.status
        if (status === "running") {
          runningTools.add(part.callID)
        } else if (status === "completed" || status === "error") {
          runningTools.delete(part.callID)
        }
      }
    }
    yield { type: "executor_event", event }

    const now = Date.now()
    if (now - lastHeartbeat >= HEARTBEAT_INTERVAL_MS) {
      lastHeartbeat = now
      EngineProtocol.emit(Event.GoalProgress, {
        taskID: task.id, goalRunID, summary: `Goal ${goalRunID.slice(-8)} executing`,
      }, { taskID: task.id, runID: run.id, goalRunID, source: "goal-executor" })
        .catch(err => log.warn("GoalProgress heartbeat emit failed", { goalRunID, error: String(err) }))
      yield { type: "heartbeat" }
    }
  }
  streamDone = true
  streamAbort.abort("stream ended")
  // Poller races the stream; after streamAbort it rejects with AbortError.
  // We join it so the handle doesn't leak, but a genuine poller bug would
  // also land here, so we log non-abort rejections instead of swallowing.
  await poller.catch(err => {
    if (!streamAbort.signal.aborted) {
      log.warn("poller rejected unexpectedly", { goalRunID, error: String(err) })
    }
  })

  if (signal.aborted) return { error: "Execution aborted" }

  // idleGraceExceeded: session.idle fired → LLM turn genuinely done, but
  // the queue-task callback chain is stuck. Previously this path called
  // extractDelivery() under the assumption that "idle means finished". That
  // assumption is a silent-pass: a goal session can be idle because it hung
  // on a permission prompt, crashed mid-thought, or genuinely completed —
  // we cannot tell from the idle signal alone. Returning an error here
  // forces goal-pool's empty-delivery guard to surface the failure to the
  // Orchestrator, which can then decide to retry, modify, or fail the goal.
  // Extracting a possibly-empty snapshot and calling it "passed" was the
  // mechanism behind the 006/007 benchmark stall.
  if (idleGraceExceeded) {
    log.warn("session idle grace exceeded — treating as failure (no silent extract)", { goalRunID })
    await finalizeQueueTaskRow({
      queueTaskID,
      status: "failed",
      goalRunID,
    })
    return {
      error:
        "Session idle-grace window exceeded without queue-task completion — " +
        "callback chain is stuck or session hung mid-turn. " +
        "Goal is marked failed; Orchestrator decides whether to retry.",
    }
  }

  // inactivityTimeoutExceeded: no events for the applicable threshold. The
  // executor is dead — permission hang, LLM crash, network failure, or a
  // genuinely wedged tool. Report which threshold fired so the operator
  // knows whether it was the plain (no tool running) or tool-running variant.
  if (inactivityTimeoutExceeded) {
    const hadRunningTool = runningTools.size > 0
    const seconds = hadRunningTool
      ? TOOL_RUNNING_INACTIVITY_TIMEOUT_MS / 1000
      : INACTIVITY_TIMEOUT_MS / 1000
    const cause = hadRunningTool
      ? `tool wedged (${runningTools.size} running), permission hang, or LLM crash`
      : "permission hang, LLM timeout, or network failure"
    const reason = `Executor produced no events for ${seconds}s — session is dead (possible causes: ${cause})`
    log.error("inactivity timeout — failing goal_run", { goalRunID, reason, hadRunningTool })
    await abortDeadExecutor({
      executor,
      sessionID,
      queueTaskID,
      goalRunID,
      reason,
    })
    return { error: reason }
  }

  const status = await Promise.race([
    executor.status(queueTaskID),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error("executor.status() timeout")), EXECUTOR_STATUS_TIMEOUT_MS),
    ),
  ]).catch((err) => ({
    status: "failed" as const,
    error: err instanceof Error ? err.message : "status check failed after stream end",
  }))

  if (status.status !== "completed") {
    const failError = status.error ?? `Executor finished with status "${status.status}" (no error detail)`
    log.error("goal_run executor status not completed", { runID: run.id, goalRunID, goalID: goal.id, statusResult: status.status, error: failError })
    return { error: failError }
  }

  return { delivery: await extractDelivery(goalRunID, workDir, goal.id, baseRef, sessionID) }
}

// ---------------------------------------------------------------------------
// Extract delivery diffs via the worktree's own git.
//
// The per-goal worktree is already a proper git worktree with its own
// index + HEAD + branch. baseRef is the worktree HEAD captured before the
// executor starts (goal-pool.ts); after the executor finishes,
// `deliveryFromWorktree` stages everything (`git add -A`), commits, and
// diffs baseRef..HEAD for the FileDiff[] payload. Missing workDir/baseRef
// is a dispatch bug — fail loud.
// ---------------------------------------------------------------------------

async function extractDelivery(
  goalRunID: string,
  workDir: string | undefined,
  goalID: string,
  baseRef: string,
  // `goal_report` is a tool call persisted on the user-facing session
  // (sessionID, prefix "ses"), not the executor protocol session
  // (executorSessionID, prefix "exs"). extractGoalReport calls
  // `Session.messages({sessionID})` which Zod-validates the id prefix —
  // passing the executor session id caused every goal to fail with
  // `Invalid string: must start with "ses"` (iter-6).
  sessionID: string,
): Promise<PipelineDelivery> {
  if (!workDir) {
    throw new Error(`extractDelivery: workDir is required (goalRunID=${goalRunID}, goalID=${goalID}). Per-goal dispatch must create a worktree before running the executor — an absent worktree is a dispatch-time bug, not a runtime condition.`)
  }
  const result = await Instance.provide({
    directory: workDir,
    fn: () => deliveryFromWorktree(baseRef, `Goal ${goalID.slice(-8)}`),
  })
  // Executor contract: goal_report is mandatory and terminal. extractGoalReport
  // throws on missing / duplicated / invalid — those are failures, not fallback
  // conditions. Attach the parsed report to the delivery so the delivery agent
  // can adversarially cross-check its claims against the diff.
  const report = await extractGoalReport(sessionID)
  log.info("delivery extracted", {
    goalRunID,
    files: result.delivery.diffs.length,
    baseRef,
    mergeRef: result.mergeRef,
    reportFiles: report.files_changed.length,
    reportDecisions: report.design_decisions.length,
  })
  return { ...result.delivery, report }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function findGoalRunByGoalAndRun(goalID: string, runID: string): Promise<string | undefined> {
  const { listGoalRunsForRun } = await import("@/engine/store")
  const runs = listGoalRunsForRun(runID) as Array<{ id: string; goal_id: string; status: string }>
  // `aborted` must be excluded alongside `completed`/`failed` — goal_run FSM
  // treats all three as terminal (see engine/goal-run-state-machine.ts). Without
  // excluding aborted, a retry after signal-aborted or evaluator-aborted goal_run
  // re-enters with the same ID and the downstream `updateGoalRun(status:"running")`
  // throws `Invalid goal_run transition: aborted -> running`. Observed in
  // usage-replica-vague bench6: one goal stuck in pending↔failed oscillation
  // across 4+ retry cycles because dispatch kept handing back the same
  // aborted goal_run instead of triggering supersede → createGoalRun.
  const active = runs.find((gr) =>
    gr.goal_id === goalID &&
    gr.status !== "completed" &&
    gr.status !== "failed" &&
    gr.status !== "aborted",
  )
  return active?.id
}

async function abortDeadExecutor(input: {
  executor: PipelineDeps["executor"]
  sessionID: string
  queueTaskID: string
  goalRunID: string
  reason: string
}) {
  try {
    await input.executor.abort({
      sessionID: input.sessionID,
      queueTaskID: input.queueTaskID,
    })
  } catch (err) {
    log.warn("failed to abort dead executor session", {
      goalRunID: input.goalRunID,
      queueTaskID: input.queueTaskID,
      error: err instanceof Error ? err.message : String(err),
    })
  }
  await finalizeQueueTaskRow({
    queueTaskID: input.queueTaskID,
    status: "failed",
    error: input.reason,
    goalRunID: input.goalRunID,
  })
}

async function finalizeQueueTaskRow(input: {
  queueTaskID: string
  status: "completed" | "failed"
  error?: string
  goalRunID: string
}) {
  try {
    const { TaskQueueTable } = await import("@/scheduler/task-queue.sql")
    Database.use((db) =>
      db
        .update(TaskQueueTable)
        .set({
          status: input.status,
          ...(input.status === "failed" ? { error_message: input.error ?? "executor aborted" } : { error_message: null }),
          time_completed: Date.now(),
          time_updated: Date.now(),
        })
        .where(and(eq(TaskQueueTable.id, input.queueTaskID), eq(TaskQueueTable.status, "running")))
        .run(),
    )
  } catch (err) {
    log.warn("failed to finalize queue task row", {
      goalRunID: input.goalRunID,
      queueTaskID: input.queueTaskID,
      status: input.status,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
