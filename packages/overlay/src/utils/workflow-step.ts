/** Map a session stage (= session.kind as stamped into message.channel by
 *  the protocol bridge) to the goal workflow phase it claims under.
 *
 *  Returns `{ stepID, phaseID }` when the stage is a goal-scope phase
 *  session kind; returns `null` for task-scope stages (requirements /
 *  architect / frontend-design / assistant / acceptance / ...) and for the
 *  `executor` container kind — the executor container does NOT render as
 *  its own card; the overlay's step card represents it visually, and the
 *  container's only role is to be a parentID anchor for the phase sessions.
 *
 *  stepID / phaseID must match a step defined in the backend workflow
 *  (packages/opencorvus/src/engine/workflow.ts PIPELINE.build.phases).
 *  Backend is the source of truth. For goal-owned sessions, tree-writer treats
 *  a missing mapping as a bridge/workflow drift error instead of rendering a
 *  top-level session card.
 *
 *  The current pipeline build step declares one phase: `build`. Planning and
 *  review evidence are task-scope workflow steps, not per-goal phase cards. */
export interface GoalPhaseLocation {
  stepID: string
  phaseID: string
}

export function goalStagePhaseID(stage: string): GoalPhaseLocation | null {
  const normalized = String(stage || "")
    .trim()
    .toLowerCase()
  switch (normalized) {
    case "build":
      return { stepID: "build", phaseID: "build" }
    default:
      return null
  }
}
