import { tool } from "ai"
import {
  AcceptanceReviewVerdict,
  type AcceptanceEvidenceFacetType,
  type AcceptanceReviewVerdictType,
} from "@/acceptance/review-verdict"
import { limitSummary, markdownJson, requireReportString } from "@/agent/report"

export interface IntegrityAcceptanceCollector {
  acceptanceVerdict?: AcceptanceReviewVerdictType
}

export function buildAcceptanceReport(collector: IntegrityAcceptanceCollector) {
  const verdict = collector.acceptanceVerdict
  if (!verdict) {
    return {
      summary: "Acceptance verdict missing",
      detail: "## Acceptance\nNo acceptance verdict submitted.",
    }
  }
  const summary = requireReportString(verdict.summary, "acceptance verdict summary")
  return {
    summary: limitSummary(summary),
    detail: [
      `## Acceptance Verdict\n${verdict.verdict}`,
      `## Summary\n${summary}`,
      `## Full Verdict\n${markdownJson(verdict)}`,
    ].join("\n\n"),
  }
}

export function createIntegrityAcceptanceOutputTools(input?: {
  requiredEvidenceFacets?: AcceptanceEvidenceFacetType[]
  requiredTools?: string[]
  collector?: IntegrityAcceptanceCollector
}) {
  const collector = input?.collector ?? {}
  const requiredEvidenceFacets = Array.from(new Set(input?.requiredEvidenceFacets ?? []))
  const requiredTools = Array.from(new Set(input?.requiredTools ?? []))
  const requires = (facet: AcceptanceEvidenceFacetType) => requiredEvidenceFacets.includes(facet)

  return {
    tools: {
      submit_acceptance_verdict: tool({
        description:
          "Emit the final acceptance verdict from inside the integrity session. Call this exactly once after the " +
          "runtime/output/visual/code evidence needed for this task has been produced or read through integrity tools. " +
          "Plain text is not accepted as a final verdict.\n\n" +
          "- verdict='accepted' requires summary, deferred_checks, tool_call_evidence, and only the task-applicable startup/frontend fields.\n" +
          "- verdict='rejected' requires summary, tool_call_evidence, and rejection_details with concrete routing evidence.\n" +
          (requiredEvidenceFacets.length > 0
            ? `Required evidence facets for accepted: [${requiredEvidenceFacets.join(", ")}].\n`
            : "Required evidence facets for accepted: none. Do not fabricate startup/frontend evidence.\n") +
          (requiredTools.length > 0
            ? `Required passed tools for accepted: [${requiredTools.join(", ")}].\n`
            : ""),
        inputSchema: AcceptanceReviewVerdict,
        execute: async (input) => {
          const parsed = AcceptanceReviewVerdict.safeParse(input)
          if (!parsed.success) {
            return `Error: submit_acceptance_verdict payload failed schema validation: ${parsed.error.message}`
          }
          const obj = parsed.data
          if (obj.verdict === "accepted") {
            if (typeof obj.launch_command === "string") {
              const trimmed = obj.launch_command.trim().replace(/^`+|`+$/g, "").trim()
              obj.launch_command = trimmed.length > 0 ? trimmed : undefined
            }
            if (requires("startup") && !obj.startup_verification?.attempted) {
              return "Error: verdict='accepted' requires startup_verification.attempted=true for this task."
            }
            if (obj.startup_verification && !obj.startup_verification.success) {
              return "Error: verdict='accepted' contradicts startup_verification.success=false; reject with category='startup'."
            }
            if ((requires("frontend") || requires("visual")) && !obj.frontend_check?.attempted) {
              return "Error: verdict='accepted' requires frontend_check.attempted=true for frontend/visual tasks."
            }
            if (obj.frontend_check?.attempted && obj.frontend_check.renders_correctly === false) {
              return "Error: verdict='accepted' contradicts frontend_check.renders_correctly=false; reject with category='visual' or 'runtime'."
            }
            const failedDeferred = obj.deferred_checks.filter((check) => check.result === "failed")
            if (failedDeferred.length > 0) {
              return `Error: verdict='accepted' contains failed deferred_checks: ${failedDeferred.map((c) => c.name).join(", ")}.`
            }
            const passedEvidenceCount = obj.tool_call_evidence.filter((e) => e.passed).length
            if (passedEvidenceCount === 0) {
              return "Error: verdict='accepted' requires at least one passed tool_call_evidence entry."
            }
            if (requiredTools.length > 0) {
              const passedTools = new Set(obj.tool_call_evidence.filter((e) => e.passed).map((e) => e.tool))
              const missing = requiredTools.filter((toolName) => !passedTools.has(toolName))
              if (missing.length > 0) {
                return `Error: verdict='accepted' is missing passed tool evidence for: ${missing.join(", ")}.`
              }
            }
          }
          if (obj.verdict === "rejected") {
            const advisoryNames = new Set(
              obj.deferred_checks.filter((item) => item.result === "advisory_failed").map((item) => item.name),
            )
            const failedNames = new Set(
              obj.deferred_checks.filter((item) => item.result === "failed").map((item) => item.name),
            )
            if (failedNames.size === 0 && advisoryNames.size > 0) {
              const cited = obj.rejection_details
                .map((detail) => detail.check_id)
                .filter((item): item is string => Boolean(item))
              if (cited.length === obj.rejection_details.length && cited.every((checkID) => advisoryNames.has(checkID))) {
                return "Error: advisory signals alone cannot drive rejected acceptance; cite a primary failure or reclassify."
              }
            }
          }
          collector.acceptanceVerdict = obj
          return `PASS: acceptance verdict=${obj.verdict} submitted with ${obj.tool_call_evidence.length} evidence item(s).`
        },
      }),
    },
    getCollector() {
      return collector
    },
    buildReport() {
      return buildAcceptanceReport(collector)
    },
  }
}
