import type { OrchestratorRunTable, OrchestratorTaskTable } from "./orchestrator.sql"
import type { RunRow, TaskRow } from "./store"

export type RuntimeHooks = {
  updateTask: (
    row: TaskRow,
    values: Partial<typeof OrchestratorTaskTable.$inferInsert>,
    summary: string,
  ) => Promise<TaskRow>
  updateRun: (
    row: RunRow,
    values: Partial<typeof OrchestratorRunTable.$inferInsert>,
    summary: string,
  ) => Promise<RunRow>
}
