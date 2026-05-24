export type SpecSnapshotLineage = {
  taskID: string
  activeSpecSnapshotID: string
  inheritedSpecSnapshotIDs: string[]
  reason: "active_only" | "integrity_correction_lineage"
}

export function specSnapshotIDsForLineage(lineage: SpecSnapshotLineage): string[] {
  return [lineage.activeSpecSnapshotID, ...lineage.inheritedSpecSnapshotIDs]
}
