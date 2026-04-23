/**
 * Structured output tool for the DeliveryAgent.
 *
 * The agent MUST finalize its verdict by calling `submit_verdict` — a single
 * Zod-validated tool call that writes into a collector the outer verify()
 * loop reads. There is no free-text / markdown / ```json fence parsing path;
 * eliminating free-text output makes verdict emission robust against fence
 * pollution (zero-width chars, code-fence drift) that previously masqueraded
 * as "empty verdict" failures.
 *
 * Mirrors the architect pattern (output-tools.ts + finalize_architect).
 */
import { tool } from "ai"
import {
  DeliveryVerdict,
  type DeliveryVerdictType,
} from "./verdict"

export interface DeliveryCollector {
  verdict?: DeliveryVerdictType
  finalized: boolean
}

function emptyCollector(): DeliveryCollector {
  return { finalized: false }
}

export function createDeliveryOutputTools(input?: { requiredTools?: string[] }) {
  let collector: DeliveryCollector = emptyCollector()
  const requiredTools = Array.from(new Set(input?.requiredTools ?? []))

  const tools = {
    submit_verdict: tool({
      description:
        "Emit the FINAL delivery verdict. You MUST call this exactly once, as " +
        "the last action of the session, after you have finished Phase 0 adapt / " +
        "Phase 1-4 checks / Phase 5 repairs. This is the ONLY way the verdict " +
        "leaves the agent — plain-text / markdown output is discarded. If " +
        "submit_verdict is not called before the step budget runs out, the run " +
        "is treated as a failed parse and retried.\n\n" +
        "Attribution contract (enforced here):\n" +
        "- verdict='rejected' REQUIRES non-empty affected_goal_ids.\n" +
        "- Every rejection_details[].goal_id MUST appear in affected_goal_ids.\n" +
        "- verdict='accepted' normalizes affected_goal_ids to [] (ignored).\n" +
        (requiredTools.length > 0
          ? `- verdict='accepted' REQUIRES tool_call_evidence[] to cover every required tool with passed=true: [${requiredTools.join(", ")}].\n`
          : "") +
        "\nOn validation failure the tool returns the error message — fix the " +
        "payload and call submit_verdict again.",
      inputSchema: DeliveryVerdict,
      execute: async (input) => {
        const obj: DeliveryVerdictType = {
          ...input,
          issues_found: (input.issues_found ?? []).filter(
            (item) => typeof item === "string" && item.trim().length > 0,
          ),
          affected_goal_ids: Array.from(
            new Set(
              (input.affected_goal_ids ?? []).filter(
                (item) => typeof item === "string" && item.trim().length > 0,
              ),
            ),
          ),
        }

        if (typeof obj.launch_command === "string") {
          const trimmed = obj.launch_command.trim().replace(/^`+|`+$/g, "").trim()
          obj.launch_command = trimmed.length > 0 ? trimmed : undefined
        }

        if (obj.verdict === "accepted") {
          obj.affected_goal_ids = []
          if (requiredTools.length > 0) {
            const passedTools = new Set(
              (obj.tool_call_evidence ?? []).filter((e) => e.passed).map((e) => e.tool),
            )
            const missing = requiredTools.filter((t) => !passedTools.has(t))
            if (missing.length > 0) {
              return (
                `Error: verdict='accepted' requires tool_call_evidence[] to cover every ` +
                `skill-required tool with passed=true. Missing passed evidence for: ${missing.join(", ")}. ` +
                `Either run the missing tool(s) and resubmit with the evidence populated, or ` +
                `switch verdict to 'rejected' with rejection_details explaining why the check cannot pass.`
              )
            }
            for (const ev of obj.tool_call_evidence ?? []) {
              if (!ev.detail || ev.detail.trim().length < 8) {
                return (
                  `Error: tool_call_evidence[].detail for tool="${ev.tool}" is empty or trivially short. ` +
                  `Populate with reproducer-grade evidence (numbers, URLs, exit codes, selectors), not prose narration. ` +
                  `Then resubmit.`
                )
              }
            }
          }
        } else {
          if (obj.affected_goal_ids.length === 0) {
            return (
              "Error: verdict='rejected' requires a non-empty affected_goal_ids — " +
              "cite at least one goal id the rejection is attributed to. Call " +
              "submit_verdict again with the corrected payload."
            )
          }
          const affectedSet = new Set(obj.affected_goal_ids)
          const details = obj.rejection_details ?? []
          for (const d of details) {
            if (typeof d.goal_id !== "string" || d.goal_id.trim().length === 0) {
              return (
                "Error: every rejection_details entry must have a non-empty " +
                "goal_id — every rejection must be attributed to a specific goal. " +
                "Call submit_verdict again with the corrected payload."
              )
            }
            if (!affectedSet.has(d.goal_id)) {
              return (
                `Error: rejection_details carries goal_id="${d.goal_id}" that is ` +
                `not listed in affected_goal_ids (${
                  [...affectedSet].join(", ") || "empty"
                }). Add it to affected_goal_ids or correct the rejection_details entry, ` +
                "then call submit_verdict again."
              )
            }
          }
        }

        collector.verdict = obj
        collector.finalized = true

        const issues = obj.issues_found.length
        const rejections = (obj.rejection_details ?? []).length
        return [
          `PASS: verdict=${obj.verdict} submitted.`,
          `  ${issues} issues_found, ${rejections} rejection_details,`,
          `  ${obj.affected_goal_ids.length} affected_goal_ids,`,
          `  startup=${obj.startup_verification.success ? "ok" : "fail"}`,
        ].join("\n")
      },
    }),
  }

  return {
    tools,
    getCollector() {
      return collector
    },
    reset() {
      collector = emptyCollector()
    },
  }
}
