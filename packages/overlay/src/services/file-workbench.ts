import { createSignal } from "solid-js"
import { uint8ToBase64 } from "@opencorvus-ai/transport-protocol"
import { apiJson } from "./api"

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

export interface FileUploadPayload {
  name: string
  contentBase64: string
  mimeType?: string
}

export interface FileUploadResult {
  name: string
  path: string
  bytes: number
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

async function droppedFilePayload(file: File): Promise<FileUploadPayload> {
  return {
    name: file.name,
    contentBase64: uint8ToBase64(new Uint8Array(await file.arrayBuffer())),
    mimeType: file.type || undefined,
  }
}

export async function uploadDroppedFiles(targetDir: string, files: File[]): Promise<FileUploadResult[]> {
  const payloads = await Promise.all(files.map(droppedFilePayload))
  return (await apiJson("file/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetDir, files: payloads }),
  })) as FileUploadResult[]
}
