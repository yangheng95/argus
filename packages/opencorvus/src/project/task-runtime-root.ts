import { requireTask } from "@/engine/store"
import { Project } from "@/project/project"
import { NotFoundError } from "@/storage/db"

export function taskPrimaryProjectRoot(
  taskID: string,
  input: {
    activeProjectID?: string
  } = {},
): string {
  const task = requireTask(taskID)
  if (input.activeProjectID && task.project_id !== input.activeProjectID) {
    throw new NotFoundError({
      message: `Task not found in current project: ${taskID}`,
    })
  }
  const project = Project.get(task.project_id)
  if (!project) {
    throw new NotFoundError({
      message: `Task project not found for ${taskID}: ${task.project_id}`,
    })
  }
  return project.worktree
}
