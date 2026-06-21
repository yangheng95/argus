import type { VisualEvidenceBundle } from "@/acceptance/visual-evidence"

type ReferenceParityDecisionEntry = {
  key: string
  value: string
}

type ReferenceParityScorer = {
  type?: string
  name?: string
  inputs?: string[]
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
  visualEvidence?: VisualEvidenceBundle[]
}): { required: boolean; regions: string[] } {
  let required = false
  const regions = new Set<string>()
  for (const goal of input.goals.filter((item) =>
    input.specSnapshotID ? item.spec_snapshot_id === input.specSnapshotID : true,
  )) {
    for (const spec of goal.acceptance_specs ?? []) {
      for (const scorer of spec.scorers ?? []) {
        if (scorer.type === "prebuilt" && scorer.name === "visual-evidence-bundle") required = true
        if (scorer.type === "llm_judge" && scorer.inputs?.includes("visual_evidence")) required = true
      }
    }
  }
  for (const bundle of input.visualEvidence ?? []) {
    if (bundle.taskID !== input.taskID) continue
    for (const region of bundle.regions.filter((item) => item.required)) {
      required = true
      regions.add(`${region.id}@${region.viewport}`)
    }
  }
  return { required, regions: [...regions].sort() }
}
