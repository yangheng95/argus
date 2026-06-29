import z from "zod"
import { Tool } from "./tool"
import { Bus } from "@/bus"
import { Event } from "@/engine/model"
import { taskIDForSession } from "@/orchestrator/task-event"

export namespace TaskReport {
  export const EventDef = Event.TaskReport

  export type Report = z.infer<typeof EventDef.properties>
}

export const TaskReportTool = Tool.define("task_report", {
  description: `Signal your current status to the channel orchestrator at the end of each work turn.

In managed channel mode you MUST call this tool at the end of every turn. Pick the right status:
- **progress**: Made headway but need more turns. Describe what you did in summary and set next_plan for the next step.
- **need_input**: Cannot proceed without user clarification. Set question clearly.
- **done**: This agent session's assigned turn is complete. Summarize the result and list modified files in artifacts.
- **failed**: This agent session's assigned turn hit an unrecoverable error. Explain what went wrong in error.

This reports worker-session progress only; it does not complete, fail, or cancel the engine task lifecycle.`,
  parameters: z.object({
    status: z
      .enum(["progress", "need_input", "done", "failed"])
      .describe(
        "progress=more turns needed | need_input=waiting for user | done=session turn complete | failed=session error",
      ),
    summary: z.string().describe("What happened this turn, or the final result"),
    question: z.string().optional().describe("Question for the user (required when status=need_input)"),
    next_plan: z.string().optional().describe("What to do in the next turn (when status=progress)"),
    artifacts: z.array(z.string()).optional().describe("Files created or modified (when status=done)"),
    error: z.string().optional().describe("Error details (when status=failed)"),
  }),
  async execute(params, ctx) {
    const contextTaskID = typeof ctx.extra?.taskID === "string" ? ctx.extra.taskID : undefined
    const resolvedTaskID = taskIDForSession(ctx.sessionID)
    if (contextTaskID && resolvedTaskID && contextTaskID !== resolvedTaskID) {
      throw new Error(
        `task_report context task ${contextTaskID} does not own session ${ctx.sessionID}; expected ${resolvedTaskID}`,
      )
    }
    const taskID = resolvedTaskID
    if (!taskID) {
      throw new Error(
        `task_report requires task-owned session ${ctx.sessionID}; report cannot be projected to task conversation`,
      )
    }
    Bus.publish(TaskReport.EventDef, {
      taskID,
      sessionID: ctx.sessionID,
      status: params.status,
      summary: params.summary,
      question: params.question,
      next_plan: params.next_plan,
      artifacts: params.artifacts,
      error: params.error,
    })

    const message =
      params.status === "need_input"
        ? "Channel runtime will relay your question to the user. Your next turn will contain their answer — wait for it."
        : params.status === "progress"
          ? "Progress recorded. You will receive a continue signal in the next turn."
          : `Session report recorded as ${params.status}. Session will close.`

    return {
      title: `task_report: ${params.status}`,
      output: JSON.stringify({ acknowledged: true, status: params.status, message }),
      metadata: {},
    }
  },
})
