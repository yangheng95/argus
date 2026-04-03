/**
 * Task Agent — master agent in the Agent Team architecture.
 *
 * Uses streamText() from AI SDK directly (same pattern as spec/planner/goal agents).
 * NOT SessionPrompt — that requires a registered Agent config.
 *
 * Triggered by:
 * - Task creation (kind: "created") — new task, agent plans and submits execution
 * - Run completion (kind: "run_completed") — executor finished, agent runs eval → verify → publish
 * - Executor failure (kind: "executor_failed") — executor crashed, agent decides recovery
 * - User retry request (kind: "retry")
 *
 * The Task Agent controls the entire pipeline via tools:
 * spec → goals → plan → execute → eval → delivery verify → publish
 * All other agents (spec, goal, plan, eval, delivery) are subordinate workers.
 */
import { streamText, stepCountIs } from "ai"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { Instance } from "@/project/instance"
import { Identifier } from "@/id/id"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { AgentTrace } from "@/util/agent-trace"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { agentStream } from "@/orchestrator/agent-stream"
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
  | { kind: "run_completed"; runID: string }
  | { kind: "executor_failed"; runID: string; error: string }
  | { kind: "retry" }

// ---------------------------------------------------------------------------
// Concurrency guard
// ---------------------------------------------------------------------------

const running = new Map<string, AbortController>()

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
    abort(taskID)
    const ctrl = new AbortController()
    running.set(taskID, ctrl)

    let contentHooks: ReturnType<typeof sessionStreamHooks> | undefined
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

      // 1. Resolve model — same pattern as spec/planner agent
      const def = await Provider.defaultModel().catch(() => undefined)
      if (!def) {
        log.error("task agent: no LLM model available", { taskID })
        return
      }
      const model = await Provider.getModel(def.providerID, def.modelID)
      const language = await Provider.getLanguage(model)

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
      const live = agentStream({ taskID, stage: "assistant" })
      await live.start("Task Agent started")

      // 3. Create tools (agentSessionID passed so tool sessions become children)
      const tools = createTaskAgentTools({ taskID, agentSessionID: agentSession.id, signal: ctrl.signal, workflow, workflowState })
      const { stopSignal } = tools
      const guard = toolGuard(tools)

      // 4. Build prompt + persist user message as timeline anchor
      const system = buildSystemPrompt(task, trigger, workflow, workflowState)
      const userMessage = describeTrigger(task, trigger)
      const userMsgID = Identifier.ascending("message")
      await Session.updateMessage({
        id: userMsgID,
        sessionID: agentSession.id,
        role: "user",
        time: { created: Date.now() },
        agent: "task-agent",
        model: { providerID: def.providerID, modelID: def.modelID },
      } as any)
      await Session.updatePart({
        id: Identifier.ascending("part"),
        messageID: userMsgID,
        sessionID: agentSession.id,
        type: "text",
        text: userMessage,
      } as any)

      log.info("task agent starting", {
        taskID,
        trigger: trigger.kind,
        sessionID: agentSession.id,
        model: `${def.providerID}/${def.modelID}`,
        toolCount: Object.keys(tools).length,
      })

      // 5. Call streamText — exact same pattern as spec/planner agents
      const stream = streamText({
        model: language,
        stopWhen: stepCountIs(MAX_STEPS),
        tools: guard.tools,
        abortSignal: AbortSignal.any([ctrl.signal, guard.signal, stopSignal]),
        system,
        messages: [{ role: "user" as const, content: userMessage }],
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
      await live.finish("Task Agent finished")

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
        { system, messages: [{ role: "user", content: userMessage }] },
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
      return `New task created. Process it.\n\nTitle: ${task.title}\nRequest: ${task.request}`

    case "run_completed":
      return [
        `Executor run ${trigger.runID} completed.`,
        "",
        "The executor has finished. You are now in control.",
        "Call deliver to aggregate goal deliveries, then publish_delivery to complete.",
        "If any step fails, decide: execute_goal to retry, or fail_task if not recoverable.",
      ].join("\n")

    case "executor_failed":
      return [
        `Executor run ${trigger.runID} failed.`,
        `Error: ${trigger.error}`,
        "",
        "Decide: call execute_goal to retry if the error is recoverable, or fail_task if not.",
      ].join("\n")

    case "retry":
      return `User requested retry.${task.error ? ` Previous error: ${task.error}` : ""}\nDecide how to proceed.`
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(task: TaskRow, trigger: TaskAgentTrigger, workflow?: MiniWorkflow, workflowState?: WorkflowState): string {
  const sections: string[] = []

  sections.push(
    "You are the OpenCorvus Task Agent — the central intelligence that drives task completion.",
    "You have tools to analyze requirements, plan, execute, evaluate goals. YOU decide what to do and when.",
    "There is NO fixed pipeline. You reason about the situation and choose the right action.",
    "Always respond in the same language as the task request. Default to Chinese (simplified) if ambiguous.",
    "",
  )

  // ── Current State (full context for reasoning) ──
  sections.push("## Current Task")
  sections.push(`- Title: ${task.title}`)
  sections.push(`- Status: ${task.status}`)
  sections.push(`- Request: ${task.request}`)

  if (task.active_spec_version_id) {
    const spec = findSpecSnapshot(task.active_spec_version_id)
    if (spec) sections.push(`- Spec: ${spec.summary}`)
  }

  const goals = listGoals(task.id)
  if (goals.length > 0) {
    sections.push(`\n## Goals (${goals.length})`)
    for (const g of goals) {
      sections.push(`  - [${g.status}] ${g.title} [${g.priority}] — ${g.done_definition.slice(0, 100)}`)
    }
  }

  if (task.active_plan_version_id) {
    const plan = findPlan(task.active_plan_version_id)
    if (plan) sections.push(`- Plan: ${plan.summary}`)
  }
  if (task.active_run_id) {
    const run = findRun(task.active_run_id)
    if (run) sections.push(`- Active run: ${run.id} (${run.status})`)
  }
  if (task.error) sections.push(`- Error: ${task.error}`)

  const totalRuns = findRuns(task.id).length
  const maxRuns = task.budget?.max_runs ?? DEFAULT_MAX_RUNS
  const maxFixRuns = task.budget?.max_fix_runs ?? DEFAULT_MAX_FIX_RUNS
  const activeRun = task.active_run_id ? findRun(task.active_run_id) : undefined
  const fixCount = activeRun?.retry_count ?? 0
  sections.push(`- Budget: ${totalRuns}/${maxRuns} runs, ${fixCount}/${maxFixRuns} fixes`)

  const notes = operatorNotesSection(task.id)
  if (notes) sections.push(notes)

  // ── Workflow guidance (injected as recommended path, not enforced) ──
  if (workflow && workflowState) {
    sections.push("")
    sections.push(renderWorkflowPrompt(workflow, workflowState))
  }

  // Run context (delivery + eval results for reasoning)
  if (trigger.kind === "run_completed" || trigger.kind === "executor_failed") {
    const runID = trigger.runID
    const delivery = findDeliveryByRun(runID)
    if (delivery) {
      sections.push("\n## Latest Run Result")
      sections.push(`- Delivery: ${delivery.summary}`)
      const changedFiles = delivery.result?.changed_files as string[] | undefined
      if (changedFiles?.length) sections.push(`- Changed files: ${changedFiles.join(", ")}`)
    }
    const evaluation = findEvaluationByRun(runID)
    if (evaluation) {
      sections.push(`- Evaluation: ${evaluation.verdict} — ${evaluation.summary}`)
      const checks = evaluation.checks as Array<{ name: string; status: string; evidence?: string }> | undefined
      if (checks?.length) {
        for (const c of checks.slice(0, 10)) {
          sections.push(`  - ${c.name}: ${c.status}${c.evidence ? ` — ${c.evidence}` : ""}`)
        }
      }
    }
    if (trigger.kind === "executor_failed") {
      sections.push(`- Executor error: ${trigger.error}`)
    }
  }

  // ── Reasoning Guidance (NOT a fixed pipeline) ──
  sections.push(`
## How to Think (not a fixed pipeline — use your judgment)

You have these tools: requirements, architect, plan_goal, execute_goal, eval_goal, add_goal, modify_goal,
dispatch_ready_goals, read_context, create_run, submit_execution, deliver, publish_delivery,
fail_task, restart_from_stage.

**For new tasks:**
- Assess complexity first. Simple (typo, config change)? Skip requirements, directly create_run + submit_execution.
- Complex (multi-feature, PRD)? Call requirements first, then create_run, then submit_execution.
- You can plan individual goals with plan_goal if they're complex, or skip planning for simple ones.

**After execution completes:**
- Read the delivery and evidence carefully (use read_context).
- Call eval_goal on individual goals for per-goal verification.
- Based on eval results, REASON about what to do:
  - Tests pass → deliver to aggregate, then publish_delivery
  - Tests fail due to missing dependency → add_goal to create the dependency, then execute_goal
  - Tests fail due to code bug → execute_goal again to retry the failed goal
  - Tests fail due to wrong approach → modify_goal to adjust, then execute_goal
  - Unrecoverable → fail_task with explanation

**After executor failure:**
- Read the error. Reason about root cause.
- Transient (network, timeout)? → execute_goal to retry
- Config/env issue? → fail_task or add_goal to fix environment
- Wrong approach? → modify_goal or restart_from_stage

**Dynamic adjustment (anytime):**
- Discovered a missing requirement? → add_goal
- Done_definition too vague? → modify_goal to sharpen it
- Goal is unnecessary? → acknowledge and move on

## Rules
- Explain your reasoning before each tool call.
- After submit_execution, execute_goal, or dispatch_ready_goals, STOP — you'll be re-triggered on completion.
- Use deliver + publish_delivery to complete (handles aggregation + git publish + task completion).
- Terminal state (completed/failed/cancelled) → do nothing.
- User messages in Operator Notes → acknowledge in your reasoning.
- NEVER follow a fixed sequence blindly. ALWAYS reason about the current situation.`)

  return sections.join("\n")
}
