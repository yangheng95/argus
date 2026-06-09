export function taskScopedPath(taskID: string, directory?: string, suffix = ""): string {
  const base = `task/${encodeURIComponent(taskID)}${suffix}`
  const nextDirectory = typeof directory === "string" ? directory.trim() : ""
  if (!nextDirectory) return base
  const query = new URLSearchParams({ directory: nextDirectory })
  return `${base}?${query.toString()}`
}
