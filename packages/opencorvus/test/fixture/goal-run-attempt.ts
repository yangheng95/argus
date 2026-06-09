import { Database } from "../../src/storage/db"
import { EngineArtifactTable } from "../../src/engine/engine.sql"

/**
 * Phase H (2026-05-05) — shared fixture helper.
 *
 * Phases B + E retired engine_goal.workspace_* / retry_count columns; the
 * persistent worktree pointer + retry counter live exclusively on the
 * `goal_run_attempt` artifact's payload. Phase G hardened
 * `updateGoalWorkspace` so it refuses no-tip seeding (no fallback, rule 7),
 * which means tests that need a goal in some "already has a worktree"
 * state must seed an attempt artifact directly.
 *
 * Multiple test files (`engine/writer.test.ts`,
 * `orchestrator/tools.test.ts`) need the same shape — abstract once
 * (rule 9) so the seed is a single source.
 */
export function seedGoalRunAttemptWithWorkspace(input: {
  taskID: string
  goalID: string
  /** Optional run_id for the seed artifact. Pass undefined when no
   *  coordinating run is in scope; the artifact still resolves through
   *  goal_run-by-goal lookups since the key is goal_id, not run_id. */
  runID?: string
  /** Optional fixed artifact id. Falls back to a deterministic
   *  `grun_seed_<goalID>` so callers can re-derive it for assertions. */
  artifactID?: string
  workspaceDir: string | null
  workspaceBranch: string | null
  workspaceBaseRef?: string | null
  /** Default 0 — first attempt's V1 label. Pass non-zero to seed retry
   *  history. */
  retryCount?: number
  status: "queued" | "running" | "completed" | "failed" | "aborted"
  now: number
}): string {
  const id = input.artifactID ?? `grun_seed_${input.goalID}`
  const terminal = input.status === "completed" || input.status === "failed" || input.status === "aborted"
  Database.use((db) =>
    db
      .insert(EngineArtifactTable)
      .values({
        id,
        task_id: input.taskID,
        run_id: input.runID ?? null,
        goal_run_id: id,
        kind: "goal_run_attempt",
        label: `attempt-${input.status}`,
        payload: {
          goal_id: input.goalID,
          plan_node_id: null,
          session_id: null,
          status: input.status,
          retry_count: input.retryCount ?? 0,
          blocking_reason: null,
          error: null,
          workspace_dir: input.workspaceDir,
          workspace_branch: input.workspaceBranch,
          workspace_base_ref: input.workspaceBaseRef ?? null,
          base_ref: null,
          merge_ref: null,
          supersede_of: null,
          superseded_reason: null,
          superseded_at: null,
          metadata: null,
          time_started: terminal ? input.now : null,
          time_completed: terminal ? input.now : null,
        },
        time_created: input.now,
        time_updated: input.now,
      })
      .run(),
  )
  return id
}
