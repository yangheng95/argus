import { createSignal } from "solid-js"

export interface FileNode {
  name: string
  path: string
  absolute: string
  type: "file" | "directory"
  ignored: boolean
}

export interface FileContent {
  type: "text" | "binary"
  content: string
  diff?: string
  encoding?: "base64"
  mimeType?: string
}

const [selectedFilePath, setSelectedFilePath] = createSignal("")
const [fileWorkbenchOpen, setFileWorkbenchOpen] = createSignal(false)

export { selectedFilePath, fileWorkbenchOpen }

export function openFileEditor(path: string): void {
  const next = String(path || "").trim()
  if (!next) return
  setSelectedFilePath(next)
  setFileWorkbenchOpen(true)
}

export function closeFileEditor(): void {
  setSelectedFilePath("")
  setFileWorkbenchOpen(false)
}

export function shortWorkbenchPath(path: string): string {
  const parts = String(path || "")
    .split(/[\\/]/)
    .filter(Boolean)
  if (parts.length <= 2) return path
  return parts.slice(-2).join("/")
}
