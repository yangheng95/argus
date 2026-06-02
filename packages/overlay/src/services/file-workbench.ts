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
const [fileEditorFocus, setFileEditorFocus] = createSignal<"messages" | "editor">("messages")

export { selectedFilePath, fileWorkbenchOpen, fileEditorFocus }

export function openFileEditor(path: string): void {
  const next = String(path || "").trim()
  if (!next) return
  setSelectedFilePath(next)
  setFileWorkbenchOpen(true)
  setFileEditorFocus("editor")
}

export function closeFileEditor(): void {
  setSelectedFilePath("")
  setFileWorkbenchOpen(false)
  setFileEditorFocus("messages")
}

export function showFileEditor(): void {
  if (!selectedFilePath()) return
  setFileWorkbenchOpen(true)
  setFileEditorFocus("editor")
}

export function showMessagesPane(): void {
  setFileEditorFocus("messages")
}

export function showWorkbenchPane(): void {
  setFileWorkbenchOpen(true)
  setFileEditorFocus("editor")
}

export function toggleFileEditorFocus(): void {
  const open = fileWorkbenchOpen()
  const focused = fileEditorFocus() === "editor"
  setFileWorkbenchOpen(!open || !focused)
  setFileEditorFocus(!open || !focused ? "editor" : "messages")
}

export function shortWorkbenchPath(path: string): string {
  const parts = String(path || "").split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return path
  return parts.slice(-2).join("/")
}
