import { apiJson } from "./api"

export interface ProjectWorktreeInfo {
  name: string
  branch?: string
  directory: string
  goalID?: string
  status: "primary" | "active" | "expired"
  removable: boolean
}

export interface ProjectWorktreeDeleteFailure {
  directory: string
  error: string
}

export class ProjectWorktreeBulkDeleteError extends Error {
  readonly deleted: number
  readonly failures: ProjectWorktreeDeleteFailure[]

  constructor(input: { deleted: number; failures: ProjectWorktreeDeleteFailure[] }) {
    const failureDetails = input.failures.map((failure) => `${failure.directory}: ${failure.error}`).join("; ")
    super(
      `Failed to delete ${input.failures.length} project worktree(s) after deleting ${input.deleted}. ${failureDetails}`,
    )
    this.name = "ProjectWorktreeBulkDeleteError"
    this.deleted = input.deleted
    this.failures = input.failures
  }
}

function projectWorktreesPath(projectDirectory: string): string {
  const directory = String(projectDirectory || "").trim()
  if (!directory) throw new Error("project/current/worktrees requires a project directory")
  return `project/current/worktrees?directory=${encodeURIComponent(directory)}`
}

export async function loadProjectWorktrees(projectDirectory: string): Promise<ProjectWorktreeInfo[]> {
  const result = await apiJson(projectWorktreesPath(projectDirectory))
  if (!Array.isArray(result)) throw new Error("project/current/worktrees returned a non-array payload")
  return result.map((item: any) => {
    if (typeof item?.name !== "string") throw new Error("project worktree is missing name")
    if (typeof item?.directory !== "string") throw new Error("project worktree is missing directory")
    if (item.status !== "primary" && item.status !== "active" && item.status !== "expired") {
      throw new Error("project worktree has an unknown status")
    }
    if (typeof item?.removable !== "boolean") throw new Error("project worktree is missing removable")
    return {
      name: item.name,
      branch: typeof item.branch === "string" ? item.branch : undefined,
      directory: item.directory,
      goalID: typeof item.goalID === "string" ? item.goalID : undefined,
      status: item.status,
      removable: item.removable,
    }
  })
}

export async function deleteProjectWorktree(projectDirectory: string, directory: string): Promise<boolean> {
  if (!directory) throw new Error("deleteProjectWorktree requires a target directory")
  const result = await apiJson(projectWorktreesPath(projectDirectory), {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directory }),
    timeoutMilliseconds: null,
  })
  if (result?.ok !== true) throw new Error("project/current/worktrees did not confirm deletion")
  return true
}

export async function deleteProjectWorktrees(projectDirectory: string, directories: string[]): Promise<number> {
  const targets = directories.filter((directory) => directory.trim())
  const failures: ProjectWorktreeDeleteFailure[] = []
  let deleted = 0
  for (const directory of targets) {
    try {
      await deleteProjectWorktree(projectDirectory, directory)
      deleted += 1
    } catch (error) {
      failures.push({
        directory,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (failures.length > 0) throw new ProjectWorktreeBulkDeleteError({ deleted, failures })
  return deleted
}
