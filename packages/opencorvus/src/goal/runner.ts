import { $ } from "bun"
import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { dict } from "@/util/object"
import { selectorList } from "@/check/policy"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Session } from "@/session"
import { Worktree } from "@/worktree"
import { Ownership } from "@/engine/ownership"
import { Identifier } from "@/id/id"
import {
  findTask,
  updateGoalRun,
} from "@/engine"
import type {
  TaskRow,
  GoalRow,
  GoalRunRow,
} from "@/engine"

const log = Log.create({ service: "goal-runner" })
const GOAL_RUN_RETENTION_MS = 72 * 60 * 60 * 1000




function goalRunLocalSessionID(goalRun: GoalRunRow) {
  const id = dict(goalRun.metadata).local_session_id
  return typeof id === "string" && id ? id : goalRun.session_id ?? undefined
}

function goalRunExpired(goalRun: GoalRunRow, now = Date.now(), ttl = GOAL_RUN_RETENTION_MS) {
  const time = goalRun.time_completed ?? goalRun.time_updated ?? goalRun.time_created ?? now
  return now - time >= ttl
}

async function archiveGoalRunTranscript(goalRun: GoalRunRow) {
  const sourceSessionID = goalRunLocalSessionID(goalRun)
  if (!sourceSessionID) return
  const task = findTask(goalRun.task_id)
  const targetSessionID = task?.session_id ?? undefined
  if (!targetSessionID || targetSessionID === sourceSessionID) return

  const messages = await Session.messages({ sessionID: sourceSessionID }).catch(() => [])
  if (messages.length === 0) return

  const ids = new Map<string, string>()
  for (const item of messages) {
    const messageID = Identifier.ascending("message")
    ids.set(item.info.id, messageID)
    const info =
      item.info.role === "assistant"
        ? {
            ...item.info,
            id: messageID,
            sessionID: targetSessionID,
            parentID: ids.get(item.info.parentID) ?? item.info.parentID,
          }
        : {
            ...item.info,
            id: messageID,
            sessionID: targetSessionID,
          }
    await Session.saveMessage(info)
    for (const part of item.parts) {
      await Session.updatePart({
        ...part,
        id: Identifier.ascending("part"),
        messageID,
        sessionID: targetSessionID,
      })
    }
    await Session.updateMessage(info)
  }
  await Session.touch(targetSessionID)
}

async function removeGoalRunSession(goalRun: GoalRunRow) {
  const id = goalRunLocalSessionID(goalRun)
  if (id) {
    await archiveGoalRunTranscript(goalRun).catch((err) => {
      log.warn("failed to archive goal run transcript", { goalRunID: goalRun.id, sessionID: id, error: String(err) })
    })
    await Session.remove(id).catch((err) => {
      log.warn("failed to remove goal run session", { sessionID: id, error: String(err) })
    })
  }
  if (!id && !goalRun.session_id) return
  updateGoalRun(goalRun.id, {
    session_id: null,
    metadata: {
      ...dict(goalRun.metadata),
      local_session_id: null,
    },
  })
}

const EVALUATOR_MANAGED_SELECTORS = new Set(["ui_review", "startup", "code_quality", "code_review", "dead_code_review"])

function goalSelectors(goal: GoalRow) {
  return selectorList(goal.metadata).filter((item) => item !== "spec_check")
}

function executorSelectors(goal: GoalRow) {
  return goalSelectors(goal).filter((item) => !EVALUATOR_MANAGED_SELECTORS.has(item))
}

function evaluatorManagedSelectors(goal: GoalRow) {
  return goalSelectors(goal).filter((item) => EVALUATOR_MANAGED_SELECTORS.has(item))
}

export async function cleanupGoalWorkspace(directory?: string) {
  if (!directory) return
  // Accept both the Global goal-workspace path and the per-project worktree
  // path. Per-goal dispatch creates worktrees under
  // `<primary>/.opencorvus/worktrees/` (via Worktree.create). Without this
  // check cleanup is silently skipped, leaking LSP servers + worktree dirs.
  // The legacy parent-directory layout (`.opencorvus-worktrees/`) is also
  // still matched so a cleanup straddling the migration still works.
  const goalWorkspaceRoot = path.join(Global.Path.data, "goal-workspace")
  const isGoalWorkspace = Filesystem.contains(goalWorkspaceRoot, directory)
  const isWorktree =
    directory.includes(path.join(".opencorvus", "worktrees")) ||
    directory.includes(".opencorvus-worktrees")
  if (!isGoalWorkspace && !isWorktree) return

  // [observability/phase-0] Per-step timing + outcome breakdown. Until we have
  // this, a "retry reused new worktree path" incident gives no signal about
  // WHICH step of cleanup failed (Instance.dispose / Worktree.remove / fs.rm /
  // removeSandbox). The summary log at the end lets ops correlate a cleanup
  // failure with the subsequent Worktree.create candidate() fallback (random
  // suffix) that breaks prompt-cache continuity.
  const started = Date.now()
  type StepOutcome = { step: string; ok: boolean; ms: number; error?: string }
  const steps: StepOutcome[] = []
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
    const t0 = Date.now()
    try {
      const result = await fn()
      steps.push({ step: name, ok: true, ms: Date.now() - t0 })
      return result
    } catch (err) {
      const code =
        typeof (err as { code?: unknown })?.code === "string"
          ? ((err as { code?: string }).code as string)
          : undefined
      steps.push({
        step: name,
        ok: false,
        ms: Date.now() - t0,
        error: code ? `${code}: ${String(err)}` : String(err),
      })
      log.warn(`cleanupGoalWorkspace.${name} failed`, { directory, error: String(err), code })
      return undefined
    }
  }

  const projectID = Instance.project.id
  const exists = await Filesystem.exists(directory)
  if (!exists) {
    await timed("removeSandbox", () => Project.removeSandbox(projectID, directory))
    log.info("cleanupGoalWorkspace done (missing directory)", {
      directory,
      existed: false,
      totalMs: Date.now() - started,
      steps,
    })
    return
  }

  const drop = () =>
    timed("fs.rm", () =>
      fs.rm(directory, {
        recursive: true,
        force: true,
        maxRetries: 50,
        retryDelay: 100,
      }),
    )

  await timed("Instance.dispose", () =>
    Instance.provide({
      directory,
      fn: () => Instance.dispose(),
    }),
  )

  if (!Project.isGitRepo(Instance.directory)) {
    await drop()
  } else {
    const removed = await timed("Worktree.remove", () => Worktree.remove({ directory }))
    if (removed === undefined) {
      // Worktree.remove threw → fall through to the brute-force fs.rm. `timed`
      // already recorded the remove failure; we still want the drop attempt's
      // own ok/fail to land in the summary.
      await drop()
    }
  }
  await timed("removeSandbox", () => Project.removeSandbox(projectID, directory))
  await timed("ownership.clear", () =>
    Ownership.Worktree.clear({
      primaryWorktreeDir: Instance.worktree,
      worktreeDir: directory,
    }),
  )

  const allOk = steps.every((s) => s.ok)
  const summary = {
    directory,
    existed: true,
    totalMs: Date.now() - started,
    steps,
  }
  if (allOk) log.info("cleanupGoalWorkspace done", summary)
  else log.warn("cleanupGoalWorkspace completed with failures", summary)
}

/**
 * Create the per-goal **build** worker session — the LLM that actually
 * writes code inside the goal's worktree. Named by its role: this session
 * does the build phase of the goal. Its parent is the executor container
 * session (see createExecutorSession below), which groups plan + build +
 * evaluate sessions under one overlay step card.
 *
 * (Renamed from createGoalSession + kind:"executor" — that naming had the
 *  worker-vs-container wires crossed. See specs/new-arch/07-panel-reactivity
 *  §session 终态 for the agreed vocabulary.)
 */
export async function createBuildSession(task: TaskRow, goal: GoalRow, directory?: string, parentSessionID?: string) {
  const session = await Session.createNext({
    kind: "build",
    goalID: goal.id,
    parentID: parentSessionID ?? task.session_id ?? undefined,
    title: `${task.title}: ${goal.title}`,
    directory: directory ?? (await import("@/project/instance")).Instance.directory,
  })
  // Permissions for goal sessions are now governed by the project config
  // (`experimental.auto_permission` = global auto-approve switch, plus the
  // user's explicit `permission` rules). The old blanket "allow *,*" on
  // every goal session silently disabled every permission prompt — that
  // was the reason the overlay's question/permission UX never surfaced
  // anything to the operator. Leaving it off lets PermissionNext do its
  // normal resolution: config rules → ask → (optionally) auto-approved by
  // the AutoPermission subscriber when auto_permission is set.
  return session
}

