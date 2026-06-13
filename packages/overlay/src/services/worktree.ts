import { apiJson } from "./api"

export interface ProjectWorktreeInfo {
  name: string
  branch?: string
  directory: string
  goalID?: string
  status: "primary" | "active" | "expired"
  removable: boolean
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
  })
  if (result?.ok !== true) throw new Error("project/current/worktrees did not confirm deletion")
  return true
}
