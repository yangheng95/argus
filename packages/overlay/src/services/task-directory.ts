import { boardStore, taskByID } from "../store/board"

export function taskOwningDirectory(taskID: string): string {
  const id = String(taskID || "").trim()
  if (!id) throw new Error("taskOwningDirectory requires a taskID")
  const rowDirectory = taskByID(id)?.task?.directory
  if (typeof rowDirectory === "string" && rowDirectory.trim()) return rowDirectory.trim()
  const boardTask = boardStore.board?.task
  if (boardTask?.id === id && typeof boardTask.directory === "string" && boardTask.directory.trim()) {
    return boardTask.directory.trim()
  }
  throw new Error(`task ${id} has no owning project directory`)
}
