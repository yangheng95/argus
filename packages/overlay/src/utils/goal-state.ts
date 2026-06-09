// ── Goal-level rollup state ──
//
// Maps a board.goalWorkflows[i] entry onto a single state token used by
// TaskProgressBar pills. The backend exposes both:
//
//   - `goalStatus` ("passed" | "failed" | "running" | "pending" | "blocked"),
//     the canonical goal-level rollup
//   - `steps[].status` ("pending" | "running" | "completed" | "failed" |
//     "skipped"), per-step granular status
//
// goalStatus wins when present; we only inspect step rows when it's
// "pending" because in that case a freshly-running step exists before
// the goal-level rollup catches up.

export type GoalState = "pending" | "running" | "passed" | "failed" | "blocked"

export function goalState(goal: any): GoalState {
  const overall = String(goal?.goalStatus || "").toLowerCase()
  if (overall === "passed") return "passed"
  if (overall === "failed") return "failed"
  if (overall === "blocked") return "blocked"
  if (overall === "running") return "running"
  // goalStatus is "pending" / unknown — inspect step rows for in-flight
  // activity so a goal that JUST started running shows the pulse instead
  // of hiding behind a stale pending pill.
  const steps = Array.isArray(goal?.steps) ? goal.steps : []
  if (steps.some((s: any) => String(s?.status || "").toLowerCase() === "running")) {
    return "running"
  }
  if (steps.some((s: any) => String(s?.status || "").toLowerCase() === "failed")) {
    return "failed"
  }
  return "pending"
}
