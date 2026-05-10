/**
 * Structured output tool for the DeliveryAgent.
 *
 * The agent MUST finalize its semantic verdict by calling `submit_verdict` —
 * a single Zod-validated tool call that writes into a collector the outer
 * verify() loop reads. The host delivery arbiter is the only owner that
 * converts deterministic gates, specialist reviews, visual metrics, and this
 * semantic verdict into the final persisted verdict. There is no free-text /
 * markdown / ```json fence parsing path; eliminating free-text output makes
 * verdict emission robust against fence pollution (zero-width chars,
 * code-fence drift) that previously masqueraded as "empty verdict" failures.
 *
 * The `inputSchema` (`DeliveryVerdict`) carries every structural invariant
 * — non-empty arrays, ≥8-char details, discriminated accept/reject shapes.
 * This `execute()` body only enforces CROSS-FIELD SEMANTIC invariants that
 * a Zod schema cannot express:
 *   - accepted requires startup_verification.success=true when startup is applicable
 *   - accepted requires frontend_check.attempted=true ⇒ renders_correctly!=false
 *   - accepted requires no primary result='failed' deferred_check
 *   - accepted requires ≥1 tool_call_evidence with passed=true
 *   - accepted requires every skill-required_tool to appear with passed=true
 *
 * Mirrors the architect pattern (output-tools.ts + submit_architect).
 */
import { tool } from "ai"
import {
  DeliveryVerdict,
  type DeliveryEvidenceFacetType,
  type DeliveryVerdictType,
} from "./verdict"

export interface DeliveryCollector {
  /** Raw collector slot. Callers must parse with DeliveryVerdict before using it. */
  verdict?: unknown
  finalized: boolean
}

function emptyCollector(): DeliveryCollector {
  return { finalized: false }
}

export function createDeliveryOutputTools(input?: {
  requiredTools?: string[]
  requiredEvidenceFacets?: DeliveryEvidenceFacetType[]
  manifestGate?: {
    status: "passed" | "failed"
    summary: string
  }
  hostGateFailures?: Array<{
    kind: "manifest" | "runtime" | "visual"
    id: string
    summary: string
  }>
}) {
  let collector: DeliveryCollector = emptyCollector()
  const requiredEvidenceFacets = Array.from(new Set(input?.requiredEvidenceFacets ?? []))
  const requiredTools = Array.from(new Set([
    ...(input?.requiredTools ?? []),
    ...(requiredEvidenceFacets.some((facet) => facet === "frontend" || facet === "visual")
      ? ["start_frontend_preview"]
      : []),
  ]))
  const manifestGate = input?.manifestGate
  const hostGateFailures = input?.hostGateFailures ?? []
  const requires = (facet: DeliveryEvidenceFacetType) => requiredEvidenceFacets.includes(facet)

  const tools = {
    submit_verdict: tool({
      description:
        "Emit the delivery semantic verdict for the host arbiter. You MUST call this exactly once, as " +
        "the last action of the session, after you have finished every required " +
        "verification check (Phases 1-5 of the delivery prompt). This is the ONLY way the verdict " +
        "leaves the agent — plain-text / markdown output is discarded. If " +
        "submit_verdict is not called before the step budget runs out, the run " +
        "is treated as a failed parse and retried.\n\n" +
        "Schema shape (discriminated by `verdict`):\n" +
        "- verdict='accepted' — provide summary, deferred_checks, tool_call_evidence (≥1 entry), plus only the task-applicable evidence facets listed below. NO rejection_details.\n" +
        "- verdict='rejected' — provide summary, deferred_checks, tool_call_evidence (≥1 entry), any evidence facets you actually probed, AND rejection_details (≥1 entry). Include goal_id only when a responsible goal is actually identifiable; include check_id when the issue directly cites a deferred_checks[].name; omit goal_id for task-scope project failures.\n" +
        "There is NO separate affected_goal_ids or issues_found field — goal rework routing derives only from rejection_details entries that truthfully include goal_id.\n" +
        (requiredEvidenceFacets.length > 0
          ? `\nHost-required evidence facets for verdict='accepted': [${requiredEvidenceFacets.join(", ")}].\n`
          : "\nHost-required evidence facets for verdict='accepted': none. Do not fabricate startup/frontend evidence for non-runnable work.\n") +
        "\nCross-field rules for verdict='accepted' (enforced here — payload is rejected and you re-submit if any fails):\n" +
        "- If startup is host-required, startup_verification.attempted MUST be true AND .success MUST be true.\n" +
        "- If frontend or visual is host-required, frontend_check.attempted MUST be true and renders_correctly MUST NOT be false.\n" +
        "- If any host hard gate failed (manifest, runtime-evidence, or visual metric), verdict='accepted' is rejected; submit a rejected verdict with evidence-backed rejection_details.\n" +
        "- Any supplied failed startup/frontend evidence contradicts acceptance even when that facet was not required.\n" +
        "- deferred_checks MUST carry no primary result='failed' entries; result='advisory_failed' is allowed as diagnostic evidence.\n" +
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
        const parsed = DeliveryVerdict.safeParse(input)
        if (!parsed.success) {
          return `Error: submit_verdict payload failed DeliveryVerdict schema validation: ${parsed.error.message}`
        }
        const obj: DeliveryVerdictType = parsed.data

        if (obj.verdict === "accepted") {
          if (typeof obj.launch_command === "string") {
            const trimmed = obj.launch_command.trim().replace(/^`+|`+$/g, "").trim()
            obj.launch_command = trimmed.length > 0 ? trimmed : undefined
          }

          if (manifestGate?.status === "failed" || hostGateFailures.length > 0) {
            const summaries = hostGateFailures.length > 0
              ? hostGateFailures.map((item) => `${item.kind}:${item.id}: ${item.summary}`).join(" | ")
              : `manifest:finalGate: ${manifestGate?.summary ?? "failed"}`
            return (
              `Error: verdict='accepted' is forbidden because host hard gate(s) failed: ` +
              `${summaries}. Submit ` +
              `verdict='rejected' with rejection_details. Include goal_id only when ` +
              `a responsible goal is identifiable; otherwise leave the entry task-scoped.`
            )
          }

          // Cross-field semantic checks — Zod cannot express "field A=true
          // implies field B!=false". These protect against the "time's up,
          // emit something positive" failure mode where the agent fills
          // `success`/`renders_correctly` with truthy bits while the
          // narrative fields contradict them.
          if (requires("startup") && !obj.startup_verification?.attempted) {
            return (
              `Error: verdict='accepted' requires startup_verification.attempted=true. ` +
              `The host marked startup as applicable to this task. Either attempt startup ` +
              `(install → build → start → probe) and report the outcome honestly, or set ` +
              `verdict='rejected' with rejection_details including one entry with ` +
              `category='startup' naming the unverifiable surface.`
            )
          }
          if (obj.startup_verification && !obj.startup_verification.success) {
            return (
              `Error: verdict='accepted' requires startup_verification.success=true. ` +
              `You reported startup failed (success=false) and still tried to accept. ` +
              `A delivery that does not start is a startup rejection — set ` +
              `verdict='rejected' with rejection_details including one entry with ` +
              `category='startup' naming the failure (include the command you ran, the ` +
              `error / non-zero exit / hung probe, and which goal owns the entry point).`
            )
          }
          if ((requires("frontend") || requires("visual")) && !obj.frontend_check?.attempted) {
            return (
              `Error: verdict='accepted' requires frontend_check.attempted=true. ` +
              `The host marked frontend/visual evidence as applicable to this task. ` +
              `Run an appropriate render probe or screenshot and report the outcome, ` +
              `or reject with category='visual' or category='runtime'.`
            )
          }
          if (obj.frontend_check?.attempted && obj.frontend_check.renders_correctly === false) {
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
              `primary result='failed' entries. You reported ${failedDeferred.length} failed ` +
              `deferred check(s): ${failedDeferred.map((c) => c.name).join(", ")}. ` +
              `result='advisory_failed' is allowed for auxiliary diagnostics, but ` +
              `primary failures require verdict='rejected' with rejection_details.`
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

        if (obj.verdict === "rejected") {
          const advisoryOnlyError = advisoryOnlyRejectionError(obj)
          if (advisoryOnlyError) return advisoryOnlyError
        }

        collector.verdict = obj
        collector.finalized = true

        const rejections = obj.verdict === "rejected" ? obj.rejection_details.length : 0
        const distinctGoals = obj.verdict === "rejected"
          ? new Set(obj.rejection_details.map((d) => d.goal_id).filter((item): item is string => Boolean(item))).size
          : 0
        return [
          `PASS: verdict=${obj.verdict} submitted.`,
          `  ${rejections} rejection_details across ${distinctGoals} goal(s),`,
          `  ${obj.tool_call_evidence.length} tool_call_evidence entries,`,
          `  startup=${obj.startup_verification ? (obj.startup_verification.success ? "ok" : "fail") : "n/a"}`,
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

function advisoryOnlyRejectionError(obj: DeliveryVerdictType): string | undefined {
  if (obj.verdict !== "rejected") return undefined
  const failedNames = new Set(obj.deferred_checks.filter((item) => item.result === "failed").map((item) => item.name))
  if (failedNames.size > 0) return undefined
  const advisoryNames = new Set(obj.deferred_checks
    .filter((item) => item.result === "advisory_failed")
    .map((item) => item.name))
  if (advisoryNames.size === 0) return undefined
  const citedCheckIds = obj.rejection_details
    .map((detail) => detail.check_id)
    .filter((item): item is string => Boolean(item))
  if (citedCheckIds.length !== obj.rejection_details.length) return undefined
  const allDetailsReferenceAdvisory = citedCheckIds.every((checkID) => advisoryNames.has(checkID))
  if (!allDetailsReferenceAdvisory) return undefined
  return "Error: advisory 信号不应单独触发 reject — 找一个 primary 失败或重新分类"
}
