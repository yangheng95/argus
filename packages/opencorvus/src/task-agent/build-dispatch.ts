/**
 * Build-task dispatcher — fast path for `task.kind === "build"`.
 *
 * Bypasses the workflow pipeline (decompose → design → architect → execute →
 * deliver) and instead runs the build agent directly on `task.request`.
 *
 * The task still:
 *   - lives in the orchestrator_task table (so list/cancel/audit are uniform)
 *   - moves through queued → active → completed/failed
 *   - persists its trace into a child session under task.session_id
 *
 * What it does NOT do:
 *   - decompose the request into goals
 *   - allocate plan_versions / milestones / runs / goal_runs
 *   - register evaluators or delivery gates
 *
 * If a build task wants any of those, it shouldn't have been dispatched as
 * `kind: "build"` in the first place — Gateway picks the kind (workflow vs
 * build) at task creation time per its system-prompt rules.
 */

import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { SessionPrompt } from "@/session/prompt"
import { Log } from "@/util/log"
import { updateTask } from "@/orchestrator/state"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { requireTask, type TaskRow } from "@/orchestrator/store"

const log = Log.create({ service: "task-agent.build" })

export async function runBuildTask(input: { task: TaskRow; signal: AbortSignal }): Promise<void> {
  const { task, signal } = input
  if (task.kind !== "build") {
    throw new Error(`runBuildTask requires task.kind="build" (got ${task.kind})`)
  }
  if (!task.session_id) {
    log.error("build task without session_id", { taskID: task.id })
    return
  }
  if (signal.aborted) {
    log.info("build task aborted before start", { taskID: task.id })
    return
  }

  // Mark the task active so the queue scheduler / UI see the transition
  // exactly as the workflow path does. Failures from updateTask propagate —
  // we don't want to silently run a "build" task that nobody knows is active.
  // Each updateTask call re-fetches the row to satisfy the CAS guard in
  // state.ts (the in-memory `task` snapshot would be stale after the first
  // status change).
  await updateTask(requireTask(task.id), { status: "active", time_started: Date.now() }, "Build task dispatched")

  // Create a child session under the task's session so the build agent's
  // trace (assistant messages, tool parts) is isolated yet still navigable
  // from the task UI via the parent_id chain.
  const agentSession = await Session.createNext({
    parentID: task.session_id,
    title: `Build: ${task.title}`,
    directory: Instance.directory,
  })
  registerGoalRunSession(agentSession.id, task.id, "assistant")

  log.info("build task starting", {
    taskID: task.id,
    sessionID: agentSession.id,
    request: task.request.slice(0, 120),
  })

  try {
    await SessionPrompt.prompt({
      sessionID: agentSession.id,
      agent: "build",
      parts: [{ type: "text", text: task.request, kind: "user_content" }],
    })
    if (signal.aborted) {
      log.info("build task aborted during run; not marking completed", { taskID: task.id })
      return
    }
    await updateTask(
      requireTask(task.id),
      { status: "completed", time_completed: Date.now() },
      "Build task completed",
    )
    log.info("build task completed", { taskID: task.id })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    log.error("build task failed", { taskID: task.id, error: msg })
    // Best-effort failure mark: if the row was already moved to a terminal
    // state by another path, swallow the StaleRow error rather than crashing
    // the test runner / queue worker. The original `err` is still rethrown.
    await updateTask(requireTask(task.id), { status: "failed", error: msg }, "Build task failed").catch(
      (markErr) => log.warn("could not mark build task failed", { taskID: task.id, markErr: String(markErr) }),
    )
    throw err
  } finally {
    // Touch the agent session so the UI sees recency.
    await Session.touch(agentSession.id).catch(() => undefined)
  }
}

