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
 * decompose → goals → plan → execute → eval → delivery verify → publish
 * All other agents (decompose, architect, plan, eval, delivery) are subordinate workers.
 */
import { stepCountIs } from "ai"
import { Provider } from "@/provider/provider"
import { ProviderLLM } from "@/provider/llm"
import { Session } from "@/session"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { AgentTrace } from "@/util/agent-trace"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { sessionStreamHooks } from "@/orchestrator/session-stream"
import { createTaskAgentTools } from "./tools"
import { operatorNotesSection } from "@/orchestrator/helpers"
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
  | { kind: "batch_complete"; runID: string; summary: { passed: number; failed: number; total: number } }
  | { kind: "retry" }

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

const running = new Map<string, AbortController>()
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
    // legacy syncRun) are blocked.
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
        AgentTrace.startTask(taskID)
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

      // 1. Resolve model
      const def = await Provider.defaultModel().catch(() => undefined)
      if (!def) {
        log.error("task agent: no LLM model available", { taskID })
        return
      }
      const model = await Provider.getModel(def.providerID, def.modelID)

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
      // Build multimodal content when task has image attachments (only for initial trigger)
      const attachments = trigger.kind === "created" && Array.isArray(task.attachments) ? task.attachments : undefined
      const userContent = attachments?.length
        ? [
            { type: "text" as const, text: userText },
            ...attachments.map((a: any) => ({
              type: "file" as const,
              data: a.data as string,
              mediaType: a.mime as string,
              ...(a.filename ? { filename: a.filename as string } : {}),
            })),
          ]
        : userText

      log.info("task agent starting", {
        taskID,
        trigger: trigger.kind,
        sessionID: agentSession.id,
        model: `${def.providerID}/${def.modelID}`,
        toolCount: Object.keys(tools).length,
      })

      // 5. Call LLM through unified provider layer
      const stream = await ProviderLLM.stream({
        model,
        stopWhen: stepCountIs(MAX_STEPS),
        tools: guard.tools as any,
        abortSignal: AbortSignal.any([ctrl.signal, guard.signal, stopSignal]),
        system,
        messages: [{ role: "user" as const, content: userContent }],
        cacheKey: `task-${taskID}`,
        ...(contentHooks!.onChunk ? { onChunk: contentHooks!.onChunk as any } : {}),
        ...(contentHooks!.onError ? { onError: contentHooks!.onError } : {}),
        onStepFinish: guard.onStepFinish as any,
      })

      // 6. Await completion
      const [resultText, resultSteps, resultFinishReason] = await Promise.all([
        stream.text,
        stream.steps,
        stream.finishReason,
      ])
      await contentHooks!.flush()


      const toolCallCount = resultSteps.reduce(
        (sum, s) => sum + (Array.isArray((s as any).toolCalls) ? (s as any).toolCalls.length : 0),
        0,
      )
      log.info("task agent finished", {
        taskID,
        trigger: trigger.kind,
        steps: resultSteps.length,
        toolCalls: toolCallCount,
        finishReason: resultFinishReason,
        textLength: resultText?.length ?? 0,
      })

      AgentTrace.capture("task-agent", 1,
        { system, messages: [{ role: "user", content: userContent }] },
        resultText ?? "",
        { trigger: trigger.kind, taskID, toolCalls: toolCallCount, finishReason: resultFinishReason },
      )
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

    case "batch_complete":
      return [
        `Goal batch complete on run ${trigger.runID}.`,
        `Summary: ${trigger.summary.passed} passed, ${trigger.summary.failed} failed, ${trigger.summary.total} total.`,
        "",
        "Read context (read_context) to see goal statuses and eval evidence.",
        "Decide next action based on current state — no predetermined action.",
      ].join("\n")

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
  "## Stage Sequence",
  "",
  "1. **requirements** — Decompose the task into goal contracts with acceptance criteria. ALWAYS call this first.",
  "2. **architect** — Coordinate cross-goal interface contracts. REQUIRED for multi-goal tasks — call after requirements returns 2+ goals. Skip only for single-goal tasks (the tool will enforce this automatically).",
  "3. **run** — Create run (create_run), then dispatch (submit_execution). The execution engine plans each goal automatically just before it executes — do NOT call plan_goal upfront for all goals.",
  "4. **deliver** — Aggregate and verify (deliver). Delivery agent is the single verification gate: it tests, fixes issues, and makes final acceptance decision. Only when all blocking goals have completed execution.",
  "",
  "You have these tools: requirements, architect, execute_goal, add_goal, modify_goal,",
  "dispatch_ready_goals, retry_failed_goals, query_failed_goals, read_context, create_run,",
  "submit_execution, deliver, publish_delivery, fail_task, restart_from_stage.",
  "(Note: per-goal planning happens automatically inside the execution engine — no plan_goal tool needed.)",
  "",
  "**For new tasks:**",
  "- ALWAYS call requirements first to decompose the task into goals. No exceptions.",
  "- After requirements: ALWAYS call architect next if there are 2+ goals. It coordinates interface contracts that all executors depend on. Skip only when requirements returned exactly 1 goal.",
  "- Then create_run, then submit_execution. The execution engine plans each goal automatically.",
  "- Do NOT call plan_goal for goals upfront — planning is lazy and happens per-goal inside the execution engine, right before each goal executes.",
  "",
  "**After batch completes (re-triggered with batch_complete):**",
  "- FIRST: If any goals failed (executor produced no output), call query_failed_goals",
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
      ctx.push(`  - [${g.status}] ${g.title} [${g.priority}] — ${g.done_definition.slice(0, 100)}`)
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

  const notes = operatorNotesSection(task.id)
  if (notes) ctx.push(notes)

  // ── Workflow guidance (injected as recommended path, not enforced) ──
  if (workflow && workflowState) {
    ctx.push("")
    ctx.push(renderWorkflowPrompt(workflow, workflowState))
  }

  // Run context (delivery + eval results for reasoning)
  if (trigger.kind === "batch_complete") {
    const runID = trigger.runID
    const delivery = findDeliveryByRun(runID)
    if (delivery) {
      ctx.push("\n## Latest Run Result")
      ctx.push(`- Delivery: ${delivery.summary}`)
      const changedFiles = delivery.result?.changed_files as string[] | undefined
      if (changedFiles?.length) ctx.push(`- Changed files: ${changedFiles.join(", ")}`)
    }
    const evaluation = findEvaluationByRun(runID)
    if (evaluation) {
      ctx.push(`- Evaluation: ${evaluation.verdict} — ${evaluation.summary}`)
      const checks = evaluation.checks as Array<{ name: string; status: string; evidence?: string }> | undefined
      if (checks?.length) {
        for (const c of checks.slice(0, 10)) {
          ctx.push(`  - ${c.name}: ${c.status}${c.evidence ? ` — ${c.evidence}` : ""}`)
        }
      }
    }
    ctx.push(
      `- Batch summary: ${trigger.summary.passed} passed, ${trigger.summary.failed} failed, ${trigger.summary.total} total.`,
    )
  }

  return [TASK_AGENT_INSTRUCTIONS, ctx.join("\n")]
}
