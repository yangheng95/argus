import z from "zod"
import { Tool } from "./tool"
import { Bus } from "@/bus"
import { BusEvent } from "@/bus/bus-event"
import { Session } from "@/session"
import { limitSummary, markdownList, requireReportString } from "@/agent/report"

export namespace GoalReport {
  export const FileChange = z.object({
    path: z.string().min(1),
    summary: z
      .string()
      .min(1)
      .describe("What changed in this file and why. One or two sentences, concrete — not 'updated foo'."),
  })

  export const CheckRun = z.object({
    name: z.string().min(1),
    command: z.string().min(1),
    exit_code: z.number().int(),
    output_excerpt: z
      .string()
      .optional()
      .describe("Last relevant lines of stdout/stderr (≤ 2000 chars). Omit when trivially green."),
  })

  export const DesignDecision = z.object({
    choice: z.string().min(1).describe("The decision made, stated as a concrete claim."),
    alternatives: z
      .array(z.string())
      .default([])
      .describe("Alternatives that were considered and rejected. Empty array if none were weighed."),
    reason: z
      .string()
      .min(1)
      .describe("Why this choice won over the alternatives. Must be a real reason, not a restatement of the choice."),
  })

  export const Report = z.object({
    files_changed: z
      .array(FileChange)
      .describe(
        "Every file touched in this goal. May be empty if the goal's acceptance " +
          "was met by reusing a prior attempt's worktree without further edits — " +
          "the orchestrator cross-checks against the host's actual_changed_files " +
          "ground truth.",
      ),
    checks_run: z
      .array(CheckRun)
      .default([])
      .describe(
        "Commands executed to verify the goal (build / test / lint / verify). Empty array is allowed only for goals whose acceptance is entirely rubric/semantic.",
      ),
    implementation_approach: z
      .string()
      .min(40)
      .describe(
        "The actual implementation plan: what scheme you used, core structure, key APIs, and data flow. Must describe the approach concretely so an evaluator can cross-check the diff against it.",
      ),
    design_decisions: z
      .array(DesignDecision)
      .default([])
      .describe(
        "Key decisions and why. Each entry names the alternatives considered and the reason the chosen one won. Empty array means the goal required no non-trivial decision.",
      ),
    blockers: z
      .array(z.string())
      .default([])
      .describe(
        "Hard blockers hit during execution. Empty when none. A filled array signals the goal did not fully complete.",
      ),
    followup_workload_guidance: z
      .string()
      .trim()
      .min(1)
      .optional()
      .describe(
        "Explicit warning for subsequent agents about hidden or remaining work surface, evidence they must read deeper, and whether goal workload analysis or Architect re-sizing should be revisited.",
      ),
  })

  export type ReportInput = z.infer<typeof Report>

  export const EventDef = BusEvent.define(
    "goal.report",
    z.object({
      sessionID: z.string(),
      report: Report,
    }),
  )
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
