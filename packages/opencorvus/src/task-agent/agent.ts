/**
 * Task Agent — master agent in the Agent Team architecture.
 *
 * Calls LLM through ProviderLLM.stream() — the unified provider adaptation layer.
 *
 * Triggered by:
 * - Task creation (kind: "created") — new task, agent plans and submits execution
 * - Batch complete (kind: "batch_complete") — goal batch finished (any mix of pass/fail),
 *   agent reads fresh context and decides next action
 * - User retry request (kind: "retry")
 *
 * The Task Agent controls the entire pipeline via tools:
 * requirements → goals → plan → execute → eval → delivery verify → publish
 * All other agents (requirements, architect, plan, eval, delivery) are subordinate workers.
 */
import { stepCountIs } from "ai"
import { Provider } from "@/provider/provider"
import { renderSpecsAsText, type AcceptanceSpec } from "@/acceptance/types"
import { AgentRuntime } from "@/agent/runtime"
import { Session } from "@/session"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { Trace } from "@/trace"
import { clearTaskSessions, registerGoalRunSession } from "@/server/routes/task-event"
import { sessionStreamHooks } from "@/agent/runtime"
import { createTaskAgentTools } from "./tools"
import { SubAgentProtocol } from "@/agent/sub-agent-protocol"
import { AttachmentStore } from "@/storage/attachment-store"
import { clarificationTranscriptSection, operatorNotesSection } from "@/orchestrator/helpers"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPlan,
  findRun,
  findRuns,
  findSpecSnapshot,
  findTask,
  listActiveGoalRunsByCoordinator,
  listGoals,
  requireTask,
  type TaskRow,
} from "@/orchestrator/store"
import { DEFAULT_MAX_RUNS, DEFAULT_MAX_FIX_RUNS } from "@/orchestrator/helpers"
import { updateTask } from "@/orchestrator/state"
import {
  WorkflowRegistry,
  createWorkflowState,
  renderWorkflowPrompt,
  type WorkflowState,
  type MiniWorkflow,
} from "@/orchestrator/workflow"
import { OrchestratorProtocol } from "@/orchestrator/protocol"
import { Event as OrchestratorEvent } from "@/orchestrator/model"

const log = Log.create({ service: "task-agent" })
const MAX_STEPS = 20

// ---------------------------------------------------------------------------
// Trigger types
// ---------------------------------------------------------------------------

export type TaskAgentTrigger =
  | { kind: "created" }
  | { kind: "batch_complete"; runID: string; summary: { passed: number; failed: number; total: number }; depBlocked?: Array<{ goalTitle: string; blockedBy: Array<{ title: string; status: string }> }> }
  | { kind: "retry" }

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

const running = new Map<string, AbortController>()
// Tracks tasks that have already emitted Trace.event("task.finish"); the
// task-agent can be re-triggered after a task reaches terminal status, and
// without dedupe each re-trigger would emit a redundant finish event.
const finishEmitted = new Set<string>()
// Cooldown: when the Task Agent last finished for each task.
// Orphan recovery checks this to avoid re-triggering immediately.
const lastFinished = new Map<string, number>()

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export namespace TaskAgent {
  export function abort(taskID: string): void {
    const ctrl = running.get(taskID)
    if (ctrl) {
      ctrl.abort("task agent aborted")
      running.delete(taskID)
      log.info("task agent aborted", { taskID })
    }
  }

  export function isRunning(taskID: string): boolean {
    return running.has(taskID)
  }

  export async function processTask(taskID: string, trigger: TaskAgentTrigger): Promise<void> {
    // ── Dispatch gate: suppress wake-up while goals are executing ──
    // When goals are running in parallel, the Task Agent has nothing useful
    // to do — it would waste API tokens asking LLM to spin-wait.
    // notifyGoalResult() ensures all goal_runs are in terminal state before
    // calling processTask, so legitimate completion triggers pass naturally.
    // failRun() marks all active goal_runs as failed before calling, so it
    // also passes. Only spurious triggers (orphan recovery, user retry,
    // redundant syncRun re-notifications) are blocked.
    const gateTask = findTask(taskID)
    if (gateTask?.active_run_id) {
      const activeGoalRuns = listActiveGoalRunsByCoordinator(gateTask.active_run_id)
      if (activeGoalRuns.length > 0) {
        log.info("task agent suppressed by dispatch gate", {
          taskID,
          trigger: trigger.kind,
          activeGoalRuns: activeGoalRuns.length,
          goalRunIDs: activeGoalRuns.map(gr => gr.id),
        })
        return
      }
    }

    abort(taskID)
    const ctrl = new AbortController()
    running.set(taskID, ctrl)

    let contentHooks: ReturnType<typeof sessionStreamHooks> | undefined
    let stopSignal: AbortSignal | undefined
    try {
      const task = requireTask(taskID)
      if (!task.session_id) {
        log.error("task agent: no session_id on task", { taskID })
        return
      }

      // 0. Initialize workflow state on new task creation
      let workflow: MiniWorkflow | undefined
      let workflowState: WorkflowState | undefined
      if (trigger.kind === "created") {
        finishEmitted.delete(taskID)
        Trace.event({
          taskID,
          sessionID: task.session_id,
          category: "task.start",
          payload: { kind: task.kind, request: task.request },
        })
        const requestedID = (task.metadata as any)?._workflow?.workflowID
        const workflowID = requestedID ?? await WorkflowRegistry.defaultID()
        workflow = await WorkflowRegistry.resolve(workflowID) ?? WorkflowRegistry.resolveSync("standard")
        if (workflow) {
          workflowState = createWorkflowState(workflow)
          const meta = { ...(task.metadata ?? {}), _workflow: workflowState }
          await updateTask(task, { metadata: meta }, `Workflow selected: ${workflow.name}`)
          OrchestratorProtocol.emit(OrchestratorEvent.WorkflowSelected, {
            taskID,
            workflowID: workflow.id,
            workflowName: workflow.name,
            summary: `Workflow "${workflow.name}" selected`,
          })
        }
      } else {
        // Load existing workflow state for re-triggers
        const existingState = (task.metadata as any)?._workflow as WorkflowState | undefined
        if (existingState) {
          workflow = await WorkflowRegistry.resolve(existingState.workflowID) ?? WorkflowRegistry.resolveSync(existingState.workflowID)
          workflowState = existingState
        }
      }

      // 1. Resolve model — respects agent.task.model in user config; falls
      //    through to Provider.defaultModel() otherwise.
      const { resolveAgentModel } = await import("@/agent/model")
      const model = await resolveAgentModel("task").catch((e) => {
        log.error("task agent: no LLM model available", { taskID, error: e instanceof Error ? e.message : String(e) })
        return undefined
      })
      if (!model) return

      // 2. Create child session + streaming hooks
      const agentSession = await Session.createNext({
        parentID: task.session_id,
        title: `Agent: ${task.title}`,
        directory: Instance.directory,
      })
      registerGoalRunSession(agentSession.id, taskID, "assistant")
      contentHooks = sessionStreamHooks({
        sessionID: agentSession.id,
        taskID,
        stage: "assistant",
      })


      // 3. Create tools (agentSessionID passed so tool sessions become children)
      const { tools, stopSignal: dispatchSignal } = createTaskAgentTools({ taskID, agentSessionID: agentSession.id, signal: ctrl.signal, workflow, workflowState })
      stopSignal = dispatchSignal
      const guard = toolGuard(tools)

      // 4. Build prompt — use the user's original request as the user message
      // for "created" triggers (it IS the user's intent). For re-triggers
      // (batch_complete, retry) use a short event description.
      const system = buildSystemParts(task, trigger, workflow, workflowState)
      const userText = trigger.kind === "created"
        ? task.request
        : describeTrigger(task, trigger)
      // Build multimodal content when task has file attachments (only for initial trigger).
      // AttachmentStore.partition routes image/audio/video/pdf to inline file
      // parts and text/* / json to a URL-only reference list; see helper
      // comments for the silent-rejection rationale.
      const attachments = trigger.kind === "created" && Array.isArray(task.attachments)
        ? (task.attachments as Array<{ sha?: string; url?: string; mime?: string; size?: number; filename?: string }>)
        : undefined
      const { multimodal, referenceOnly } = AttachmentStore.partition(attachments)
      const attachmentParts = await AttachmentStore.loadFileParts(multimodal)
      // Task Agent is the orchestrator; it does NOT own a `read` tool.
      // Attachments are forwarded automatically to the sub-agents it dispatches
      // (requirements / design_analysis / architect via the `requirements` /
      // `design_analysis` / `architect` tools), which DO have read access. The
      // inventory below tells the Task Agent what's available when deciding
      // which sub-agent to invoke; the trailing instruction is a HARD design
      // constraint (no read tool here), not a fallback hint.
      const referenceText = referenceOnly.length
        ? AttachmentStore.renderReferenceList(referenceOnly).replace(
            "## Task Attachments (read via the `read` tool when you need their content)",
            "## Task Attachments (forwarded to sub-agents automatically)",
          ) +
          "\n\nDo NOT attempt to read these yourself — invoke the appropriate sub-agent (requirements / design_analysis / architect) which receives the attachments and can read them via its `read` tool."
        : ""
      const enrichedUserText = userText + referenceText
      const userContent = attachmentParts.length
        ? [{ type: "text" as const, text: enrichedUserText }, ...attachmentParts]
        : enrichedUserText

      log.info("task agent starting", {
        taskID,
        trigger: trigger.kind,
        sessionID: agentSession.id,
        model: `${model.providerID}/${model.id}`,
        toolCount: Object.keys(tools).length,
      })

      // 5. Run through AgentRuntime — unified guard / failure / persistence wiring.
      const taskAgentProgressMs = 20 * 60 * 1000
      const runResult = await AgentRuntime.run({
        agent: "task-agent",
        model,
        system,
        messages: [{ role: "user" as const, content: userContent }],
        tools: guard.tools as any,
        stopWhen: stepCountIs(MAX_STEPS),
        cacheKey: `task-${taskID}`,
        sessionID: agentSession.id,
        taskID,
        stage: "assistant",
        signal: AbortSignal.any([ctrl.signal, guard.signal, stopSignal]),
        onStepFinish: guard.onStepFinish as any,
        hooks: contentHooks,
        policies: {
          // Task-agent is the root coordinator: it sits in `tool.execute`
          // for minutes at a time while sub-agents (design-analyst /
          // requirements / planner / executor) run. The root stream emits no
          // chunks during those gaps, so a tight Tier-1 alive timer would
          // false-trigger. Each sub-agent carries its own alive guard, so
          // we collapse Tier 1 into Tier 2 here (alive == progress).
          aliveTimeoutMs: taskAgentProgressMs,
          progressTimeoutMs: taskAgentProgressMs,
          absoluteTimeoutMs: taskAgentProgressMs * 3,
          // Root agent: surface child failures as collected state; the task
          // loop handles escalation, not the runtime.
          failurePolicy: "collect",
        },
      })
      const resultText = runResult.text
      const resultSteps = runResult.steps
      const resultFinishReason = runResult.finishReason
      const toolCallCount = runResult.toolCallCount
      log.info("task agent finished", {
        taskID,
        trigger: trigger.kind,
        steps: resultSteps.length,
        toolCalls: toolCallCount,
        finishReason: resultFinishReason,
        textLength: resultText?.length ?? 0,
        streamFailures: runResult.failures.count,
        timeoutTier: runResult.timeout?.tier,
      })

      // Critical stream failures (mid-stream protocol violations, persist
      // failures, provider onError, progress-guard timeouts) mean the
      // agent's view of the run is incoherent and we must fail the task.
      // Excluded from critical:
      //   - `flush`: cleanup-path persistence hiccup after the LLM already
      //     returned; doesn't retroactively invalidate a successful run.
      //   - `tool-input-validation`: AI-SDK rejected a tool call's input
      //     against its Zod inputSchema; the SDK has already fed the error
      //     back to the model as the tool result, so the model self-corrects
      //     on the next step. Bounded by stopWhen=stepCountIs — unrecoverable
      //     models still loud-fail via step-cap, not silently. Failing hard
      //     here would short-circuit the "Task Agent is the sole decision-
      //     maker, independent reasoning" design (01-agents.md).
      const critical = runResult.failures.items.filter(
        (item) => item.kind !== "flush" && item.kind !== "tool-input-validation",
      )
      const flushOnly = runResult.failures.items.filter((item) => item.kind === "flush")
      if (flushOnly.length > 0) {
        log.warn("task agent: post-stream flush hiccup (non-fatal)", {
          taskID,
          flushFailures: flushOnly.length,
          firstFlushKind: flushOnly[0]?.chunkType,
          firstFlushReason: flushOnly[0]?.reason,
        })
      }
      if (critical.length > 0 || runResult.timeout) {
        const first = critical[0]
        const reason = runResult.timeout?.reason
          ?? (first ? `${first.kind}: ${first.reason}` : "unknown stream failure")
        log.warn("task agent surfaced stream failures", {
          taskID,
          criticalCount: critical.length,
          timeoutTier: runResult.timeout?.tier,
          firstFailureKind: first?.kind,
        })
        const current = requireTask(taskID)
        if (current.status !== "completed" && current.status !== "failed" && current.status !== "cancelled") {
          await updateTask(current, {
            status: "failed",
            error: `Task Agent stream failure: ${reason}`,
          }, `Task Agent stream failure: ${reason}`)
        }
      }

    } catch (error) {
      // Finalize any tool parts stuck in running/pending before returning
      await contentHooks?.flush().catch(() => undefined)
      if (ctrl.signal.aborted) {
        log.info("task agent was aborted", { taskID })
        return
      }
      // stopSignal abort is a normal termination (submit_execution/dispatch/execute_goal
      // dispatched work). NOT an error — the agent will be re-triggered on completion.
      if (stopSignal?.aborted) {
        log.info("task agent stopped after dispatch", { taskID, trigger: trigger.kind })
        return
      }
      const msg = error instanceof Error ? error.message : String(error)
      log.error("task agent failed", { taskID, trigger: trigger.kind, error: msg })
      // Surface the error on the task so UI/orphan-recovery can see it.
      // Don't change task status — let orphan recovery decide the next step.
      try {
        const current = requireTask(taskID)
        if (current.status !== "completed" && current.status !== "failed" && current.status !== "cancelled") {
          await updateTask(current, { error: `Task Agent error: ${msg}` }, `Task Agent failed: ${msg}`)
        }
      } catch { /* task may have been deleted */ }
    } finally {
      running.delete(taskID)
      const finalTask = findTask(taskID)
      const isTerminal = !!finalTask && (finalTask.status === "completed" || finalTask.status === "failed" || finalTask.status === "cancelled")
      if (isTerminal && !finishEmitted.has(taskID)) {
        finishEmitted.add(taskID)
        const sid = finalTask?.session_id ?? undefined
        Trace.event({
          taskID,
          sessionID: sid,
          category: "task.finish",
          payload: { status: finalTask?.status, error: finalTask?.error ?? null },
        })
        // Per-task in-memory bookkeeping built up during the run:
        //   • goalRunSessionRegistry (task-event.ts): ~10+ sub-sessions per task
        //   • Trace.counters / Trace.writes: per-taskID seq counter + write queue
        // None of the register call sites pair with an unregister, so without
        // this the maps grow unboundedly across benchmark runs. Release must
        // happen AFTER the task.finish Trace.event above so that event's
        // append syscall is already chained into Trace.writes.
        clearTaskSessions(taskID)
        Trace.clearTask(taskID)
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Trigger description
// ---------------------------------------------------------------------------

function describeTrigger(task: TaskRow, trigger: TaskAgentTrigger): string {
  switch (trigger.kind) {
    case "created":
      return "New task created. Process it."

    case "batch_complete": {
      const lines = [
        `Goal batch complete on run ${trigger.runID}.`,
        `Summary: ${trigger.summary.passed} passed, ${trigger.summary.failed} failed, ${trigger.summary.total} total.`,
      ]

      if (trigger.depBlocked && trigger.depBlocked.length > 0) {
        lines.push(
          "",
          "⚠ BLOCKED GOALS — the following pending goals CANNOT execute because their dependencies failed:",
        )
        for (const b of trigger.depBlocked) {
          const deps = b.blockedBy.map(d => `${d.title} [${d.status}]`).join(", ")
          lines.push(`  • "${b.goalTitle}" blocked by: ${deps}`)
        }
        lines.push(
          "",
          "ACTION REQUIRED: You MUST resolve the blocking goals before these can proceed.",
          "Call query_failed_goals, then either retry_failed_goals (with root cause analysis) or fail_task.",
          "Dispatching or waiting will NOT help — these goals will never become ready until the blockers are resolved.",
        )
      } else {
        lines.push(
          "",
          "Read context (read_context) to see goal statuses and eval evidence.",
          "Decide next action based on current state — no predetermined action.",
        )
      }

      return lines.join("\n")
    }

    case "retry":
      return `User requested retry.${task.error ? ` Previous error: ${task.error}` : ""}\nDecide how to proceed.`
  }
}

// ---------------------------------------------------------------------------
// System prompt — split into stable instructions (cacheable) and dynamic context
// ---------------------------------------------------------------------------

/** Static instructions that never change between invocations. */
const TASK_AGENT_INSTRUCTIONS = [
  "You are the OpenCorvus Task Agent — the central intelligence that drives task completion.",
  "You have tools to analyze requirements, plan, execute, and deliver goals. YOU decide what to do and when.",
  "There is NO fixed pipeline. You reason about the situation and choose the right action.",
  "Always respond in the same language as the task request. Default to Chinese (simplified) if ambiguous.",
  "",
  "## Route Decision (FIRST, exactly once)",
  "",
  "Before anything else, decide whether the task needs planning or can be handled directly.",
  "",
  "- **Direct build path** — call `build` with the user's request and a one-sentence `reason`. Use when the task is a single-file edit, bug fix, small refactor in place, typo/comment/config tweak, short debug-and-fix, or a lookup-then-edit. The build agent has read/write/edit/bash and solves it end-to-end. No requirements, no architect, no goals, no deliver. Call `build` AT MOST ONCE; when it returns, stop.",
  "- **Pipeline path** — go to requirements. Use when the task has multiple files, acceptance criteria, a UI to replicate from a design, cross-module refactor, new subsystem, or explicit non-functional goals.",
  "- **Can't tell** — prefer the pipeline. Requirements can still decompose into a single goal and the cost is marginal; a misrouted direct build skips verification entirely and is harder to recover from.",
  "",
  "Never do both paths. Never call `build` after entering requirements, and never call requirements after `build` has returned successfully.",
  "",
  "## Stage Sequence (pipeline path)",
  "",
  "**Clarification via `question`** — when you genuinely cannot proceed without a human decision, call the `question` tool. It renders option buttons in the task's InteractionPanel and blocks until the user answers. Use it SPARINGLY, only at these checkpoints:",
  "  (a) BEFORE requirements when the incoming request is too vague to decompose (e.g. a single sentence with no scope).",
  "  (b) DURING execute when you discover a missing critical input (conflicting goals, unspecified tech stack, unclear data source) that cannot be inferred from the codebase.",
  "  (c) BEFORE deliver when multiple viable approaches exist and the user should pick.",
  "  (d) AFTER refine to let the user select which improvement suggestions to roll into the next iteration.",
  "Do NOT ask the user for information you could reasonably derive from read_context, the task request, or existing goals. Prefer one well-structured question with options over a cascade of free-text prompts.",
  "0.5. **design_analysis** (optional, auto-triggered) — Analyze visual references (images, URLs) to produce structured design specs (layout tree, style tokens, component inventory, interactions, responsive rules). The spec is stored on task.metadata.design_spec and forwarded ONLY to the requirements agent — it does not leak into later sub-agent prompts. See triggering rules below.",
  "1. **requirements** — Analyze the task into goal contracts with acceptance criteria.",
  "2. **architect** — Coordinate cross-goal interface contracts. REQUIRED for multi-goal tasks — call after requirements returns 2+ goals. Skip only for single-goal tasks (the tool will enforce this automatically).",
  "3. **run** — Create run (create_run), then dispatch (submit_execution). The execution engine plans each goal automatically just before it executes — do NOT call plan_goal upfront for all goals.",
  "4. **deliver** — Aggregate and verify (deliver). Delivery agent is the single verification gate: it tests, fixes issues, and makes final acceptance decision. Only when all blocking goals have completed execution.",
  "5. **refine** (optional, post-completion) — Explore the delivered project, analyze quality/coverage/features, and suggest next iteration improvements. Use after delivery completes successfully, or when user re-triggers a completed task asking for improvements.",
  "",
  "You have these tools: build, design_analysis, requirements, architect, execute_goal, add_goal, modify_goal,",
  "dispatch_ready_goals, retry_failed_goals, query_failed_goals, read_context, create_run,",
  "submit_execution, deliver, publish_delivery, fail_task, restart_from_stage, refine, question.",
  "(Note: per-goal planning happens automatically inside the execution engine — no plan_goal tool needed.)",
  "",
  "**For new tasks:**",
  "- FIRST: apply the Route Decision rule above. Direct-build candidates call `build`; everything else goes to requirements.",
  "- Pipeline DEFAULT: go directly to requirements. Most non-trivial requests (PRDs, specs, designs, detailed descriptions) have enough information.",
  "- **Design analysis trigger**: Call design_analysis BEFORE requirements when ALL of these apply:",
  "  (1) The task is frontend/UI-related (web page, component, dashboard, landing page, etc.),",
  "  AND (2) visual references exist: image attachments OR a URL to replicate/analyze.",
  "  The design analyst produces exact layout, colors, typography, component inventory — information",
  "  that lets the requirements agent create pixel-accurate goals instead of vague 'build the UI' goals.",
  "  SKIP design_analysis when: no images/URLs, purely backend/API, or the request already contains detailed design specs.",
  "- If the request is genuinely unusable for decomposition (e.g., a single sentence like '做个订单系统' with no scope or context), call `question` with 2-3 targeted questions (scope, target users, key constraints) — then proceed to requirements once answered.",
  "- After requirements: ALWAYS call architect next if there are 2+ goals. It coordinates interface contracts that all executors depend on. Skip only when requirements returned exactly 1 goal.",
  "- Then create_run, then submit_execution. The execution engine plans each goal automatically.",
  "- Do NOT call plan_goal for goals upfront — planning is lazy and happens per-goal inside the execution engine, right before each goal executes.",
  "",
  "**After batch completes (re-triggered with batch_complete):**",
  "- FIRST: If any goals failed, call query_failed_goals",
  "  to get structured per-goal info. Without this information you CANNOT make",
  "  an informed retry decision.",
  "- **If ANY goals are still \"running\" or \"pending\" → do NOTHING. Stop immediately.**",
  "  You will be re-triggered again when the next batch completes.",
  "- Only proceed when ALL goals have terminal status (passed/failed).",
  "- Based on query_failed_goals output, REASON about each failure:",
  "  - All blocking goals passed → deliver (delivery agent will test, fix, and accept/reject)",
  "  - Some failed → **DEFAULT ACTION: autonomously fix and retry.** Call",
  "    retry_failed_goals with per_goal_analysis articulating root_cause +",
  "    failure_class + expected_fix for EVERY failed goal. The tool schema",
  "    enforces this — reflexive retry without analysis will be rejected.",
  "  - Missing dependency discovered → add_goal to create the dependency, then",
  "    retry_failed_goals (include the new goal's analysis if it was also failed).",
  "  - Wrong contract for a specific goal → modify_goal, then execute_goal.",
  "  - **ONLY use fail_task when the delivered code is empty, garbled, or",
  "    fundamentally unusable (e.g., no meaningful code produced, output is",
  "    random characters, or the executor produced nothing at all). All other",
  "    errors — logic bugs, test failures, missing imports, wrong approach —",
  "    MUST be fixed autonomously via retry_failed_goals.**",
  "- **NEVER call execute_goal on a passed goal.** Passed goals are terminal success",
  "  state. To change contract use modify_goal.",
  "",
  "**Post-completion iteration (re-triggered on completed task):**",
  "- User sent a message to a completed task → you are re-triggered with kind=retry.",
  "- Call refine to analyze what was built and generate improvement suggestions.",
  "- Call `question` with the suggestions as multi-select options so the user picks which to roll in.",
  "- Once you have the selection, call restart_from_stage(requirements) to begin a new cycle with the chosen scope.",
  "- The full iteration loop: deliver → refine → question → restart → requirements → architect → execute → deliver → ...",
  "- **If refine throws** (LLM returned non-JSON output): do NOT retry refine in a loop — that burns tokens on a likely-deterministic formatting failure. Instead call `question` directly with a short question asking what the operator wants to improve, then proceed with `restart_from_stage(requirements)` based on the answer. If the operator has no specific request, end the turn without restarting.",
  "",
  "**Dynamic adjustment (anytime):**",
  "- Discovered a missing requirement? → add_goal",
  "- Done_definition too vague? → modify_goal to sharpen it",
  "- Goal is unnecessary? → acknowledge and move on",
  "",
  "## Rules",
  "- Explain your reasoning before each tool call.",
  "- After submit_execution, execute_goal, or dispatch_ready_goals, STOP — you'll be re-triggered on completion.",
  "- Use deliver to complete (handles aggregation + verification + fix + git publish + task completion).",
  "- Terminal state (completed/failed/cancelled) → do nothing.",
  "- User messages in Operator Notes → acknowledge in your reasoning.",
  "- NEVER skip requirements or deliver stages.",
  "- When executor delivers errors, your default response is to fix and retry — not to give up.",
].join("\n")

/**
 * Build the task agent system prompt as a two-part array:
 *   [0] = static instructions (stable, benefits from 1h cache TTL)
 *   [1] = dynamic context (changes per trigger — task state, goals, budget, etc.)
 */
function buildSystemParts(task: TaskRow, trigger: TaskAgentTrigger, workflow?: MiniWorkflow, workflowState?: WorkflowState): string[] {
  const ctx: string[] = []

  // ── Follow-up task context ──
  // When the delivery agent's `submit_next_task` spawned this task (for any
  // reason — repair, iteration, or a queued recommendation), we attach the
  // predecessor task id, any failed-criteria evidence, and scope hints so
  // the agent knows what came before and what (if anything) must be fixed.
  const meta = (task.metadata as Record<string, unknown> | null) ?? {}
  const parentTask = typeof meta.parent_task === "string" ? meta.parent_task : undefined
  if (parentTask) {
    const failed = Array.isArray(meta.failed_criteria) ? (meta.failed_criteria as string[]) : []
    const scope = Array.isArray(meta.next_task_scope_files) ? (meta.next_task_scope_files as string[]) : []
    const depth = typeof meta.task_chain_depth === "number" ? meta.task_chain_depth : undefined
    ctx.push("## Follow-up Context")
    ctx.push(`- Predecessor task: ${parentTask}`)
    if (depth !== undefined) ctx.push(`- Task chain depth: ${depth}`)
    if (failed.length > 0) {
      ctx.push(`- Failed criteria from previous verification: ${failed.join(", ")}`)
      ctx.push(`- Address every failed criterion. Do not regress passing criteria.`)
    }
    if (scope.length > 0) ctx.push(`- Suggested scope (focus area): ${scope.join(", ")}`)
    ctx.push("")
  }

  // ── Current State (full context for reasoning) ──
  ctx.push("## Current Task")
  ctx.push(`- Title: ${task.title}`)
  ctx.push(`- Status: ${task.status}`)
  // For re-triggers the request is included here for context; for "created"
  // triggers the user message IS the request so no duplication needed.
  if (trigger.kind !== "created") {
    ctx.push(`- Request: ${task.request}`)
  }

  if (task.active_spec_version_id) {
    const spec = findSpecSnapshot(task.active_spec_version_id)
    if (spec) ctx.push(`- Spec: ${spec.summary}`)
  }

  const goals = listGoals(task.id)
  if (goals.length > 0) {
    ctx.push(`\n## Goals (${goals.length})`)
    for (const g of goals) {
      ctx.push(`  - [${g.status}] ${g.title} [${g.priority}] — ${renderSpecsAsText((g.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, 200)}`)
    }
  }

  if (task.active_plan_version_id) {
    const plan = findPlan(task.active_plan_version_id)
    if (plan) ctx.push(`- Plan: ${plan.summary}`)
  }
  if (task.active_run_id) {
    const run = findRun(task.active_run_id)
    if (run) ctx.push(`- Active run: ${run.id} (${run.status})`)
  }
  if (task.error) ctx.push(`- Error: ${task.error}`)

  const totalRuns = findRuns(task.id).length
  const maxRuns = task.budget?.max_runs ?? DEFAULT_MAX_RUNS
  const maxFixRuns = task.budget?.max_fix_runs ?? DEFAULT_MAX_FIX_RUNS
  const activeRun = task.active_run_id ? findRun(task.active_run_id) : undefined
  const fixCount = activeRun?.retry_count ?? 0
  ctx.push(`- Budget: ${totalRuns}/${maxRuns} runs, ${fixCount}/${maxFixRuns} fixes`)

  const clarifications = clarificationTranscriptSection(task.id)
  if (clarifications) ctx.push(clarifications)
  const notes = operatorNotesSection(task.id)
  if (notes) ctx.push(notes)

  // ── Workflow guidance (injected as recommended path, not enforced) ──
  if (workflow && workflowState) {
    ctx.push("")
    ctx.push(renderWorkflowPrompt(workflow, workflowState))
  }

  // Run context (delivery + eval results for reasoning).
  //
  // This block was the largest single source of system-prompt growth in
  // the task-agent prior to the SubAgentProtocol introduction: a batch
  // complete trigger could embed kilobytes of LLM-generated delivery
  // prose, hundreds of changed-file paths, and ten checks each carrying
  // multi-paragraph evidence. The yielded summary is now framed as a
  // sub-agent-protocol message — same shape, same per-message ceiling
  // as a tool return — with explicit pointers back to the persistent
  // delivery / evaluation rows for full content.
  if (trigger.kind === "batch_complete") {
    const runID = trigger.runID
    const delivery = findDeliveryByRun(runID)
    const evaluation = findEvaluationByRun(runID)

    const fields: Array<[string, string | string[]]> = []
    if (delivery) {
      fields.push(["delivery_summary", delivery.summary])
      const changedFiles = delivery.result?.changed_files as string[] | undefined
      if (changedFiles?.length) fields.push(["changed_files", changedFiles])
    }
    if (evaluation) {
      fields.push([`evaluation_${evaluation.verdict}`, evaluation.summary])
      const checks = evaluation.checks as Array<{ name: string; status: string; evidence?: string }> | undefined
      if (checks?.length) {
        const lines = checks.map((c) => `${c.name}=${c.status}${c.evidence ? `: ${c.evidence}` : ""}`)
        fields.push(["check_results", lines])
      }
    }
    fields.push([
      "batch_totals",
      `${trigger.summary.passed} passed / ${trigger.summary.failed} failed / ${trigger.summary.total} total`,
    ])

    const pointerHints: string[] = []
    if (delivery) pointerHints.push(`read_context scope=deliveries (delivery row ${delivery.id})`)
    if (evaluation) pointerHints.push(`read_context scope=evaluations (evaluation row ${evaluation.id})`)
    const pointer = pointerHints.length > 0 ? pointerHints.join("; ") : "read_context"

    ctx.push("")
    ctx.push(SubAgentProtocol.yieldResult({
      headline: `## Latest Run Result (run ${runID})`,
      fields,
      pointer,
    }))
  }

  return [TASK_AGENT_INSTRUCTIONS, ctx.join("\n")]
}
