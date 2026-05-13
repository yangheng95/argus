import type { AgentWorkflowRecord } from "./agent-workflow"

export interface AgentWorkflowLane {
  id: string
  kind: "single" | "parallel"
  parentSessionID: string
  startedAt: number
  lastObservedAt: number
  completedAt?: number
  records: AgentWorkflowRecord[]
}

function intervalEnd(record: AgentWorkflowRecord): number {
  return record.completedAt || record.lastObservedAt || record.startedAt
}

function intervalsOverlap(left: AgentWorkflowRecord, right: AgentWorkflowRecord): boolean {
  if (!left.startedAt || !right.startedAt) return false
  const leftEnd = intervalEnd(left)
  const rightEnd = intervalEnd(right)
  if (leftEnd <= left.startedAt || rightEnd <= right.startedAt) return false
  return left.startedAt <= rightEnd && right.startedAt <= leftEnd
}

function laneID(records: AgentWorkflowRecord[]): string {
  return records.map((record) => record.sessionID).join("+")
}

function makeLane(records: AgentWorkflowRecord[]): AgentWorkflowLane {
  const sorted = records.slice().sort((left, right) => left.startedAt - right.startedAt)
  const completedValues = sorted
    .map((record) => record.completedAt)
    .filter((value): value is number => typeof value === "number" && value > 0)
  return {
    id: laneID(sorted),
    kind: sorted.length > 1 ? "parallel" : "single",
    parentSessionID: sorted[0]?.parentSessionID || "",
    startedAt: Math.min(...sorted.map((record) => record.startedAt)),
    lastObservedAt: Math.max(...sorted.map((record) => record.lastObservedAt || record.startedAt)),
    ...(completedValues.length === sorted.length ? { completedAt: Math.max(...completedValues) } : {}),
    records: sorted,
  }
}

export function buildAgentWorkflowLanes(records: AgentWorkflowRecord[]): AgentWorkflowLane[] {
  const byParent = new Map<string, AgentWorkflowRecord[]>()
  for (const record of records) {
    const key = record.parentSessionID || "root"
    byParent.set(key, [...(byParent.get(key) || []), record])
  }
  const lanes: AgentWorkflowLane[] = []
  for (const [parentSessionID, parentRecords] of byParent.entries()) {
    const sorted = parentRecords.slice().sort((left, right) => left.startedAt - right.startedAt)
    const visited = new Set<string>()
    for (const record of sorted) {
      if (visited.has(record.sessionID)) continue
      const group = [record]
      visited.add(record.sessionID)
      for (const candidate of sorted) {
        if (visited.has(candidate.sessionID)) continue
        if (candidate.parentSessionID !== record.parentSessionID) continue
        if (!group.some((member) => intervalsOverlap(member, candidate))) continue
        group.push(candidate)
        visited.add(candidate.sessionID)
      }
      lanes.push(makeLane(group))
    }
  }
  return lanes.sort((left, right) => left.startedAt - right.startedAt)
}
