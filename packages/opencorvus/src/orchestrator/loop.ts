/**
 * Task Control Loop — the single entry point for task lifecycle.
 *
 * Post-phase-5 model: the GoalPool is gone. The orchestrator dispatches work
 * via the `build` tool which runs SYNCHRONOUSLY inside one orchestrator
 * step (SessionPrompt + parallel tool_calls). One processTask invocation
 * can therefore drive the full build → deliver → publish cycle in one
 * decision pass. The outer loop's job shrinks to:
 *
 *   1. Mark the task active and bound decision rounds against runaway.
 *   2. Wake the orchestrator with an optional caller-supplied event note.
 *   3. After processTask returns, check:
 *      - task terminal → exit
 *      - delivery-agent verdict artifact was newly rejected → auto-rewake
 *        with the structured rejection note so the orchestrator gets an
 *        ergonomic re-entry point without the operator typing anything
 *      - otherwise exit; the next wake comes from an operator event or a
 *        scheduler tick.
 *
 * What this does NOT own:
 *   - Deciding what the orchestrator does on wake (LLM reads describe).
 *   - Dispatching goals to sub-workers (the `build` tool body handles that).
 *   - Polling goal_run rows (phase 5 removed the pool; build is blocking).
 *   - Constructing typed triggers (phase 2 removed the enum).
 */

import { Log } from "@/util/log"
import type { RuntimeHooks } from "@/engine/runtime-hooks"
import { Orchestrator, OrchestratorEventNote, type OrchestratorEvent } from "@/orchestrator/agent"
import { findTask } from "@/engine"
import { deriveTaskStatus, isTaskActive, isTaskQueued, isTaskTerminal } from "@/engine/task-status"

const log = Log.create({ service: "orchestrator-loop" })

// Per-taskID serial chain. A second runTaskLoop() call for the same task
// waits for the in-flight loop to finish, then runs a fresh decision pass —
// which reads the freshly-appended session message. Replaces the previous
// in-memory "is running" Set that silently dropped user messages into
// recordOperatorNote and was the root of the "queued, no resume" bug.
const taskLoopChain = new Map<string, Promise<void>>()
const taskLoopAbort = new Map<string, AbortController>()

function combineSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const active = signals.filter((signal): signal is AbortSignal => !!signal)
  if (active.length === 0) return undefined
  if (active.length === 1) return active[0]

  const controller = new AbortController()
  const listeners = new Map<AbortSignal, () => void>()

  const abortFrom = (source: AbortSignal) => {
    if (!controller.signal.aborted) controller.abort(source.reason)
    for (const [signal, listener] of listeners) {
      signal.removeEventListener("abort", listener)
    }
    listeners.clear()
  }

  for (const signal of active) {
    if (signal.aborted) {
      abortFrom(signal)
      return controller.signal
    }
    const listener = () => abortFrom(signal)
    listeners.set(signal, listener)
    signal.addEventListener("abort", listener, { once: true })
  }

  return controller.signal
}

export function interruptTaskLoop(taskID: string, reason = "task loop interrupted") {
  taskLoopAbort.get(taskID)?.abort(reason)
  Orchestrator.abort(taskID)
  // Detach the chain tail. If the aborted inner loop is hung on a non
  // signal-aware await (observed in benchmarks: LLM streams that acknowledge
  // abort by setting a flag but never reject the outer Promise), a subsequent
  // runTaskLoop() would chain `prev.then()` onto that zombie Promise and wait
  // forever for the next wake to fire.
  // Dropping the Map entry here means the NEXT runTaskLoop() starts from
  // Promise.resolve() instead — the old loop's cleanup still runs when its
  // Promise eventually resolves, it just no longer gates later wakes.
  // processTask's own `abort(taskID)` preamble serialises any brief overlap
  // between the old tail and the new head.
  taskLoopChain.delete(taskID)
}

export async function runTaskLoop(input: {
  taskID: string
  event?: OrchestratorEvent
  signal?: AbortSignal
  hooks: RuntimeHooks
}) {
  const prev = taskLoopChain.get(input.taskID) ?? Promise.resolve()
  const next = prev.catch(() => undefined).then(async () => {
    const localAbort = new AbortController()
    taskLoopAbort.set(input.taskID, localAbort)
    try {
      await runTaskLoopInner({
        ...input,
        signal: combineSignals([input.signal, localAbort.signal]),
      })
    } finally {
      if (taskLoopAbort.get(input.taskID) === localAbort) {
        taskLoopAbort.delete(input.taskID)
      }
    }
  })
  taskLoopChain.set(input.taskID, next)
  // Clean up only if we're still the tail — a later call may have chained
  // on top of `next` before it resolved, and that one must stay in the map.
  next.finally(() => {
    if (taskLoopChain.get(input.taskID) === next) taskLoopChain.delete(input.taskID)
  })
  return next
}

/**
 * Run the full task lifecycle as a blocking loop.
 *
 * Returns when the task reaches a terminal state (completed / failed /
 * cancelled), when the iteration budget is exhausted, or when no
 * auto-rewake condition (delivery rejection) is observed after an
 * orchestrator pass. Concurrent entries for the same task are serialised
 * by `runTaskLoop` above.
 */
async function runTaskLoopInner(input: {
  taskID: string
  event?: OrchestratorEvent
  signal?: AbortSignal
  // Retained for API compatibility; the post-phase-5 loop no longer threads
  // hooks into a pool driver. Left in the signature so dispatchTaskLoop's
  // callers stay unchanged.
  hooks?: RuntimeHooks
}) {
  const { taskID, signal } = input
  let event = input.event

  void input.hooks

  // Immediately mark the task as active so the cwd-scoped queue can observe
  // that this task now owns execution for its workspace before the first
  // orchestrator decision completes.
  {
    const { updateTask } = await import("@/engine/state")
    const task = findTask(taskID)
    if (task && isTaskQueued(task)) {
      await updateTask(task, { status: "active" }, "Task loop started — marking active for serial queue")
    }
  }

  log.info("task loop started", { taskID, note: event?.note })

  // ── Main loop: Decision → (optional auto-rewake on delivery rejection) → Decision ──
  let decisionTurn = 0
  /** Absolute task-level iteration budget — the sole runaway guard on this
   *  loop. Per LLM-autonomous redesign the loop does not classify "stuck"
   *  itself; if the LLM is not making progress it can read the trajectory
   *  on its next decision turn (via describe / query_metric_trajectory) and
   *  call fail_task. The hard ceiling only exists so a truly wedged LLM
   *  cannot burn unbounded decision rounds. Override via
   *  `OPENCORVUS_MAX_TASK_ITERATIONS` (e.g. 200 for a debug PRD run). */
  const MAX_TASK_ITERATIONS = parseInt(
    process.env.OPENCORVUS_MAX_TASK_ITERATIONS || "50",
    10,
  )
  /** Floor for `findRecentDeliveryRejection` — only consider verdict
   *  artifacts newer than this. Initialized to loop start so we don't react
   *  to pre-existing verdicts from previous loop runs of the same task
   *  (e.g. crash recovery), and bumped past every consumed artifact so a
   *  single rejection only fires the wake once. */
  let lastReworkSeenAt = Date.now()

  while (!signal?.aborted) {
    const task = findTask(taskID)
    if (!task) {
      log.error("task not found, exiting loop", { taskID })
      break
    }

    // Terminal-state exit. Operator messages / retry requests arrive as a
    // caller-supplied event.note and must be allowed to wake a terminal
    // task so the orchestrator can revive it; bare state-read wakes must
    // not, or the loop burns turns on nothing.
    if (isTaskTerminal(task) && !event) {
      log.info("task in terminal state, exiting loop", { taskID, status: deriveTaskStatus(task) })
      break
    }

    decisionTurn++
    // Task-level iteration budget (hard ceiling) counts only actual
    // Orchestrator decision turns.
    if (decisionTurn > MAX_TASK_ITERATIONS) {
      const { updateTask } = await import("@/engine/state")
      log.error("task iteration budget exhausted — failing task", {
        taskID, decisionTurn, max: MAX_TASK_ITERATIONS,
      })
      await updateTask(task, {
        status: "failed",
        error: `Task iteration budget exhausted: decision turns ${decisionTurn}/${MAX_TASK_ITERATIONS}. ` +
          `Increase OPENCORVUS_MAX_TASK_ITERATIONS if the workload legitimately needs more rounds.`,
      }, "task-iteration budget")
      break
    }

    // ── Decision Point ──
    // Call Orchestrator with the current event note. Post-phase-5 a single
    // processTask pass can drive build (possibly in parallel) + deliver +
    // publish in one AI-SDK step chain, so the outer loop does NOT need
    // to schedule goal dispatch itself.
    log.info("decision point", { taskID, iteration: decisionTurn, note: event?.note })

    try {
      await Orchestrator.processTask(taskID, event)
    } catch (err) {
      if (signal?.aborted) break
      log.error("orchestrator error at decision point", { taskID, error: String(err) })
      // Don't break immediately — the auto-rewake check below may still
      // find a delivery-rejection artifact worth acting on; otherwise the
      // loop exits normally at the end of this iteration.
    }
    // Consume the event: subsequent iterations synthesise their own wake
    // notes from state reads below. The caller's initial event is one-shot.
    event = undefined

    const taskAfter = findTask(taskID)
    if (!taskAfter) break
    if (isTaskTerminal(taskAfter)) {
      log.info("task entered terminal state after decision", {
        taskID,
        status: deriveTaskStatus(taskAfter),
      })
      break
    }

    // ── Delivery rejection detection (auto-rewake) ──
    // When `deliver` rejects it writes a verdict artifact
    // (label="delivery-agent-verdict", payload.verdict="rejected"). If the
    // orchestrator ran deliver and then STOPPED without calling build+deliver
    // again, this auto-rewake gives it one more cycle with the rejection
    // payload surfaced as a wake note. The artifact watermark makes a given
    // rejection fire at most once.
    //
    // Keyed on the verdict artifact — NOT on goal_run.superseded_reason
    // string matching. Per rule 23 we do not branch on enum label values;
    // the artifact is the first-class delivery output.
    if (isTaskActive(taskAfter)) {
      const { findRecentDeliveryRejection } = await import("@/engine/store")
      const verdictArt = findRecentDeliveryRejection(taskID, lastReworkSeenAt)
      if (verdictArt) {
        lastReworkSeenAt = (verdictArt.time_created ?? Date.now()) + 1
        const verdict = (verdictArt.payload ?? {}) as Record<string, unknown>
        log.info("delivery rejection detected — re-waking orchestrator", {
          taskID,
          verdictArtifactID: verdictArt.id,
        })
        event = {
          note: OrchestratorEventNote.deliveryRejected({
            verdictSummary: typeof verdict.summary === "string" ? verdict.summary : undefined,
            issues: Array.isArray(verdict.issues_found) ? (verdict.issues_found as string[]) : [],
            rejectionDetails: Array.isArray(verdict.rejection_details)
              ? (verdict.rejection_details as Array<{ category?: string; file?: string; error?: string; suggestion?: string }>)
              : [],
          }),
        }
        continue
      }
    }

    // ── Build-settled-without-deliver detection (auto-rewake) ──
    // Workflow contract: `deliver` is mandatory after every build batch. The
    // orchestrator's LLM occasionally ends its turn after build returns
    // without dispatching deliver (compliance drift, or it mis-classifies a
    // verification-kind goal as a build target). Without this rewake the
    // task sits idle until an external trigger arrives — which never comes
    // for autonomous benchmark runs. We watermark on `goal_run_attempt`
    // artifacts so a single batch only fires once; if the LLM re-skips
    // deliver after the rewake, MAX_TASK_ITERATIONS still bounds runaway.
    if (isTaskActive(taskAfter)) {
      const { findRecentBuildSettlement, hasDeliveryVerdictSince } = await import("@/engine/store")
      const settlement = findRecentBuildSettlement(taskID, lastReworkSeenAt)
      if (settlement && !hasDeliveryVerdictSince(taskID, lastReworkSeenAt)) {
        lastReworkSeenAt = (settlement.time_created ?? Date.now()) + 1
        log.info("build batch settled without deliver — re-waking orchestrator", {
          taskID,
          settlementArtifactID: settlement.id,
        })
        event = {
          note: OrchestratorEventNote.deliverPending({ settledGoalCount: 1 }),
        }
        continue
      }
    }

    // ── Orchestrator stream-error detection (auto-rewake) ──
    // When the orchestrator's own LLM stream aborts mid-decision (provider
    // onError, session-llm idle watchdog), agent.ts records an
    // `orchestrator-stream-error` artifact instead of marking the task
    // terminal. We auto-rewake with the structured retry note so the next
    // decision turn lets the LLM read the abort fact + session log and
    // decide for itself. Same watermark + at-most-once semantics as the
    // delivery-rejection branch above. Per rule 23 the recovery decision
    // belongs to the LLM, not to this loop. `MAX_TASK_ITERATIONS` is the
    // runaway guard; each transient hang costs one decision turn.
    if (isTaskActive(taskAfter)) {
      const { findRecentOrchestratorStreamError } = await import("@/engine/store")
      const errArt = findRecentOrchestratorStreamError(taskID, lastReworkSeenAt)
      if (errArt) {
        lastReworkSeenAt = (errArt.time_created ?? Date.now()) + 1
        const payload = (errArt.payload ?? {}) as Record<string, unknown>
        log.info("orchestrator stream error detected — re-waking orchestrator", {
          taskID,
          artifactID: errArt.id,
          iteration: decisionTurn,
        })
        event = {
          note: OrchestratorEventNote.streamErrorRetry({
            reason: typeof payload.reason === "string" ? payload.reason : "stream error",
            sessionID: typeof payload.sessionID === "string" ? payload.sessionID : undefined,
          }),
        }
        continue
      }
    }

    // No auto-rewake signal detected. The orchestrator either stopped mid
    // task (pending operator input, awaiting external trigger) or finished
    // without marking terminal. Exit and let the next external wake
    // (operator message, scheduler tick, ownership recovery) re-enter.
    log.info(
      "orchestrator pass ended with no auto-rewake signal — loop exiting",
      { taskID, iteration: decisionTurn, taskStatus: deriveTaskStatus(taskAfter) },
    )
    break
  }

  log.info("task loop exited", { taskID, iteration: decisionTurn })
  // Queue progression is owned by engine/queue.ts. This loop only owns one
  // task's lifecycle and leaves sibling dispatch to the cwd queue.
}
