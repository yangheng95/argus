import { boardStore } from "../store/board"
import { settingsStore } from "../store/settings"

export function activeProjectDirectory(): string {
  return (boardStore.board?.task?.directory || settingsStore.directory || "").trim()
}

export function projectScopedPath(path: string, directory = activeProjectDirectory()): string {
  const cleanPath = path.replace(/^\/+/, "")
  const cleanDirectory = directory.trim()
  if (!cleanDirectory) return cleanPath
  const query = new URLSearchParams({ directory: cleanDirectory })
  return `${cleanPath}?${query.toString()}`
}
