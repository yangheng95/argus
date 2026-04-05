/**
 * GoalPool — queue-based concurrent goal execution.
 *
 * Replaces the fire-and-forget event bridge model with a structured pool:
 *   - submit(goals) adds goals to queue, respecting dependency order
 *   - Pool auto-fills slots when one completes (up to concurrency limit)
 *   - drain() blocks until queue empty + all slots idle, returns all results
 *   - Per-goal inactivity timeout (no hard timeout)
 *   - Each completed goal is auto-eval'd before the slot is freed
 *
 * The pool is a TOOL — the Task Control Loop calls it, awaits drain(),
 * then feeds results back to the Decision Point. No fire-and-forget.
 */

import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Database, eq } from "@/storage/db"
import { Identifier } from "@/id/id"
import { Worktree } from "@/worktree"
import { ExecutorRegistry } from "@/executor/registry"
import { runGoalPipeline } from "@/pipeline"
import { evaluateGoal } from "@/evaluator/per-goal"
import { createDecisionLog } from "@/decision-log"
import { readyGoalNodes, type GoalNodeEntry } from "@/goal/scheduler"
import { cleanupGoalWorkspace } from "@/goal/runner"
import {
  findGoalRun,
  listPlanNodesByPlan,
  listGoalsByPlan,
  findLatestFailedEvalForGoal,
  findDeliveryByGoalRun,
  findLatestDeliveryForGoal,
  type TaskRow,
  type RunRow,
  type PlanRow,
  type GoalRow,
  type GoalRunRow,
} from "./store"
import {
  createGoalRun,
  updateGoalRun,
  updateGoalRunExecutorSessionStatus,
  persistDelivery,
  ensureExecutorSession,
} from "./persist"
import { OrchestratorGoalTable, OrchestratorEvaluationTable } from "./orchestrator.sql"
import { buildFixPrompt, goalRowToContract } from "./helpers"
import { buildGoalPrompt, createGoalSession } from "@/goal/runner"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { sessionStreamHooks } from "./session-stream"
import { Event } from "./model"
import { OrchestratorProtocol } from "./protocol"
import type { GoalContract, PipelineDelivery, PipelineEvent } from "@/pipeline/types"

const log = Log.create({ service: "goal-pool" })

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface GoalResult {
  goalID: string
  goalRunID: string
  title: string
  status: "passed" | "failed"
  verdict?: "accepted" | "rejected" | "inconclusive"
  evidence?: string[]
  error?: string
  delivery?: PipelineDelivery
  attempts: number
}

export interface GoalPoolOptions {
  task: TaskRow
  run: RunRow
  plan: PlanRow
  concurrency: number
  /** Per-goal inactivity timeout (ms). Default 30 min. */
  goalStallMs?: number
  signal?: AbortSignal
  hooks: PoolHooks
}

export interface PoolHooks {
  /** Called when a goal completes/fails eval — for overlay/progress projection */
  onGoalResult?: (result: GoalResult) => void
  /** Called on executor events — for session projection */
  onExecutorEvent?: (goalID: string, event: PipelineEvent) => void
  /** Merge delivery to main workspace */
  mergeDelivery: (task: TaskRow, run: RunRow, plan: PlanRow, goalRun: GoalRunRow, delivery: PipelineDelivery) => Promise<void>
  /** Update run status */
  updateRun: (run: RunRow, update: Record<string, unknown>, reason: string) => Promise<void>
}

// ---------------------------------------------------------------------------
// GoalPool
// ---------------------------------------------------------------------------

export class GoalPool {
  private queue: GoalNodeEntry[] = []
  private active = new Map<string, { goalRunID: string; ctrl: AbortController; promise: Promise<GoalResult> }>()
  private results: GoalResult[] = []
  private opts: GoalPoolOptions
  private lastActivity = Date.now()
  private drainResolve?: () => void

  constructor(opts: GoalPoolOptions) {
    this.opts = opts
  }

  /**
   * Submit goals for execution. Only dependency-ready goals are dispatched;
   * the rest wait in the queue until their deps are satisfied.
   */
  submit(goalIDs?: string[]) {
    const { plan } = this.opts
    const nodes = listPlanNodesByPlan(plan.id)
    const goals = listGoalsByPlan(plan.id) as GoalRow[]

    const ready = readyGoalNodes(nodes, goals)
    const filtered = goalIDs
      ? ready.filter(e => goalIDs.includes(e.goal.id))
      : ready

    for (const entry of filtered) {
      // Don't double-queue
      if (this.queue.some(q => q.goal.id === entry.goal.id)) continue
      if (this.active.has(entry.goal.id)) continue
      this.queue.push(entry)
    }

    this.fillSlots()
  }

  /**
   * Block until all queued + active goals are done.
   * Returns collected results. Automatically re-fills slots
   * from queue as goals complete (respecting dependencies).
   */
  async drain(): Promise<GoalResult[]> {
    // If already empty, return immediately
    if (this.active.size === 0 && this.queue.length === 0) {
      return [...this.results]
    }

    // Wait for all active + queued goals to complete
    while (this.active.size > 0 || this.queue.length > 0) {
      if (this.opts.signal?.aborted) break

      // Wait for ANY active goal to finish
      if (this.active.size > 0) {
        const promises = [...this.active.values()].map(a => a.promise)
        await Promise.race([
          Promise.race(promises),
          this.abortPromise(),
        ])
      } else if (this.queue.length > 0) {
        // Queue has items but nothing active — deps not ready yet.
        // Re-check after a short delay (a goal may have just completed,
        // satisfying deps for queued goals).
        this.fillSlots()
        if (this.active.size === 0) {
          // Still nothing dispatchable — all queued goals have unsatisfied deps.
          // This means remaining goals depend on failed goals — they'll never be ready.
          log.warn("drain: queued goals have unsatisfied deps, breaking", {
            queued: this.queue.map(q => q.goal.id),
          })
          break
        }
      }
    }

    const collected = [...this.results]
    this.results = []
    return collected
  }

  /** Number of currently executing goals */
  get activeCount() { return this.active.size }

  /** Number of goals waiting in queue */
  get queuedCount() { return this.queue.length }

  /** Abort all active goals */
  abort() {
    for (const [, slot] of this.active) {
      slot.ctrl.abort("pool aborted")
    }
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private fillSlots() {
    const { plan, signal } = this.opts
    if (signal?.aborted) return

    while (this.active.size < this.opts.concurrency && this.queue.length > 0) {
      // Re-evaluate readiness each iteration (a just-dispatched goal's dep resolution may change)
      const nodes = listPlanNodesByPlan(plan.id)
      const goals = listGoalsByPlan(plan.id) as GoalRow[]
      const ready = readyGoalNodes(nodes, goals)
      const readyIDs = new Set(ready.map(e => e.goal.id))

      const idx = this.queue.findIndex(q => readyIDs.has(q.goal.id))
      if (idx < 0) break // no ready goals in queue

      const entry = this.queue.splice(idx, 1)[0]!
      this.dispatchGoal(entry)
    }
  }

  private dispatchGoal(entry: GoalNodeEntry) {
    const ctrl = new AbortController()
    const combined = this.opts.signal
      ? AbortSignal.any([this.opts.signal, ctrl.signal])
      : ctrl.signal

    const promise = this.executeAndEval(entry, combined)
      .then(result => {
        this.active.delete(entry.goal.id)
        this.results.push(result)
        this.opts.hooks.onGoalResult?.(result)
        this.lastActivity = Date.now()
        // Re-fill slots — this goal's completion may unblock dependents
        this.fillSlots()
        return result
      })
      .catch(err => {
        this.active.delete(entry.goal.id)
        const result: GoalResult = {
          goalID: entry.goal.id,
          goalRunID: "",
          title: entry.goal.title,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
          attempts: 1,
        }
        this.results.push(result)
        this.opts.hooks.onGoalResult?.(result)
        this.lastActivity = Date.now()
        this.fillSlots()
        return result
      })

    this.active.set(entry.goal.id, { goalRunID: "", ctrl, promise })
  }

  private async executeAndEval(entry: GoalNodeEntry, signal: AbortSignal): Promise<GoalResult> {
    const { task, run, plan, hooks, goalStallMs = 30 * 60 * 1000 } = this.opts
    const sessionID = task.session_id
    if (!sessionID) throw new Error(`Task ${task.id} has no session`)

    // ── 1. Mark goal as running ──
    Database.use(db =>
      db.update(OrchestratorGoalTable)
        .set({ status: "running", time_updated: Date.now() })
        .where(eq(OrchestratorGoalTable.id, entry.goal.id))
        .run(),
    )

    let worktreeDir: string | undefined
    try {
      // ── 2. Create worktree ──
      const worktreeInfo = await Worktree.create({
        name: `goal-${entry.goal.id.slice(-8)}`,
        checkout: "sync",
      })
      worktreeDir = worktreeInfo.directory

      // ── 2b. Apply previous failed delivery (if retry) ──
      // When a goal is retried, the new worktree branches from HEAD, which
      // does NOT include the failed goal's previous code attempt (failed
      // goals don't merge to HEAD). Without this, the executor starts from
      // scratch and may make the same mistakes. By preserving the last
      // delivery's diffs INTO the retry worktree, the executor sees its
      // own buggy code + eval evidence, enabling targeted fixes.
      const prevDelivery = findLatestDeliveryForGoal(entry.goal.id)
      if (prevDelivery) {
        const result = prevDelivery.result as { diffs?: Array<{ file: string; status?: string; after?: string }> } | null
        if (result?.diffs && result.diffs.length > 0) {
          const { applyGoalDelivery } = await import("@/goal/runner")
          await applyGoalDelivery({
            directory: worktreeDir,
            delivery: { diffs: result.diffs as any },
            ownedPaths: entry.goal.owned_paths ?? [],
          }).catch((err) => {
            log.warn("retry: failed to apply previous delivery into worktree", {
              goalID: entry.goal.id,
              error: String(err),
            })
          })
          log.info("retry: restored previous delivery into worktree", {
            goalID: entry.goal.id,
            files: result.diffs.length,
          })
        }
      }

      // ── 3. Create goal session ──
      const goalSession = await createGoalSession(task as any, entry.goal as any, worktreeDir)

      // ── 4. Create GoalRun record ──
      const goalRun = createGoalRun({
        taskID: task.id,
        goalID: entry.goal.id,
        planNodeID: entry.node.id,
        coordinatorRunID: run.id,
        sessionID: goalSession.id,
        executor: run.executor,
        workspaceDir: worktreeDir,
        metadata: { worktree_branch: worktreeInfo.branch },
      })

      // Update active slot with goalRunID
      const slot = this.active.get(entry.goal.id)
      if (slot) slot.goalRunID = goalRun.id

      // ── 5. Build prompt (with eval fix context for retries) ──
      const allGoals = listGoalsByPlan(plan.id)
      let prompt = buildGoalPrompt({
        plan: plan as any,
        node: entry.node as any,
        goal: entry.goal as any,
        taskRequest: plan.prompt,
        taskID: task.id,
        allGoals,
        cwd: worktreeDir,
      })

      const failedEvals = findLatestFailedEvalForGoal(entry.goal.id)
      if (failedEvals.length > 0) {
        const lastFail = failedEvals[0]!
        const checks = lastFail.checks as Array<{ name: string; status: string; evidence?: string }> | null
        const failedChecks = checks?.filter(c => c.status === "failed").map(c => ({
          name: c.name, status: c.status, evidence: c.evidence ?? "",
        })) ?? []
        const fixCtx = failedChecks.length > 0 ? { source: "eval_failure" as const, checks: failedChecks } : undefined
        prompt += "\n\n---\n\n" + buildFixPrompt(lastFail.summary, fixCtx)
      }

      // ── 6. Submit to executor ──
      const executor = ExecutorRegistry.createInstance(run.executor)
      const submission = await executor.submit({
        sessionID: goalSession.id,
        prompt,
        priority: task.priority,
        source: "planner",
        cwd: worktreeDir,
      })

      updateGoalRun(goalRun.id, {
        status: "accepted",
        time_started: Date.now(),
        metadata: {
          ...((goalRun.metadata as Record<string, unknown>) ?? {}),
          queue_task_id: submission.queueTaskID,
          provider_session_id: submission.sessionID,
        },
      })

      const executorSession = ensureExecutorSession({
        taskID: task.id,
        runID: run.id,
        provider: run.executor,
        refs: { provider_session_id: submission.sessionID, queue_task_id: submission.queueTaskID },
        settings: { cwd: worktreeDir },
        started: Date.now(),
        goalRunID: goalRun.id,
      })

      registerGoalRunSession(goalSession.id, task.id, "executor", entry.goal.id)
      registerGoalRunSession(executorSession.id, task.id, "executor", entry.goal.id)

      // ── 7. Run pipeline with inactivity detection ──
      const contract: GoalContract = {
        goal: goalRowToContract(entry.goal),
        planNode: entry.node as any,
        run, task, plan,
        allGoals: listGoalsByPlan(plan.id).map(goalRowToContract),
      }

      let lastEventTime = Date.now()
      let delivery: PipelineDelivery | undefined

      const pipeline = runGoalPipeline(contract, {
        executor,
        workDir: worktreeDir,
        sessionID: goalSession.id,
        executorSessionID: executorSession.id,
        queueTaskID: submission.queueTaskID,
        signal,
      })

      // Inactivity watchdog — runs in parallel
      const stallCtrl = new AbortController()
      const stallWatcher = (async () => {
        while (!stallCtrl.signal.aborted) {
          await new Promise(r => setTimeout(r, 30_000))
          if (stallCtrl.signal.aborted) return
          const inactiveMs = Date.now() - lastEventTime
          if (inactiveMs >= goalStallMs) {
            log.warn("goal stalled — no activity", {
              goalID: entry.goal.id, goalRunID: goalRun.id, inactiveMs,
            })
            // Don't abort — let the pipeline's own inactivity timeout handle it.
            // We just log for diagnostics.
            return
          }
        }
      })()

      for await (const event of pipeline) {
        if (signal.aborted) break
        lastEventTime = Date.now()
        this.lastActivity = Date.now()
        hooks.onExecutorEvent?.(entry.goal.id, event)

        if (event.type === "completed") {
          delivery = event.delivery
        }
      }

      stallCtrl.abort()
      await stallWatcher.catch(() => {})

      if (signal.aborted) {
        return { goalID: entry.goal.id, goalRunID: goalRun.id, title: entry.goal.title, status: "failed", error: "aborted", attempts: failedEvals.length + 1 }
      }

      // ── 8. Merge delivery ──
      const finalGoalRun = findGoalRun(goalRun.id)
      if (finalGoalRun && delivery && delivery.diffs.length > 0) {
        await hooks.mergeDelivery(task, run, plan, finalGoalRun, delivery)
      }

      // ── 9. Cleanup worktree ──
      if (worktreeDir) {
        await cleanupGoalWorkspace(worktreeDir).catch(err => {
          log.warn("worktree cleanup failed", { goalRunID: goalRun.id, error: String(err) })
        })
      }

      // ── 10. Auto-eval ──
      if (!delivery) {
        Database.use(db => db.update(OrchestratorGoalTable)
          .set({ status: "failed", time_updated: Date.now() })
          .where(eq(OrchestratorGoalTable.id, entry.goal.id)).run())

        return {
          goalID: entry.goal.id, goalRunID: goalRun.id, title: entry.goal.title,
          status: "failed", error: "No delivery", attempts: failedEvals.length + 1,
        }
      }

      const evalResult = await this.evalGoal(task, run, goalRun, entry.goal as GoalRow, delivery, signal)

      log.info("goal pool: goal eval complete", {
        goalID: entry.goal.id, verdict: evalResult.status,
      })

      return {
        ...evalResult,
        goalRunID: goalRun.id,
        title: entry.goal.title,
        attempts: failedEvals.length + 1,
      }

    } catch (err) {
      if (worktreeDir) await cleanupGoalWorkspace(worktreeDir).catch(() => {})
      const error = err instanceof Error ? err.message : String(err)
      log.error("goal dispatch/execution failed", { goalID: entry.goal.id, error })

      Database.use(db => db.update(OrchestratorGoalTable)
        .set({ status: "failed", time_updated: Date.now() })
        .where(eq(OrchestratorGoalTable.id, entry.goal.id)).run())

      return {
        goalID: entry.goal.id, goalRunID: "", title: entry.goal.title,
        status: "failed", error, attempts: 1,
      }
    }
  }

  private async evalGoal(
    task: TaskRow, run: RunRow, goalRun: GoalRunRow, goal: GoalRow,
    delivery: PipelineDelivery, signal: AbortSignal,
  ): Promise<Omit<GoalResult, "goalRunID" | "title" | "attempts">> {
    try {
      const decisionLog = createDecisionLog(task.id)
      const diffs = delivery.diffs
      const contract = {
        goal: { id: goal.id, title: goal.title, done_definition: goal.done_definition ?? "", owned_paths: (goal.owned_paths ?? []) as string[] },
        task: { id: task.id, title: task.title, request: task.request ?? "" },
      }

      const evalSession = await Session.createNext({
        parentID: task.session_id ?? "",
        title: `Eval: ${goal.title}`,
        directory: Instance.directory,
      })
      registerGoalRunSession(evalSession.id, task.id, "evaluator", goal.id)
      const evalHooks = sessionStreamHooks({ sessionID: evalSession.id, taskID: task.id, stage: "eval" })

      const verdict = await evaluateGoal({
        contract: contract as any,
        delivery: { summary: delivery.summary, diffs },
        decisionLog,
        sessionID: evalSession.id,
        signal,
        stream: { onChunk: evalHooks.onChunk as any, onError: evalHooks.onError },
      })
      await evalHooks.flush()

      // Persist evaluation
      const evalID = Identifier.ascending("evaluation")
      const now = Date.now()
      Database.use(db => {
        db.insert(OrchestratorEvaluationTable).values({
          id: evalID,
          task_id: task.id,
          run_id: goalRun.coordinator_run_id,
          goal_run_id: goalRun.id,
          delivery_id: findDeliveryByGoalRun(goalRun.id)?.id,
          status: verdict.pass ? "passed" : "failed",
          verdict: verdict.pass ? "accepted" : "rejected",
          summary: verdict.reasoning.slice(0, 500),
          checks: [
            { name: "judge", status: verdict.pass ? "passed" : "failed", evidence: verdict.reasoning.slice(0, 500) },
            { name: "artifact", status: verdict.pass ? "passed" : "failed", evidence: `Delivery: ${diffs.length} file(s) changed` },
            ...verdict.evidence.map((e, i) => ({
              name: `evidence_${i + 1}`,
              status: verdict.evidenceStatus?.[i] ?? (verdict.pass ? "passed" : "failed"),
              evidence: e,
            })),
          ],
          time_created: now,
          time_updated: now,
        }).run()

        db.update(OrchestratorGoalTable)
          .set({ status: verdict.pass ? "passed" : "failed", time_updated: now })
          .where(eq(OrchestratorGoalTable.id, goal.id))
          .run()
      })

      // Emit overlay event
      if (verdict.pass) {
        OrchestratorProtocol.emit(Event.GoalPassed, { taskID: task.id, goalID: goal.id, summary: goal.title }, { source: "auto_eval" }).catch(() => {})
      } else {
        OrchestratorProtocol.emit(Event.GoalFailed, { taskID: task.id, goalID: goal.id, summary: `${goal.title}: ${verdict.reasoning.slice(0, 200)}` }, { source: "auto_eval" }).catch(() => {})
      }

      return {
        goalID: goal.id,
        status: verdict.pass ? "passed" : "failed",
        verdict: verdict.verdict,
        evidence: verdict.evidence,
        delivery,
      }
    } catch (err) {
      log.error("auto-eval failed", { goalID: goal.id, error: String(err) })
      Database.use(db => db.update(OrchestratorGoalTable)
        .set({ status: "failed", time_updated: Date.now() })
        .where(eq(OrchestratorGoalTable.id, goal.id)).run())

      return {
        goalID: goal.id,
        status: "failed",
        error: `Eval failed: ${err instanceof Error ? err.message : String(err)}`,
      }
    }
  }

  private abortPromise(): Promise<never> {
    if (!this.opts.signal) return new Promise(() => {}) // never resolves
    return new Promise<never>((_, reject) => {
      this.opts.signal!.addEventListener("abort", () => reject(new Error("pool aborted")), { once: true })
    })
  }
}
