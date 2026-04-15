/**
 * GoalPool — queue-based concurrent goal execution.
 *
 * Replaces the fire-and-forget event bridge model with a structured pool:
 *   - submit(goals) adds goals to queue, respecting dependency order
 *   - Pool auto-fills slots when one completes (up to concurrency limit)
 *   - drain() blocks until queue empty + all slots idle, returns all results
 *   - Per-goal inactivity timeout (no hard timeout)
 *
 * Executor completes → goal marked passed/failed based on delivery.
 * No per-goal evaluator — delivery agent is the single verification gate.
 *
 * The pool is a TOOL — the Task Control Loop calls it, awaits drain(),
 * then feeds results back to the Decision Point. No fire-and-forget.
 */

import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Database, eq } from "@/storage/db"
import { Worktree } from "@/worktree"
import { ExecutorRegistry } from "@/executor/registry"
import { runGoalPipeline } from "@/pipeline"
import { evaluateGoal } from "@/evaluator/per-goal"
import { OrchestratorConfig } from "./config"
import { OrchestratorService } from "./service"
import { createDecisionLog } from "@/decision-log"
import { readyGoalNodes, type GoalNodeEntry } from "@/goal/scheduler"
import { cleanupGoalWorkspace } from "@/goal/runner"
import { writeIntentBundle } from "@/goal/intent-bundle"
import {
  listPlanNodesByPlan,
  listGoalsByPlan,
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
  ensureExecutorSession,
} from "./persist"
import { OrchestratorGoalTable, OrchestratorPlanNodeTable } from "./orchestrator.sql"
import { clarificationTranscriptSection, goalRowToContract, operatorNotesSection } from "./helpers"
import { buildGoalPrompt, createGoalSession } from "@/goal/runner"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { sessionStreamHooks } from "@/agent/runtime"
import { Event } from "./model"
import { OrchestratorProtocol } from "./protocol"
import { markGoalWorkflowStep } from "./workflow"
import { projectExecutorEventToSession } from "./runtime"
import { MemoryInjection } from "@/memory/injection"
import { TaskPlan } from "@/memory/task-plan"
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

      // ── 2b. Apply previous delivery as safety net (if retry) ──
      // Normally, all deliveries (passed or failed) are merged to HEAD in
      // step 9, so the retry worktree already contains the previous code.
      // This replay is a defensive fallback for cases where the HEAD merge
      // failed silently (e.g., git errors). For normal files this is an
      // idempotent overwrite; merge-strategy files use the merger.
      const prevDelivery = findLatestDeliveryForGoal(entry.goal.id)
      if (prevDelivery) {
        const result = prevDelivery.result as { diffs?: Array<{ file: string; status?: string; after?: string }> } | null
        if (result?.diffs && result.diffs.length > 0) {
          const { applyGoalDelivery } = await import("@/goal/runner")
          try {
            await applyGoalDelivery({
              directory: worktreeDir,
              delivery: { diffs: result.diffs as any },
              ownedPaths: entry.goal.owned_paths ?? [],
            })
            log.info("retry: restored previous delivery into worktree", {
              goalID: entry.goal.id,
              files: result.diffs.length,
            })
          } catch (err) {
            log.error("retry: FAILED to apply previous delivery — executor starts from scratch", {
              goalID: entry.goal.id,
              error: String(err),
              diffCount: result.diffs.length,
            })
          }
        }
      }

      // ── 2c-pre. Mount the intent bundle at .opencorvus/intent/ BEFORE planning ──
      // Every subsequent stage (per-goal planner, executor) runs inside this
      // worktree and its tools may read the mounted files. The bundle must
      // exist before any of them start so prompts that reference
      // `.opencorvus/intent/request.md` by section are immediately valid.
      // Failure here is not swallowed: if the bundle does not land, downstream
      // prompts will point at a nonexistent path, so a write error must abort
      // this goal's launch rather than silently proceed.
      await writeIntentBundle({
        worktreeDir: worktreeDir!,
        taskID: task.id,
        title: task.title,
        request: task.request,
        clarifications: clarificationTranscriptSection(task.id),
        operatorNotes: operatorNotesSection(task.id),
      })

      // ── 2c. Per-goal planning (mandatory — runs just before execution, not upfront) ──
      // Planning is tightly coupled to execution: it runs inside the pool with the
      // actual worktree available for codebase exploration. This ensures plans are
      // accurate (not stale from an empty project) and happen lazily per-goal
      // (not all 24 goals in parallel before any execution starts).
      // Planning is NOT optional — failure propagates and the goal run fails.
      let planNodeBrief: string
      let plannerSessionID: string
      await markGoalWorkflowStep(task.id, entry.goal.id, entry.goal.title, "plan", "running").catch(() => undefined)
      {
        const allGoalsForPlan = listGoalsByPlan(plan.id)
        const goalContract = goalRowToContract(entry.goal)
        const dependsOn = (Array.isArray(goalContract.depends_on) ? goalContract.depends_on : []) as string[]
        const planContract: GoalContract = {
          goal: goalContract,
          planNode: entry.node as any,
          run, task, plan,
          dependencies: dependsOn.length > 0
            ? allGoalsForPlan.filter((g) => dependsOn.includes(g.id)).map(goalRowToContract)
            : [],
        }
        const planSession = await Session.createNext({
          parentID: sessionID,
          title: `Plan: ${entry.goal.title}`,
          directory: Instance.directory,
        })
        plannerSessionID = planSession.id
        registerGoalRunSession(planSession.id, task.id, "planner", entry.goal.id)
        const planHooks = sessionStreamHooks({ sessionID: planSession.id, taskID: task.id, stage: "plan" })
        try {
          const { planGoal } = await import("@/planner/per-goal")
          const plannerDL = createDecisionLog(task.id)
          // CONTRACT: planGoal / buildGoalPrompt require `.opencorvus/intent/`
          // to be populated under workDir. That was done by the writeIntentBundle
          // call above (step 2c-pre), which throws on failure so reaching this
          // point means the bundle is present and will still be present when
          // the executor starts after this planner finishes.
          const planSteps = await planGoal({
            contract: planContract,
            decisionLog: plannerDL,
            workDir: worktreeDir,
            sessionID: planSession.id,
            signal,
            stream: {
              onChunk: async (arg: any) => {
                const chunk = (arg as any)?.chunk
                if (chunk?.type === "text-delta") {
                  if (planHooks.onChunk) await planHooks.onChunk({ chunk: { ...chunk, type: "reasoning-delta" } })
                } else {
                  if (planHooks.onChunk) await planHooks.onChunk(arg as any)
                }
              },
              onError: planHooks.onError,
            },
          })
          planNodeBrief = planSteps.brief
          // Persist to plan node so buildGoalPrompt and the UI pick up the actual plan
          Database.use(db => db.update(OrchestratorPlanNodeTable)
            .set({ brief: planSteps.brief, time_updated: Date.now() })
            .where(eq(OrchestratorPlanNodeTable.id, entry.node.id))
            .run())
          log.info("goal pool: per-goal plan created", { goalID: entry.goal.id, briefLen: planSteps.brief.length })
          await markGoalWorkflowStep(task.id, entry.goal.id, entry.goal.title, "plan", "completed").catch(() => undefined)
        } catch (planErr) {
          await markGoalWorkflowStep(task.id, entry.goal.id, entry.goal.title, "plan", "failed").catch(() => undefined)
          throw planErr
        } finally {
          await planHooks.flush()
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
        metadata: { worktree_branch: worktreeInfo.branch, plannerSessionID },
      })

      // ── 4b. Write worktree metadata for traceability ──
      {
        const fs = await import("fs/promises")
        const metaPath = await import("path").then(p => p.join(worktreeDir!, ".opencorvus-meta.json"))
        const meta = {
          goalID: entry.goal.id,
          goalRunID: goalRun.id,
          taskID: task.id,
          runID: run.id,
          planID: plan.id,
          goalTitle: entry.goal.title,
          worktreeBranch: worktreeInfo.branch,
          createdAt: new Date().toISOString(),
        }
        await fs.writeFile(metaPath, JSON.stringify(meta, null, 2)).catch(err => {
          log.warn("failed to write worktree meta", { goalID: entry.goal.id, error: String(err) })
        })
      }

      // Update active slot with goalRunID
      const slot = this.active.get(entry.goal.id)
      if (slot) slot.goalRunID = goalRun.id

      // ── 5. Build prompt ──
      // Pass only direct dependency rows so the executor prompt does not
      // inflate with N-1 sibling contracts. buildGoalPrompt only ever looks
      // up the goal's depends_on entries; passing the full list was waste.
      const dependencyIDs = Array.isArray((entry.goal as { depends_on?: unknown }).depends_on)
        ? ((entry.goal as { depends_on: string[] }).depends_on)
        : []
      const dependencyGoals = dependencyIDs.length > 0
        ? listGoalsByPlan(plan.id).filter((g) => dependencyIDs.includes(g.id))
        : []
      const prompt = buildGoalPrompt({
        plan: plan as any,
        node: { ...entry.node, brief: planNodeBrief } as any,
        goal: entry.goal as any,
        taskRequest: plan.prompt,
        taskID: task.id,
        dependencies: dependencyGoals,
        cwd: worktreeDir,
      })

      // ── 6. Submit to executor ──
      // For managed (external) executors, build enriched system context that
      // SessionPrompt would normally provide for opencode. This injects the
      // memory and task-plan layers that the built-in executor receives, via
      // the SDK's systemPrompt.append / developerInstructions.
      //
      // Clarifications and operator notes are NOT injected here: the intent
      // bundle mounted above already exposes them as files in the worktree,
      // and `buildGoalPrompt` above skips its inline copies when the bundle
      // is mounted. Injecting them a third time via systemOverride would
      // recreate the triple-exposure we deliberately removed.
      let systemOverride: string | undefined
      if (run.executor !== "opencode") {
        const sections: string[] = []
        const memory = await MemoryInjection.systemPromptSection({
          projectID: Instance.project.id,
          sessionID: goalSession.id,
          query: prompt.slice(0, 500),
        }).catch(() => null)
        if (memory) sections.push(memory)
        const taskPlanSection = TaskPlan.toMarkdown(goalSession.id)
        if (taskPlanSection) sections.push(taskPlanSection)
        if (sections.length > 0) systemOverride = sections.join("\n\n")
      }

      await markGoalWorkflowStep(task.id, entry.goal.id, entry.goal.title, "execute", "running").catch(() => undefined)
      const executor = ExecutorRegistry.createInstance(run.executor)
      const submission = await executor.submit({
        sessionID: goalSession.id,
        prompt,
        priority: task.priority,
        source: "planner",
        cwd: worktreeDir,
        system: systemOverride,
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
      const execGoal = goalRowToContract(entry.goal)
      const execDeps = (Array.isArray(execGoal.depends_on) ? execGoal.depends_on : []) as string[]
      const contract: GoalContract = {
        goal: execGoal,
        planNode: entry.node as any,
        run, task, plan,
        dependencies: execDeps.length > 0
          ? listGoalsByPlan(plan.id).filter((g) => execDeps.includes(g.id)).map(goalRowToContract)
          : [],
      }

      let lastEventTime = Date.now()
      let delivery: PipelineDelivery | undefined
      let pipelineError: string | undefined

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

        // Bridge managed executor events into Session → Bus → SSE → overlay.
        // runtime.ts already has the complete bridge (projectExecutorEventToSession)
        // that handles text, reasoning, tool calls/results, usage, and session lifecycle.
        // It skips opencode (which manages its own session natively).
        if (event.type === "executor_event") {
          projectExecutorEventToSession(task.id, run, goalSession.id, event.event).catch((err) => {
            log.warn("executor event session projection failed", {
              goalID: entry.goal.id, eventType: event.event?.type, error: String(err),
            })
          })
        }

        if (event.type === "completed") {
          delivery = event.delivery
        }
        if (event.type === "failed") {
          pipelineError = event.error
        }
      }

      stallCtrl.abort()
      await stallWatcher.catch(() => {})

      if (signal.aborted) {
        await markGoalWorkflowStep(task.id, entry.goal.id, entry.goal.title, "execute", "failed").catch(() => undefined)
        return { goalID: entry.goal.id, goalRunID: goalRun.id, title: entry.goal.title, status: "failed", error: "aborted", attempts: 1 }
      }

      // ── 8. Determine goal status from executor result ──
      // Executor completed with delivery → "passed" (trust executor's self-report).
      // No delivery → "failed" (executor could not produce output).
      // Delivery agent is the single verification gate — runs at task level after all goals.
      const now = Date.now()
      if (!delivery) {
        const failReason = pipelineError ?? "Executor completed without delivery (no error detail)"
        if (worktreeDir) await cleanupGoalWorkspace(worktreeDir).catch(() => {})
        Database.use(db => db.update(OrchestratorGoalTable)
          .set({ status: "failed", time_updated: now })
          .where(eq(OrchestratorGoalTable.id, entry.goal.id)).run())

        await markGoalWorkflowStep(task.id, entry.goal.id, entry.goal.title, "execute", "failed").catch(() => undefined)
        OrchestratorProtocol.emit(Event.GoalFailed, {
          taskID: task.id, goalID: entry.goal.id, summary: `${entry.goal.title}: ${failReason}`,
        }, { source: "executor" }).catch(() => {})

        return {
          goalID: entry.goal.id, goalRunID: goalRun.id, title: entry.goal.title,
          status: "failed", error: failReason, attempts: 1,
        }
      }

      // ── Per-goal deterministic evaluator (gated) ──
      // The legacy path treats "executor produced delivery" as sufficient for
      // a passed goal. Per design (01-agents.md L111 + docs/product/.../evaluator.md):
      // evaluator is the deterministic command runner that verifies each
      // goal's acceptance_specs BEFORE marking passed. Gated by
      // `evaluator.per_goal_enabled` so the path can be flipped on when
      // downstream consumers (criteria panel, retry pipeline) are stable.
      const orchCfgForEval = await OrchestratorConfig.get().catch(() => undefined)
      if (orchCfgForEval?.evaluator?.per_goal_enabled) {
        try {
          const allGoalsForContract = listGoalsByPlan(plan.id)
          const goalFields = goalRowToContract(entry.goal)
          const depIds: string[] = Array.isArray(goalFields.depends_on) ? goalFields.depends_on : []
          const dependencies = allGoalsForContract
            .filter((g) => depIds.includes(g.id))
            .map((g) => goalRowToContract(g))
          const contract: GoalContract = {
            goal: goalFields,
            planNode: null,
            run,
            task,
            plan,
            dependencies,
          }
          const verdict = await evaluateGoal({
            contract,
            delivery,
            signal,
            tier: orchCfgForEval.evaluator.tier,
          })

          // Sink each check into task.metadata.criteria_results so the overlay
          // Quality Gates panel reflects deterministic per-goal outcomes.
          if (verdict.checks.length > 0) {
            await OrchestratorService.upsertTaskCriteria(task.id, verdict.checks.map((c) => ({
              name: `${entry.goal.id}.${c.name}`,
              status: c.passed ? "passed" as const : "failed" as const,
              family: "goal_eval",
              evidence: c.output,
              label: `${entry.goal.title} · ${c.name}`,
            }))).catch((err) => {
              log.warn("per-goal eval: sink criteria failed (non-fatal)", {
                goalID: entry.goal.id, error: String(err),
              })
            })
          }

          if (!verdict.pass) {
            const failReason = verdict.reasoning || `Per-goal evaluator rejected: ${verdict.verdict}`
            if (worktreeDir) await cleanupGoalWorkspace(worktreeDir).catch(() => {})
            Database.use(db => db.update(OrchestratorGoalTable)
              .set({ status: "failed", time_updated: now })
              .where(eq(OrchestratorGoalTable.id, entry.goal.id)).run())
            await markGoalWorkflowStep(task.id, entry.goal.id, entry.goal.title, "execute", "failed").catch(() => undefined)
            OrchestratorProtocol.emit(Event.GoalFailed, {
              taskID: task.id, goalID: entry.goal.id, summary: `${entry.goal.title}: ${failReason}`,
            }, { source: "evaluator" }).catch(() => {})
            return {
              goalID: entry.goal.id, goalRunID: goalRun.id, title: entry.goal.title,
              status: "failed", verdict: verdict.verdict, error: failReason, evidence: verdict.evidence,
              delivery, attempts: 1,
            }
          }
        } catch (evalErr) {
          // Evaluator infrastructure failure (shell missing, worktree vanished,
          // llm-judge provider down). Surface loud — do NOT silently pass the
          // goal. Operator needs to see why eval could not run.
          const msg = evalErr instanceof Error ? evalErr.message : String(evalErr)
          log.error("per-goal eval threw; marking goal failed", {
            goalID: entry.goal.id, error: msg,
          })
          if (worktreeDir) await cleanupGoalWorkspace(worktreeDir).catch(() => {})
          Database.use(db => db.update(OrchestratorGoalTable)
            .set({ status: "failed", time_updated: now })
            .where(eq(OrchestratorGoalTable.id, entry.goal.id)).run())
          await markGoalWorkflowStep(task.id, entry.goal.id, entry.goal.title, "execute", "failed").catch(() => undefined)
          OrchestratorProtocol.emit(Event.GoalFailed, {
            taskID: task.id, goalID: entry.goal.id, summary: `${entry.goal.title}: evaluator threw: ${msg}`,
          }, { source: "evaluator" }).catch(() => {})
          return {
            goalID: entry.goal.id, goalRunID: goalRun.id, title: entry.goal.title,
            status: "failed", error: `evaluator threw: ${msg}`, delivery, attempts: 1,
          }
        }
      }

      // Executor produced delivery (and evaluator passed if enabled) → mark goal passed
      Database.use(db => db.update(OrchestratorGoalTable)
        .set({ status: "passed", time_updated: now })
        .where(eq(OrchestratorGoalTable.id, entry.goal.id)).run())

      await markGoalWorkflowStep(task.id, entry.goal.id, entry.goal.title, "execute", "completed").catch(() => undefined)
      OrchestratorProtocol.emit(Event.GoalPassed, {
        taskID: task.id, goalID: entry.goal.id, summary: entry.goal.title,
      }, { source: "executor" }).catch(() => {})

      // ── 9. Merge delivery ──
      if (delivery.diffs.length > 0) {
        await hooks.mergeDelivery(task, run, plan, goalRun, delivery)
      }

      // ── 10. Cleanup worktree ──
      if (worktreeDir) {
        await cleanupGoalWorkspace(worktreeDir).catch(err => {
          log.warn("worktree cleanup failed", { goalRunID: goalRun.id, error: String(err) })
        })
      }

      log.info("goal pool: goal execution complete", {
        goalID: entry.goal.id, status: "passed", files: delivery.diffs.length,
      })

      return {
        goalID: entry.goal.id,
        goalRunID: goalRun.id,
        title: entry.goal.title,
        status: "passed",
        verdict: "accepted",
        delivery,
        attempts: 1,
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

  private abortPromise(): Promise<never> {
    if (!this.opts.signal) return new Promise(() => {}) // never resolves
    return new Promise<never>((_, reject) => {
      this.opts.signal!.addEventListener("abort", () => reject(new Error("pool aborted")), { once: true })
    })
  }
}
