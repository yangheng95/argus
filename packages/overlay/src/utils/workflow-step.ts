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
 *  Backend is the source of truth — if the mapping drifts, the overlay
 *  fails closed (phase claim returns null, session card floats top-level).
 *
 *  Per 2026-04-20 per-goal evaluator removal: `evaluator` session kind is
 *  gone. The build step now has two phases (plan + build); acceptance-time
 *  adversarial review happens inside the (task-scope) acceptance session,
 *  not inside a goal-scope phase card. */
export interface GoalPhaseLocation {
  stepID: string;
  phaseID: string;
}

export function goalStagePhaseID(stage: string): GoalPhaseLocation | null {
  const normalized = String(stage || "").trim().toLowerCase();
  switch (normalized) {
    case "planner":
      return { stepID: "build", phaseID: "plan" };
    case "build":
      return { stepID: "build", phaseID: "build" };
    default:
      return null;
  }
}
