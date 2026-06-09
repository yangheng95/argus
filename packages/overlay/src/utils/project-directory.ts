export interface ProjectDirectoryLabel {
  name: string
  parent: string
}

export function projectDirectoryKey(directory: string): string {
  return directory || "__opencorvus_unassigned_project__"
}

export function projectDirectoryLabel(directory: string, unknownName: string): ProjectDirectoryLabel {
  const normalized = (directory || "").replace(/\\/g, "/").replace(/\/+$/, "")
  if (!normalized) return { name: unknownName, parent: "" }
  const parts = normalized.split("/").filter(Boolean)
  const name = parts[parts.length - 1] || normalized
  const parent =
    parts.length > 1 ? (parts.length > 3 ? ".../" + parts.slice(-3, -1).join("/") : parts.slice(0, -1).join("/")) : ""
  return { name, parent }
}
