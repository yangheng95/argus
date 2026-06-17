import z from "zod"
import { Tool } from "./tool"
import { Log } from "@/util/log"
import { createDecisionLog } from "@/decision-log"

export const WAIT_MIN_MS = 1_000
export const WAIT_MAX_MS = 10 * 60 * 1000

const log = Log.create({ service: "wait-tool" })

export const WaitToolParameters = z.object({
  duration_ms: z
    .number()
    .int()
    .min(WAIT_MIN_MS)
    .max(WAIT_MAX_MS)
    .describe(
      `Pause length in milliseconds. Minimum ${WAIT_MIN_MS}, maximum ${WAIT_MAX_MS}. ` +
        "Pick the smallest duration that gives the named external event a real chance to occur.",
    ),
  reason: z
    .string()
    .min(1)
    .describe(
      "Concrete external event you are waiting for and why no in-task dispatch is responsible until it lands.",
    ),
})

export const WaitToolDescription =
  "One-shot deliberate pause. Yields the current agent turn for the stated number of milliseconds before returning, so a NAMED external event the repository cannot itself trigger has time to settle before your NEXT tool call. USE WHEN: evidence shows there is nothing dispatchable RIGHT NOW, AND the unblocking event is concretely external. NOT a polling primitive — never chain wait calls to re-inspect state on a fixed cadence. NOT a substitute for asking the user, reporting a blocker, or refreshing available evidence when those actions are responsible."

export async function executeWait(input: {
  duration_ms: number
  reason: string
  signal?: AbortSignal
  taskID?: string
  logPhase?: string
}): Promise<{ elapsed: number; aborted: boolean; output: string }> {
  const startedAt = Date.now()
  if (input.taskID) {
    createDecisionLog(input.taskID).append({
      phase: input.logPhase ?? "wait",
      key: `wait_${startedAt}`,
      value: `wait ${input.duration_ms}ms`,
      reason: input.reason,
    })
  }

  let aborted = false
  await new Promise<void>((resolve) => {
    if (input.signal?.aborted) {
      aborted = true
      resolve()
      return
    }
    const onAbort = () => {
      aborted = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      input.signal?.removeEventListener("abort", onAbort)
      resolve()
    }, input.duration_ms)
    input.signal?.addEventListener("abort", onAbort, { once: true })
  })

  const elapsed = Date.now() - startedAt
  log.info("wait completed", {
    taskID: input.taskID,
    requestedMs: input.duration_ms,
    elapsedMs: elapsed,
    aborted,
  })
  const output = aborted
    ? `wait aborted after ${elapsed}ms (requested ${input.duration_ms}ms). Reason: ${input.reason}`
    : `Waited ${elapsed}ms (requested ${input.duration_ms}ms). Reason: ${input.reason}. Re-read evidence before your next dispatch — the world may have changed during the pause.`
  return { elapsed, aborted, output }
}

export const WaitTool = Tool.define("wait", {
  description: WaitToolDescription,
  parameters: WaitToolParameters,
  async execute(params, ctx) {
    const taskID = typeof ctx.extra?.taskID === "string" ? ctx.extra.taskID : undefined
    const result = await executeWait({
      duration_ms: params.duration_ms,
      reason: params.reason,
      signal: ctx.abort,
      taskID,
      logPhase: taskID ? "agent" : undefined,
    })
    return {
      title: result.aborted ? "Wait Aborted" : "Wait Complete",
      output: result.output,
      metadata: {
        requestedMs: params.duration_ms,
        elapsedMs: result.elapsed,
        aborted: result.aborted,
      },
    }
  },
})
