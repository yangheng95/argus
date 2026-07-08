/**
 * Stateful-snapshot tool registry — single source of truth.
 *
 * A "stateful snapshot" tool is one whose return value is a snapshot of
 * mutable task state. The LATEST call's output represents authoritative
 * state; older calls' outputs are obsolete. The session loop projects
 * older calls' outputs to a short "[superseded]" placeholder in the
 * model prompt, dramatically reducing the per-turn token bill.
 *
 * This module is dependency-free so it can be imported from both
 * `orchestrator/tools.ts` (where the actual tool definitions live) and
 * `session/message.ts` (where projection happens) without creating a
 * circular dependency through `@/session`.
 *
 * Adding a tool here means making a deliberate semantic claim: the tool
 * is read-only, returns a state snapshot, and the most recent call
 * supersedes any earlier ones in the same session. Do NOT add a tool
 * here unless that property holds — the projection silently drops
 * superseded payloads, so a tool whose old returns still carry value
 * (e.g., a transcript of an irreversible operation) MUST stay out.
 *
 * The forward-guard test in `test/session/stateful-snapshot-tools.test.ts`
 * verifies every name here corresponds to a real tool registered by
 * `createOrchestratorTools`. Renaming a tool without updating this list
 * therefore fails CI rather than silently disabling projection.
 */
export const STATEFUL_SNAPSHOT_TOOL_NAMES = [
  // Live-state queries — called every turn; latest answer supersedes all.
  "read_context",
  // Refinement is normally called once per task; if a retry path re-invokes
  // it, the older ACK ceases to reflect reality. Full outputs persist in
  // Decision Log / task state, re-readable via read_context.
  "refine",
] as const

export type StatefulSnapshotToolName = (typeof STATEFUL_SNAPSHOT_TOOL_NAMES)[number]

export const STATEFUL_SNAPSHOT_TOOL_ACTIONS = [
  {
    tool: "manage_task",
    action: "query_failed_goals",
    key: "manage_task action=query_failed_goals",
  },
] as const

export type StatefulSnapshotToolAction = (typeof STATEFUL_SNAPSHOT_TOOL_ACTIONS)[number]

const STATEFUL_SNAPSHOT_TOOL_NAME_SET = new Set<string>(STATEFUL_SNAPSHOT_TOOL_NAMES)

function parseToolInputRecord(input: unknown): Record<string, unknown> | undefined {
  if (input && typeof input === "object" && !Array.isArray(input)) return input as Record<string, unknown>
  if (typeof input !== "string" || input.trim().length === 0) return undefined
  try {
    const parsed = JSON.parse(input)
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined
  } catch {
    return undefined
  }
}

export function statefulSnapshotToolKey(toolName: string, input: unknown): string | undefined {
  if (STATEFUL_SNAPSHOT_TOOL_NAME_SET.has(toolName)) return toolName
  const record = parseToolInputRecord(input)
  if (!record) return undefined
  return STATEFUL_SNAPSHOT_TOOL_ACTIONS.find(
    (entry) => entry.tool === toolName && record.action === entry.action,
  )?.key
}

/**
 * Orchestrator tools that cannot by themselves complete a scheduling decision.
 *
 * These tools may be useful inside a wake, but a wake that stops after calling
 * only these tools has not changed task lifecycle, dispatched responsible
 * work, asked the operator, or updated the task plan. The orchestrator must
 * continue with a real decision tool in the same wake.
 */
export const ORCHESTRATOR_NO_DECISION_OBSERVATION_TOOL_NAMES = [
  "read_context",
  "browser_preview",
  "bash",
] as const

export type OrchestratorNoDecisionObservationToolName = (typeof ORCHESTRATOR_NO_DECISION_OBSERVATION_TOOL_NAMES)[number]

const ORCHESTRATOR_NO_DECISION_OBSERVATION_TOOL_NAME_SET = new Set<string>(
  ORCHESTRATOR_NO_DECISION_OBSERVATION_TOOL_NAMES,
)

export function isOrchestratorNoDecisionObservationToolName(
  value: string,
): value is OrchestratorNoDecisionObservationToolName {
  return ORCHESTRATOR_NO_DECISION_OBSERVATION_TOOL_NAME_SET.has(value)
}

export const ORCHESTRATOR_DECISION_EFFECT_METADATA_KEY = "orchestratorDecisionEffect"
export type OrchestratorDecisionEffect = "decision" | "observation" | "none"
