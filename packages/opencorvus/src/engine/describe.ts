/**
 * Describe layer — project a task / goal's CURRENT STATE from the event stream.
 *
 * This is the single read-path the orchestrator LLM uses to see "what's going
 * on." It composes an LLM-readable snapshot from append-only events:
 *   - engine_goal_run (attempt history, immutable)
 *   - engine_iteration (acceptance arbiter trajectory)
 *   - engine_artifact  (latest verdict payload)
 *   - decision_log     (operator + agent decisions)
 *   - clarifications / operator notes
 *
 * **It does NOT read `engine_goal.status` as authoritative.** The status
 * derivations here are computed from the goal_run chain tip at describe time.
 * When Phase 3 deletes the status cache field this layer keeps working with
 * zero changes — that's the whole point.
 *
 * The orchestrator LLM makes dispatch / retry / publish decisions directly
 * from this snapshot. There is no FSM gate between the LLM and the tools;
 * this description IS the gate — if the LLM mis-reads it, that's the LLM's
 * problem, not a state-machine deadlock.
 */

import { renderSpecsAsText, type AcceptanceSpec } from "@/acceptance/types"
import z from "zod"
import { createDecisionLog, type DecisionEntry } from "@/decision-log"
import { FRONTEND_DESIGN_COMPLETION_KEYS, frontendDesignArtifactPaths } from "@/frontend-design/handoff"
import { renderUserRequestSection } from "@/intent/request-prompt"
import { readIterationHistory as readHistory } from "@/metrics/store"
import { deriveGoalStatus } from "./goal-status"
import { isGoalRunOrphaned, isRunOrphan } from "./orphan"
import { deriveTaskStatus } from "./task-status"
import { ToolFailureCause, renderToolFailureCause } from "@/session/tool-failure-cause"
import { SessionStatus } from "@/session/status"
import { Database, sql } from "@/storage/db"

/** Derived goal status enum — returned by goalStatusByID / statusOf.
 *  The column it used to shadow (engine_goal.status) is gone; this is
 *  the function-return type for the live derivation. */
export type EngineGoalStatus = "pending" | "running" | "passed" | "failed"
import { effectiveMaxAgentParallelism, clarificationTranscriptSection, operatorNotesSection } from "./helpers"
import {
  findActivePlanForTask,
  findActiveRunForTask,
  findActiveSpecForTask,
  findLatestAcceptanceVerdictArtifact,
  findLatestGoalWorkloadArtifact,
  findRuns,
  findTask,
  listFrontendResearchBriefArtifacts,
  listResearchBriefArtifacts,
  listGoalRefillNotificationArtifacts,
  listGoalRunsByGoal,
  listGoals,
  listOrchestratorStreamErrorArtifacts,
  listToolExecuteErrorArtifacts,
  type GoalRow,
  type GoalRunRow,
  type ResearchBriefArtifactRow,
  type TaskRow,
} from "./store"
import { researchBriefIsStale, researchRequestHashInput } from "@/research/staleness"

/** Cap recent stream-failure entries surfaced into the orchestrator prompt.
 *  A chronically failing provider can write an artifact every wake; older
 *  entries add no decision value once the LLM has seen the trend. */
const STREAM_FAILURE_PROMPT_CAP = 5
const AGENT_FAILURE_PROMPT_CAP = 5
const TOOL_EXECUTE_FAILURE_PROMPT_CAP = 5
const OPEN_TOOL_CALL_PROMPT_CAP = 5
const TERMINAL_GOAL_REFILL_PROMPT_CAP = 5
const RESEARCH_BRIEF_DESC_CAP = 4

const TerminalGoalRefillNotificationPayloadSchema = z.object({
  task_id: z.string(),
  run_id: z.string(),
  fingerprint: z.string(),
  terminal_goal_run: z.object({ id: z.string(), goal_id: z.string(), status: z.string() }),
  live_sibling_goal_runs: z.array(z.object({ id: z.string(), goal_id: z.string(), status: z.string() })),
  dispatch_result: z.enum(["started", "queued"]),
  time_dispatched: z.number(),
})

const LIVE_STATES = new Set(["queued", "accepted", "planning", "running", "evaluating", "blocked"])
const TERMINAL_OK_STATES = new Set(["completed"])
const TERMINAL_FAIL_STATES = new Set(["failed"])
const TERMINAL_ABORTED_STATES = new Set(["aborted"])

// ---------------------------------------------------------------------------
// Structured description types (exported for tests / UI)
// ---------------------------------------------------------------------------

export interface GoalAttemptSummary {
  goal_run_id: string
  /** Persisted status of this particular goal_run row (immutable once terminal). */
  outcome: string
  /** If non-null, this attempt was itself superseded by a newer one — the
   *  typed reason names why (acceptance_rework / manual_retry / modify_contract /
   *  restart_stage). Terminal + superseded_reason is retry intent evidence;
   *  it does not make the goal scheduler-dispatchable by itself. */
  superseded_reason?: string
  superseded_at?: number
  /** Points at the older attempt this row supersedes (forms the chain). */
  supersede_of?: string
  time_started?: number
  time_completed?: number
  duration_ms?: number
  error?: string
  blocking_reason?: string
  session_id?: string
}

export interface GoalDesc {
  id: string
  title: string
  kind: string
  priority: "blocking" | "advisory"
  objective: string
  acceptance_summary: string
  requirement_ids?: string[]
  owned_paths: string[]
  depends_on: string[]
  /** All historical goal_runs in chronological order (oldest → newest). */
  attempts: GoalAttemptSummary[]
  attempt_count: number
  /** The tip — the newest attempt with no successor pointing at it via
   *  supersede_of. `undefined` when the goal has never dispatched. */
  latest_attempt?: GoalAttemptSummary
  // Derived boolean views. All are pure functions of `latest_attempt`;
  // NO read from engine_goal.status.
  is_running: boolean
  is_terminal_ok: boolean
  is_terminal_fail: boolean
  is_aborted: boolean
  /** True when the tip is terminal (completed/failed/aborted) AND carries
   *  superseded_reason — meaning: a retry intent was recorded, the goal
   *  should be re-dispatched. The orchestrator LLM uses this to decide
   *  whether to call `dispatch_goal(id)`. */
  needs_redispatch: boolean
  /** True when the goal has never had a goal_run. */
  never_dispatched: boolean
  /** True when the tip goal_run is in a live status but its `owner` stamp is a
   *  foreign (restarted) process — physically orphaned, mid-stream turn cannot
   *  resume. The orchestrator should treat it as a dead attempt and re-dispatch.
   *  Spec: specs/new-arch/2026-05-29-goal-run-owner-orphan-liveness.md */
  is_orphaned: boolean
}

export interface StreamFailureDesc {
  artifact_id: string
  time_created: number
  /** Free-text reason recorded by `recordOrchestratorStreamError` —
   *  e.g. "APIError: Provider alibaba-coding-plan returned HTTP 401 …". */
  reason: string
  /** Class name from the AI SDK error (`APIError`, `AbortError`, …) when
   *  the writer captured one. */
  error_name?: string
  /** Orchestrator session id active at the moment of the failure, when
   *  available. */
  session_id?: string
}

export interface ToolExecuteFailureDesc {
  artifact_id: string
  time_created: number
  session_id?: string
  message_id?: string
  part_id?: string
  tool_name: string
  call_id: string
  reason: string
}

export interface AgentFailureDesc {
  decision_id: string
  time_created: number
  key: string
  reason: string
  goal_id?: string
}

export interface OpenToolCallDesc {
  time_created: number
  session_id: string
  session_kind: string
  message_id: string
  part_id: string
  tool_name: string
  call_id: string
  status: string
}

export interface TerminalGoalRefillNotificationDesc {
  artifact_id: string
  run_id: string
  time_created: number
  time_dispatched: number
  fingerprint: string
  terminal_goal_run: { id: string; goal_id: string; status: string }
  live_sibling_goal_runs: Array<{ id: string; goal_id: string; status: string }>
  dispatch_result: "started" | "queued"
}

export interface AcceptanceVerdictDesc {
  iteration: number
  verdict: string
  summary: string
  issues: string[]
  details: Array<{ category?: string; file?: string; error: string; suggestion?: string }>
  verdict_artifact_id?: string
}

export interface TaskDesc {
  id: string
  title: string
  kind: "workflow" | "build"
  status: string
  request: string
  error?: string
  spec_summary?: string
  plan_summary?: string
  /** True when a Goal Workload Analyst artifact exists for this task. Pure
   *  fact (rule 23): no gate — the orchestrator LLM decides whether to run /
   *  re-run workload_analysis. */
  workload_analyzed?: boolean
  /** True when a workload artifact exists but was computed against a superseded
   *  architect snapshot (its spec_snapshot_id != the active snapshot). Stale
   *  briefs are not injected downstream; the LLM may re-run workload_analysis. */
  workload_stale?: boolean
  research?: ResearchBriefDesc[]
  frontend_research?: ResearchBriefDesc[]
  frontend_design?: FrontendDesignHandoffDesc
  active_run_id?: string
  active_run_status?: string
  /** True when `active_run_id` refers to a run that currently has no live
   *  executor (no live `engine_goal_run` attached) — i.e. this run has
   *  lost its OS-level execution context, typically because the owner
   *  process was restarted. Derived by `engine/recovery.ts#isRunOrphan`
   *  from the existing live-run / live-goal-run tables. Phase 4+ retires
   *  the abort brake that today translates this fact into status writes;
   *  this boolean becomes the sole signal the orchestrator LLM reads. */
  run_orphan?: boolean
  clarifications?: string
  operator_notes?: string
  goals: GoalDesc[]
  /** When the goal set contains a `kind=bootstrap` goal whose status is not
   *  yet `passed`, this is its id; otherwise null. Surfaced upfront so the
   *  orchestrator LLM can serialise dispatch (build the bootstrap goal first,
   *  THEN fan-out non-bootstrap goals) when that is the correct collaboration
   *  shape. No tool gate enforces this; the orchestrator is responsible for
   *  the scheduling decision from the describe snapshot. */
  active_bootstrap_goal_id?: string
  collaboration_closure?: CollaborationClosureDesc
  budget: {
    runs_used: number
    fix_count: number
    max_executor_groups: number
  }
  recent_verdict?: AcceptanceVerdictDesc
  /** Recent orchestrator-stream-error artifacts (newest first, capped at
   *  STREAM_FAILURE_PROMPT_CAP). Most entries are wakes whose LLM stream
   *  aborted before any decision was made; OrchestratorNoDecisionStopError is
   *  a completed stream that stopped without a workflow decision. The
   *  orchestrator LLM reads this list on its next wake and decides from the
   *  current task context — there is no engine state machine that auto-handles
   *  them (rule 13). Empty / undefined when the task has had no such artifacts
   *  since `task.time_started`. */
  recent_stream_failures?: StreamFailureDesc[]
  recent_tool_execute_failures?: ToolExecuteFailureDesc[]
  /** Persisted tool calls in the task session tree whose state is still
   *  pending/running while no current process owns the tool session. This is
   *  execution evidence for the orchestrator LLM, not a lifecycle transition. */
  open_tool_calls_without_current_owner?: OpenToolCallDesc[]
  /** Durable facts that a terminal goal completion already woke the
   *  orchestrator for FIFO refill. Written after dispatchTaskLoop starts and
   *  read here so the next model turn can distinguish "terminal completion
   *  already surfaced" from "no refill evidence." */
  recent_terminal_goal_refills?: TerminalGoalRefillNotificationDesc[]
  /** Recent sub-agent session failures recorded in decision_log phase
   *  "agent_error". These are the model-visible counterpart to overlay red
   *  session cards: provider quota, network, schema, and terminal session
   *  errors that would otherwise live only in User Interface (UI) / log status. */
  recent_agent_failures?: AgentFailureDesc[]
  iterations_count: number
}

export interface ResearchBriefDesc {
  artifact_id: string
  session_id: string
  stale: boolean
  stale_reasons: string[]
  source_urls: string[]
  source_count: number
  fact_count: number
  blocking_open_question_count: number
  bundle_paths: string[]
  summary: string
}

export interface FrontendDesignHandoffDesc {
  is_complete: boolean
  has_public_report: boolean
  has_evidence_source_manifest: boolean
  frontend_template_path?: string
  source_manifest_path?: string
  present_keys: string[]
  missing_completion_keys: string[]
  latest_decision_id: string
  latest_updated_at: number
  public_report_decision_id?: string
  evidence_source_manifest_decision_id?: string
}

export interface CollaborationClosureDesc {
  execution_started: boolean
  attempts_count: number
  passed_goal_ids: string[]
  failed_goal_ids: string[]
  dispatchable_goal_ids: string[]
  blocked_goals: Array<{ goal_id: string; blocked_by: Array<{ goal_id: string; status: string }> }>
}

function describeResearchBriefArtifact(input: {
  task: TaskRow
  artifact?: ResearchBriefArtifactRow
}): ResearchBriefDesc | undefined {
  const artifact = input.artifact
  if (!artifact) return undefined
  const staleness = researchBriefIsStale({
    request: input.task.request,
    requestHashInput: researchRequestHashInput({
      request: input.task.request,
      clarificationTranscript: clarificationTranscriptSection(input.task.id),
      operatorNotes: operatorNotesSection(input.task.id),
    }),
    brief: artifact.payload,
  })
  return {
    artifact_id: artifact.id,
    session_id: artifact.payload.metadata.research_session_id,
    stale: staleness.stale,
    stale_reasons: staleness.reasons,
    source_urls: researchBriefSourceURLs(artifact.payload),
    source_count: artifact.payload.evidence_index.length,
    fact_count: artifact.payload.facts.length,
    blocking_open_question_count: artifact.payload.open_questions.filter((item) => item.blocking).length,
    bundle_paths: [
      artifact.payload.bundle.full_markdown_path,
      artifact.payload.bundle.evidence_json_path,
      artifact.payload.bundle.citation_map_path,
    ],
    summary: artifact.payload.summary,
  }
}

function researchBriefSourceURLs(brief: ResearchBriefArtifactRow["payload"]): string[] {
  const urls = brief.webpage_contract?.source_url ? [brief.webpage_contract.source_url] : []
  return [...new Set(urls)]
}

function describeFrontendDesignHandoff(taskID: string): FrontendDesignHandoffDesc | undefined {
  const entries = createDecisionLog(taskID).readByPhase("frontend_design")
  if (entries.length === 0) return undefined

  const latestByKey = new Map<string, DecisionEntry>()
  for (const entry of entries) latestByKey.set(entry.key, entry)

  const missingCompletionKeys = FRONTEND_DESIGN_COMPLETION_KEYS.filter((key) => !latestByKey.has(key))
  const latestEntry = entries.reduce((latest, entry) => (entry.timeCreated >= latest.timeCreated ? entry : latest))
  const paths = frontendDesignArtifactPaths("", taskID)
  const hasPublicReport = latestByKey.has("public_report")
  const hasEvidenceSourceManifest = latestByKey.has("evidence_source_manifest")

  return {
    is_complete: missingCompletionKeys.length === 0,
    has_public_report: hasPublicReport,
    has_evidence_source_manifest: hasEvidenceSourceManifest,
    frontend_template_path: hasPublicReport ? paths.templateRelative : undefined,
    source_manifest_path: hasEvidenceSourceManifest ? paths.manifestRelative : undefined,
    present_keys: [...latestByKey.keys()].sort(),
    missing_completion_keys: [...missingCompletionKeys],
    latest_decision_id: latestEntry.id,
    latest_updated_at: latestEntry.timeCreated,
    public_report_decision_id: latestByKey.get("public_report")?.id,
    evidence_source_manifest_decision_id: latestByKey.get("evidence_source_manifest")?.id,
  }
}

function listOpenToolCallsWithoutCurrentOwner(task: TaskRow): OpenToolCallDesc[] {
  if (!task.session_id) return []
  const rows = Database.use((db) =>
    db.all<{
      time_created: number
      session_id: string
      session_kind: string
      message_id: string
      part_id: string
      tool_name: string | null
      call_id: string | null
      status: string | null
    }>(sql`
      WITH RECURSIVE session_tree(id, kind) AS (
        SELECT id, kind
        FROM session
        WHERE id = ${task.session_id}
          AND project_id = ${task.project_id}
        UNION ALL
        SELECT s.id, s.kind
        FROM session s
        JOIN session_tree st ON s.parent_id = st.id
      )
      SELECT
        p.time_created AS time_created,
        p.session_id AS session_id,
        st.kind AS session_kind,
        p.message_id AS message_id,
        p.id AS part_id,
        json_extract(p.data, '$.tool') AS tool_name,
        json_extract(p.data, '$.callID') AS call_id,
        json_extract(p.data, '$.state.status') AS status
      FROM part p
      JOIN session_tree st ON st.id = p.session_id
      WHERE json_extract(p.data, '$.type') = 'tool'
        AND json_extract(p.data, '$.state.status') NOT IN ('completed', 'error')
      ORDER BY p.time_created DESC, p.id DESC
    `),
  )

  return rows
    .flatMap((row) => {
      const currentStatus = SessionStatus.get(row.session_id)
      if (currentStatus.type === "streaming" || currentStatus.type === "retry") return []
      if (!row.tool_name || !row.call_id || !row.status) return []
      return [
        {
          time_created: row.time_created,
          session_id: row.session_id,
          session_kind: row.session_kind,
          message_id: row.message_id,
          part_id: row.part_id,
          tool_name: row.tool_name,
          call_id: row.call_id,
          status: row.status,
        },
      ]
    })
    .slice(0, OPEN_TOOL_CALL_PROMPT_CAP)
}

// ---------------------------------------------------------------------------
// Goal description
// ---------------------------------------------------------------------------

function describeAttempt(row: GoalRunRow): GoalAttemptSummary {
  const durationMs = row.time_started && row.time_completed ? row.time_completed - row.time_started : undefined
  return {
    goal_run_id: row.id,
    outcome: row.status,
    supersede_of: row.supersede_of ?? undefined,
    superseded_reason: row.superseded_reason ?? undefined,
    superseded_at: row.superseded_at ?? undefined,
    time_started: row.time_started ?? undefined,
    time_completed: row.time_completed ?? undefined,
    duration_ms: durationMs,
    error: row.error ?? undefined,
    blocking_reason: row.blocking_reason ?? undefined,
    session_id: row.session_id ?? undefined,
  }
}

function tipFromChain(rows: GoalRunRow[]): GoalRunRow | undefined {
  if (rows.length === 0) return undefined
  const supersededIDs = new Set(rows.map((r) => r.supersede_of).filter((x): x is string => !!x))
  // Rows are ordered desc by time_created — the first tip is the newest.
  return rows.find((r) => !supersededIDs.has(r.id))
}

export function describeGoal(goal: GoalRow, rewindCursor?: number | null): GoalDesc {
  let rows = listGoalRunsByGoal(goal.id)
  // Apply rewind cursor: events after the cursor are invisible to the UI /
  // orchestrator view. The append-only chain is intact in DB; this is a
  // projection filter.
  if (rewindCursor != null) {
    rows = rows.filter((r) => (r.time_created ?? 0) <= rewindCursor)
  }
  const tip = tipFromChain(rows)
  // Render attempts oldest → newest so the LLM reads a natural timeline.
  const attempts = [...rows].reverse().map(describeAttempt)
  const latest = tip ? describeAttempt(tip) : undefined

  // Owner-stamp orphan is a confidence fact, not a lifecycle projection.
  // Keep is_running tied to the persisted goal_run status; expose ownership
  // death separately through is_orphaned so the LLM decides the next action.
  const tipIsOrphaned = !!tip && isGoalRunOrphaned(tip)
  const tipIsLive = !!tip && LIVE_STATES.has(tip.status)
  const tipIsOk = !!tip && TERMINAL_OK_STATES.has(tip.status)
  const tipIsFail = !!tip && TERMINAL_FAIL_STATES.has(tip.status)
  const tipIsAborted = !!tip && TERMINAL_ABORTED_STATES.has(tip.status)
  const tipHasRedispatchIntent = !!tip && !!tip.superseded_reason
  const isTerminal = tipIsOk || tipIsFail || tipIsAborted

  return {
    id: goal.id,
    title: goal.title,
    kind: goal.kind ?? "feature",
    priority: goal.priority as "blocking" | "advisory",
    objective: goal.objective,
    acceptance_summary: renderSpecsAsText((goal.acceptance_specs ?? []) as AcceptanceSpec[]).slice(0, 300),
    requirement_ids: (goal.requirement_ids ?? []) as string[],
    owned_paths: (goal.owned_paths ?? []) as string[],
    depends_on: (goal.depends_on ?? []) as string[],
    attempts,
    attempt_count: attempts.length,
    latest_attempt: latest,
    is_running: tipIsLive,
    is_terminal_ok: tipIsOk && !tipHasRedispatchIntent,
    is_terminal_fail: tipIsFail && !tipHasRedispatchIntent,
    is_aborted: tipIsAborted && !tipHasRedispatchIntent,
    needs_redispatch: isTerminal && tipHasRedispatchIntent,
    never_dispatched: rows.length === 0,
    is_orphaned: tipIsOrphaned,
  }
}

/**
 * Drop-in replacement for reading `engine_goal.status` as a cache. Derives
 * the status live from the goal_run chain (plus cascade_state) on each call.
 * When the goal has never dispatched, returns "pending" — matching the
 * initial cache value. Use this at every call-site that previously did
 * `goal.status === X` / `g.status === X` so the cache field can be retired
 * in Phase 4 without another sweep.
 *
 * Same sync semantics as `deriveGoalStatus` — it hits the DB via
 * findGoal + listGoalRunsByGoal, both of which are primary-key / indexed
 * queries. Acceptable in filter loops with small goal counts (≤100 per task).
 */
export function goalStatusByID(goalID: string): EngineGoalStatus {
  return deriveGoalStatus(goalID) ?? "pending"
}

function buildCollaborationClosure(goals: GoalDesc[]): CollaborationClosureDesc | undefined {
  if (goals.length === 0) return undefined

  const attemptsCount = goals.reduce((sum, goal) => sum + goal.attempt_count, 0)
  const passed = new Set(goals.filter((goal) => goal.is_terminal_ok).map((goal) => goal.id))
  const failedGoalIDs = goals.filter((goal) => goal.is_terminal_fail).map((goal) => goal.id)
  const byID = new Map(goals.map((goal) => [goal.id, goal]))
  const dispatchableGoalIDs: string[] = []
  const blockedGoals: CollaborationClosureDesc["blocked_goals"] = []

  for (const goal of goals) {
    const mayDispatch = goal.never_dispatched
    if (!mayDispatch) continue

    const blockers = goal.depends_on
      .filter((depID) => !passed.has(depID))
      .map((depID) => {
        const dep = byID.get(depID)
        return { goal_id: depID, status: dep ? describeDerivedState(dep) : "missing" }
      })

    if (blockers.length > 0) {
      blockedGoals.push({ goal_id: goal.id, blocked_by: blockers })
    } else {
      dispatchableGoalIDs.push(goal.id)
    }
  }

  return {
    execution_started: attemptsCount > 0,
    attempts_count: attemptsCount,
    passed_goal_ids: [...passed],
    failed_goal_ids: failedGoalIDs,
    dispatchable_goal_ids: dispatchableGoalIDs,
    blocked_goals: blockedGoals,
  }
}

// ---------------------------------------------------------------------------
// Task description
// ---------------------------------------------------------------------------

function describeVerdict(taskID: string): AcceptanceVerdictDesc | undefined {
  const art = findLatestAcceptanceVerdictArtifact(taskID)
  if (!art) return undefined
  const payload = (art.payload ?? {}) as Record<string, unknown>
  const history = readHistory(taskID)
  const lastIter = history[history.length - 1]
  // Single source of truth (rule 22): rejection_details is the canonical
  // structured field; the human-readable issues list is derived from each
  // entry's `.error`, not stored as a separate `issues_found` shadow field.
  const details = Array.isArray(payload.rejection_details)
    ? (payload.rejection_details as AcceptanceVerdictDesc["details"])
    : []
  const issues = details.map((d) => (typeof d.error === "string" ? d.error : "")).filter((s) => s.length > 0)
  return {
    iteration: lastIter?.iteration ?? 0,
    verdict: typeof payload.verdict === "string" ? payload.verdict : "unknown",
    summary: typeof payload.summary === "string" ? payload.summary : "",
    issues,
    details,
    verdict_artifact_id: art.id,
  }
}

function describeTerminalGoalRefillNotifications(taskID: string): TerminalGoalRefillNotificationDesc[] {
  return listGoalRefillNotificationArtifacts(taskID, TERMINAL_GOAL_REFILL_PROMPT_CAP).map((row) => {
    const payload = TerminalGoalRefillNotificationPayloadSchema.parse(row.payload)
    if (payload.task_id !== taskID) {
      throw new Error(`goal_refill_notification ${row.id} task_id mismatch: payload=${payload.task_id} query=${taskID}`)
    }
    return {
      artifact_id: row.id,
      run_id: payload.run_id,
      time_created: row.time_created,
      time_dispatched: payload.time_dispatched,
      fingerprint: payload.fingerprint,
      terminal_goal_run: payload.terminal_goal_run,
      live_sibling_goal_runs: payload.live_sibling_goal_runs,
      dispatch_result: payload.dispatch_result,
    }
  })
}

export async function describeTask(taskID: string): Promise<TaskDesc> {
  const task = findTask(taskID)
  if (!task) {
    throw new Error(`describeTask: task ${taskID} not found`)
  }
  return describeTaskFromRow(task)
}

async function describeTaskFromRow(task: TaskRow): Promise<TaskDesc> {
  // Rewind cursor: filters events with time_created > cursor from every
  // derived view below (goal attempts, iterations, verdict). Goals
  // themselves are kept regardless — a rewound task still has its goals
  // visible, just with an empty attempt history if they were all created
  // after the cursor. This matches the UX "go back to before I started."
  const rewindCursor = task.rewind_cursor_time ?? null

  let goalRows = listGoals(task.id)
  if (rewindCursor != null) {
    goalRows = goalRows.filter((g) => (g.time_created ?? 0) <= rewindCursor)
  }
  const goals = goalRows.map((g) => describeGoal(g, rewindCursor))

  let specSummary: string | undefined
  const activeSpec = findActiveSpecForTask(task.id)
  if (activeSpec) {
    specSummary = activeSpec.summary
  }

  // Goal Workload Analyst facts (rule 23: facts only, no gate). The artifact is
  // task-level latest-wins; it is "stale" when it targets a superseded architect
  // snapshot, in which case downstream injection ignores it.
  const workloadArtifact = findLatestGoalWorkloadArtifact(task.id)
  const workloadAnalyzed = workloadArtifact ? true : undefined
  const workloadStale =
    workloadArtifact && activeSpec ? workloadArtifact.spec_snapshot_id !== activeSpec.id || undefined : undefined

  const research = listResearchBriefArtifacts(task.id)
    .slice(0, RESEARCH_BRIEF_DESC_CAP)
    .flatMap((artifact) => {
      const desc = describeResearchBriefArtifact({ task, artifact })
      return desc ? [desc] : []
    })
  const frontendResearch = listFrontendResearchBriefArtifacts(task.id)
    .slice(0, RESEARCH_BRIEF_DESC_CAP)
    .flatMap((artifact) => {
      const desc = describeResearchBriefArtifact({ task, artifact })
      return desc ? [desc] : []
    })
  const frontendDesign = describeFrontendDesignHandoff(task.id)

  let planSummary: string | undefined
  const activePlan = findActivePlanForTask(task.id)
  if (activePlan) {
    planSummary = activePlan.summary
  }

  let activeRunStatus: string | undefined
  let runOrphan: boolean | undefined
  const activeRunForTask = findActiveRunForTask(task.id)
  if (activeRunForTask) {
    activeRunStatus = activeRunForTask.status
    // Fact-only orphan probe from engine/orphan.ts. Phase-7 removed the
    // abort-brake-on-startup path; the LLM reads `run_orphan` and
    // decides whether to retry / restart_from_stage / drop.
    runOrphan = isRunOrphan(task.project_id, activeRunForTask.id)
  }

  const totalRuns = findRuns(task.id).length
  const maxExecutorGroups = await effectiveMaxAgentParallelism(task)
  const fixCount = activeRunForTask?.retry_count ?? 0

  const history = readHistory(task.id)
  const verdict = describeVerdict(task.id)

  // Surface recent orchestrator stream errors so the LLM can read them on
  // the next user-driven wake and decide retry / restart / fail. Runtime
  // restart must not auto-wake active tasks: the overlay restores the task
  // view and waits for a real operator message.
  const streamErrorFloor = task.time_started ?? task.time_created
  const streamErrorRows = listOrchestratorStreamErrorArtifacts(task.id, streamErrorFloor, STREAM_FAILURE_PROMPT_CAP)
  const recentStreamFailures: StreamFailureDesc[] = streamErrorRows.map((row) => {
    const payload = (row.payload ?? {}) as {
      reason?: string
      errorName?: string
      sessionID?: string
    }
    return {
      artifact_id: row.id,
      time_created: row.time_created,
      reason: typeof payload.reason === "string" ? payload.reason : "",
      error_name: typeof payload.errorName === "string" ? payload.errorName : undefined,
      session_id: typeof payload.sessionID === "string" ? payload.sessionID : undefined,
    }
  })
  const toolExecuteRows = listToolExecuteErrorArtifacts(task.id, streamErrorFloor, TOOL_EXECUTE_FAILURE_PROMPT_CAP)
  const recentToolExecuteFailures: ToolExecuteFailureDesc[] = toolExecuteRows.map((row) => {
    const payload = (row.payload ?? {}) as {
      sessionID?: string
      messageID?: string
      partID?: string
      toolName?: string
      callID?: string
      failure?: unknown
    }
    const parsedFailure = ToolFailureCause.safeParse(payload.failure)
    return {
      artifact_id: row.id,
      time_created: row.time_created,
      session_id: typeof payload.sessionID === "string" ? payload.sessionID : undefined,
      message_id: typeof payload.messageID === "string" ? payload.messageID : undefined,
      part_id: typeof payload.partID === "string" ? payload.partID : undefined,
      tool_name: typeof payload.toolName === "string" ? payload.toolName : "",
      call_id: typeof payload.callID === "string" ? payload.callID : "",
      reason: parsedFailure.success ? renderToolFailureCause(parsedFailure.data) : "",
    }
  })

  const agentFailureFloor = task.time_started ?? task.time_created
  const recentAgentFailures: AgentFailureDesc[] = createDecisionLog(task.id)
    .readByPhase("agent_error")
    .filter((entry) => entry.timeCreated >= agentFailureFloor)
    .slice(-AGENT_FAILURE_PROMPT_CAP)
    .reverse()
    .map((entry) => ({
      decision_id: entry.id,
      time_created: entry.timeCreated,
      key: entry.key,
      reason: entry.value,
      goal_id: entry.goalID ?? undefined,
    }))
  const openToolCallsWithoutCurrentOwner = listOpenToolCallsWithoutCurrentOwner(task)
  const recentTerminalGoalRefills = describeTerminalGoalRefillNotifications(task.id)

  // Bootstrap-first signal. Single source — derived from goal status and
  // surfaced as collaboration context. This is not a dispatch gate.
  const activeBootstrap = goalRows.find((g) => g.kind === "bootstrap" && goalStatusByID(g.id) !== "passed")
  const collaborationClosure = buildCollaborationClosure(goals)

  return {
    id: task.id,
    title: task.title,
    kind: task.kind,
    status: deriveTaskStatus(task),
    request: task.request,
    error: task.error ?? undefined,
    spec_summary: specSummary,
    plan_summary: planSummary,
    workload_analyzed: workloadAnalyzed,
    workload_stale: workloadStale,
    research: research.length > 0 ? research : undefined,
    frontend_research: frontendResearch,
    frontend_design: frontendDesign,
    active_run_id: activeRunForTask?.id,
    active_run_status: activeRunStatus,
    run_orphan: runOrphan,
    clarifications: clarificationTranscriptSection(task.id) || undefined,
    operator_notes: operatorNotesSection(task.id) || undefined,
    goals,
    active_bootstrap_goal_id: activeBootstrap?.id,
    collaboration_closure: collaborationClosure,
    budget: {
      runs_used: totalRuns,
      fix_count: fixCount,
      max_executor_groups: maxExecutorGroups,
    },
    recent_verdict: verdict,
    recent_stream_failures: recentStreamFailures.length > 0 ? recentStreamFailures : undefined,
    recent_tool_execute_failures: recentToolExecuteFailures.length > 0 ? recentToolExecuteFailures : undefined,
    open_tool_calls_without_current_owner:
      openToolCallsWithoutCurrentOwner.length > 0 ? openToolCallsWithoutCurrentOwner : undefined,
    recent_terminal_goal_refills: recentTerminalGoalRefills.length > 0 ? recentTerminalGoalRefills : undefined,
    recent_agent_failures: recentAgentFailures.length > 0 ? recentAgentFailures : undefined,
    iterations_count: history.length,
  }
}

// ---------------------------------------------------------------------------
// Markdown rendering — the orchestrator prompt consumes this directly.
// ---------------------------------------------------------------------------

function describeDerivedState(g: GoalDesc): string {
  const flags: string[] = []
  if (g.never_dispatched) flags.push("never_dispatched")
  if (g.is_orphaned) flags.push("ORPHANED(owner process restarted — mid-stream execution context is gone)")
  if (g.is_running) flags.push("running")
  if (g.is_terminal_ok) flags.push("terminal_ok")
  if (g.is_terminal_fail) flags.push("terminal_fail")
  if (g.is_aborted) flags.push("aborted")
  if (g.needs_redispatch) flags.push(`NEEDS_REDISPATCH(${g.latest_attempt?.superseded_reason})`)
  return flags.length > 0 ? flags.join(", ") : "unknown"
}

export function renderGoal(g: GoalDesc): string[] {
  const lines: string[] = []
  const requirementIDs = g.requirement_ids ?? []
  lines.push(`### Goal ${g.id}: ${g.title} [${g.priority}, ${g.kind}]`)
  lines.push(`Objective: ${g.objective}`)
  if (requirementIDs.length > 0) lines.push(`Requirement IDs: ${requirementIDs.join(", ")}`)
  if (g.owned_paths.length > 0) lines.push(`Responsibility paths: ${g.owned_paths.join(", ")}`)
  if (g.depends_on.length > 0) lines.push(`Depends on: ${g.depends_on.join(", ")}`)
  if (g.acceptance_summary) lines.push(`Acceptance (first 300): ${g.acceptance_summary}`)
  lines.push(`State: ${describeDerivedState(g)}`)

  if (g.attempts.length > 0) {
    lines.push(`Attempts (${g.attempt_count}):`)
    for (const [i, a] of g.attempts.entries()) {
      const parts: string[] = [`#${i + 1} run=${a.goal_run_id} outcome=${a.outcome}`]
      if (a.duration_ms !== undefined) parts.push(`duration=${a.duration_ms}ms`)
      if (a.session_id) parts.push(`session=${a.session_id}`)
      if (a.superseded_reason) parts.push(`superseded_reason=${a.superseded_reason}`)
      if (a.error) parts.push(`error=${truncate(a.error, 120)}`)
      if (a.blocking_reason) parts.push(`blocked=${truncate(a.blocking_reason, 80)}`)
      lines.push(`  ${parts.join(" | ")}`)
      const recoveryHint = buildAttemptRecoveryHint(a.error)
      if (recoveryHint) lines.push(`    recovery_hint=${recoveryHint}`)
    }
  } else {
    lines.push(`Attempts: (none — goal has never dispatched)`)
  }

  return lines
}

export function renderTerminalGoalRefillNotifications(
  refills: TerminalGoalRefillNotificationDesc[] | undefined,
): string[] {
  if (!refills || refills.length === 0) return []
  const lines: string[] = []
  lines.push(`## Terminal goal refill wake facts (${refills.length})`)
  for (const refill of refills) {
    const ts = new Date(refill.time_dispatched).toISOString()
    const liveSiblings =
      refill.live_sibling_goal_runs.length > 0
        ? refill.live_sibling_goal_runs.map((goalRun) => `${goalRun.id}:${goalRun.status}`).join(", ")
        : "(none)"
    lines.push(
      `- ${ts} run=${refill.run_id} dispatch=${refill.dispatch_result} fingerprint=${refill.fingerprint} terminal=${refill.terminal_goal_run.id}:${refill.terminal_goal_run.status} live_siblings=${liveSiblings} artifact=${refill.artifact_id}`,
    )
  }
  lines.push(
    `Each entry means a terminal goal completion already started an orchestrator refill wake. ` +
      `Use this as current execution evidence; do not wait for sibling goals merely because the refill wake has not produced a later decision yet.`,
  )
  return lines
}

function buildAttemptRecoveryHint(error?: string): string | undefined {
  if (!error) return undefined
  if (!error.includes("report_build_result") && !error.includes("missing_terminal_report")) return undefined
  return "Build ended without a structured report_build_result terminal call. The retained goal worktree is diagnostic under .opencorvus/r, not primary workspace pollution. Retry this goal with explicit report_build_result(files_changed[]) instructions; do not restart_from_stage solely because diagnostic worktree files exist."
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + "…"
}

export function renderCollaborationClosure(
  desc: CollaborationClosureDesc | undefined,
  goals: GoalDesc[],
  options: { autoIteration?: boolean } = {},
): string[] {
  if (!desc) return []
  const autoIteration = options.autoIteration === true

  const lines: string[] = []
  const titleByID = new Map(goals.map((goal) => [goal.id, goal.title]))
  lines.push("## Collaboration Closure")
  lines.push(`Execution attempts recorded: ${desc.attempts_count}`)

  if (desc.execution_started) {
    lines.push(
      "The active goal graph has entered execution. Treat it as the shared collaboration contract, not a scratchpad to re-plan for ordinary shared-file edits.",
    )
    lines.push(
      "Ordinary collaboration drift belongs in Build `files_changed[]` reports and, when the written contract needs a point correction, `modify_goal`. Architect re-entry is structural re-planning and needs acceptance/reference-coverage evidence or an explicit upstream restart.",
    )
  } else {
    lines.push("Execution has not started yet; this is still the planning window.")
  }

  if (desc.passed_goal_ids.length > 0) {
    lines.push(
      `Passed goals: ${desc.passed_goal_ids.map((id) => `${id} (${titleByID.get(id) ?? "untitled"})`).join(", ")}`,
    )
  }

  if (desc.failed_goal_ids.length > 0) {
    lines.push("Failed goals requiring same-graph diagnosis:")
    for (const goalID of desc.failed_goal_ids) {
      lines.push(`- ${goalID}: ${titleByID.get(goalID) ?? "untitled"}`)
    }
    if (autoIteration) {
      lines.push(
        "assistant.auto_iteration=true: Failed goals stay inside the current collaboration closure. Read `query_failed_goals`, then retry `build({ goalID })` or apply `modify_goal` when the contract itself needs a point correction. Do not restart upstream merely because a Build attempt failed or a failed worktree contains partial files.",
      )
    } else {
      lines.push(
        "assistant.auto_iteration=false: no host-side retry loop is queued automatically, but the orchestrator turn still owns same-task recovery. Read `query_failed_goals`, then route repair through `build({ goalID, request })`, `modify_goal`, or `architect`; ask the operator only for external/destructive blockers. Do not restart upstream merely because a Build attempt failed or a failed worktree contains partial files.",
      )
    }
  }

  if (desc.dispatchable_goal_ids.length > 0) {
    lines.push("Next dispatchable goals:")
    for (const goalID of desc.dispatchable_goal_ids) {
      lines.push(`- ${goalID}: ${titleByID.get(goalID) ?? "untitled"}`)
    }
  } else {
    lines.push("Next dispatchable goals: none derived from current dependency evidence.")
  }

  if (desc.blocked_goals.length > 0) {
    lines.push("Dependency-blocked goals:")
    for (const blocked of desc.blocked_goals) {
      const blockers = blocked.blocked_by.map((dep) => `${dep.goal_id} [${dep.status}]`).join(", ")
      lines.push(`- ${blocked.goal_id}: blocked by ${blockers}`)
    }
  }

  return lines
}

/**
 * Render a TaskDesc as markdown suitable for direct injection into the
 * orchestrator's system prompt. LLM reads this instead of querying piecemeal.
 */
export function renderTaskDescription(desc: TaskDesc, options: { autoIteration?: boolean } = {}): string {
  const lines: string[] = []
  lines.push(`## Task: ${desc.title} (${desc.status})`)
  lines.push(`Kind: ${desc.kind}`)
  lines.push(renderUserRequestSection({ heading: "## Request", request: desc.request, taskID: desc.id }))
  if (desc.spec_summary) lines.push(`Spec: ${desc.spec_summary}`)
  if (desc.plan_summary) lines.push(`Plan: ${desc.plan_summary}`)
  lines.push(...renderResearchBriefDescs("Deep Research Brief", desc.research))
  lines.push(...renderResearchBriefDescs("Frontend Research Brief", desc.frontend_research))
  lines.push(...renderFrontendDesignHandoffDesc(desc.frontend_design))
  if (desc.active_run_id) {
    const orphanTag = desc.run_orphan ? " ORPHAN" : ""
    lines.push(
      `Active run: ${desc.active_run_id}${desc.active_run_status ? ` (${desc.active_run_status})` : ""}${orphanTag}`,
    )
    if (desc.run_orphan) {
      lines.push(
        `Note: this run has no live executor — the owner process was restarted. ` +
          `The next decision should treat it as abandoned (retry, restart_from_stage, ` +
          `or drop) rather than assuming it is still progressing.`,
      )
    }
  }
  if (desc.error) lines.push(`Error: ${desc.error}`)
  lines.push(
    `Runtime facts: ${desc.budget.runs_used} run(s) recorded, ` +
      `${desc.budget.fix_count} fix attempt(s) on the active run, ` +
      `${desc.iterations_count} acceptance iteration(s), ` +
      `workload_analysis=${desc.workload_stale ? "stale" : desc.workload_analyzed ? "current" : "not_run"}, ` +
      `agent_parallelism=${desc.budget.max_executor_groups}.`,
  )
  lines.push(
    "No numeric run/fix budget is enforced by the host. Decide whether to continue, change strategy, ask the operator, or fail_task from the evidence above and below.",
  )

  const closureLines = renderCollaborationClosure(desc.collaboration_closure, desc.goals, options)
  if (closureLines.length > 0) {
    lines.push("")
    lines.push(...closureLines)
  }

  const terminalGoalRefillLines = renderTerminalGoalRefillNotifications(desc.recent_terminal_goal_refills)
  if (terminalGoalRefillLines.length > 0) {
    lines.push("")
    lines.push(...terminalGoalRefillLines)
  }

  if (desc.clarifications) {
    lines.push("")
    lines.push(desc.clarifications)
  }
  if (desc.operator_notes) {
    lines.push("")
    lines.push(desc.operator_notes)
  }

  lines.push("")
  if (desc.goals.length === 0) {
    lines.push("## Goals (none authored yet)")
  } else {
    lines.push(`## Goals (${desc.goals.length})`)
    if (desc.active_bootstrap_goal_id) {
      // Physical-fact framing: state the collaboration risk, then let the
      // orchestrator decide. No hidden dispatch gate sits behind this text.
      lines.push("")
      lines.push(
        `**Bootstrap-first dispatch order**: goal \`${desc.active_bootstrap_goal_id}\` ` +
          `(\`kind=bootstrap\`) is not yet \`passed\`. Bootstrap goals own ` +
          `scaffold-level files (\`package.json\`, \`vite.config.ts\`/\`bunfig.toml\`, ` +
          `\`tsconfig.json\`, \`src/main.*\`, \`src/App.*\`); every other goal ` +
          `would inevitably touch those files on its worktree, producing ` +
          `coordination risk at merge and acceptance time. Plan deliberately: ` +
          `dispatch the bootstrap goal first when the scaffold is not yet real, ` +
          `or dispatch another goal only when its prompt and files_changed[] ` +
          `can explain how it cooperates with the shared scaffold milestone.`,
      )
    }
    for (const g of desc.goals) {
      lines.push("")
      lines.push(...renderGoal(g))
    }
  }

  if (desc.recent_stream_failures && desc.recent_stream_failures.length > 0) {
    lines.push("")
    lines.push(`## Recent orchestrator stream failures (${desc.recent_stream_failures.length})`)
    const hasNoDecisionFailure = desc.recent_stream_failures.some(
      (f) => f.error_name === "OrchestratorNoDecisionStopError",
    )
    for (const f of desc.recent_stream_failures) {
      const ts = new Date(f.time_created).toISOString()
      const tag = f.error_name ? `[${f.error_name}] ` : ""
      lines.push(`- ${ts} ${tag}${truncate(f.reason, 240)}`)
    }
    if (hasNoDecisionFailure) {
      lines.push(
        `Entries tagged \`OrchestratorNoDecisionStopError\` are decision-contract failures: ` +
          `the stream completed, but the orchestrator stopped without a workflow decision. ` +
          `Continue from current task state and make a real workflow decision; do not treat ` +
          `those entries as provider/network failures.`,
      )
    }
    lines.push(
      `Other entries are upstream LLM-call failures that aborted a wake before any decision ` +
        `was made. Use those entries to decide: \`retry_task\` (transient network/idle blip), ` +
        `\`restart_from_stage\` (config-level — wrong provider/key), or \`fail_task\` ` +
        `(permanent — quota exhausted, key revoked, model gone).`,
    )
  }

  if (desc.open_tool_calls_without_current_owner && desc.open_tool_calls_without_current_owner.length > 0) {
    lines.push("")
    lines.push(
      `## Open tool calls without current process owner (${desc.open_tool_calls_without_current_owner.length})`,
    )
    for (const f of desc.open_tool_calls_without_current_owner) {
      const ts = new Date(f.time_created).toISOString()
      lines.push(
        `- ${ts} ${f.tool_name} status=${f.status} call=${f.call_id} session=${f.session_id} kind=${f.session_kind} message=${f.message_id} part=${f.part_id}`,
      )
    }
    lines.push(
      `Each entry is a persisted assistant tool call in this task's session tree with no terminal tool result ` +
        `and no current-process session owner. Treat it as execution evidence from a previous interrupted wake; ` +
        `decide whether to retry_task, re-dispatch the relevant tool/work, restart_from_stage, fail_task, or ask ` +
        `the operator from the full task context.`,
    )
  }

  if (desc.recent_agent_failures && desc.recent_agent_failures.length > 0) {
    lines.push("")
    lines.push(`## Recent agent session failures (${desc.recent_agent_failures.length})`)
    for (const f of desc.recent_agent_failures) {
      const ts = new Date(f.time_created).toISOString()
      const goal = f.goal_id ? ` goal=${f.goal_id}` : ""
      lines.push(`- ${ts} ${f.key}${goal}: ${truncate(f.reason, 360)}`)
    }
    lines.push(
      `These entries are failed agent/tool sessions made visible to this prompt. ` +
        `Treat quota/network/provider failures as failed attempts of the current task or goal; ` +
        `retry the same work, change provider, or fail_task from this evidence. ` +
        `Do not infer a fresh task start merely because the latest user wake repeats the original request.`,
    )
  }

  if (desc.recent_tool_execute_failures && desc.recent_tool_execute_failures.length > 0) {
    lines.push("")
    lines.push(`## Recent tool execution failures (${desc.recent_tool_execute_failures.length})`)
    for (const f of desc.recent_tool_execute_failures) {
      const ts = new Date(f.time_created).toISOString()
      const session = f.session_id ? ` session=${f.session_id}` : ""
      lines.push(`- ${ts} ${f.tool_name} call=${f.call_id}${session}: ${truncate(f.reason, 360)}`)
    }
    lines.push(
      `These entries are persisted tool-call failures with the original ToolFailureCause. ` +
        `Use them as audit evidence for retry_task, restart_from_stage, or fail_task decisions.`,
    )
  }

  if (desc.recent_verdict) {
    const v = desc.recent_verdict
    lines.push("")
    lines.push(`## Latest Acceptance Verdict (iteration ${v.iteration})`)
    lines.push(`Verdict: ${v.verdict}`)
    if (v.summary) lines.push(`Summary: ${truncate(v.summary, 800)}`)
    if (v.issues.length > 0) {
      lines.push(`Issues (${v.issues.length}):`)
      for (const issue of v.issues) lines.push(`  - ${truncate(issue, 200)}`)
    }
    if (v.details.length > 0) {
      lines.push(`Structured details:`)
      for (const d of v.details) {
        const filePart = d.file ? ` [${d.file}]` : ""
        const catPart = d.category ? `[${d.category}]` : ""
        const sugPart = d.suggestion ? ` → ${truncate(d.suggestion, 160)}` : ""
        lines.push(`  - ${catPart}${filePart}: ${truncate(d.error, 160)}${sugPart}`)
      }
    }
  }

  return lines.join("\n")
}

function renderResearchBriefDesc(title: string, desc?: ResearchBriefDesc): string[] {
  if (!desc) return []
  const lines: string[] = []
  lines.push("")
  lines.push(`## ${title}`)
  lines.push(`- artifact_id: ${desc.artifact_id}`)
  lines.push(`- session_id: ${desc.session_id}`)
  lines.push(`- stale: ${desc.stale ? "true" : "false"}`)
  if (desc.stale_reasons.length > 0) {
    lines.push(`- stale_reasons: ${desc.stale_reasons.join(", ")}`)
  }
  if (desc.source_urls.length > 0) lines.push(`- source_urls: ${desc.source_urls.join(", ")}`)
  lines.push(
    `- coverage: sources=${desc.source_count}, facts=${desc.fact_count}, blocking_open_questions=${desc.blocking_open_question_count}`,
  )
  lines.push(`- bundle_paths: ${desc.bundle_paths.join(", ")}`)
  lines.push(`- summary_json: ${JSON.stringify(truncate(desc.summary, 800))}`)
  lines.push(
    "Research is advisory evidence only. It is not a route selector; choose the next tool from full task context.",
  )
  return lines
}

function renderResearchBriefDescs(title: string, descs?: ResearchBriefDesc[]): string[] {
  if (!descs || descs.length === 0) return []
  if (descs.length === 1) return renderResearchBriefDesc(title, descs[0]!)
  return descs.flatMap((desc, index) => renderResearchBriefDesc(`${title} ${index + 1}/${descs.length}`, desc))
}

function renderFrontendDesignHandoffDesc(desc?: FrontendDesignHandoffDesc): string[] {
  if (!desc) return []
  const lines: string[] = []
  lines.push("")
  lines.push("## Frontend Design Handoff")
  lines.push(`- is_complete: ${desc.is_complete ? "true" : "false"}`)
  lines.push(`- has_public_report: ${desc.has_public_report ? "true" : "false"}`)
  lines.push(`- has_evidence_source_manifest: ${desc.has_evidence_source_manifest ? "true" : "false"}`)
  if (desc.frontend_template_path) lines.push(`- frontend_template_path: ${desc.frontend_template_path}`)
  if (desc.source_manifest_path) lines.push(`- source_manifest_path: ${desc.source_manifest_path}`)
  lines.push(`- latest_decision_id: ${desc.latest_decision_id}`)
  lines.push(`- latest_updated_at: ${new Date(desc.latest_updated_at).toISOString()}`)
  if (desc.public_report_decision_id) lines.push(`- public_report_decision_id: ${desc.public_report_decision_id}`)
  if (desc.evidence_source_manifest_decision_id) {
    lines.push(`- evidence_source_manifest_decision_id: ${desc.evidence_source_manifest_decision_id}`)
  }
  lines.push(`- present_keys: ${desc.present_keys.join(", ")}`)
  lines.push(
    `- missing_completion_keys: ${
      desc.missing_completion_keys.length > 0 ? desc.missing_completion_keys.join(", ") : "(none)"
    }`,
  )
  if (desc.is_complete) {
    lines.push(
      "Frontend design is complete durable task-scope handoff evidence. Consume these report and manifest pointers for downstream requirements, architect, build, visual QA, and integrity decisions instead of reacquiring the same frontend_design scope.",
    )
  } else {
    lines.push(
      "Frontend design is partial durable task-scope evidence. Missing completion keys above are the concrete recovery evidence if this scope needs frontend_design continuation.",
    )
  }
  return lines
}
