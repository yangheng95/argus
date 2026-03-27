/**
 * Unattended auto-reply: when unattended mode is enabled, automatically answers
 * agent questions and approves permission requests via LLM instead of blocking
 * or rejecting them.
 *
 * Subscribes to Question.Event.Asked and PermissionNext.Event.Asked.
 * Must reply BEFORE the Question auto-reject timeout (10s default).
 */
import { Bus } from "@/bus"
import { Question } from "@/question"
import { PermissionNext } from "@/permission/next"
import { Provider } from "@/provider/provider"
import { completeText } from "@/llm/api"
import { Log } from "@/util/log"
import { unattendedProject, UNATTENDED_AUTO_REPLY } from "./unattended"
import { activeRunBySession, requireTask, type TaskRow } from "./store"
import { markInteraction, replyProtocolInteraction } from "./interaction-actions"
import { findInteractionByExternal, type InteractionRow } from "./store"

const log = Log.create({ service: "orchestrator.auto-reply" })

const AUTO_REPLY_TIMEOUT_MS = 7_000 // must finish before Question's 10s auto-reject

// ---------------------------------------------------------------------------
// LLM auto-reply for questions
// ---------------------------------------------------------------------------

async function generateQuestionReply(
  task: TaskRow,
  questions: Question.Info[],
): Promise<Question.Answer[]> {
  const def = await Provider.defaultModel().catch(() => undefined)
  if (!def) throw new Error("no LLM model available for auto-reply")
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
    timeoutMs: AUTO_REPLY_TIMEOUT_MS,
  })

  // Parse "1: answer" lines, fall back to full text for each question
  const lines = result.text.trim().split("\n").filter(Boolean)
  return questions.map((_q, i) => {
    const prefix = `${i + 1}:`
    const match = lines.find((l) => l.trim().startsWith(prefix))
    const text = match ? match.slice(match.indexOf(":") + 1).trim() : (lines[i] ?? UNATTENDED_AUTO_REPLY)
    return [text]
  })
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

async function handleQuestionAsked(request: Question.Request) {
  if (!(await unattendedProject())) return
  const run = activeRunBySession(request.sessionID)
  if (!run) return // not an orchestrator session

  log.info("auto-replying to question", {
    questionID: request.id,
    runID: run.id,
    count: request.questions.length,
  })

  let answers: Question.Answer[]
  try {
    const task = requireTask(run.task_id)
    answers = await generateQuestionReply(task, request.questions)
  } catch (err) {
    log.warn("auto-reply LLM failed, using fallback", { error: String(err) })
    answers = request.questions.map(() => [UNATTENDED_AUTO_REPLY])
  }

  try {
    await Question.reply({ requestID: request.id, answers })
    // Mark the interaction record as auto-answered (if it exists by now)
    const interaction = findInteractionByExternal(request.id)
    if (interaction && interaction.status === "pending") {
      markInteraction(interaction, "answered", {
        answers,
        auto_reply: true,
      })
    }
  } catch (err) {
    // Question may have already been rejected or answered
    log.debug("auto-reply delivery failed (question may be resolved)", { error: String(err) })
  }
}

async function handlePermissionAsked(request: PermissionNext.Request) {
  if (!(await unattendedProject())) return
  const run = activeRunBySession(request.sessionID)
  if (!run) return

  log.info("auto-approving permission", {
    permissionID: request.id,
    runID: run.id,
    permission: request.permission,
  })

  try {
    await PermissionNext.reply({
      requestID: request.id,
      reply: "once",
    })
    const interaction = findInteractionByExternal(request.id)
    if (interaction && interaction.status === "pending") {
      markInteraction(interaction, "answered", {
        reply: "once",
        auto_reply: true,
      })
    }
  } catch (err) {
    log.debug("auto-approve delivery failed (permission may be resolved)", { error: String(err) })
  }
}

// ---------------------------------------------------------------------------
// Subscription setup — call once during orchestrator init
// ---------------------------------------------------------------------------

export namespace AutoReply {
  let subscribed = false

  export function subscribe() {
    if (subscribed) return
    subscribed = true
    Bus.subscribe(Question.Event.Asked, ({ properties }) => {
      void handleQuestionAsked(properties)
    })
    Bus.subscribe(PermissionNext.Event.Asked, ({ properties }) => {
      void handlePermissionAsked(properties)
    })
    log.info("auto-reply subscriptions active")
  }
}
