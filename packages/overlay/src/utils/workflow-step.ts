/** Map a session stage (= session.kind as stamped into message.channel by
 *  the protocol bridge) to the goal workflow phase it claims under.
 *
 *  Returns `{ stepID, phaseID }` when the stage is a goal-scope phase
 *  session kind; returns `null` for task-scope stages (requirements /
 *  architect / design-analyst / assistant / delivery / ...) and for the
 *  `executor` container kind — the executor container does NOT render as
 *  its own card; the overlay's step card represents it visually, and the
 *  container's only role is to be a parentID anchor for the three phase
 *  sessions.
 *
 *  stepID / phaseID must match a step defined in the backend workflow
 *  (packages/opencorvus/src/engine/workflow.ts PIPELINE.build.phases).
 *  Backend is the source of truth — if the mapping drifts, the overlay
 *  fails closed (phase claim returns null, session card floats top-level). */
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
    case "evaluator":
      return { stepID: "build", phaseID: "evaluate" };
    default:
      return null;
  }
}
