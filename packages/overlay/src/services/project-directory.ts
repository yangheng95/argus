import { boardStore } from "../store/board"
import { settingsStore } from "../store/settings"

export function activeProjectDirectory(): string {
  return (boardStore.board?.task?.directory || settingsStore.directory || "").trim()
}

export function projectScopedPath(path: string, directory: string): string {
  const cleanPath = path.replace(/^\/+/, "")
  const cleanDirectory = directory.trim()
  if (!cleanDirectory) throw new Error("projectScopedPath: directory is required")
  const query = new URLSearchParams({ directory: cleanDirectory })
  return `${cleanPath}?${query.toString()}`
}
