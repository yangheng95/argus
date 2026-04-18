import type { EngineRunStatus } from "@/engine/engine.sql"
import { GOAL_RUN_RESETTABLE_STATUSES, LIVE_RUN_STATUSES, isDispatchableRunStatus, isLiveRunStatus } from "@/engine/catalog"

export type RestartStage = "requirements" | "plan" | "executor"
export { GOAL_RUN_RESETTABLE_STATUSES, LIVE_RUN_STATUSES, isLiveRunStatus }

export function isRunReadyForGoalDispatch(input: {
  planVersionID?: string | null
  status?: EngineRunStatus | null
} | null | undefined): boolean {
  if (!input?.planVersionID) return false
  return isDispatchableRunStatus(input.status)
}

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
      return {
        clearSpec: false,
        clearPlan: true,
        deleteGoals: false,
        resetGoalStatuses: true,
        retireGoalRuns: true,
        queueFreshRun: false,
        nextAction: "create_run" as const,
      }
    case "executor":
      return {
        clearSpec: false,
        clearPlan: false,
        deleteGoals: false,
        resetGoalStatuses: true,
        retireGoalRuns: true,
        queueFreshRun: hasActivePlan,
        nextAction: hasActivePlan ? "submit_execution" as const : "create_run" as const,
      }
  }
}
