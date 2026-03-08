import { Identifier } from "@/id/id"
import { OrchestratorGoalTable, OrchestratorProgressSnapshotTable, OrchestratorTaskTable } from "@/orchestrator/orchestrator.sql"
import { Database, eq } from "@/storage/db"

function inferGoalMetadata(text: string, criteria?: string) {
  const lower = `${text} ${criteria ?? ""}`.toLowerCase()
  const selectors = [
    lower.includes("build") ? "build" : undefined,
    lower.includes("test") ? "test" : undefined,
    lower.includes("lint") ? "lint" : undefined,
    lower.includes("verify") ? "verify_cmd" : undefined,
    lower.includes("regression") || lower.includes("coverage") ? "test" : undefined,
    /(ui|ux|design|layout|页面|界面|交互|体验|accessibility)/.test(lower) ? "ui_review" : undefined,
    /(code quality|maintain|readab|review|refactor|代码质量|可维护|可读)/.test(lower) ? "code_quality" : undefined,
    /\bcr\b|code review|审查|代码评审|review finding|review comment/.test(lower) ? "code_review" : undefined,
    /(dead code|unused code|unused export|obsolete|stale branch|死代码|无用代码|废弃分支|清理旧代码)/.test(lower)
      ? "dead_code_review"
      : undefined,
    /(startup|start normally|starts normally|boot|launch|serve|server|启动|运行起来|正常启动)/.test(lower)
      ? "startup"
      : undefined,
  ].filter((item): item is string => Boolean(item))
  if (selectors.length === 0) return undefined
  return {
    check_selector: [...new Set(selectors)],
  }
}

export namespace GoalService {
  export function addOperatorGoal(input: { taskID: string; description: string }) {
    const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
    const planVersionID = task?.active_plan_version_id
    if (!task || !planVersionID) return

    const now = Date.now()
    const count = Database.use((db) =>
      db
        .select()
        .from(OrchestratorGoalTable)
        .where(eq(OrchestratorGoalTable.plan_version_id, planVersionID))
        .all().length,
    )

    Database.use((db) =>
      db
        .insert(OrchestratorGoalTable)
        .values({
          id: Identifier.ascending("goal"),
          task_id: task.id,
          plan_version_id: planVersionID,
          description: input.description,
          criteria: "This operator-provided goal is satisfied and acceptance checks still pass.",
          metadata: {
            origin: "operator",
            ...(inferGoalMetadata(input.description) ?? {}),
          },
          priority: "blocking",
          status: "pending",
          order_index: count,
          time_created: now,
          time_updated: now,
        })
        .run(),
    )

    Database.use((db) =>
      db
        .insert(OrchestratorProgressSnapshotTable)
        .values({
          id: Identifier.ascending("progress"),
          task_id: task.id,
          status: "running",
          summary: "Goal added from operator message",
          payload: {
            description: input.description,
            origin: "operator",
          },
          time_created: now,
          time_updated: now,
        })
        .run(),
    )
  }

  export function updateGoal(input: {
    goalID: string
    description: string
    criteria: string
  }) {
    return Database.use((db) =>
      db
        .update(OrchestratorGoalTable)
        .set({
          description: input.description,
          criteria: input.criteria,
          metadata: inferGoalMetadata(input.description, input.criteria),
          time_updated: Date.now(),
        })
        .where(eq(OrchestratorGoalTable.id, input.goalID))
        .run(),
    )
  }

  export function deleteGoal(goalID: string) {
    return Database.use((db) =>
      db.delete(OrchestratorGoalTable).where(eq(OrchestratorGoalTable.id, goalID)).run(),
    )
  }
}
