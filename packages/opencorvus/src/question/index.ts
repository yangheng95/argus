import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Config } from "@/config/config"
import { Identifier } from "@/id/id"
import { Instance, lazyInstanceState } from "@/project/instance"
import { Log } from "@/util/log"
import z from "zod"
import { values as objectValues } from "@/util/object"
import { Answer as _Answer } from "./types"
import type { Answer as _AnswerType } from "./types"

export namespace Question {
  const log = Log.create({ service: "question" })

  export const Option = z
    .object({
      label: z.string().describe("Display text (1-5 words, concise)"),
      description: z.string().describe("Explanation of choice"),
    })
    .meta({
      ref: "QuestionOption",
    })
  export type Option = z.infer<typeof Option>

  export const Info = z
    .object({
      question: z.string().describe("Complete question"),
      header: z.string().describe("Very short label (max 30 chars)"),
      options: z.array(Option).describe("Available choices"),
      multiple: z.boolean().optional().describe("Allow selecting multiple choices"),
      custom: z.boolean().optional().describe("Allow typing a custom answer"),
    })
    .meta({
      ref: "QuestionInfo",
    })
  export type Info = z.infer<typeof Info>

  export const Request = z
    .object({
      id: Identifier.schema("question"),
      sessionID: Identifier.schema("session"),
      questions: z.array(Info).describe("Questions to ask"),
      tool: z
        .object({
          messageID: z.string(),
          callID: z.string(),
        })
        .optional(),
    })
    .meta({
      ref: "QuestionRequest",
    })
  export type Request = z.infer<typeof Request>

  // Re-exported from ./types so schema-only consumers (engine/model) can
  // import directly without pulling in Bus/Instance. External callers using
  // the `Question.Answer` namespace form keep working unchanged.
  export const Answer = _Answer
  export type Answer = _AnswerType

  export const Reply = z.object({
    answers: z
      .array(Answer)
      .describe("User answers in order of questions (each answer is an array of selected labels)"),
  })
  export type Reply = z.infer<typeof Reply>

  export const Event = {
    Asked: BusEvent.define("question.asked", Request),
    Replied: BusEvent.define(
      "question.replied",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
        answers: z.array(Answer),
      }),
    ),
    Rejected: BusEvent.define(
      "question.rejected",
      z.object({
        sessionID: z.string(),
        requestID: z.string(),
      }),
    ),
  }

  const state = lazyInstanceState(
    async () => {
      const pending: Record<
        string,
        {
          info: Request
          resolve: (answers: Answer[]) => void
          reject: (e: any) => void
          timer: ReturnType<typeof setTimeout> | undefined
        }
      > = {}

      return {
        pending,
      }
    },
    async (s) => {
      // Cancel any pending question timers when the instance is disposed so that
      // late-firing auto-reject timeouts cannot bleed into the next test/run.
      // We deliberately do NOT call entry.reject — by the time dispose runs, callers
      // have abandoned their await, and rejecting would surface as an unhandled rejection.
      for (const id of Object.keys(s.pending)) {
        const entry = s.pending[id]
        clearTimeout(entry.timer)
        delete s.pending[id]
      }
    },
  )

  const QUESTION_MIN_TIMEOUT_MS = 1000
  const QUESTION_AUTO_REJECT_MS = Math.max(
    parseInt(process.env.OPENCORVUS_QUESTION_TIMEOUT_MS || "300000", 10),
    QUESTION_MIN_TIMEOUT_MS,
  )

  export async function ask(input: {
    sessionID: string
    questions: Info[]
    tool?: { messageID: string; callID: string }
    /** Override auto-reject timeout in ms. Defaults to OPENCORVUS_QUESTION_TIMEOUT_MS (5min). */
    timeoutMs?: number
  }): Promise<Answer[]> {
    const s = await state()
    const id = Identifier.ascending("question")
    const timeout = Math.max(input.timeoutMs ?? QUESTION_AUTO_REJECT_MS, QUESTION_MIN_TIMEOUT_MS)
    log.info("asking", { id, questions: input.questions.length, timeoutMs: timeout })

    return new Promise<Answer[]>((resolve, reject) => {
      const info: Request = {
        id,
        sessionID: input.sessionID,
        questions: input.questions,
        tool: input.tool,
      }
      s.pending[id] = {
        info,
        resolve,
        reject,
        timer: undefined,
      }
      Bus.publish(Event.Asked, info)
      void Config.get()
        .then((cfg) => {
          const autoRejectOnTimeout = cfg.experimental?.auto_question === true
          log.info("question timeout configured", { id, autoReject: autoRejectOnTimeout })
          if (!autoRejectOnTimeout || !s.pending[id]) return
          s.pending[id].timer = setTimeout(() => {
            if (s.pending[id]) {
              log.info("auto-reject timeout", { id, questions: input.questions.length })
              delete s.pending[id]
              Bus.publish(Event.Rejected, {
                sessionID: input.sessionID,
                requestID: id,
              })
              reject(new RejectedError())
            }
          }, timeout)
        })
        .catch((error) => {
          if (!s.pending[id]) return
          delete s.pending[id]
          reject(error)
        })
    })
  }

  export async function reply(input: { requestID: string; answers: Answer[] }): Promise<void> {
    const s = await state()
    const existing = s.pending[input.requestID]
    if (!existing) {
      log.warn("reply for unknown request", { requestID: input.requestID })
      return
    }
    clearTimeout(existing.timer)
    delete s.pending[input.requestID]

    log.info("replied", { requestID: input.requestID, answers: input.answers })

    Bus.publish(Event.Replied, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
      answers: input.answers,
    })

    existing.resolve(input.answers)
  }

  export async function reject(requestID: string): Promise<void> {
    const s = await state()
    const existing = s.pending[requestID]
    if (!existing) {
      log.warn("reject for unknown request", { requestID })
      return
    }
    delete s.pending[requestID]

    log.info("rejected", { requestID })

    Bus.publish(Event.Rejected, {
      sessionID: existing.info.sessionID,
      requestID: existing.info.id,
    })

    existing.reject(new RejectedError())
  }

  export class RejectedError extends Error {
    constructor() {
      super("The user dismissed this question")
    }
  }

  export async function list() {
    return state().then((x) => objectValues(x.pending).map((item) => item.info))
  }

  /**
   * Ask the user and return both the formatted LLM-facing summary and the raw
   * answers. Shared by the executor-side QuestionTool and the orchestrator's
   * `question` tool so both code paths render the same final string; the raw
   * `answers` are used by clients such as overlay to re-render the tool card.
   *
   * When the user dismisses the dialog, `answers` is null and `output` carries
   * a user-dismissed message the LLM can act on.
   */
  export async function askAndFormat(input: {
    sessionID: string
    questions: Info[]
    tool?: { messageID: string; callID: string }
    timeoutMs?: number
  }): Promise<{ output: string; answers: Answer[] | null }> {
    try {
      const answers = await ask(input)
      const lines = input.questions
        .map((q, i) => `"${q.question}" → ${(answers[i] ?? []).join(", ") || "(no answer)"}`)
        .join("\n")
      return { output: `User answered:\n${lines}`, answers }
    } catch (err) {
      if (err instanceof RejectedError) {
        return {
          output: "User dismissed the questions without answering. Decide how to proceed based on available context.",
          answers: null,
        }
      }
      throw err
    }
  }
}
