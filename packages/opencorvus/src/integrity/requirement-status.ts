/**
 * Requirement Status Snapshot — pure DB projection from REQ rows to claiming
 * goals to tip goal_run + per-spec scorer outcomes. Used by integrity review
 * to feed the LLM real end-to-end completion evidence post-build.
 *
 * Rule 6.1: this file PROJECTS data and does NOT compute completion verdicts.
 * No "done" / "partial" / "not_done" aggregate is calculated here — that's the
 * LLM's job inside the integrity prompt. The host's only responsibility is to
 * lay out raw REQ → goal → run → spec evidence faithfully.
 *
 * Join chain:
 *   1. engine_requirement rows for the spec snapshot. Visible REQ-N is in
 *      `metadata.source_requirement_id`; fall back to `row.id` only when
 *      missing (mirrors orchestrator/tools.ts:1368-1376 mapping).
 *   2. engine_goal rows for the task filtered by spec_snapshot_id; for each
 *      REQ-N, claiming goals are those whose `requirement_ids` array contains
 *      the visible REQ-N id.
 *   3. For each claiming goal: `findLatestTipGoalRun(goalID)` gives the live
 *      tip's status (NOT a stale superseded run's evidence). When the tip
 *      exists, `findGoalRunEvidence(tipRun.id)` returns the verification-evidence
 *      artifact written for THAT run.
 *   4. For each REQ-N × claiming goal pair: filter the goal's `acceptance_specs`
 *      JSON to specs whose `source_requirement_id == REQ-N`, then index the
 *      evidence's `checks[]` by `spec_id` (which equals the AcceptanceSpec.id,
 *      NOT the REQ id) and look up each spec's pass/fail outcome.
 */
import type { AcceptanceSpec } from "@/acceptance/types"
import type { EngineGoalRunStatus } from "@/engine/engine.sql"
import {
  findLatestTipGoalRun as defaultFindLatestTipGoalRun,
  findRequirements as defaultFindRequirements,
  listGoals as defaultListGoals,
  type RequirementRow,
} from "@/engine/store"
import { findGoalRunEvidence as defaultFindGoalRunEvidence } from "@/verification/persist"

export type RequirementSnapshotRunStatus = EngineGoalRunStatus | "unstarted"

export interface RequirementSpecOutcome {
  /** AcceptanceSpec.id, e.g. "acc-fe-1". This is what evidence.checks[].spec_id
   *  matches — NOT the REQ id. */
  specID: string
  severity: AcceptanceSpec["severity"]
  /** undefined when the spec has no evidence for this run (e.g. evaluator never
   *  ran the scorer, or the run is queued/running and has not produced
   *  evidence yet). true ⇔ checks[].status === "passed", false ⇔ "failed";
   *  "skipped" maps to undefined. */
  passed?: boolean
  /** Short human-readable summary of the check outcome (`evidence` field on
   *  EngineEvaluationCheck), if present. Truncated to keep the prompt small. */
  summary?: string
}

export interface RequirementClaimingGoal {
  goalID: string
  goalTitle: string
  /** EngineGoalRunStatus from the tip goal_run row, OR "unstarted" when no
   *  goal_run exists yet for this goal. */
  runStatus: RequirementSnapshotRunStatus
  /** Per-spec outcomes for acceptance_specs whose source_requirement_id matches
   *  this row's REQ-N. Empty array means the goal claims the REQ (via
   *  requirement_ids) but has no acceptance_specs scoped to it — itself a
   *  fidelity signal the LLM should pick up. */
  specOutcomes: RequirementSpecOutcome[]
}

export interface RequirementStatusRow {
  /** Visible REQ-N — extracted from metadata.source_requirement_id, or the
   *  internal id when metadata is missing. */
  reqID: string
  reqDescription: string
  /** Goals whose `requirement_ids` claim this REQ. May be empty when no goal
   *  claims the REQ (the fidelity reviewer should still see it as `uncovered`
   *  via the regular Requirements section). */
  claimingGoals: RequirementClaimingGoal[]
}

/**
 * Extract the visible REQ-N id from a requirement row. Mirrors the existing
 * pattern in orchestrator/tools.ts that runs ahead of `reviewIntegrity`.
 * Engine internally generates a unique id; the user-facing REQ-N (the one that
 * appears in goal.requirement_ids and AcceptanceSpec.source_requirement_id)
 * is preserved in metadata.source_requirement_id.
 */
export function extractVisibleReqID(row: RequirementRow): string {
  const meta = (row.metadata ?? {}) as Record<string, unknown>
  const source = typeof meta.source_requirement_id === "string" ? meta.source_requirement_id : undefined
  return source ?? row.id
}

function parseAcceptanceSpecs(raw: unknown): AcceptanceSpec[] {
  if (Array.isArray(raw)) return raw as AcceptanceSpec[]
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as AcceptanceSpec[]) : []
    } catch {
      return []
    }
  }
  return []
}

function parseRequirementIDs(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((x): x is string => typeof x === "string")
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw)
      return Array.isArray(parsed) ? (parsed as unknown[]).filter((x): x is string => typeof x === "string") : []
    } catch {
      return []
    }
  }
  return []
}

function summaryClip(text: string | undefined, max = 120): string | undefined {
  if (!text) return undefined
  return text.length > max ? text.slice(0, max - 1) + "…" : text
}

/**
 * Compute the post-build REQ status snapshot for a given (taskID, specSnapshotID).
 *
 * Returns an empty array when there are no REQ rows on the snapshot — pre-build
 * (no Requirements yet) and trivially-empty cases both flow through the same
 * empty-array path; the prompt renderer omits the snapshot section entirely
 * when this is empty.
 *
 * NOTE: callers may also legitimately get a non-empty array where every REQ has
 * `claimingGoals: []` (no goal claims the REQ) or every claiming goal has
 * `runStatus: "unstarted"` (snapshot exists but build has not started). The
 * orchestrator inspects the snapshot to decide pre_build vs post_build phase
 * for `recordIntegrityAttempt`; this projection itself is phase-agnostic.
 */
export interface RequirementStatusDeps {
  findRequirements: typeof defaultFindRequirements
  listGoals: typeof defaultListGoals
  findLatestTipGoalRun: typeof defaultFindLatestTipGoalRun
  findGoalRunEvidence: typeof defaultFindGoalRunEvidence
}

export function computeRequirementStatusSnapshot(
  input: {
    taskID: string
    specSnapshotID: string
  },
  // Deps are injectable so unit tests don't have to `mock.module(@/engine/store)`
  // (which leaks across files in Bun's pooled test runner). Production callers
  // omit `deps` and inherit the real DB-backed implementations; tests pass an
  // explicit object with stubbed projections.
  deps: RequirementStatusDeps = {
    findRequirements: defaultFindRequirements,
    listGoals: defaultListGoals,
    findLatestTipGoalRun: defaultFindLatestTipGoalRun,
    findGoalRunEvidence: defaultFindGoalRunEvidence,
  },
): RequirementStatusRow[] {
  const { findRequirements, listGoals, findLatestTipGoalRun, findGoalRunEvidence } = deps
  const reqRows = findRequirements(input.specSnapshotID)
  if (reqRows.length === 0) return []

  const goalsForSnapshot = listGoals(input.taskID).filter((g) => g.spec_snapshot_id === input.specSnapshotID)

  // Memoize tip goal_run + evidence per goalID — multiple REQs may share a
  // claiming goal and we must NOT re-query the artifact stream per pair.
  const tipRunCache = new Map<string, ReturnType<typeof findLatestTipGoalRun>>()
  const evidenceCache = new Map<string, ReturnType<typeof findGoalRunEvidence>>()

  const out: RequirementStatusRow[] = []
  for (const reqRow of reqRows) {
    const reqID = extractVisibleReqID(reqRow)
    const claimingGoals: RequirementClaimingGoal[] = []
    for (const goal of goalsForSnapshot) {
      const goalReqIDs = parseRequirementIDs(goal.requirement_ids)
      if (!goalReqIDs.includes(reqID)) continue

      let tip = tipRunCache.get(goal.id)
      if (tip === undefined && !tipRunCache.has(goal.id)) {
        tip = findLatestTipGoalRun(goal.id)
        tipRunCache.set(goal.id, tip)
      }

      const runStatus: RequirementSnapshotRunStatus = tip ? tip.status : "unstarted"

      let evidence: ReturnType<typeof findGoalRunEvidence> | undefined
      if (tip) {
        evidence = evidenceCache.get(tip.id)
        if (evidence === undefined && !evidenceCache.has(tip.id)) {
          evidence = findGoalRunEvidence(tip.id)
          evidenceCache.set(tip.id, evidence)
        }
      }

      const specs = parseAcceptanceSpecs(goal.acceptance_specs)
      const relatedSpecs = specs.filter((s) => s.source_requirement_id === reqID)

      const checksBySpec = new Map<string, { passed?: boolean; summary?: string }>()
      const checks = evidence?.checks ?? []
      for (const c of checks) {
        if (!c.spec_id) continue
        const passed = c.status === "passed" ? true : c.status === "failed" ? false : undefined
        checksBySpec.set(c.spec_id, { passed, summary: summaryClip(c.evidence) })
      }

      const specOutcomes: RequirementSpecOutcome[] = relatedSpecs.map((s) => {
        const outcome = checksBySpec.get(s.id)
        return {
          specID: s.id,
          severity: s.severity,
          passed: outcome?.passed,
          summary: outcome?.summary,
        }
      })

      claimingGoals.push({
        goalID: goal.id,
        goalTitle: goal.title,
        runStatus,
        specOutcomes,
      })
    }

    out.push({
      reqID,
      reqDescription: reqRow.description,
      claimingGoals,
    })
  }

  return out
}
