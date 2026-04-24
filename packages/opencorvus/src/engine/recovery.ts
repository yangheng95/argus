/**
 * Engine execution recovery.
 *
 * Phase-1 shape (see `specs/new-arch/16-unified-teardown.md` §1.5, §7-1):
 * this module splits the pre-existing `recoverProjectExecution` path into
 * three separable responsibilities so that phase 4+ can tear the physical
 * "abort brake" down without touching the orphan-observation pipeline:
 *
 *   1. `observeOrphanRuns(projectID)` — PURE FACT. Returns the list of
 *      live `engine_run` rows that have no live `engine_goal_run` attached.
 *      No writes. No aborts. Used by the describe projection to surface
 *      `run_orphan` on `TaskDesc`.
 *
 *   2. `cleanupOrphanExecutionArtifacts(projectID)` — PHYSICAL BRAKE.
 *      Aborts orphan runs + live executor sessions + live goal runs and
 *      drives OS-level cleanup via the `Ownership` registry (worktree
 *      markers + child-process markers whose owner PID is dead).
 *
 *      The abort calls remain ON for phase 1 because `active_run_id` and
 *      the queue/runtime/tool gates downstream still treat live `engine_run`
 *      rows as control-plane truth (see engine/queue.ts, engine/runtime.ts,
 *      orchestrator/tools.ts). Flipping them off before phase 4 would park
 *      every task on a stale `active_run_id`. Phase 4 removes those gates,
 *      and at that point this function can drop the abort half and become
 *      pure ownership sweeping.
 *
 *   3. `recoverProjectExecution(...)` — legacy composite entry point. Runs
 *      observe → cleanup → resume-task-loops in order. Callers that only
 *      want facts should call `observeOrphanRuns` directly; callers that
 *      only want physical cleanup should call `cleanupOrphanExecutionArtifacts`.
 *
 * THE TASK LOOP IS NOT AUTOMATICALLY RESTARTED by observe/cleanup. Only
 * `recoverProjectExecution` resumes active task loops, matching the prior
 * behaviour. Per the user-message-driven model, tasks stay at
 * status="active" in DB; whether a loop is currently in flight is not
 * tracked — every user message unconditionally calls runTaskLoop, and the
 * per-taskID serial chain in orchestrator/loop.ts ensures concurrent
 * calls are linearised rather than dropped.
 */

import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { advanceQueue, listActiveForCwd, listOrphanedActiveInProject, listQueuedCwdsInProject, resumeActiveTaskLoop } from "./queue"
import {
  abortLiveExecutionForProject,
  abortRuns,
} from "./writer"
import {
  listLiveGoalRunsForProject,
  listLiveRunsForProject,
  searchProjectTasks,
  type RunRow,
} from "./store"
import { Ownership } from "./ownership"
import { Worktree } from "@/worktree"

const log = Log.create({ service: "engine-recovery" })

const RECOVERY_REASON = "Process restart: executor session lost during recovery"

/**
 * Pure observation: list live engine_run rows that have no live
 * engine_goal_run attached. Shape-compatible with the old
 * `recoverOrphanRuns` filter — but returns the rows instead of mutating
 * them, so callers (e.g. describe.ts) can project "is this run an orphan"
 * without triggering the abort brake.
 *
 * SEMANTICS:
 *   - `status === "queued"` is NOT orphan (waiting to start is normal).
 *   - Everything else that has no live goal_run IS orphan (lost the
 *     executor link across a process restart).
 *
 * Complexity: two indexed list queries (live-runs + live-goal-runs) on
 * the project. Acceptable to call on describe paths.
 */
export function observeOrphanRuns(projectID: string): RunRow[] {
  const liveGoalRunIDs = new Set(
    listLiveGoalRunsForProject(projectID).map((goalRun) => goalRun.coordinator_run_id),
  )
  return listLiveRunsForProject(projectID).filter((run) => {
    if (run.status === "queued") return false
    if (liveGoalRunIDs.has(run.id)) return false
    return true
  })
}

/**
 * Is the given run currently orphan for the given project?
 *
 * Convenience wrapper around `observeOrphanRuns` for describe.ts, where
 * each task only needs a boolean for its `active_run_id`. Callers that
 * already have the full orphan list should reuse it instead of calling
 * this per-run.
 */
export function isRunOrphan(projectID: string, runID: string): boolean {
  if (!runID) return false
  return observeOrphanRuns(projectID).some((r) => r.id === runID)
}

/**
 * Physical cleanup of orphan execution artifacts:
 *
 *   (a) ABORT BRAKE (phase-1 temp, default OFF after phase-4):
 *       Terminates live executor sessions, live goal_runs, and orphan
 *       runs via the writer primitives. Originally required because the
 *       `engine/queue.ts` control plane gated on stale `active_run_id`;
 *       phase 2 removed those derivations and phase 4 confirms no
 *       control-plane reader still blocks on orphan live rows, so the
 *       default is now `false`. Callers that need the pre-phase-4
 *       behaviour (e.g. regression fixtures that depend on the legacy
 *       abort semantics) can opt back in with `enableAbortBrake: true`.
 *
 *   (b) OWNERSHIP SWEEP: consumes the on-disk ownership registry
 *       (`Ownership.Worktree` + `Ownership.Process`) and drops stale
 *       markers plus, for dead-owner worktree markers, removes the
 *       physical directory via `Worktree.remove`. No DB writes here.
 *
 * Returns a fact bundle suitable for logging and for the composite
 * recoverProjectExecution entry point.
 */
export async function cleanupOrphanExecutionArtifacts(input: {
  projectID: string
  /** Opt into the legacy abort brake. Defaults to `false` post-phase-4
   *  — leaving orphan `engine_run` / `engine_goal_run` rows in place is
   *  safe because the control plane now reads `run_orphan` from the
   *  describe projection (phase 1) rather than gating on live status. */
  enableAbortBrake?: boolean
  /** Override the disk root for ownership markers. Defaults to the
   *  `Instance.worktree` primary directory. */
  primaryWorktreeDir?: string
}) {
  const enableAbortBrake = input.enableAbortBrake === true

  let abortedSessions = 0
  let abortedGoalRuns = 0
  let abortedRuns = 0

  if (enableAbortBrake) {
    const liveAbort = await abortLiveExecutionForProject({
      projectID: input.projectID,
      reason: RECOVERY_REASON,
      cleanupGoalWorkspaces: false,
    })
    abortedSessions = liveAbort.executorSessions
    abortedGoalRuns = liveAbort.goalRuns
    const orphans = observeOrphanRuns(input.projectID)
    abortedRuns = await abortRuns(orphans, "Process restart: run lost live executor state during recovery")
  }

  const primaryWorktreeDir = input.primaryWorktreeDir ?? safeInstanceWorktree()
  let ownership: Ownership.CleanupResult | undefined
  if (primaryWorktreeDir) {
    ownership = await Ownership.cleanup({
      primaryWorktreeDir,
      removeWorktreeDir: async (directory) => {
        await Worktree.remove({ directory }).catch((err) => {
          log.warn("ownership sweep: Worktree.remove failed, leaving on disk", {
            directory,
            error: err instanceof Error ? err.message : String(err),
          })
        })
      },
    })
  }

  return {
    abortedSessions,
    abortedGoalRuns,
    abortedRuns,
    ownership,
  }
}

function safeInstanceWorktree(): string | undefined {
  try {
    return Instance.worktree
  } catch {
    // Called outside an Instance.provide scope (e.g. some test harnesses).
    // Skip ownership sweep rather than throwing — markers just linger until
    // a real Instance-scoped recovery call picks them up.
    return undefined
  }
}

/**
 * Composite entry point preserved for callers (cli/cmd/serve.ts,
 * project/instance wiring). Runs observe → cleanup → resume. Callers
 * that only need observation should import `observeOrphanRuns` directly.
 */
export async function recoverProjectExecution(input: {
  projectID: string
  isTaskLoopActive?: (taskID: string) => boolean
  startTaskLoop?: (taskID: string) => Promise<void> | void
}) {
  const cleanup = await cleanupOrphanExecutionArtifacts({ projectID: input.projectID })
  const resumedTaskIDs = await resumeRecoveredTaskLoops(input)

  log.info("project recovery complete", {
    projectID: input.projectID,
    abortedSessions: cleanup.abortedSessions,
    abortedGoalRuns: cleanup.abortedGoalRuns,
    abortedRuns: cleanup.abortedRuns,
    ownershipWorktreeOrphans: cleanup.ownership?.worktreeOrphans.length ?? 0,
    ownershipProcessOrphans: cleanup.ownership?.processOrphans.length ?? 0,
    resumedTaskIDs,
  })

  return {
    abortedSessions: cleanup.abortedSessions,
    abortedGoalRuns: cleanup.abortedGoalRuns,
    abortedRuns: cleanup.abortedRuns,
    ownership: cleanup.ownership,
    resumedTaskID: resumedTaskIDs[0],
    resumedTaskIDs,
  }
}

async function resumeRecoveredTaskLoops(input: {
  projectID: string
  isTaskLoopActive?: (taskID: string) => boolean
  startTaskLoop?: (taskID: string) => Promise<void> | void
}) {
  const { startTaskLoop } = input
  if (startTaskLoop) {
    return resumeRecoveredTaskLoopsWithHooks({
      ...input,
      startTaskLoop,
    })
  }

  const resumedTaskIDs: string[] = []
  const orphaned = [...listOrphanedActiveInProject(input.projectID)]
    .sort((left, right) => (right.time_status_changed ?? 0) - (left.time_status_changed ?? 0))
  for (const task of orphaned) {
    await resumeActiveTaskLoop(task.id)
    resumedTaskIDs.push(task.id)
  }

  for (const cwd of listQueuedCwdsInProject(input.projectID)) {
    if (listActiveForCwd(cwd).length > 0) continue
    const before = new Set(listActiveForCwd(cwd).map((task) => task.id))
    await advanceQueue(cwd)
    for (const task of listActiveForCwd(cwd)) {
      if (!before.has(task.id)) resumedTaskIDs.push(task.id)
    }
  }

  return resumedTaskIDs
}

async function resumeRecoveredTaskLoopsWithHooks(input: {
  projectID: string
  isTaskLoopActive?: (taskID: string) => boolean
  startTaskLoop: (taskID: string) => Promise<void> | void
}) {
  const activeTask = [...listOrphanedActiveInProject(input.projectID)]
    .sort((left, right) => (right.time_status_changed ?? 0) - (left.time_status_changed ?? 0))[0]
  if (activeTask && !input.isTaskLoopActive?.(activeTask.id)) {
    await input.startTaskLoop(activeTask.id)
    return [activeTask.id]
  }

  if (searchProjectTasks(input.projectID, { status: "active", limit: 100 }).length > 0) {
    return []
  }

  const queuedTask = searchProjectTasks(input.projectID, { status: "queued", limit: 100 })
    .sort((left, right) => (left.time_created ?? 0) - (right.time_created ?? 0))[0]
  if (!queuedTask || input.isTaskLoopActive?.(queuedTask.id)) return []
  await input.startTaskLoop(queuedTask.id)
  return [queuedTask.id]
}
