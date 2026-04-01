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
import { registerGoalRunSession } from "@/server/routes/task-event"
import { agentStream } from "./agent-stream"
import { sessionStreamHooks } from "./session-stream"
import { createTaskAgentTools } from "./task-tools"
import { operatorNotesSection } from "./helpers"
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
} from "./store"
import { DEFAULT_MAX_RUNS, DEFAULT_MAX_FIX_RUNS } from "./helpers"
import { updateTask } from "./state"

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
      const tools = createTaskAgentTools({ taskID, agentSessionID: agentSession.id, signal: ctrl.signal })
      const guard = toolGuard(tools)

      // 4. Build prompt + persist user message as timeline anchor
      const system = buildSystemPrompt(task, trigger)
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
        abortSignal: AbortSignal.any([ctrl.signal, guard.signal]),
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
        "Run evaluation (run_eval), then delivery verification (run_delivery_verify), then publish (publish_delivery).",
        "If any step fails, decide: create_fix_run or fail_task.",
      ].join("\n")

    case "executor_failed":
      return [
        `Executor run ${trigger.runID} failed.`,
        `Error: ${trigger.error}`,
        "",
        "Decide: call create_fix_run if the error is recoverable, or fail_task if not.",
      ].join("\n")

    case "retry":
      return `User requested retry.${task.error ? ` Previous error: ${task.error}` : ""}\nDecide how to proceed.`
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

  // Fix budget status
  const totalRuns = findRuns(task.id).length
  const maxRuns = task.budget?.max_runs ?? DEFAULT_MAX_RUNS
  const maxFixRuns = task.budget?.max_fix_runs ?? DEFAULT_MAX_FIX_RUNS
  const activeRun = task.active_run_id ? findRun(task.active_run_id) : undefined
  const fixCount = activeRun?.retry_count ?? 0
  sections.push(`- Run budget: ${totalRuns}/${maxRuns} total runs used, ${fixCount}/${maxFixRuns} fix runs used`)

  // Pending user messages (operator notes)
  const notes = operatorNotesSection(task.id)
  if (notes) sections.push(notes)

  // Run context for completion/failure triggers
  if (trigger.kind === "run_completed" || trigger.kind === "executor_failed") {
    const runID = trigger.runID
    const delivery = findDeliveryByRun(runID)
    if (delivery) {
      sections.push("")
      sections.push("## Run Context")
      sections.push(`- Delivery summary: ${delivery.summary}`)
      const changedFiles = delivery.result?.changed_files as string[] | undefined
      if (changedFiles && changedFiles.length > 0) {
        sections.push(`- Changed files: ${changedFiles.join(", ")}`)
      }
    }
    const evaluation = findEvaluationByRun(runID)
    if (evaluation) {
      sections.push(`- Evaluation: ${evaluation.verdict} — ${evaluation.summary}`)
    }
  }

  sections.push("")

  // Decision guidance based on trigger type
  if (trigger.kind === "created" || trigger.kind === "retry") {
    sections.push("## How to Decide")
    sections.push(
      "1. Always call analyze_requirements first to create a spec — the evaluator checks spec compliance.",
      "2. For multi-goal tasks, call decompose_goals to break down the spec into verifiable goals.",
      "3. Call create_plan to create an execution plan.",
      "4. Call submit_execution to dispatch the run to the executor.",
      "5. After calling submit_execution, STOP. You will be re-triggered when execution completes.",
    )
  } else if (trigger.kind === "run_completed") {
    sections.push("## How to Decide")
    sections.push(
      "You control the full post-execution pipeline. Follow this sequence:",
      "1. Call run_eval to run evaluation checks on the delivery.",
      "2. If eval passes: call run_delivery_verify for delivery agent verification.",
      "3. If delivery verification passes: call publish_delivery to publish and complete the task.",
      "4. If any step fails: analyze the results, then call create_fix_run (with clear guidance) or fail_task (if unrecoverable).",
      "- Check the fix budget before creating fix runs — if exhausted, call fail_task.",
    )
  } else if (trigger.kind === "executor_failed") {
    sections.push("## How to Decide")
    sections.push(
      "- Analyze the executor error.",
      "- If it's a transient error (network, timeout): call create_fix_run to retry.",
      "- If it's a configuration or environment error: call fail_task with explanation.",
      "- If the approach needs adjustment: call create_fix_run with specific fix guidance.",
    )
  }

  sections.push(
    "",
    "## Rules",
    "- Explain your reasoning before each tool call.",
    "- After calling submit_execution or create_fix_run, STOP. Do not call more tools.",
    "- When triggered with run_completed, follow the full eval → verify → publish pipeline via tools.",
    "- To complete a task, always use publish_delivery (which handles git publish + task completion).",
    "- If the task is already in a terminal state (completed/failed/cancelled), do nothing.",
    "- If user messages are pending in Operator Notes, acknowledge them in your reasoning.",
  )

  return sections.join("\n")
}
