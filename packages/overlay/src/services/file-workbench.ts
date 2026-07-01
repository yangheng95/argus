import { createSignal } from "solid-js"
import { uint8ToBase64 } from "@opencorvus-ai/transport-protocol"
import { apiJson } from "./api"
import { projectScopedPath } from "./project-directory"

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

export interface FileCreateRequest {
  path: string
  type: "file" | "directory"
  content?: string
}

export interface FileMoveResult {
  previousPath: string
  path: string
  node: FileNode
}

export interface FileCopyResult {
  sourcePath: string
  path: string
  node: FileNode
}

export interface FileDeleteResult {
  path: string
}

export interface FileOperationScope {
  directory: string
}

export interface FileEditorTarget extends FileOperationScope {
  path: string
}

const [selectedFileTarget, setSelectedFileTarget] = createSignal<FileEditorTarget | null>(null)
const [fileWorkbenchOpen, setFileWorkbenchOpen] = createSignal(false)

const selectedFilePath = () => selectedFileTarget()?.path ?? ""

export { selectedFilePath, selectedFileTarget, fileWorkbenchOpen }

function normalizeWorkbenchPath(path: string): string {
  return String(path || "")
    .replaceAll("\\", "/")
    .split("/")
    .filter(Boolean)
    .join("/")
}

function joinWorkbenchPath(parent: string, child: string): string {
  const normalizedParent = normalizeWorkbenchPath(parent)
  const normalizedChild = normalizeWorkbenchPath(child)
  return [normalizedParent, normalizedChild].filter(Boolean).join("/")
}

function descendantSuffix(path: string, base: string): string | null {
  const normalizedPath = normalizeWorkbenchPath(path)
  const normalizedBase = normalizeWorkbenchPath(base)
  if (!normalizedBase) return normalizedPath ? normalizedPath : null
  if (normalizedPath === normalizedBase) return ""
  const prefix = `${normalizedBase}/`
  return normalizedPath.startsWith(prefix) ? normalizedPath.slice(prefix.length) : null
}

function normalizeFileEditorTarget(path: string, scope: FileOperationScope): FileEditorTarget {
  const next = String(path || "").trim()
  const directory = scope.directory.trim()
  if (!next || !directory) throw new Error("openFileEditor: path and directory are required")
  return {
    path: normalizeWorkbenchPath(next),
    directory,
  }
}

export function openFileEditor(path: string, scope: FileOperationScope): void {
  setSelectedFileTarget(normalizeFileEditorTarget(path, scope))
  setFileWorkbenchOpen(true)
}

export function closeFileEditor(): void {
  setSelectedFileTarget(null)
  setFileWorkbenchOpen(false)
}

export function updateOpenFilePathAfterMove(previousPath: string, nextPath: string, scope: FileOperationScope): void {
  const target = selectedFileTarget()
  if (!target || target.directory !== scope.directory.trim()) return
  const suffix = descendantSuffix(target.path, previousPath)
  if (suffix === null) return
  setSelectedFileTarget({
    ...target,
    path: suffix ? joinWorkbenchPath(nextPath, suffix) : normalizeWorkbenchPath(nextPath),
  })
  setFileWorkbenchOpen(true)
}

export function closeFileEditorIfDeleted(path: string, scope: FileOperationScope): void {
  const target = selectedFileTarget()
  if (!target || target.directory !== scope.directory.trim()) return
  if (descendantSuffix(target.path, path) === null) return
  closeFileEditor()
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

function fileQueryPath(path: string, params: Record<string, string>, scope: FileOperationScope): string {
  const directory = scope.directory.trim()
  if (!directory) throw new Error("fileQueryPath: directory is required")
  const query = new URLSearchParams({ ...params, directory })
  return `${path}?${query.toString()}`
}

export async function uploadDroppedFiles(
  targetDir: string,
  files: File[],
  scope: FileOperationScope,
): Promise<FileUploadResult[]> {
  const payloads = await Promise.all(files.map(droppedFilePayload))
  return (await apiJson(projectScopedPath("file/upload", scope.directory), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ targetDir, files: payloads }),
  })) as FileUploadResult[]
}

export async function createFileItem(input: FileCreateRequest, scope: FileOperationScope): Promise<FileNode> {
  return (await apiJson(projectScopedPath("file/item", scope.directory), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  })) as FileNode
}

export async function moveFileItem(path: string, newPath: string, scope: FileOperationScope): Promise<FileMoveResult> {
  return (await apiJson(projectScopedPath("file/item", scope.directory), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, newPath }),
  })) as FileMoveResult
}

export async function copyFileItem(path: string, newPath: string, scope: FileOperationScope): Promise<FileCopyResult> {
  return (await apiJson(projectScopedPath("file/item/copy", scope.directory), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path, newPath }),
  })) as FileCopyResult
}

export async function deleteFileItem(path: string, scope: FileOperationScope): Promise<FileDeleteResult> {
  return (await apiJson(fileQueryPath("file/item", { path }, scope), {
    method: "DELETE",
  })) as FileDeleteResult
}
