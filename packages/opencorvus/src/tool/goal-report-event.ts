import z from "zod"
import { BusEvent } from "@/bus/bus-event"

export namespace GoalReportEvent {
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
