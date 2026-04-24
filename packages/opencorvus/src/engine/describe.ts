/**
 * Describe layer — project a task / goal's CURRENT STATE from the event stream.
 *
 * This is the single read-path the orchestrator LLM uses to see "what's going
 * on." It composes an LLM-readable snapshot from append-only events:
 *   - engine_goal_run (attempt history, immutable)
 *   - engine_iteration (delivery arbiter trajectory)
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
import { readIterationHistory as readHistory } from "@/metrics/store"
import { deriveGoalStatus } from "./goal-status"
import { isRunOrphan } from "./recovery"

/** Derived goal status enum — returned by goalStatusByID / statusOf.
 *  The column it used to shadow (engine_goal.status) is gone; this is
 *  the function-return type for the live derivation. */
export type EngineGoalStatus = "pending" | "running" | "passed" | "failed"
import {
  effectiveMaxFixRuns,
  effectiveMaxRuns,
  clarificationTranscriptSection,
  operatorNotesSection,
} from "./helpers"
import {
  findActivePlanForTask,
  findActiveRunForTask,
  findActiveSpecForTask,
  findLatestDeliveryVerdictArtifact,
  findRun,
  findRuns,
  findTask,
  listGoalRunsByGoal,
  listGoals,
  type GoalRow,
  type GoalRunRow,
  type TaskRow,
} from "./store"

const LIVE_STATES = new Set(["queued", "accepted", "planning", "running", "evaluating", "blocked"])
const TERMINAL_OK_STATES = new Set(["completed"])
const TERMINAL_FAIL_STATES = new Set(["failed"])
const TERMINAL_ABORTED_STATES = new Set(["aborted"])

// ---------------------------------------------------------------------------
// Structured description types (exported for tests / UI)
// ---------------------------------------------------------------------------

export interface GoalAttemptSummary {
  goal_run_id: string
  /** FSM status of this particular goal_run row (immutable once terminal). */
  outcome: string
  /** If non-null, this attempt was itself superseded by a newer one — the
   *  typed reason names why (delivery_rework / manual_retry / modify_contract /
   *  restart_stage). Terminal + superseded_reason means "redispatchable." */
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
  owned_paths: string[]
  depends_on: string[]
  exports: string[]
  imports: string[]
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
}

export interface DeliveryVerdictDesc {
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
  status: string
  request: string
  error?: string
  spec_summary?: string
  plan_summary?: string
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
  budget: {
    runs_used: number
    max_runs: number
    fix_count: number
    max_fix_runs: number
  }
  recent_verdict?: DeliveryVerdictDesc
  iterations_count: number
}

// ---------------------------------------------------------------------------
// Goal description
// ---------------------------------------------------------------------------

function describeAttempt(row: GoalRunRow): GoalAttemptSummary {
  const durationMs = row.time_started && row.time_completed
    ? row.time_completed - row.time_started
    : undefined
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
  const supersededIDs = new Set(
    rows.map((r) => r.supersede_of).filter((x): x is string => !!x),
  )
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
    owned_paths: (goal.owned_paths ?? []) as string[],
    depends_on: (goal.depends_on ?? []) as string[],
    exports: (goal.exports ?? []) as string[],
    imports: (goal.imports ?? []) as string[],
    attempts,
    attempt_count: attempts.length,
    latest_attempt: latest,
    is_running: tipIsLive,
    is_terminal_ok: tipIsOk && !tipHasRedispatchIntent,
    is_terminal_fail: tipIsFail && !tipHasRedispatchIntent,
    is_aborted: tipIsAborted && !tipHasRedispatchIntent,
    needs_redispatch: isTerminal && tipHasRedispatchIntent,
    never_dispatched: rows.length === 0,
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

// ---------------------------------------------------------------------------
// Task description
// ---------------------------------------------------------------------------

function describeVerdict(taskID: string): DeliveryVerdictDesc | undefined {
  const art = findLatestDeliveryVerdictArtifact(taskID)
  if (!art) return undefined
  const payload = (art.payload ?? {}) as Record<string, unknown>
  const history = readHistory(taskID)
  const lastIter = history[history.length - 1]
  return {
    iteration: lastIter?.iteration ?? 0,
    verdict: typeof payload.verdict === "string" ? payload.verdict : "unknown",
    summary: typeof payload.summary === "string" ? payload.summary : "",
    issues: Array.isArray(payload.issues_found) ? (payload.issues_found as string[]) : [],
    details: Array.isArray(payload.rejection_details)
      ? (payload.rejection_details as DeliveryVerdictDesc["details"])
      : [],
    verdict_artifact_id: art.id,
  }
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
    // Fact-only orphan probe. Does not write the run's status — the abort
    // brake in engine/recovery.ts#cleanupOrphanExecutionArtifacts still
    // handles the physical teardown during process startup.
    runOrphan = isRunOrphan(task.project_id, activeRunForTask.id)
  }

  const totalRuns = findRuns(task.id).length
  const [maxRuns, maxFixRuns] = await Promise.all([
    effectiveMaxRuns(task),
    effectiveMaxFixRuns(task),
  ])
  const fixCount = activeRunForTask?.retry_count ?? 0

  const history = readHistory(task.id)
  const verdict = describeVerdict(task.id)

  return {
    id: task.id,
    title: task.title,
    status: task.status,
    request: task.request,
    error: task.error ?? undefined,
    spec_summary: specSummary,
    plan_summary: planSummary,
    active_run_id: activeRunForTask?.id,
    active_run_status: activeRunStatus,
    run_orphan: runOrphan,
    clarifications: clarificationTranscriptSection(task.id) || undefined,
    operator_notes: operatorNotesSection(task.id) || undefined,
    goals,
    budget: {
      runs_used: totalRuns,
      max_runs: maxRuns,
      fix_count: fixCount,
      max_fix_runs: maxFixRuns,
    },
    recent_verdict: verdict,
    iterations_count: history.length,
  }
}

// ---------------------------------------------------------------------------
// Markdown rendering — the orchestrator prompt consumes this directly.
// ---------------------------------------------------------------------------

function describeDerivedState(g: GoalDesc): string {
  const flags: string[] = []
  if (g.never_dispatched) flags.push("never_dispatched")
  if (g.is_running) flags.push("running")
  if (g.is_terminal_ok) flags.push("terminal_ok")
  if (g.is_terminal_fail) flags.push("terminal_fail")
  if (g.is_aborted) flags.push("aborted")
  if (g.needs_redispatch) flags.push(`NEEDS_REDISPATCH(${g.latest_attempt?.superseded_reason})`)
  return flags.length > 0 ? flags.join(", ") : "unknown"
}

function renderGoal(g: GoalDesc): string[] {
  const lines: string[] = []
  lines.push(`### Goal ${g.id}: ${g.title} [${g.priority}, ${g.kind}]`)
  lines.push(`Objective: ${g.objective}`)
  if (g.owned_paths.length > 0) lines.push(`Owned paths: ${g.owned_paths.join(", ")}`)
  if (g.depends_on.length > 0) lines.push(`Depends on: ${g.depends_on.join(", ")}`)
  if (g.exports.length > 0) lines.push(`Exports: ${g.exports.join(", ")}`)
  if (g.imports.length > 0) lines.push(`Imports: ${g.imports.join(", ")}`)
  if (g.acceptance_summary) lines.push(`Acceptance (first 300): ${g.acceptance_summary}`)
  lines.push(`State: ${describeDerivedState(g)}`)

  if (g.attempts.length > 0) {
    lines.push(`Attempts (${g.attempt_count}):`)
    for (const [i, a] of g.attempts.entries()) {
      const parts: string[] = [`#${i + 1} run=${a.goal_run_id} outcome=${a.outcome}`]
      if (a.duration_ms !== undefined) parts.push(`duration=${a.duration_ms}ms`)
      if (a.superseded_reason) parts.push(`superseded_reason=${a.superseded_reason}`)
      if (a.error) parts.push(`error=${truncate(a.error, 120)}`)
      if (a.blocking_reason) parts.push(`blocked=${truncate(a.blocking_reason, 80)}`)
      lines.push(`  ${parts.join(" | ")}`)
    }
  } else {
    lines.push(`Attempts: (none — goal has never dispatched)`)
  }

  return lines
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text
  return text.slice(0, max - 1) + "…"
}

/**
 * Render a TaskDesc as markdown suitable for direct injection into the
 * orchestrator's system prompt. LLM reads this instead of querying piecemeal.
 */
export function renderTaskDescription(desc: TaskDesc): string {
  const lines: string[] = []
  lines.push(`## Task: ${desc.title} (${desc.status})`)
  lines.push(`Request: ${truncate(desc.request, 2000)}`)
  if (desc.spec_summary) lines.push(`Spec: ${desc.spec_summary}`)
  if (desc.plan_summary) lines.push(`Plan: ${desc.plan_summary}`)
  if (desc.active_run_id) {
    const orphanTag = desc.run_orphan ? " ORPHAN" : ""
    lines.push(`Active run: ${desc.active_run_id}${desc.active_run_status ? ` (${desc.active_run_status})` : ""}${orphanTag}`)
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
    `Budget: ${desc.budget.runs_used}/${desc.budget.max_runs} runs, ` +
      `${desc.budget.fix_count}/${desc.budget.max_fix_runs} fixes, ` +
      `${desc.iterations_count} delivery iterations`,
  )

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
    for (const g of desc.goals) {
      lines.push("")
      lines.push(...renderGoal(g))
    }
  }

  if (desc.recent_verdict) {
    const v = desc.recent_verdict
    lines.push("")
    lines.push(`## Latest Delivery Verdict (iteration ${v.iteration})`)
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
