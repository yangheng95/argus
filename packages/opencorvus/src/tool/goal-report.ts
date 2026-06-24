import { Tool } from "./tool"
import { Bus } from "@/bus"
import { Session } from "@/session"
import { limitSummary, markdownList, requireReportString } from "@/agent/report"
import { GoalReportEvent } from "./goal-report-event"

export namespace GoalReport {
  export const FileChange = GoalReportEvent.FileChange
  export const CheckRun = GoalReportEvent.CheckRun
  export const DesignDecision = GoalReportEvent.DesignDecision
  export const Report = GoalReportEvent.Report
  export type ReportInput = GoalReportEvent.ReportInput
  export const EventDef = GoalReportEvent.EventDef
}

export const GoalReportTool = Tool.define("goal_report", {
  description: `Emit the structured implementation report for this goal. You MUST call this tool exactly once, at the end of the goal, after all deliverables and checks are complete.

Fields are adversarially cross-checked against the diff by the acceptance evaluator:
- implementation_approach is matched against the actual code written — a claim the diff does not support is a rejection.
- design_decisions[].reason is challenged — a restated choice or a reason the code contradicts is a rejection.
- followup_workload_guidance should warn later agents about remaining hidden work surface instead of letting them infer scope only from this goal's file list.

Do not call this tool more than once. Do not call it as a progress update mid-goal.`,
  parameters: GoalReport.Report,
  async execute(params, ctx) {
    Bus.publish(GoalReport.EventDef, {
      sessionID: ctx.sessionID,
      report: params,
    })
    return {
      title: "goal_report",
      output: JSON.stringify({ acknowledged: true, files: params.files_changed.length }),
      metadata: {},
    }
  },
})

export function buildGoalReport(report: GoalReport.ReportInput) {
  const approach = requireReportString(report.implementation_approach, "goal implementation_approach")
  const fileLines = report.files_changed.map((file) => `${file.path}: ${file.summary}`)
  return {
    summary: limitSummary(approach),
    detail: [
      `## Implementation Approach\n${approach}`,
      report.followup_workload_guidance
        ? `## Follow-up Workload Guidance\n${report.followup_workload_guidance}`
        : undefined,
      `## Files Changed\n${fileLines.length ? markdownList(fileLines) : "- no files changed"}`,
    ]
      .filter((section): section is string => Boolean(section))
      .join("\n\n"),
  }
}

/**
 * Extract the structured report emitted by the goal executor via the
 * `goal_report` tool call. Reads the executor session's messages, locates
 * the single completed `goal_report` tool invocation, and parses its
 * input against the schema.
 *
 * Throws (no fallback) when:
 *   - the tool was never called,
 *   - the tool was called more than once (the goal contract mandates exactly
 *     one terminal call),
 *   - the input does not validate.
 *
 * Each failure mode maps to a real executor contract violation — surfacing
 * them as hard errors is what lets the evaluator replan instead of silently
 * accepting an undocumented acceptance.
 */
export async function extractGoalReport(sessionID: string): Promise<GoalReport.ReportInput> {
  const messages = await Session.messages({ sessionID })
  const calls: Array<Record<string, unknown>> = []
  for (const msg of messages) {
    if (msg.info.role !== "assistant") continue
    for (const part of msg.parts) {
      if (part.type !== "tool") continue
      if (part.tool !== "goal_report") continue
      if (part.state.status !== "completed") continue
      if (!part.state.input || typeof part.state.input !== "object" || Array.isArray(part.state.input)) {
        throw new Error(`extractGoalReport: goal_report input for ${part.callID} was not an object`)
      }
      calls.push(part.state.input as Record<string, unknown>)
    }
  }
  if (calls.length === 0) {
    throw new Error(
      "extractGoalReport: executor did not call `goal_report` before terminating. " +
        "The goal contract requires exactly one terminal `goal_report` tool call with " +
        "implementation_approach and design_decisions. Missing call means the executor " +
        "violated the contract — goal must fail and replan, not silently pass.",
    )
  }
  if (calls.length > 1) {
    throw new Error(
      `extractGoalReport: executor called \`goal_report\` ${calls.length} times. ` +
        "The contract specifies exactly one terminal call. Multiple calls mean the " +
        "executor used it as a progress update — reject rather than pick one arbitrarily.",
    )
  }
  const parsed = GoalReport.Report.safeParse(calls[0])
  if (!parsed.success) {
    throw new Error(
      `extractGoalReport: \`goal_report\` input failed schema validation: ` +
        parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    )
  }
  return parsed.data
}
