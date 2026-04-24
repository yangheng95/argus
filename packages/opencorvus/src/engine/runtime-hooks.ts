import type { EngineTaskTable } from "./engine.sql"
import type { RunRow, TaskRow } from "./store"

export type RuntimeHooks = {
  updateTask: (
    row: TaskRow,
    values: Partial<typeof EngineTaskTable.$inferInsert>,
    summary: string,
  ) => Promise<TaskRow>
  updateRun: (
    row: RunRow,
    values: Partial<RunRow>,
    summary: string,
  ) => Promise<RunRow>
}
