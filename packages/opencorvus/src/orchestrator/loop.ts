/**
 * Task Control Loop — the single entry point for task lifecycle.
 *
 * One wake = one orchestrator decision pass. There is no internal loop, no
 * watermark, no auto-rewake. The orchestrator LLM owns every workflow
 * decision through its own tool calls (dispatch_goal / deliver / modify_goal /
 * fail_task / question). When it stops, the loop exits. The next wake comes
 * from an external trigger (operator message, scheduler tick, ownership
 * recovery) — re-entering this function with a fresh event.
 *
 * Per rule 23 (no state machines): the loop does NOT inspect artifacts and
 * synthesise wake notes to push the LLM through a fixed pipeline. Past
 * iterations grew three such gates (acceptance-rejection rewake,
 * build-settled-without-deliver rewake, orchestrator-stream-error rewake);
 * all three were FSM in disguise and have been deleted.
 *
 * What this owns:
 *   - Per-taskID serial chain (so concurrent wakes don't double-run).
 *   - Marking queued → active so the cwd-scoped queue sees ownership.
 *
 * What this does NOT own:
 *   - Deciding what the orchestrator does on wake (LLM reads describe).
 *   - Dispatching goals (the `build` tool body handles that).
 *   - Reacting to acceptance rejection / build settlement / stream error —
 *     those are facts the LLM reads via describe on its next decision turn.
 */

import { Log } from "@/util/log"
import type { RuntimeHooks } from "@/engine/runtime-hooks"
import { Orchestrator, type OrchestratorEvent } from "@/orchestrator/agent"
import { findTask } from "@/engine"
import { deriveTaskStatus, isTaskQueued, isTaskTerminal } from "@/engine/task-status"

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

export async function awaitTaskLoopIdle(taskID: string, idleTimeoutMs: number) {
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
    throw new Error(`awaitTaskLoopIdle: invalid idleTimeoutMs ${idleTimeoutMs}`)
  }

  let lastSignature = ""
  let idleDeadline = Date.now() + idleTimeoutMs
  while (true) {
    const signature = [taskLoopAbort.has(taskID) ? "loop" : "", Orchestrator.isRunning(taskID) ? "orchestrator" : ""]
      .filter(Boolean)
      .join("+")

    if (!signature) return

    if (signature !== lastSignature) {
      lastSignature = signature
      idleDeadline = Date.now() + idleTimeoutMs
    }

    if (Date.now() > idleDeadline) {
      throw new Error(
        `awaitTaskLoopIdle: task ${taskID} did not become idle after ${idleTimeoutMs}ms without state changes`,
      )
    }

    await new Promise<void>((resolve) => setTimeout(resolve, 50))
  }
}

export async function runTaskLoop(input: {
  taskID: string
  event?: OrchestratorEvent
  signal?: AbortSignal
  hooks: RuntimeHooks
}) {
  const prev = taskLoopChain.get(input.taskID) ?? Promise.resolve()
  const next = prev
    .catch(() => undefined)
    .then(async () => {
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
 * Run one orchestrator decision pass.
 *
 * Single-pass: enter, mark active if queued, run `Orchestrator.processTask`
 * once with the caller event, exit. There is no internal rewake. If the
 * LLM stops mid-task (acceptance rejection, build settled, stream error,
 * pending question), the next external trigger re-enters this function.
 * Concurrent entries for the same task are serialised by `runTaskLoop`.
 */
async function runTaskLoopInner(input: {
  taskID: string
  event?: OrchestratorEvent
  signal?: AbortSignal
  // Retained for API compatibility; the loop no longer threads hooks into a
  // pool driver. Left in the signature so dispatchTaskLoop's callers stay unchanged.
  hooks?: RuntimeHooks
}) {
  const { taskID, signal, event } = input

  void input.hooks

  // Mark queued tasks active so the cwd-scoped queue sees ownership before
  // the first orchestrator decision completes.
  {
    const { updateTask } = await import("@/engine/state")
    const task = findTask(taskID)
    if (task && isTaskTerminal(task)) {
      log.info("terminal task loop wake ignored", { taskID, status: deriveTaskStatus(task), note: event?.note })
      return
    }
    if (task && isTaskQueued(task)) {
      await updateTask(task, { status: "active" }, "Task loop started — marking active for serial queue")
    }
  }

  log.info("task loop started", { taskID, note: event?.note })

  if (signal?.aborted) return

  const task = findTask(taskID)
  if (!task) {
    log.error("task not found, exiting loop", { taskID })
    return
  }
  if (isTaskTerminal(task)) {
    log.info("terminal task loop wake ignored", { taskID, status: deriveTaskStatus(task), note: event?.note })
    return
  }

  // Capture the git baseline before the orchestrator's first decision touches
  // the worktree. EngineGit.prepare is idempotent (early-returns when baseline
  // already exists), so wakes after the first one are no-ops. Without this
  // call, task.metadata.git.baseline.commit stays unset for the task's whole
  // lifetime; the publisher's workspace_export adapter then throws on every
  // acceptance attempt and the orchestrator loops on the rework signal.
  {
    const { EngineGit } = await import("@/engine/git")
    const result = await EngineGit.prepare(task)
    if (result.error) {
      log.warn("EngineGit.prepare failed", { taskID, error: result.error })
    }
  }

  log.info("decision point", { taskID, note: event?.note })

  try {
    await Orchestrator.processTask(taskID, event)
  } catch (err) {
    if (signal?.aborted) return
    // Pass the Error object directly so Log.formatError walks the stack +
    // err.cause chain. String(err) collapses to message-only and hides the
    // underlying provider/transport/DB cause.
    log.error("orchestrator error at decision point", { taskID, error: err })
  }

  log.info("task loop exited", { taskID })
}
