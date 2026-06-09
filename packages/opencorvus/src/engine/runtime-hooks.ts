import type { TaskUpdateValues } from "./state"
import type { RunRow, TaskRow } from "./store"

export type RuntimeHooks = {
  updateTask: (row: TaskRow, values: TaskUpdateValues, summary: string) => Promise<TaskRow>
  updateRun: (row: RunRow, values: Partial<RunRow>, summary: string) => Promise<RunRow>
}
