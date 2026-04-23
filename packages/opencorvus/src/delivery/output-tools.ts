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
        "\nInternal-consistency contract for verdict='accepted' (all enforced here — " +
        "payload is rejected and you re-submit if any fails):\n" +
        "- startup_verification.attempted MUST be true AND .success MUST be true.\n" +
        "- frontend_check.attempted=true with renders_correctly=false is forbidden — that's a visual rejection.\n" +
        "- issues_found MUST be empty (mirror of rejection_details in prose; non-empty = not spec-complete).\n" +
        "- deferred_checks MUST carry no result='failed' entries.\n" +
        "- tool_call_evidence MUST be non-empty and MUST contain ≥1 entry with passed=true.\n" +
        "- Every tool_call_evidence[].detail MUST be ≥8 chars of reproducer-grade signal (numbers, URLs, exit codes, selectors).\n" +
        (requiredTools.length > 0
          ? `- tool_call_evidence[] MUST cover every required tool with passed=true: [${requiredTools.join(", ")}].\n`
          : "") +
        "\nOn validation failure the tool returns the error message — fix the " +
        "payload and call submit_verdict again. A payload whose evidence fields " +
        "contradict verdict='accepted' is always rejected; switch to " +
        "verdict='rejected' with rejection_details instead of fabricating success signals.",
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

          // Internal-consistency floor: 'accepted' is only valid if the
          // evidence fields themselves do not contradict the verdict.
          // These checks fire regardless of whether a skill injected
          // required_tools — they protect against the "time's up, emit
          // something positive" failure mode where the agent fills the
          // detail fields with failure signals and still claims accepted.
          if (!obj.startup_verification.attempted) {
            return (
              `Error: verdict='accepted' requires startup_verification.attempted=true. ` +
              `You cannot accept a delivery whose startup you never tried to verify. ` +
              `Either attempt startup (install → build → start → probe) and report the ` +
              `outcome honestly, or set verdict='rejected' with rejection_details ` +
              `including one entry with category='startup' naming the unverifiable surface.`
            )
          }
          if (!obj.startup_verification.success) {
            return (
              `Error: verdict='accepted' requires startup_verification.success=true. ` +
              `You reported startup failed (success=false) and still tried to accept. ` +
              `A delivery that does not start is a startup rejection — set ` +
              `verdict='rejected' with rejection_details including one entry with ` +
              `category='startup' naming the failure (include the command you ran, the ` +
              `error / non-zero exit / hung probe, and which goal owns the entry point).`
            )
          }
          if (obj.frontend_check.attempted && obj.frontend_check.renders_correctly === false) {
            return (
              `Error: verdict='accepted' requires frontend_check to not carry a recorded ` +
              `render failure. You set frontend_check.attempted=true and ` +
              `renders_correctly=false, then tried to accept anyway. Visual / render ` +
              `failures are a 'visual' rejection — set verdict='rejected' with ` +
              `rejection_details citing category='visual' and the concrete miss (layout, ` +
              `colors, missing components) per the user prompt's Stage A/B checklist.`
            )
          }
          if (obj.issues_found.length > 0) {
            return (
              `Error: verdict='accepted' requires issues_found=[]. You listed ` +
              `${obj.issues_found.length} issue(s) and still tried to accept — ` +
              `issues_found is the human-readable mirror of rejection_details, so any ` +
              `non-empty list indicates the delivery is not spec-complete. Either ` +
              `fix every issue (write_file / edit_file, then re-verify), or set ` +
              `verdict='rejected' and convert each item into a rejection_details entry.`
            )
          }
          const failedDeferred = (obj.deferred_checks ?? []).filter((c) => c.result === "failed")
          if (failedDeferred.length > 0) {
            return (
              `Error: verdict='accepted' requires deferred_checks to contain no ` +
              `result='failed' entries. You reported ${failedDeferred.length} failed ` +
              `deferred check(s): ${failedDeferred.map((c) => c.name).join(", ")}. A ` +
              `failed check means the spec was not met — reject (with rejection_details ` +
              `attributing each failure to a goal) or fix and re-run the check.`
            )
          }
          const evidenceCount = (obj.tool_call_evidence ?? []).length
          const passedEvidenceCount = (obj.tool_call_evidence ?? []).filter((e) => e.passed).length
          if (evidenceCount === 0) {
            return (
              `Error: verdict='accepted' requires tool_call_evidence[] to carry at least ` +
              `one entry — an empty evidence list means there is no reviewer-auditable ` +
              `record that you actually verified anything. Add entries for the ` +
              `probes you ran (verify_page_integrity, run_command, screenshot, curl, ` +
              `etc.) with passed flags matching reality. If no probe passed, reject.`
            )
          }
          if (passedEvidenceCount === 0) {
            return (
              `Error: verdict='accepted' requires at least one tool_call_evidence[] ` +
              `entry with passed=true — every probe you ran failed. That is a ` +
              `wholesale verification failure; set verdict='rejected' with ` +
              `rejection_details covering each failed probe (startup / runtime / ` +
              `visual as appropriate).`
            )
          }
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
