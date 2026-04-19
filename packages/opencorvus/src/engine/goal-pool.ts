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

import { existsSync } from "fs"
import path from "path"
import { Log } from "@/util/log"
import { Instance } from "@/project/instance"
import { Session } from "@/session"
import { Database, eq } from "@/storage/db"
import { Worktree } from "@/worktree"
import { ExecutorRegistry } from "@/executor/registry"
import { runGoalPipeline } from "@/pipeline"
import { evaluateGoal } from "@/delivery/checks"
import { EngineConfig } from "./config"
import { upsertTaskCriteria } from "./state"
import { createDecisionLog } from "@/decision-log"
import { readyGoalNodes, type GoalNodeEntry } from "@/goal/readiness"
import { cleanupGoalWorkspace } from "@/goal/runner"
import { writeIntentBundle } from "@/goal/intent-bundle"
import { Snapshot } from "@/snapshot"
import {
  findGoal,
  listPlanNodesByPlan,
  listGoalsByPlan,
  listGoalRunsForDispatch,
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
  updateGoalCascadeFailed,
  updateGoalWorkspace,
  updateGoalWorkspaceBaseRef,
} from "./persist"
import { EngineGoalTable, EnginePlanNodeTable } from "./engine.sql"
import { clarificationTranscriptSection, goalRowToContract, operatorNotesSection } from "./helpers"
import { buildGoalPrompt, createBuildSession, createEvaluatorSession, createExecutorSession } from "@/goal/runner"
import { sessionStreamHooks } from "@/agent/runtime"
import { Event } from "./model"
import { EngineProtocol } from "./protocol"
import { projectExecutorEventToSession } from "./runtime"
import { MemoryInjection } from "@/memory/injection"
import { TaskPlan } from "@/memory/task-plan"
import type { GoalContract, PipelineDelivery, PipelineEvent } from "@/pipeline/types"
import type { EngineEvaluationCheck } from "./engine.sql"
import { cleanupGoalWorkspaceForGoal } from "./writer"

const log = Log.create({ service: "goal-pool" })

function goalWorkspaceMissingMessage(goal: GoalRow) {
  return `goal ${goal.id} recorded workspace ${goal.workspace_dir} but the directory is missing on disk`
}

async function acquireGoalWorkspace(goal: GoalRow) {
  if (goal.workspace_dir) {
    if (!existsSync(goal.workspace_dir)) {
      throw new Error(goalWorkspaceMissingMessage(goal))
    }
    if (!goal.workspace_branch) {
      throw new Error(`goal ${goal.id} recorded workspace ${goal.workspace_dir} without workspace_branch`)
    }
    const reused = {
      name: path.basename(goal.workspace_dir),
      branch: goal.workspace_branch,
      directory: goal.workspace_dir,
    }
    log.info("reusing workspace dir", {
      goalID: goal.id,
      directory: reused.directory,
      branch: reused.branch,
    })
    return reused
  }

  const created = await Worktree.create({
    name: `goal-${goal.id.slice(-8)}`,
    checkout: "sync",
  })
  updateGoalWorkspace({
    goalID: goal.id,
    workspaceDir: created.directory,
    workspaceBranch: created.branch,
  })
  log.info("created workspace dir", {
    goalID: goal.id,
    directory: created.directory,
    branch: created.branch,
  })
  return created
}

function logWorktreePreservedForRetry(goalID: string, worktreeDir: string | undefined, reason: string) {
  if (!worktreeDir) return
  log.info("worktree preserved for retry", {
    goalID,
    directory: worktreeDir,
    reason,
  })
}

function ownedPathsConformanceCheck(input: {
  goalID: string
  goalTitle: string
  ownedPaths: string[]
  violations: Array<{ file: string; expected?: string; message: string }>
  changedFiles: string[]
}): {
  summary: string
  check: EngineEvaluationCheck
  criteria: {
    name: string
    status: "failed"
    family: string
    evidence: string
    label: string
    mode: "strict"
  }
} {
  const lines = [
    "owned_paths conformance gate rejected this delivery.",
    "",
    "Violations:",
    ...input.violations.map((item) => `- ${item.message}`),
    "",
    `Declared owned_paths: ${input.ownedPaths.join(", ") || "(none)"}`,
    `Changed files: ${input.changedFiles.join(", ") || "(none)"}`,
  ]
  const evidence = lines.join("\n")
  const summary = input.violations.length === 1
    ? `owned_paths conformance failed: ${input.violations[0]!.message}`
    : `owned_paths conformance failed: ${input.violations.length} files fell outside declared owned_paths`
  const checkName = `${input.goalID}.owned_paths_conformance`
  return {
    summary,
    check: {
      name: checkName,
      label: `${input.goalTitle} · owned_paths conformance`,
      family: "goal_eval",
      status: "failed",
      evidence,
      mode: "strict",
      severity: "essential",
      scorer_kind: "prebuilt",
      trigger: "on_goal",
      matched_paths: input.violations.map((item) => item.expected).filter((item): item is string => typeof item === "string" && item.length > 0),
    },
    criteria: {
      name: checkName,
      status: "failed",
      family: "goal_eval",
      evidence,
      label: `${input.goalTitle} · owned_paths conformance`,
      mode: "strict",
    },
  }
}

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
    const { plan, task } = this.opts
    const nodes = listPlanNodesByPlan(plan.id)
    const goals = listGoalsByPlan(plan.id) as GoalRow[]
    // Task-scoped goal_run history: readiness must see COMPLETED runs from
    // prior runs on the same task so goals that passed earlier are not
    // re-dispatched when the orchestrator creates a second run. A run-scoped
    // query hides that history, which is the bug that re-executed goal
    // gol_d9bdd3508002x4iAK65I9apfNo on tsk_d9bc59062001xuMSbxYap8hY5t.
    // modify_goal / restart_from_stage abort the old goal_runs when they
    // reset a passed goal, so the retriable `aborted` status re-admits
    // dispatch for intentional rework.
    const goalRuns = listGoalRunsForDispatch(task.id)

    const ready = readyGoalNodes(nodes, goals, goalRuns)
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
    const { plan, task, signal } = this.opts
    if (signal?.aborted) return

    while (this.active.size < this.opts.concurrency && this.queue.length > 0) {
      // Re-evaluate readiness each iteration (a just-dispatched goal's dep resolution may change).
      // Task-scoped goal_runs — see submit() for rationale.
      const nodes = listPlanNodesByPlan(plan.id)
      const goals = listGoalsByPlan(plan.id) as GoalRow[]
      const goalRuns = listGoalRunsForDispatch(task.id)
      const ready = readyGoalNodes(nodes, goals, goalRuns)
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

    // ── 1. engine_goal.status is derived from goal_run chain tip; see
    // engine/goal-status.ts. We do NOT write "running" here — the upcoming
    // createGoalRun(queued) + pipeline/executor.ts updateGoalRun(running)
    // will drive syncGoalStatus → goal.status=running within a few hundred ms.
    //

    let worktreeDir: string | undefined
    let goalRun: GoalRunRow | undefined
    try {
      // ── 2. Acquire goal-scoped workspace ──
      const worktreeInfo = await acquireGoalWorkspace(entry.goal)
      worktreeDir = worktreeInfo.directory

      // ── 2b-pre. Mount the intent bundle at .opencorvus/intent/ BEFORE planning ──
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
      // Per-goal step identity: the only goal-scope step in the pipeline
      // workflow is `build`, with three phases (plan / build / evaluate).
      // We create a kind="executor" container session up front — the
      // overlay maps this to the step card, and planner / build / evaluator
      // child sessions claim under the matching phase sub-card. The
      // container has no LLM of its own; the seeded dispatch header is
      // surfaced through the step card's header row.
      //
      // Named `containerSession` rather than `executorSession` to avoid
      // collision with `ensureExecutorSession`'s engine_executor_session
      // row at line ~528 — a different domain (provider-level tracking
      // of the external executor's own session) that happens to share
      // the word "executor".
      const containerSession = await createExecutorSession(
        task as any,
        entry.goal as any,
        worktreeDir!,
        worktreeInfo.branch,
        sessionID,
      )
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
        // Per-goal planner session: persisted via session.kind='planner' +
        // session.goal_id with parentID=containerSession.id so it nests
        // under the executor container in the overlay (plan phase).
        const planSession = await Session.createNext({
          kind: "planner",
          goalID: entry.goal.id,
          parentID: containerSession.id,
          title: `Plan: ${entry.goal.title}`,
          directory: Instance.directory,
        })
        const planHooks = sessionStreamHooks({ sessionID: planSession.id, taskID: task.id, stage: "plan" })
        try {
          const { planGoal } = await import("@/planner/agent")
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
          Database.use(db => db.update(EnginePlanNodeTable)
            .set({ brief: planSteps.brief, time_updated: Date.now() })
            .where(eq(EnginePlanNodeTable.id, entry.node.id))
            .run())
          log.info("goal pool: per-goal plan created", { goalID: entry.goal.id, briefLen: planSteps.brief.length })
          // Plan sub-phase done — but the build step stays running until
          // execution sub-phase reports completion/failure below.
        } catch (planErr) {
          // Plan failure terminates the build step.
          throw planErr
        } finally {
          await planHooks.flush()
        }
      }

      // ── 3. Create build worker session ──
      // createBuildSession persists the session row with kind="build" and
      // goalID=entry.goal.id, so sessionRole/sessionGoalID resolve correctly
      // before opencode emits its first message. parentSessionID is the
      // executor container so the build worker nests under the executor
      // card in the overlay (build phase within the step).
      const buildSession = await createBuildSession(task as any, entry.goal as any, worktreeDir, containerSession.id)

      // ── 4. Create GoalRun record ──
      goalRun = createGoalRun({
        taskID: task.id,
        goalID: entry.goal.id,
        planNodeID: entry.node.id,
        coordinatorRunID: run.id,
        sessionID: buildSession.id,
        workspaceDir: worktreeDir,
        metadata: { worktree_branch: worktreeInfo.branch },
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

      throwIfAborted(signal)

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

      throwIfAborted(signal)

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
          sessionID: buildSession.id,
          query: prompt.slice(0, 500),
        }).catch(err => {
          log.warn("memory injection failed, continuing without historical context", { error: String(err) })
          return null
        })
        if (memory) sections.push(memory)
        const taskPlanSection = TaskPlan.toMarkdown(buildSession.id)
        if (taskPlanSection) sections.push(taskPlanSection)
        if (sections.length > 0) systemOverride = sections.join("\n\n")
      }

      // Capture the pre-execution tree hash in the per-goal worktree.
      // This is the only "before" reference for delivery extraction — the
      // executor's edits are diffed against it. Must happen AFTER retry
      // replay + intent bundle + per-goal planning writes land, and BEFORE
      // the executor submits its first tool call, otherwise the diff is
      // polluted by orchestrator-internal writes (intent bundle, plan notes)
      // or misses the very first file the executor writes.
      //
      // Fails loud if Snapshot.track() returns empty — the project must be
      // a git repo with snapshot enabled, which is a dispatch-time invariant
      // for per-goal worktree execution. A silent empty baseRef would produce
      // silent empty deliveries downstream.
      // Goal-scoped baseRef: captured ONCE when the goal first dispatches,
      // then reused on every retry. Snapshot diffs (`baseRef → mergeRef`)
      // stay anchored to the original scaffold state so "zero file changes"
      // only fires when the executor genuinely produced nothing relative to
      // task-start — not when a noop retry produced nothing relative to the
      // PRIOR attempt's output (which is still sitting in the preserved
      // worktree per spec-10).
      const goalRowForBaseRef = findGoal(entry.goal.id)
      if (!goalRowForBaseRef) {
        throw new Error(
          `goal-pool: findGoal(${entry.goal.id}) returned undefined after acquireGoalWorkspace — engine_goal row must exist at dispatch time.`,
        )
      }
      let baseRef: string
      if (goalRowForBaseRef.workspace_base_ref) {
        baseRef = goalRowForBaseRef.workspace_base_ref
        log.info("reusing goal-scoped baseRef", {
          goalID: entry.goal.id, baseRef, goalRunID: goalRun.id,
        })
      } else {
        const fresh = await Instance.provide({
          directory: worktreeDir,
          fn: () => Snapshot.track(),
        })
        if (!fresh) {
          throw new Error(`goal-pool: Snapshot.track() returned empty for worktree ${worktreeDir}. Per-goal dispatch requires the project to be a git repo with snapshot enabled — current state is incompatible with delivery extraction.`)
        }
        baseRef = fresh
        updateGoalWorkspaceBaseRef(entry.goal.id, baseRef)
        log.info("captured goal-scoped baseRef", {
          goalID: entry.goal.id, baseRef, goalRunID: goalRun.id,
        })
      }
      updateGoalRun(goalRun.id, { base_ref: baseRef })
      throwIfAborted(signal)

      // Build step already running from plan sub-phase above; this re-mark
      // is a no-op but keeps the call site for parity with the failure paths.
      const executor = ExecutorRegistry.createInstance(run.executor)
      const submission = await executor.submit({
        sessionID: buildSession.id,
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

      // ── 7. Run pipeline with inactivity detection ──
      const execGoal = goalRowToContract(entry.goal)
      const execDeps = (Array.isArray(execGoal.depends_on) ? execGoal.depends_on : []) as string[]
      const executionContract: GoalContract = {
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

      const pipeline = runGoalPipeline(executionContract, {
        executor,
        workDir: worktreeDir,
        sessionID: buildSession.id,
        executorSessionID: executorSession.id,
        queueTaskID: submission.queueTaskID,
        signal,
        baseRef,
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
          projectExecutorEventToSession(task.id, run, buildSession.id, event.event).catch((err) => {
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
      await stallWatcher.catch(err => {
        // stallWatcher is a background timer racing the pipeline stream. When
        // the stream finishes first we abort and join the watcher; the abort
        // itself is what lands in .catch. A genuine watcher bug would also
        // land here, so we log rather than swallow.
        if (!stallCtrl.signal.aborted) {
          log.warn("stall watcher rejected unexpectedly", { goalID: entry.goal.id, error: String(err) })
        }
      })

      if (signal.aborted) {
        return { goalID: entry.goal.id, goalRunID: goalRun.id, title: entry.goal.title, status: "failed", error: "aborted", attempts: 1 }
      }

      // ── 8. Determine goal status from executor result ──
      // Any of the following is a goal failure:
      //   • pipeline reported no delivery at all
      //   • Snapshot produced no commit ref (no stage-able changes)
      //   • commit exists but diffs are empty (executor committed no-op)
      // Each of these means the executor produced nothing actionable, and we
      // MUST NOT treat it as passed — silent empty-delivery was the root of
      // the chgZ-style hang + the benchmark 006/007 stall: a permission hang
      // or LLM crash surfaces here and nowhere else. Let it crash loud.
      const now = Date.now()
      if (!delivery || !delivery.commitRef || delivery.diffs.length === 0) {
        const failReason = !delivery
          ? (pipelineError ?? "Executor completed without delivery (no error detail)")
          : !delivery.commitRef
            ? (pipelineError ?? "Executor completed but produced no commit (zero file changes)")
            : (pipelineError ?? "Executor committed but produced zero file diffs (no-op commit)")
        // goal_run is in `evaluating` here (pipeline/executor.ts set it);
        // settle it to `failed` — engine_goal.status is derived, no direct UPDATE.
        if (goalRun) {
          updateGoalRun(goalRun.id, { status: "failed", error: failReason })
        }
        logWorktreePreservedForRetry(entry.goal.id, worktreeDir, failReason)

        EngineProtocol.emit(Event.GoalFailed, {
          taskID: task.id, goalID: entry.goal.id, summary: `${entry.goal.title}: ${failReason}`,
        }, { source: "executor" }).catch(err => log.warn("GoalFailed emit failed (executor source)", { goalID: entry.goal.id, error: String(err) }))

        return {
          goalID: entry.goal.id, goalRunID: goalRun.id, title: entry.goal.title,
          status: "failed", error: failReason, attempts: 1,
        }
      }

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

      // ── Manifest conformance advisory (non-binding) ──
      // Detect files written outside the goal's declared `owned_paths` and
      // surface them as an advisory criterion row + soft check in the
      // per-goal evidence. This is NOT a hard gate anymore:
      //
      //   - Framework byproducts (next-env.d.ts, .next/, dist/, node_modules/),
      //     generic project files (.gitignore, .env.example, README.md), and
      //     config files (tailwind.config.*, next.config.*, vite.config.*)
      //     routinely fall outside any declared owned_paths but are NOT
      //     genuine scope violations — rejecting on them burned every retry
      //     on cosmetic drift while the executor produced perfectly
      //     working output.
      //
      //   - Real scope conflicts (goal A writing into goal B's declared
      //     paths) and real layout-drift bugs (src/src/ double-wrap that
      //     breaks the build) are caught downstream by the per-goal
      //     evaluator's build / test / typecheck shell checks — those ARE
      //     binding. An advisory row records the drift so the delivery
      //     agent can still see it, but the path check itself cannot
      //     kill the goal.
      const { filesChangedByCommit, validateOwnedPathsDetailed } = await import("@/goal/merge")
      const committedFiles = await filesChangedByCommit(delivery.commitRef, worktreeDir!)
      const conformance = validateOwnedPathsDetailed(
        committedFiles.map((item) => item.file),
        goalFields.owned_paths,
      )
      if (!conformance.valid) {
        log.warn("owned_paths advisory: files outside declared scope", {
          goalID: entry.goal.id,
          count: conformance.details.length,
          violations: conformance.details.slice(0, 5).map(v => v.message),
        })
        await upsertTaskCriteria(task.id, [{
          name: `${entry.goal.id}.owned_paths_advisory`,
          label: `${entry.goal.title} · owned_paths (advisory)`,
          family: "goal_eval",
          status: "skipped",
          evidence: [
            `${conformance.details.length} file(s) outside declared owned_paths (advisory — not a rejection).`,
            "",
            "Violations:",
            ...conformance.details.map(v => `- ${v.message}`),
            "",
            "Declared owned_paths: " + (goalFields.owned_paths.join(", ") || "(none)"),
            "Build / test / typecheck remain the binding gates; this row is informational.",
          ].join("\n"),
          mode: "soft",
        }]).catch((err) => {
          log.warn("owned_paths advisory: sink criteria failed (non-fatal)", {
            goalID: entry.goal.id, error: String(err),
          })
        })
      }

      // ── Per-goal deterministic evaluator (gated) ──
      // The legacy path treats "executor produced delivery" as sufficient for
      // a passed goal. Per design (01-agents.md L111 + docs/product/.../evaluator.md):
      // evaluator is the deterministic command runner that verifies each
      // goal's acceptance_specs BEFORE marking passed. Gated by
      // `evaluator.per_goal_enabled` so the path can be flipped on when
      // downstream consumers (criteria panel, retry pipeline) are stable.
      const orchCfgForEval = await EngineConfig.get()
      if (orchCfgForEval.evaluator?.per_goal_enabled) {
        // Per-goal evaluator session — makes the evaluate phase card in the
        // overlay come alive. evaluateGoal() is a pure shell/rubric runner
        // with no LLM of its own, but it can stream command-by-command
        // output through the session hooks so the operator sees test/build
        // output in real time (and why a failing goal rejected).
        const evaluatorSession = await createEvaluatorSession(
          task as any, entry.goal as any, worktreeDir!, containerSession.id,
        )
        const evalHooks = sessionStreamHooks({
          sessionID: evaluatorSession.id,
          taskID: task.id,
          stage: "evaluator",
        })
        try {
          const verdict = await evaluateGoal({
            contract,
            delivery,
            workDir: worktreeDir!,
            signal,
            tier: orchCfgForEval.evaluator.tier,
            sessionID: evaluatorSession.id,
            stream: evalHooks,
          })

          // Sink each check into task.metadata.criteria_results so the overlay
          // Quality Gates panel reflects deterministic per-goal outcomes.
          // NOTE: spec-09 invariant — criteria_results is a PROJECTION of
          // evidence. The persistEvidence call below is the single source of
          // truth; this upsert is the aggregate view. Both must always happen
          // together.
          if (verdict.checks.length > 0) {
            await upsertTaskCriteria(task.id, verdict.checks.map((c) => ({
              name: `${entry.goal.id}.${c.name}`,
              status: c.passed ? "passed" as const : "failed" as const,
              family: "goal_eval",
              evidence: c.output,
              label: `${entry.goal.title} · ${c.name}`,
              mode: c.mode,
            }))).catch((err) => {
              log.warn("per-goal eval: sink criteria failed (non-fatal)", {
                goalID: entry.goal.id, error: String(err),
              })
            })
          }

          // spec-09 Phase B: persist a `scope="goal_run"` evidence row right
          // after evaluateGoal, BEFORE the goal_run status transition. The
          // row records the full per-check detail (spec_id, scorer_kind,
          // mode, trigger, exit_code, output_digest) that downstream
          // consumers — retry prompt builder, delivery short-circuit, rework
          // no-progress signature — will read. Failure to persist is
          // non-fatal for this goal run (we already have verdict), but the
          // warning is loud because all downstream spec-09 features depend
          // on this row.
          try {
            const { persistEvidence, outputDigest } = await import("@/verification")
            const evaluationChecks = verdict.checks.map((c) => ({
              name: c.name,
              label: `${entry.goal.title} · ${c.name}`,
              family: "goal_eval",
              status: c.passed ? "passed" as const : (c.output?.startsWith("deferred to delivery") ? "skipped" as const : "failed" as const),
              evidence: c.output,
              spec_id: c.spec_id,
              scorer_kind: c.scorer_kind,
              mode: c.mode,
              severity: c.severity,
              trigger: c.trigger,
              exit_code: c.exit_code,
              idle_timed_out: c.idle_timed_out,
              output_digest: c.output ? outputDigest(c.output) : undefined,
            }))
            persistEvidence({
              taskID: task.id,
              runID: run.id,
              goalRunID: goalRun.id,
              scope: "goal_run",
              status: verdict.pass ? "passed" : "failed",
              verdict: verdict.verdict,
              summary: verdict.reasoning || (verdict.pass ? "per-goal evaluator passed" : "per-goal evaluator rejected"),
              checks: evaluationChecks,
              timeCompleted: Date.now(),
            })
          } catch (err) {
            log.warn("per-goal eval: persistEvidence failed (non-fatal but blocks spec-09 downstream)", {
              goalID: entry.goal.id,
              goalRunID: goalRun.id,
              error: err instanceof Error ? err.message : String(err),
            })
          }

          if (!verdict.pass) {
            const failReason = verdict.reasoning || `Per-goal evaluator rejected: ${verdict.verdict}`
            // Settle goal_run → failed; engine_goal.status derives from it.
            updateGoalRun(goalRun.id, { status: "failed", error: failReason })
            logWorktreePreservedForRetry(entry.goal.id, worktreeDir, failReason)
            EngineProtocol.emit(Event.GoalFailed, {
              taskID: task.id, goalID: entry.goal.id, summary: `${entry.goal.title}: ${failReason}`,
            }, { source: "evaluator" }).catch(err => log.warn("GoalFailed emit failed (evaluator source)", { goalID: entry.goal.id, error: String(err) }))
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
          // Surface the infrastructure failure into the evaluator session
          // so the overlay's evaluate phase card shows WHY eval could not
          // run (instead of an empty phase that silently flipped to failed).
          try {
            const r = evalHooks.onChunk?.({ chunk: { type: "reasoning-delta", id: "eval-infra-error", text: `\n✗ evaluator threw: ${msg}\n` } as any })
            if (r && typeof (r as Promise<unknown>).then === "function") await r
          } catch {
            /* broadcast best-effort; real error is already logged above */
          }
          updateGoalRun(goalRun.id, { status: "failed", error: `evaluator threw: ${msg}` })
          logWorktreePreservedForRetry(entry.goal.id, worktreeDir, `evaluator threw: ${msg}`)
          EngineProtocol.emit(Event.GoalFailed, {
            taskID: task.id, goalID: entry.goal.id, summary: `${entry.goal.title}: evaluator threw: ${msg}`,
          }, { source: "evaluator" }).catch(err => log.warn("GoalFailed emit failed (evaluator source)", { goalID: entry.goal.id, error: String(err) }))
          return {
            goalID: entry.goal.id, goalRunID: goalRun.id, title: entry.goal.title,
            status: "failed", error: `evaluator threw: ${msg}`, delivery, attempts: 1,
          }
        } finally {
          // Persist whatever text/reasoning the evaluator streamed during
          // its run. Without this, the trailing parts of the eval output
          // (final rubric judgment, supplement command results) would be
          // stranded in memory.
          await evalHooks.flush().catch((err) => {
            log.warn("eval hooks flush failed (non-fatal)", { goalID: entry.goal.id, error: String(err) })
          })
        }
      }

      // ── 9. Merge delivery ──
      await hooks.mergeDelivery(task, run, plan, goalRun!, delivery)

      // ── 10. Goal terminal cleanup ──
      await cleanupGoalWorkspaceForGoal(entry.goal.id)

      // Delivery merged and terminal cleanup attempted. The goal_run now
      // transitions to completed; engine_goal.status is derived from it.
      updateGoalRun(goalRun.id, { status: "completed" })

      EngineProtocol.emit(Event.GoalPassed, {
        taskID: task.id, goalID: entry.goal.id, summary: entry.goal.title,
      }, { source: "executor" }).catch(() => {})

      log.info("goal pool: goal execution complete", {
        goalID: entry.goal.id, status: "passed", files: delivery.diffs.length,
      })

      return {
        goalID: entry.goal.id,
        goalRunID: goalRun!.id,
        title: entry.goal.title,
        status: "passed",
        verdict: "accepted",
        delivery,
        attempts: 1,
      }

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err)
      log.error("goal dispatch/execution failed", { goalID: entry.goal.id, error })
      if (goalRun) {
        try {
          updateGoalRun(goalRun.id, {
            status: signal.aborted ? "aborted" : "failed",
            error: signal.aborted ? "aborted" : error,
            blocking_reason: null,
          })
        } catch (updateErr) {
          log.warn("goal pool: failed to finalize goal_run after dispatch error", {
            goalID: entry.goal.id,
            goalRunID: goalRun.id,
            error: updateErr instanceof Error ? updateErr.message : String(updateErr),
          })
        }
        if (!signal.aborted) {
          logWorktreePreservedForRetry(entry.goal.id, worktreeDir, error)
        }
      }

      // No goal_run was created before the dispatch threw. Two cases with
      // very different semantics:
      //
      //   A. Worktree WAS acquired (worktreeDir set). The failure happened
      //      during per-goal planning — typically a transient LLM/provider
      //      error (e.g. "No output generated" from a stream interruption).
      //      This is retryable: create a shadow failed goal_run so
      //      Option B (supersedeGoalRun) + retry_failed_goals can route a
      //      fresh attempt through the same goal.workspace_dir. Preserve the
      //      workspace per spec-10 §2.4 — cleanup is reserved for terminal
      //      goal states (passed / cascade_failed / task cancel), not
      //      single-attempt transient errors.
      //
      //   B. Worktree could NOT be acquired (no worktreeDir, e.g. disk full,
      //      git init failed, process crash during Worktree.create). This is
      //      a genuine cascade: without a workspace, retries have no place
      //      to run. Escalate to updateGoalCascadeFailed to mark the goal
      //      permanently failed — we cannot salvage it with the same
      //      infrastructure it already failed on.
      //
      // Prior behavior conflated A and B and clamped every pre-createGoalRun
      // failure to cascade_failed, which meant a single provider stream blip
      // nuked the worktree (wiping prior attempts' files + evidence) and
      // forced the orchestrator to start the goal from scratch. That
      // contradicts spec-10's "preserve on progress" invariant.
      if (!goalRun) {
        if (worktreeDir) {
          const goalRow = findGoal(entry.goal.id)
          const branch = goalRow?.workspace_branch ?? undefined
          const shadowRun = createGoalRun({
            taskID: task.id,
            goalID: entry.goal.id,
            planNodeID: entry.node.id,
            coordinatorRunID: run.id,
            workspaceDir: worktreeDir,
            metadata: {
              worktree_branch: branch,
              pre_create_failure: true,
            },
          })
          updateGoalRun(shadowRun.id, {
            status: "failed",
            error,
            blocking_reason: null,
          })
          logWorktreePreservedForRetry(
            entry.goal.id,
            worktreeDir,
            `pre-createGoalRun: ${error}`,
          )
        } else {
          updateGoalCascadeFailed({
            goalID: entry.goal.id,
            reason: `worktree acquire failed before dispatch: ${error}`,
          })
        }
      }

      return {
        goalID: entry.goal.id, goalRunID: goalRun?.id ?? "", title: entry.goal.title,
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

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw new Error("goal dispatch aborted")
  }
}
