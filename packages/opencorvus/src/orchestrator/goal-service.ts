import { Identifier } from "@/id/id"
import { OrchestratorGoalTable, OrchestratorProgressSnapshotTable, OrchestratorTaskTable } from "@/orchestrator/orchestrator.sql"
import { Database, desc, eq } from "@/storage/db"
import type { AcceptanceSpec } from "@/acceptance/types"

export namespace GoalService {
  export function addOperatorGoal(input: { taskID: string; description: string }) {
    const task = Database.use((db) => db.select().from(OrchestratorTaskTable).where(eq(OrchestratorTaskTable.id, input.taskID)).get())
    const planVersionID = task?.active_plan_version_id
    if (!task || !planVersionID) return

    const now = Date.now()
    const last = Database.use((db) =>
      db
        .select()
        .from(OrchestratorGoalTable)
        .where(eq(OrchestratorGoalTable.plan_version_id, planVersionID))
        .orderBy(desc(OrchestratorGoalTable.order_index))
        .get(),
    )

    Database.use((db) =>
      db
        .insert(OrchestratorGoalTable)
        .values({
          id: Identifier.ascending("goal"),
          task_id: task.id,
          plan_version_id: planVersionID,
          title: input.description,
          objective: input.description,
          acceptance_specs: [
            {
              id: `acc-operator-${Identifier.ascending("spec")}`,
              source_requirement_id: "operator",
              goal_id: "operator",
              title: input.description.slice(0, 80),
              severity: "essential",
              scorers: [
                {
                  type: "llm_judge",
                  name: "operator-intent",
                  criteria: `The delivery satisfies this operator-provided goal: ${input.description}`,
                  inputs: ["delivery_summary", "changed_files"],
                },
              ],
            },
          ],
          owned_paths: [],
          depends_on: [],
          exports: [],
          imports: [],
          kind: "feature",
          requirement_ids: [],
          metadata: {
            origin: "operator",
          },
          priority: "blocking",
          status: "pending",
          order_index: (last?.order_index ?? -1) + 1,
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
          status: "active",
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
    title: string
    acceptance_specs: AcceptanceSpec[]
  }) {
    return Database.use((db) =>
      db
        .update(OrchestratorGoalTable)
        .set({
          title: input.title,
          acceptance_specs: input.acceptance_specs,
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
