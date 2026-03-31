/**
 * Task Agent — headless LLM-driven task processor.
 *
 * Uses streamText() from AI SDK directly (same pattern as spec/planner/goal agents).
 * NOT SessionPrompt — that requires a registered Agent config.
 *
 * Triggered by:
 * - Task creation (kind: "created")
 * - Executor completion (kind: "completed")
 * - Executor failure (kind: "failed")
 * - User retry/replan request (kind: "retry" / "replan")
 */
import { streamText, stepCountIs } from "ai"
import { Provider } from "@/provider/provider"
import { Session } from "@/session"
import { Instance } from "@/project/instance"
import { Log } from "@/util/log"
import { toolGuard } from "@/util/tool-guard"
import { registerGoalRunSession } from "@/server/routes/task-event"
import { agentStream } from "./agent-stream"
import { sessionStreamHooks } from "./session-stream"
import { createTaskAgentTools } from "./task-tools"
import {
  findDeliveryByRun,
  findEvaluationByRun,
  findPlan,
  findRun,
  findSpecSnapshot,
  listGoals,
  requireTask,
  type TaskRow,
} from "./store"

const log = Log.create({ service: "task-agent" })
const MAX_STEPS = 20

// ---------------------------------------------------------------------------
// Trigger types
// ---------------------------------------------------------------------------

export type TaskAgentTrigger =
  | { kind: "created" }
  | { kind: "completed"; runID: string }
  | { kind: "failed"; runID: string; error: string }
  | { kind: "retry" }
  | { kind: "replan" }

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

    try {
      const task = requireTask(taskID)
      if (!task.session_id) {
        log.error("task agent: no session_id on task", { taskID })
        return
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
      registerGoalRunSession(agentSession.id, taskID)
      const contentHooks = sessionStreamHooks({
        sessionID: agentSession.id,
        taskID,
        stage: "orchestrator",
      })
      const live = agentStream({ taskID, stage: "orchestrator" })
      await live.start("Task Agent started")

      // 3. Create tools (taskID captured in closure)
      const tools = createTaskAgentTools({ taskID, signal: ctrl.signal })
      const guard = toolGuard(tools)

      // 4. Build prompt
      const system = buildSystemPrompt(task, trigger)
      const userMessage = describeTrigger(task, trigger)

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
        abortSignal: AbortSignal.any([ctrl.signal, guard.signal]),
        system,
        messages: [{ role: "user" as const, content: userMessage }],
        ...(contentHooks.onChunk ? { onChunk: contentHooks.onChunk as any } : {}),
        ...(contentHooks.onError ? { onError: contentHooks.onError } : {}),
        onStepFinish: guard.onStepFinish as any,
      })

      // 6. Await completion
      const [resultText, resultSteps, resultFinishReason] = await Promise.all([
        stream.text,
        stream.steps,
        stream.finishReason,
      ])
      await contentHooks.flush()
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
    } catch (error) {
      if (ctrl.signal.aborted) {
        log.info("task agent was aborted", { taskID })
        return
      }
      const msg = error instanceof Error ? error.message : String(error)
      log.error("task agent failed", { taskID, trigger: trigger.kind, error: msg })
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

    case "completed": {
      const run = findRun(trigger.runID)
      const evaluation = run ? findEvaluationByRun(run.id) : undefined
      const delivery = run ? findDeliveryByRun(run.id) : undefined
      return [
        `Executor completed run ${trigger.runID}. Review results and decide next steps.`,
        evaluation ? `Evaluation: ${evaluation.verdict} — ${evaluation.summary}` : "Evaluation: pending",
        delivery ? `Delivery: ${(delivery.result as any)?.verdict ?? delivery.status} — ${delivery.summary}` : "Delivery: pending",
      ].join("\n")
    }

    case "failed":
      return `Executor run ${trigger.runID} failed.\nError: ${trigger.error}\nDecide: retry, replan, or fail.`

    case "retry":
      return `User requested retry.${task.error ? ` Previous error: ${task.error}` : ""}\nDecide how to proceed.`

    case "replan":
      return `User requested replan.${task.error ? ` Previous error: ${task.error}` : ""}\nCreate a new plan.`
  }
}

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function buildSystemPrompt(task: TaskRow, trigger: TaskAgentTrigger): string {
  const sections: string[] = []

  sections.push(
    "You are the OpenCorvus Task Agent. You manage task execution from requirements analysis to delivery.",
    "Always respond in the same language as the task request. Default to Chinese (simplified) if ambiguous.",
    "",
  )

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
    sections.push(`- Goals: ${goals.length} defined`)
    for (const g of goals) sections.push(`  - ${g.description} [${g.priority}]`)
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

  sections.push("")
  sections.push("## How to Decide")
  sections.push(
    "- Simple bug fix / small change: skip analysis, call create_plan directly, then submit_execution.",
    "- Complex multi-file change: analyze_requirements first, optionally decompose_goals, then create_plan, then submit_execution.",
    "- Executor completed: use check_run_result, then complete_task or retry.",
    "- Executor failed: analyze error, create new plan and retry, or fail_task.",
    "",
    "## Rules",
    "- Explain your reasoning before each tool call.",
    "- After calling submit_execution, STOP. Do not call more tools.",
    "- Never call complete_task without checking run results first.",
    "- If the task is already in a terminal state (completed/failed/cancelled), do nothing.",
  )

  return sections.join("\n")
}
