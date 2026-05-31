/**
 * Shared fact-check registration prompt fragment.
 *
 * Per specs/fact-check-agent-2026-05-25.md §5.1, this is the single source
 * for the registration-protocol text that every covered worker prompt
 * appends. Six worker agent.ts files import `withFactCheckRegistration`
 * and call it at their `runAgentSession({ core: ... })` site:
 *
 *   build / requirements / architect / frontend-design / intent-analysis /
 *   integrity (CONSENSUS phase only — team-agent.ts:265)
 *
 * Plan and reviewer phases (team-agent.ts:197 / :404) do NOT inject this
 * fragment — they produce different schemas (submit_integrity_review_plan,
 * submit_reviewer_report) that do not carry `fact_check_items`.
 *
 * The fact-check agent itself MUST NOT import this fragment
 * (anti-recursion — its report schema has no `fact_check_items` field).
 */

export const FACT_CHECK_REGISTRATION_FRAGMENT = `## Fact-check item registration

Before calling your terminal report tool, register EVERY factual claim in your output that
you have NOT directly verified via tool calls in this session, AND EVERY placeholder for
information you do not have. Use \`fact_check_items[]\` when your terminal schema exposes it.

Each item:
- \`claim\`: full standalone assertion (≥20 chars, ≤280 chars). Avoid generic words like
  "tbd", "unknown", "n/a", "continue", "next step" — they get classified as ambiguous and
  count against you in the fact-check report.
- \`confidence\`: low | medium | high (self-assessment).
- \`category\`: api | library | number | history | path | protocol | other.
- \`source\`: where you got it. "assumed" | "model prior" | "<url>" | "<file:line>" |
  "user-said:<short>".

Placeholders: \`claim="<待填充：...>"\` + confidence="low" + source="assumed".

DO NOT register: opinions, preferences, plans, your own decisions, tool-call results you
observed in this session, contents of files you read in this session.

Omit \`fact_check_items\` or use \`fact_check_items: []\` when you genuinely have no unverified claims.
Over-claiming verified-ness will be flagged as a violation in fact-check.`

/**
 * Append the fact-check registration fragment to a worker core prompt.
 * Single abstraction point for rule 9 (extract repeating structural pattern).
 * Used at every covered worker's `core:` site in its agent.ts run-function.
 *
 * Usage:
 *   core: withFactCheckRegistration(BUILD_CORE)
 *   core: withFactCheckRegistration(composeBuildCore(autoIteration))
 *   core: withFactCheckRegistration([FRONTEND_DESIGN_CORE, renderAutoIterationMode(autoIteration)].join("\\n\\n"))
 */
export function withFactCheckRegistration(core: string): string {
  return [core, FACT_CHECK_REGISTRATION_FRAGMENT].join("\n\n")
}
