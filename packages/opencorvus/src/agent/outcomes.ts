import { findBuildOutcomesForTask } from "@/engine/store"

export type TaskAgentOutcome = {
  id: string
  provider: string
  artifactKind: string
  scope: "task" | "goal"
  capabilities?: string[]
  runID?: string
  goalID?: string | null
  goalRunID?: string | null
  sessionID?: string
  status: string
  result?: string
  summary?: string
  error?: string
  noDiffReason?: string
  changedFiles?: string[]
  reportedChangedFiles?: string[]
  diffs?: Array<{
    file: string
    status?: string
    additions?: number
    deletions?: number
  }>
  commitRef?: string
  time: { created: number; updated: number }
}

export type TaskAgentOutcomeProvider = {
  id: string
  collectOutcomesForTask(taskID: string): TaskAgentOutcome[]
}

const buildOutcomeProvider: TaskAgentOutcomeProvider = {
  id: "build",
  collectOutcomesForTask(taskID) {
    return findBuildOutcomesForTask(taskID)
      .sort((left, right) => left.time_created - right.time_created || left.id.localeCompare(right.id))
      .map((outcome) => ({
        id: outcome.id,
        provider: "build",
        artifactKind: "build_attempt_outcome",
        scope: outcome.goal_run_id === null ? ("task" as const) : ("goal" as const),
        capabilities: ["implementation"],
        runID: outcome.run_id ?? undefined,
        goalID: outcome.goal_id,
        goalRunID: outcome.goal_run_id,
        sessionID: outcome.session_id ?? undefined,
        status: outcome.terminal_status,
        result: outcome.outcome_kind,
        summary: outcome.summary || undefined,
        error: outcome.error ?? undefined,
        noDiffReason: outcome.no_diff_reason ?? undefined,
        changedFiles: outcome.changed_files,
        reportedChangedFiles: outcome.reported_changed_files,
        diffs: buildOutcomeDiffSummaries(outcome.host_facts.actual_changed_files),
        commitRef: outcome.commit_ref ?? undefined,
        time: {
          created: outcome.time_created,
          updated: outcome.time_updated,
        },
      }))
  },
}

function buildOutcomeDiffSummaries(value: unknown): NonNullable<TaskAgentOutcome["diffs"]> {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return []
    const record = item as Record<string, unknown>
    const file = typeof record.path === "string" && record.path.trim() ? record.path.trim() : undefined
    if (!file) return []
    return [
      {
        file,
        ...(typeof record.status === "string" ? { status: record.status } : {}),
        ...(typeof record.additions === "number" ? { additions: record.additions } : {}),
        ...(typeof record.deletions === "number" ? { deletions: record.deletions } : {}),
      },
    ]
  })
}

const providers = new Map<string, TaskAgentOutcomeProvider>()

export function registerTaskAgentOutcomeProvider(provider: TaskAgentOutcomeProvider): () => void {
  if (providers.has(provider.id)) {
    throw new Error(`TaskAgentOutcomeProvider already registered: ${provider.id}`)
  }
  providers.set(provider.id, provider)
  return () => {
    providers.delete(provider.id)
  }
}

registerTaskAgentOutcomeProvider(buildOutcomeProvider)

export function collectTaskAgentOutcomes(taskID: string): TaskAgentOutcome[] {
  return collectAgentOutcomesForTask(taskID).filter((outcome) => outcome.scope === "task")
}

export function collectAgentOutcomesForTask(taskID: string): TaskAgentOutcome[] {
  return [...providers.values()].flatMap((provider) => provider.collectOutcomesForTask(taskID))
}

export function hasTerminalTaskAgentOutcome(input: { taskID: string; capability?: string }): boolean {
  return collectTaskAgentOutcomes(input.taskID).some((outcome) => {
    if (input.capability && !(outcome.capabilities ?? []).includes(input.capability)) return false
    return outcome.status === "completed" || outcome.status === "failed" || outcome.status === "aborted"
  })
}
