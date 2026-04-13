/**
 * Gateway notifier — bridges Question + task lifecycle events into the
 * Gateway dialog stream.
 *
 * Two responsibilities:
 *
 * 1. Question routing (Question.Event.Asked):
 *    - **Attended**: when the owning task has a gateway session attached
 *      (`task.metadata.gateway.sessionID`), render the question as an
 *      assistant message into that gateway session. The user replies via the
 *      `forward_clarification` tool, which calls `Question.reply` and
 *      unblocks the agent's awaiting `Question.ask`.
 *    - **Unattended**: `unattendedProject()` is true. The notifier delegates
 *      to a small LLM call that picks the most reasonable answer (this is
 *      the same logic the old auto-reply.ts held).
 *    - Neither: do nothing. The question times out via Question's own
 *      auto-reject. We never fall back to dropping the question into a
 *      random session — silent fallback would hide bugs (CLAUDE.md rule #1).
 *
 * 2. Task lifecycle notifications (TaskUpdated / EvaluationCompleted):
 *    When a task that was created via Gateway changes status or the delivery
 *    evaluator returns a verdict, push a one-line status message into the
 *    owning gateway session so the user sees progress without having to
 *    actively poll. Tasks not created via Gateway are ignored — we identify
 *    Gateway-owned tasks by the `metadata.gateway.sessionID` field set by
 *    `enqueue_workflow_task` / `dispatch_build_task`.
 */

import { Log } from "@/util/log"
import { Bus } from "@/bus"
import { Question } from "@/question"
import { Identifier } from "@/id/id"
import { Session } from "@/session"
import type { Message } from "@/session/message"
import { findTask, requireTask, type TaskRow } from "@/orchestrator/store"
import { taskIDForSession } from "@/server/routes/task-event"
import { Provider } from "@/provider/provider"
import { completeText } from "@/llm/api"
import { unattendedProject } from "@/orchestrator/unattended"
import { markInteraction } from "@/orchestrator/interaction-actions"
import { findInteractionByExternal } from "@/orchestrator/store"
import { Event as OrchestratorEvent } from "@/orchestrator/model"

const log = Log.create({ service: "gateway.notifier" })

// Tight upper bound — Question's default auto-reject is 10s, so the LLM has
// to finish before that. 7s leaves ~3s of slack for network / parse.
const UNATTENDED_LLM_TIMEOUT_MS = 7_000

let activeUnsubscribers: Array<() => void> = []

export function subscribe(): () => void {
  const unsubs: Array<() => void> = []

  unsubs.push(
    Bus.subscribe(Question.Event.Asked, ({ properties }) => {
      void routeQuestion(properties).catch((err) => {
        log.warn("notifier failed to route question", {
          error: err instanceof Error ? err.message : String(err),
          questionID: properties.id,
        })
      })
    }),
  )

  unsubs.push(
    Bus.subscribe(OrchestratorEvent.TaskUpdated, ({ properties }) => {
      void renderTaskUpdate(properties).catch((err) => {
        log.warn("notifier failed to render task update", {
          error: err instanceof Error ? err.message : String(err),
          taskID: properties.taskID,
        })
      })
    }),
  )

  unsubs.push(
    Bus.subscribe(OrchestratorEvent.EvaluationCompleted, ({ properties }) => {
      void renderEvaluation(properties).catch((err) => {
        log.warn("notifier failed to render evaluation", {
          error: err instanceof Error ? err.message : String(err),
          taskID: properties.taskID,
        })
      })
    }),
  )

  activeUnsubscribers.push(...unsubs)
  log.info("gateway notifier subscribed (Question + TaskUpdated + EvaluationCompleted)")

  return () => {
    for (const u of unsubs) u()
    activeUnsubscribers = activeUnsubscribers.filter((f) => !unsubs.includes(f))
  }
}

// Status transitions worth surfacing in the dialog. We skip noisy intermediates
// (queued/active heartbeats) — the user only needs the moments that matter.
const NOTIFY_STATUSES = new Set<TaskRow["status"]>(["completed", "failed", "cancelled"])

async function renderTaskUpdate(props: {
  taskID: string
  status: TaskRow["status"]
  summary: string
}): Promise<void> {
  if (!NOTIFY_STATUSES.has(props.status)) return
  const task = findTask(props.taskID)
  if (!task) return
  const gatewaySessionID = readGatewaySessionID(task)
  if (!gatewaySessionID) return // task not owned by Gateway — nothing to render

  const text = `Task **${task.title}** → ${props.status}${props.summary ? `: ${props.summary}` : ""}`
  await writeNotification(gatewaySessionID, text, {
    task_ref: task.id,
    task_status: props.status,
    kind: "task_update",
  })
}

async function renderEvaluation(props: {
  taskID: string
  evaluationID: string
  status: string
  verdict: string
  summary: string
}): Promise<void> {
  const task = findTask(props.taskID)
  if (!task) return
  const gatewaySessionID = readGatewaySessionID(task)
  if (!gatewaySessionID) return

  const text = `Evaluation for **${task.title}**: ${props.verdict} (${props.status})${props.summary ? ` — ${props.summary}` : ""}`
  await writeNotification(gatewaySessionID, text, {
    task_ref: task.id,
    evaluation_id: props.evaluationID,
    verdict: props.verdict,
    kind: "evaluation",
  })
}

async function writeNotification(
  gatewaySessionID: string,
  text: string,
  metadata: Record<string, unknown>,
): Promise<void> {
  const messageID = Identifier.ascending("message")
  await Session.updateMessage({
    id: messageID,
    sessionID: gatewaySessionID,
    role: "assistant",
    time: { created: Date.now() },
    parentID: "",
    modelID: "gateway",
    providerID: "gateway",
    mode: "agent",
    agent: "gateway",
    path: { cwd: "", root: "" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as Message.Assistant)
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID,
    sessionID: gatewaySessionID,
    type: "text",
    text,
    metadata,
  })
}

async function routeQuestion(request: Question.Request): Promise<void> {
  // Locate the orchestrator task that owns the asking session. We use
  // `taskIDForSession` (not `activeRunBySession`) because build-kind tasks
  // bypass `orchestrator_run` entirely — their question would otherwise be
  // dropped here. `taskIDForSession` walks the registry → DB session lookup
  // → parent_id chain, so it covers both workflow runs and build child
  // sessions. Returns undefined for non-orchestrator sessions; we skip those.
  const taskID = taskIDForSession(request.sessionID)
  if (!taskID) {
    log.debug("question from non-orchestrator session — notifier skipping", {
      questionID: request.id,
      sessionID: request.sessionID,
    })
    return
  }
  const task = requireTask(taskID)

  const gatewaySessionID = readGatewaySessionID(task)
  if (gatewaySessionID) {
    await renderToGateway(gatewaySessionID, request, task)
    return
  }

  if (await unattendedProject()) {
    await unattendedAutoReply(request, task)
    return
  }

  log.debug("no gateway session and not unattended — question will time out", {
    questionID: request.id,
    taskID: task.id,
  })
}

function readGatewaySessionID(task: TaskRow): string | undefined {
  const meta = (task.metadata ?? {}) as Record<string, unknown>
  const gw = (meta.gateway ?? {}) as { sessionID?: string }
  return gw.sessionID
}

async function renderToGateway(
  gatewaySessionID: string,
  request: Question.Request,
  task: TaskRow,
): Promise<void> {
  const messageID = Identifier.ascending("message")
  await Session.updateMessage({
    id: messageID,
    sessionID: gatewaySessionID,
    role: "assistant",
    time: { created: Date.now() },
    parentID: "",
    modelID: "gateway",
    providerID: "gateway",
    mode: "agent",
    agent: "gateway",
    path: { cwd: "", root: "" },
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  } as Message.Assistant)
  const summary = request.questions
    .map((q, i) => {
      const opts = q.options?.length
        ? "\n  options: " + q.options.map((o) => o.label).join(" | ")
        : ""
      return `Q${i + 1}. ${q.question}${opts}`
    })
    .join("\n")
  await Session.updatePart({
    id: Identifier.ascending("part"),
    messageID,
    sessionID: gatewaySessionID,
    type: "text",
    text: summary,
    metadata: {
      task_ref: task.id,
      question_id: request.id,
      origin_session: request.sessionID,
    } as Record<string, unknown>,
  })
  log.info("rendered clarification to gateway dialog", {
    gatewaySessionID,
    questionID: request.id,
    taskID: task.id,
    questionCount: request.questions.length,
  })
}

async function unattendedAutoReply(
  request: Question.Request,
  task: TaskRow,
): Promise<void> {
  log.info("unattended auto-reply", {
    questionID: request.id,
    taskID: task.id,
    questionCount: request.questions.length,
  })

  let answers: Question.Answer[]
  try {
    answers = await generateUnattendedAnswers(task, request.questions)
  } catch (err) {
    log.error("unattended auto-reply LLM failed — letting question time out", { error: String(err) })
    return
  }

  try {
    await Question.reply({ requestID: request.id, answers })
    const interaction = findInteractionByExternal(request.id)
    if (interaction && interaction.status === "pending") {
      markInteraction(interaction, "answered", {
        answers,
        auto_reply: true,
      })
    }
  } catch (err) {
    log.debug("auto-reply delivery failed (question may be resolved)", { error: String(err) })
  }
}

async function generateUnattendedAnswers(
  task: TaskRow,
  questions: Question.Info[],
): Promise<Question.Answer[]> {
  const def = await Provider.defaultModel()
  const modelInfo = await Provider.getModel(def.providerID, def.modelID)
  const model = await Provider.getLanguage(modelInfo)

  const questionBlock = questions
    .map((q, i) => {
      const opts = q.options.map((o) => `  - ${o.label}: ${o.description}`).join("\n")
      return `Question ${i + 1}: ${q.question}${opts ? `\nOptions:\n${opts}` : ""}`
    })
    .join("\n\n")

  const result = await completeText({
    model,
    system:
      "You are an autonomous orchestrator assistant. The coding agent has asked clarification questions during task execution. " +
      "Answer each question concisely based on the task context. Choose reasonable defaults, keep scope minimal, " +
      "and prefer the simplest viable option. " +
      "Output one answer per line, prefixed with the question number: '1: answer', '2: answer', etc. " +
      "If there are predefined options, pick the best one by label. " +
      "Answer in the same language as the task request.",
    messages: [
      {
        role: "user",
        content:
          `Task: ${task.title}\n` +
          `Request: ${task.request}\n\n` +
          `The agent is asking:\n\n${questionBlock}\n\n` +
          `Provide concise answers. Choose reasonable defaults consistent with the request.`,
      },
    ],
    maxOutputTokens: 512,
    timeoutMs: UNATTENDED_LLM_TIMEOUT_MS,
  })

  const lines = result.text.trim().split("\n").filter(Boolean)
  return questions.map((_q, i) => {
    const prefix = `${i + 1}:`
    const match = lines.find((l) => l.trim().startsWith(prefix))
    if (match) return [match.slice(match.indexOf(":") + 1).trim()]
    const line = lines[i]
    if (!line) throw new Error(`unattended LLM did not produce answer for question ${i + 1}`)
    return [line]
  })
}
