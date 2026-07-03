type ReferenceParityDecisionEntry = {
  key: string
  value: string
}

type ReferenceParityScorer = {
  type?: string
  name?: string
}

type ReferenceParityAcceptanceSpec = {
  scorers?: ReferenceParityScorer[]
}

type ReferenceParityGoal = {
  spec_snapshot_id?: string | null
  acceptance_specs?: ReferenceParityAcceptanceSpec[] | null
}

export function deriveVisualQaReferenceParityContext(input: {
  taskID: string
  specSnapshotID?: string
  goals: ReferenceParityGoal[]
  frontendDesignEntries?: ReferenceParityDecisionEntry[]
}): { required: boolean; regions: string[] } {
  let required = false
  const regions = new Set<string>()
  for (const goal of input.goals.filter((item) =>
    input.specSnapshotID ? item.spec_snapshot_id === input.specSnapshotID : true,
  )) {
    for (const spec of goal.acceptance_specs ?? []) {
      for (const scorer of spec.scorers ?? []) {
        if (scorer.type === "prebuilt" && scorer.name === "visual-feedback-verification") required = true
      }
    }
  }
  if (frontendDesignRequiresRenderedVisualFeedback(input.frontendDesignEntries ?? [])) {
    required = true
  }
  return { required, regions: [...regions].sort() }
}

function frontendDesignRequiresRenderedVisualFeedback(entries: ReferenceParityDecisionEntry[]): boolean {
  const latest = new Map<string, string>()
  for (const entry of entries) latest.set(entry.key, entry.value)
  const finalAcceptanceMode = latest.get("final_acceptance_mode")?.trim()
  if (finalAcceptanceMode) return true
  const referenceArtifacts = latest.get("reference_artifacts")?.trim()
  if (referenceArtifacts) return true
  return false
}
