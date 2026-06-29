/**
 * Fact-check terminal tool + collector.
 *
 * Per fact-check agent contract §3.2:
 *   - Single terminal tool `report_fact_check_result` accepts the full
 *     FactCheckReport in one structured payload.
 *   - Schema has NO `fact_check_items` field — anti-recursion guarantee
 *     at the schema level (rule 8 single source).
 *   - Each verified / corrected item carries ≥1 evidence pointer.
 *
 * The agent loop owns retrieval (read / search_code / glob / websearch /
 * webfetch / external_code_search / memory); when
 * inspection is done it calls this tool exactly once.
 */
import { tool } from "ai"
import { FactCheckReportSchema, validateFactCheckAgentReportSemantics, type FactCheckReport } from "./schema"
import { limitSummary } from "@/agent/report"

export interface FactCheckCollector {
  report?: FactCheckReport
}

function emptyCollector(): FactCheckCollector {
  return {}
}

function buildFactCheckMarkdown(collector: FactCheckCollector) {
  const r = collector.report
  if (!r) {
    return {
      summary: limitSummary("fact-check did not submit a report"),
      detail: "No fact-check report was submitted before the session ended.",
    }
  }
  const sections: string[] = []
  sections.push(`**verdict**: \`${r.overall_verdict}\``)
  sections.push(
    `**scope**: target_session=\`${r.scope.target_session_id}\` agent=\`${r.scope.target_agent}\` ` +
      `items=${r.scope.items_inspected}/${r.scope.items_total}`,
  )
  if (r.verified.length > 0) {
    sections.push(
      `### Verified (${r.verified.length})\n` +
        r.verified
          .map((v, i) => {
            const ev = v.evidence.map((e) => `  - [${e.kind}] ${e.pointer}: ${e.excerpt.slice(0, 200)}`).join("\n")
            return `${i + 1}. ${v.claim}\n${ev}`
          })
          .join("\n\n"),
    )
  }
  if (r.corrected.length > 0) {
    sections.push(
      `### Corrected (${r.corrected.length})\n` +
        r.corrected
          .map((c, i) => {
            const ev = c.evidence.map((e) => `  - [${e.kind}] ${e.pointer}: ${e.excerpt.slice(0, 200)}`).join("\n")
            return (
              `${i + 1}. [${c.severity}] ${c.claim}\n` +
              `   → **${c.correction}**\n` +
              `   recommended_action: \`${c.recommended_action}\`\n` +
              ev
            )
          })
          .join("\n\n"),
    )
  }
  if (r.unresolved.length > 0) {
    sections.push(
      `### Unresolved (${r.unresolved.length})\n` +
        r.unresolved.map((u, i) => `${i + 1}. [${u.severity}, ${u.why_unresolved}] ${u.claim}`).join("\n"),
    )
  }
  const summary = limitSummary(
    `fact-check verdict=${r.overall_verdict} ` +
      `(verified=${r.verified.length}, corrected=${r.corrected.length}, unresolved=${r.unresolved.length})`,
  )
  return { summary, detail: sections.join("\n\n") }
}

export function createFactCheckOutputTools() {
  let collector = emptyCollector()
  const tools = {
    report_fact_check_result: tool({
      description:
        "Submit the structured fact-check report. Call exactly once when you have inspected every item " +
        "you can. The report MUST classify each registered claim as verified / corrected / unresolved " +
        "and pick the right overall_verdict per the decision tree in fact-check-core.txt. " +
        "overall_verdict must be exactly one of clean, minor_corrections, needs_orchestrator_action, inconclusive.",
      inputSchema: FactCheckReportSchema,
      execute: async (report) => {
        const semanticError = validateFactCheckAgentReportSemantics(report)
        if (semanticError) return `Error: fact-check report failed semantic validation: ${semanticError}`
        collector.report = report
        return (
          `OK: fact-check report submitted ` +
          `(verified=${report.verified.length}, ` +
          `corrected=${report.corrected.length}, ` +
          `unresolved=${report.unresolved.length}, ` +
          `verdict=${report.overall_verdict})`
        )
      },
    }),
  }
  return {
    tools,
    getCollector: () => collector,
    buildReport: () => buildFactCheckMarkdown(collector),
    reset() {
      collector = emptyCollector()
      return collector
    },
  }
}
