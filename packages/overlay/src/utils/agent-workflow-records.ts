import type { AgentWorkflowRecord } from "./agent-workflow"

export function sortAgentWorkflowRecordsChronologically(
  records: AgentWorkflowRecord[],
): AgentWorkflowRecord[] {
  return records.slice().sort((left, right) => {
    const byStart = left.startedAt - right.startedAt
    if (byStart !== 0) return byStart
    const byObserved = (left.lastObservedAt || left.startedAt) - (right.lastObservedAt || right.startedAt)
    if (byObserved !== 0) return byObserved
    return left.sessionID.localeCompare(right.sessionID)
  })
}

export function mergeAgentRecords(
  baseRecords: AgentWorkflowRecord[],
  liveRecords: AgentWorkflowRecord[],
): AgentWorkflowRecord[] {
  const baseBySession = new Map<string, AgentWorkflowRecord>()
  for (const record of baseRecords) {
    baseBySession.set(record.sessionID, { ...record })
  }
  const merged = new Map<string, AgentWorkflowRecord>()
  for (const record of liveRecords) {
    if (!record.renderedCardID) continue
    const base = baseBySession.get(record.sessionID)
    merged.set(record.sessionID, base ? { ...base, ...record } : { ...record })
  }
  return sortAgentWorkflowRecordsChronologically([...merged.values()])
}
