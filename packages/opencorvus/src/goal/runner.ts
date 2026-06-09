import fs from "fs/promises"
import path from "path"
import { Global } from "@/global"
import { Filesystem } from "@/util/filesystem"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Project } from "@/project/project"
import { Worktree } from "@/worktree"
import { Ownership } from "@/engine/ownership"

const log = Log.create({ service: "goal-runner" })

export async function cleanupGoalWorkspace(directory?: string) {
  if (!directory) return
  // Accept both the Global goal-workspace path and the per-project worktree
  // path. Per-goal dispatch creates worktrees under
  // `<primary>/.opencorvus/runtime/` (via Worktree.create). Without this
  // check cleanup is silently skipped, leaking LSP servers + worktree dirs.
  // The legacy parent-directory layout (`.opencorvus-worktrees/`) is also
  // still matched so a cleanup straddling the migration still works.
  const goalWorkspaceRoot = path.join(Global.Path.data, "goal-workspace")
  const isGoalWorkspace = Filesystem.contains(goalWorkspaceRoot, directory)
  const isWorktree =
    directory.includes(path.join(".opencorvus", "runtime")) ||
    directory.includes(path.join(".opencorvus", "worktrees")) ||
    directory.includes(".opencorvus-worktrees")
  if (!isGoalWorkspace && !isWorktree) {
    throw new Error(`cleanupGoalWorkspace refused path outside goal workspace roots: ${directory}`)
  }

  // [observability/phase-0] Per-step timing + outcome breakdown. Until we have
  // this, a "retry reused new worktree path" incident gives no signal about
  // WHICH step of cleanup failed (Instance.dispose / Worktree.remove / fs.rm /
  // removeSandbox). The summary log at the end lets ops correlate a cleanup
  // failure with the subsequent Worktree.create candidate() fallback (random
  // suffix) that breaks prompt-cache continuity.
  const started = Date.now()
  type StepOutcome = { step: string; ok: boolean; ms: number; error?: string }
  const steps: StepOutcome[] = []
  const timed = async <T>(name: string, fn: () => Promise<T>): Promise<T> => {
    const t0 = Date.now()
    try {
      const result = await fn()
      steps.push({ step: name, ok: true, ms: Date.now() - t0 })
      return result
    } catch (err) {
      const code =
        typeof (err as { code?: unknown })?.code === "string" ? ((err as { code?: string }).code as string) : undefined
      steps.push({
        step: name,
        ok: false,
        ms: Date.now() - t0,
        error: code ? `${code}: ${String(err)}` : String(err),
      })
      log.warn(`cleanupGoalWorkspace.${name} failed`, { directory, error: String(err), code })
      throw err
    }
  }

  const projectID = Instance.project.id
  const finish = () => {
    const allOk = steps.every((s) => s.ok)
    const summary = {
      directory,
      totalMs: Date.now() - started,
      steps,
    }
    if (allOk) {
      log.info("cleanupGoalWorkspace done", summary)
      return
    }
    log.warn("cleanupGoalWorkspace failed", summary)
    throw new Error(`cleanupGoalWorkspace failed for ${directory}`)
  }

  try {
    const exists = await Filesystem.exists(directory)
    if (!exists) {
      await timed("removeSandbox", () => Project.removeSandbox(projectID, directory))
      finish()
      return
    }

    await timed("Instance.dispose", () =>
      Instance.provide({
        directory,
        fn: () => Instance.dispose(),
      }),
    )

    if (isWorktree) {
      await timed("Worktree.remove", () => Worktree.remove({ directory }))
    } else {
      await timed("fs.rm", () =>
        fs.rm(directory, {
          recursive: true,
          force: true,
          maxRetries: 50,
          retryDelay: 100,
        }),
      )
    }
    await timed("removeSandbox", () => Project.removeSandbox(projectID, directory))
    await timed("ownership.clear", () =>
      Ownership.Worktree.clear({
        primaryWorktreeDir: Instance.worktree,
        worktreeDir: directory,
      }),
    )
    finish()
  } catch (error) {
    log.warn("cleanupGoalWorkspace aborted", {
      directory,
      totalMs: Date.now() - started,
      steps,
      error: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
