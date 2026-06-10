import type { AgentWorkflowRecord } from "./agent-workflow"

export function sortAgentWorkflowRecordsChronologically(records: AgentWorkflowRecord[]): AgentWorkflowRecord[] {
  return records.slice().sort((left, right) => {
    const byStart = left.startedAt - right.startedAt
    if (byStart !== 0) return byStart
    const byObserved = (left.lastObservedAt || left.startedAt) - (right.lastObservedAt || right.startedAt)
    if (byObserved !== 0) return byObserved
    return left.sessionID.localeCompare(right.sessionID)
  })
}

function mergeAgentRecord(base: AgentWorkflowRecord | undefined, live: AgentWorkflowRecord): AgentWorkflowRecord {
  if (!base) return { ...live }
  return {
    ...base,
    ...live,
    agentName: base.agentName,
    stage: base.stage,
    parentSessionID: base.parentSessionID || live.parentSessionID,
  }
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
  for (const record of baseRecords) {
    if (record.renderedCardID) merged.set(record.sessionID, { ...record })
  }
  for (const record of liveRecords) {
    if (!record.renderedCardID) continue
    const base = baseBySession.get(record.sessionID)
    merged.set(record.sessionID, mergeAgentRecord(base, record))
  }
  return sortAgentWorkflowRecordsChronologically([...merged.values()])
}
