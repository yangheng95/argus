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
 * The `inputSchema` (`DeliveryVerdict`) carries every structural invariant
 * — non-empty arrays, ≥8-char details, discriminated accept/reject shapes.
 * This `execute()` body only enforces CROSS-FIELD SEMANTIC invariants that
 * a Zod schema cannot express:
 *   - accepted requires startup_verification.success=true
 *   - accepted requires frontend_check.attempted=true ⇒ renders_correctly!=false
 *   - accepted requires no result='failed' deferred_check
 *   - accepted requires ≥1 tool_call_evidence with passed=true
 *   - accepted requires every skill-required_tool to appear with passed=true
 *
 * Mirrors the architect pattern (output-tools.ts + submit_architect).
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
        "all required review checks. This is the ONLY way the verdict " +
        "leaves the agent — plain-text / markdown output is discarded. If " +
        "submit_verdict is not called before the step budget runs out, the run " +
        "is treated as a failed parse and retried.\n\n" +
        "Schema shape (discriminated by `verdict`):\n" +
        "- verdict='accepted' — provide summary, startup_verification, frontend_check, deferred_checks, tool_call_evidence (≥1 entry). NO rejection_details.\n" +
        "- verdict='rejected' — provide summary, startup_verification, frontend_check, deferred_checks, tool_call_evidence (≥1 entry), AND rejection_details (≥1 entry, every entry attributes to a goal_id).\n" +
        "There is NO separate affected_goal_ids or issues_found field — the orchestrator derives those from rejection_details.\n" +
        "\nCross-field rules for verdict='accepted' (enforced here — payload is rejected and you re-submit if any fails):\n" +
        "- startup_verification.attempted MUST be true AND .success MUST be true.\n" +
        "- frontend_check.attempted=true with renders_correctly=false is forbidden — that's a visual rejection.\n" +
        "- deferred_checks MUST carry no result='failed' entries.\n" +
        "- tool_call_evidence MUST contain ≥1 entry with passed=true.\n" +
        (requiredTools.length > 0
          ? `- tool_call_evidence[] MUST cover every required tool with passed=true: [${requiredTools.join(", ")}].\n`
          : "") +
        "\nOn validation failure the tool returns the error message — fix the " +
        "payload and call submit_verdict again. A payload whose evidence fields " +
        "contradict verdict='accepted' is always rejected; switch to " +
        "verdict='rejected' with rejection_details instead of fabricating success signals.",
      inputSchema: DeliveryVerdict,
      execute: async (input) => {
        const obj: DeliveryVerdictType = input

        if (obj.verdict === "accepted") {
          if (typeof obj.launch_command === "string") {
            const trimmed = obj.launch_command.trim().replace(/^`+|`+$/g, "").trim()
            obj.launch_command = trimmed.length > 0 ? trimmed : undefined
          }

          // Cross-field semantic checks — Zod cannot express "field A=true
          // implies field B!=false". These protect against the "time's up,
          // emit something positive" failure mode where the agent fills
          // `success`/`renders_correctly` with truthy bits while the
          // narrative fields contradict them.
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
          const failedDeferred = obj.deferred_checks.filter((c) => c.result === "failed")
          if (failedDeferred.length > 0) {
            return (
              `Error: verdict='accepted' requires deferred_checks to contain no ` +
              `result='failed' entries. You reported ${failedDeferred.length} failed ` +
              `deferred check(s): ${failedDeferred.map((c) => c.name).join(", ")}. A ` +
              `failed check means the spec was not met — reject with rejection_details ` +
              `attributing each failure to a goal.`
            )
          }
          const passedEvidenceCount = obj.tool_call_evidence.filter((e) => e.passed).length
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
              obj.tool_call_evidence.filter((e) => e.passed).map((e) => e.tool),
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
        }

        collector.verdict = obj
        collector.finalized = true

        const rejections = obj.verdict === "rejected" ? obj.rejection_details.length : 0
        const distinctGoals = obj.verdict === "rejected"
          ? new Set(obj.rejection_details.map((d) => d.goal_id)).size
          : 0
        return [
          `PASS: verdict=${obj.verdict} submitted.`,
          `  ${rejections} rejection_details across ${distinctGoals} goal(s),`,
          `  ${obj.tool_call_evidence.length} tool_call_evidence entries,`,
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
