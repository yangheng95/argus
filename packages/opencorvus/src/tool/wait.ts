import z from "zod"
import { Tool } from "./tool"
import { Log } from "@/util/log"
import { createDecisionLog } from "@/decision-log"
import { CronService } from "@/scheduler/cron-service"
import { Instance } from "@/project/instance"
import { TOOL_RESULT_PARK_METADATA_KEY } from "@/session/tool-result-control"

export const WAIT_MIN_MS = 1_000
export const WAIT_RECOMMENDED_MS = 20 * 60 * 1000
export const WAIT_MAX_MS = WAIT_RECOMMENDED_MS

const log = Log.create({ service: "wait-tool" })

export const WaitToolParameters = z.object({
  duration_ms: z
    .number()
    .int()
    .min(WAIT_MIN_MS)
    .max(WAIT_MAX_MS)
    .describe(
      `Pause length in milliseconds. Minimum ${WAIT_MIN_MS}, recommended ${WAIT_RECOMMENDED_MS}, maximum ${WAIT_MAX_MS}. ` +
        "When executing a goal and this wait tool is the responsible action, default to the recommended 20 minute duration once instead of chaining repeated 60 second waits.",
    ),
  reason: z
    .string()
    .min(1)
    .describe("Concrete external event you are waiting for and why no in-task dispatch is responsible until it lands."),
})

export const WaitToolDescription =
  "One-shot deliberate nonblocking pause. Schedules a durable cron wake for the stated number of milliseconds and returns immediately; the future wake re-enters the task/session with a fresh visible message. When executing a goal and this wait tool is the responsible action, default to 1200000ms (20 minutes); use that single scheduled wait instead of repeated 60000ms (60 second) waits. USE WHEN: evidence shows there is nothing dispatchable RIGHT NOW, AND the unblocking event is a concretely external event. NOT a polling primitive — never chain wait calls to re-inspect state on a fixed cadence. NOT a substitute for asking the user, reporting a blocker, or refreshing available evidence when those actions are responsible."

export async function executeWait(input: {
  duration_ms: number
  reason: string
  signal?: AbortSignal
  sessionID: string
  taskID?: string
  logPhase?: string
}): Promise<{
  requestedMs: number
  aborted: boolean
  jobID?: string
  nextRun?: number
  mode?: "task" | "session"
  output: string
}> {
  if (input.signal?.aborted) {
    const output = `wait was not scheduled because the current execution was already aborted. Reason: ${input.reason}`
    return { requestedMs: input.duration_ms, aborted: true, output }
  }

  const scheduled = input.taskID
    ? await CronService.createTaskWake({
        name: "task wait",
        projectId: Instance.project.id,
        taskId: input.taskID,
        durationMs: input.duration_ms,
        reason: input.reason,
      })
    : await CronService.createDelayedSessionWake({
        name: "session wait",
        projectId: Instance.project.id,
        sessionId: input.sessionID,
        durationMs: input.duration_ms,
        prompt: [
          "Scheduled wait completed.",
          `Requested delay: ${input.duration_ms}ms.`,
          `Reason: ${input.reason}`,
          "Continue from the current visible conversation state.",
        ].join("\n"),
      })
  const mode = input.taskID ? "task" : "session"
  if (input.taskID) {
    createDecisionLog(input.taskID).append({
      phase: input.logPhase ?? "wait",
      key: `wait_${Date.now()}`,
      value: `scheduled wait ${input.duration_ms}ms cron_job=${scheduled.id}`,
      reason: input.reason,
    })
  }
  log.info("wait scheduled", {
    taskID: input.taskID,
    sessionID: input.sessionID,
    requestedMs: input.duration_ms,
    jobID: scheduled.id,
    nextRun: scheduled.nextRun,
    mode,
  })
  const output =
    `Scheduled nonblocking ${mode} wait ${scheduled.id} for ${new Date(scheduled.nextRun).toISOString()} ` +
    `(requested ${input.duration_ms}ms). Reason: ${input.reason}. End this turn unless another real workflow decision is immediately responsible; the scheduled wake will re-read current evidence.`
  return {
    requestedMs: input.duration_ms,
    aborted: false,
    jobID: scheduled.id,
    nextRun: scheduled.nextRun,
    mode,
    output,
  }
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
      sessionID: ctx.sessionID,
      taskID,
      logPhase: taskID ? "agent" : undefined,
    })
    return {
      title: result.aborted ? "Wait Not Scheduled" : "Wait Scheduled",
      output: result.output,
      metadata: {
        requestedMs: params.duration_ms,
        aborted: result.aborted,
        jobID: result.jobID,
        nextRun: result.nextRun,
        mode: result.mode,
        nonblocking: true,
        ...(result.aborted ? {} : { [TOOL_RESULT_PARK_METADATA_KEY]: true }),
      },
    }
  },
})
