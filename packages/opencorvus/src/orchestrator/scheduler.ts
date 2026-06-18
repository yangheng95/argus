import { GOAL_RUN_RESETTABLE_STATUSES, LIVE_RUN_STATUSES, isLiveRunStatus } from "@/engine/catalog"

export type RestartStage = "requirements" | "plan" | "executor"
export { GOAL_RUN_RESETTABLE_STATUSES, LIVE_RUN_STATUSES, isLiveRunStatus }

export function restartStagePlan(stage: RestartStage, hasActivePlan: boolean) {
  switch (stage) {
    case "requirements":
      return {
        clearSpec: true,
        clearPlan: true,
        deleteGoals: true,
        resetGoalStatuses: false,
        retireGoalRuns: false,
        queueFreshRun: false,
        nextAction: "requirements" as const,
      }
    case "plan":
      // Fully regenerate goals while preserving the validated spec/requirements.
      // Goals are deleted (not reset) so the architect re-plans from scratch
      // without old goal rows colliding with the new decomposition.
      // abortLiveExecutionForTask cleans the per-goal worktrees; git main is
      // left alone — the architect plans against whatever main looks like now.
      return {
        clearSpec: false,
        clearPlan: true,
        deleteGoals: true,
        resetGoalStatuses: false,
        retireGoalRuns: true,
        queueFreshRun: false,
        nextAction: "architect" as const,
      }
    case "executor":
      return {
        clearSpec: false,
        clearPlan: false,
        deleteGoals: false,
        resetGoalStatuses: true,
        retireGoalRuns: true,
        queueFreshRun: hasActivePlan,
        nextAction: hasActivePlan ? ("submit_execution" as const) : ("create_run" as const),
      }
  }
}
