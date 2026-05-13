import { cardTreeStore, type CardNode } from "../store/card-tree"
import type { FileChange } from "../components/DiffView"
import { relativePathFrom, toolNameKey } from "./tool"

export interface ToolFileChange extends FileChange {
  openPath: string
  displayPath: string
}

export interface AgentFileChange extends ToolFileChange {
  sources: number
}

const FILE_WRITE_TOOLS = new Set(["write", "writefile"])
const FILE_EDIT_TOOLS = new Set(["edit", "editfile", "applypatch"])

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value)
}

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

function asCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0
}

function displayPath(path: string, base: string): string {
  const normalized = path.replace(/\\/g, "/")
  const normalizedBase = base.replace(/\\/g, "/").replace(/\/+$/, "")
  const rel = relativePathFrom(normalizedBase, normalized)
  return rel || normalized
}

function diffStatus(raw: unknown, before?: string, after?: string): FileChange["status"] {
  const value = String(raw || "")
    .trim()
    .toLowerCase()
  if (value === "add" || value === "added") return "added"
  if (value === "delete" || value === "deleted" || value === "remove" || value === "removed") return "deleted"
  if (before === "" && typeof after === "string" && after.length > 0) return "added"
  if (after === "" && typeof before === "string" && before.length > 0) return "deleted"
  return "modified"
}

function normalizeToolDiff(raw: unknown, base: string): ToolFileChange | null {
  if (!isRecord(raw)) return null
  const before = asString(raw.before) ?? asString(raw.oldContent)
  const after = asString(raw.after) ?? asString(raw.newContent)
  const sourcePath = asText(raw.file) ?? asText(raw.filePath) ?? asText(raw.path)
  const targetPath = asText(raw.movePath) ?? sourcePath
  if (!targetPath) return null

  const sourceDisplay = sourcePath ? displayPath(sourcePath, base) : ""
  const targetDisplay = asText(raw.relativePath) ?? displayPath(targetPath, base)
  const renderedPath =
    sourcePath && targetPath !== sourcePath ? `${sourceDisplay || sourcePath} -> ${targetDisplay}` : targetDisplay

  return {
    file: renderedPath,
    status: diffStatus(raw.type, before, after),
    additions: asCount(raw.additions),
    deletions: asCount(raw.deletions),
    before,
    after,
    openPath: targetPath,
    displayPath: renderedPath,
  }
}

export function toolFileChangesFromState(state: unknown, base: string): ToolFileChange[] {
  if (!isRecord(state)) return []
  const meta = isRecord(state.metadata) ? state.metadata : {}
  const files = Array.isArray(meta.files)
    ? meta.files.map((item) => normalizeToolDiff(item, base)).filter((item): item is ToolFileChange => !!item)
    : []
  if (files.length > 0) return files

  const single = normalizeToolDiff(meta.filediff, base)
  return single ? [single] : []
}

function inputPath(input: unknown): string {
  if (!isRecord(input)) return ""
  return asText(input.file_path) ?? asText(input.filePath) ?? asText(input.path) ?? asText(input.filename) ?? ""
}

function toolInputFileChange(part: unknown, base: string): ToolFileChange[] {
  if (!isRecord(part)) return []
  const key = toolNameKey(asText(part.tool) ?? asText(part.toolName) ?? "")
  if (!FILE_WRITE_TOOLS.has(key) && !FILE_EDIT_TOOLS.has(key)) return []
  const state = isRecord(part.state) ? part.state : {}
  if (String(state.status || "").toLowerCase() !== "completed") return []
  const path = inputPath(state.input)
  if (!path) return []
  const renderedPath = displayPath(path, base)
  return [
    {
      file: renderedPath,
      status: "modified",
      additions: 0,
      deletions: 0,
      openPath: path,
      displayPath: renderedPath,
    },
  ]
}

function toolPartFileChanges(part: unknown, base: string): ToolFileChange[] {
  if (!isRecord(part)) return []
  const state = isRecord(part.state) ? part.state : {}
  if (String(state.status || "").toLowerCase() !== "completed") return []
  return [...toolFileChangesFromState(state, base), ...toolInputFileChange(part, base)]
}

function patchPartFileChanges(part: unknown, base: string): ToolFileChange[] {
  if (!isRecord(part) || part.type !== "patch" || !Array.isArray(part.files)) return []
  return part.files.flatMap((file) => {
    const path = asText(file)
    if (!path) return []
    const renderedPath = displayPath(path, base)
    return [
      {
        file: renderedPath,
        status: "modified" as const,
        additions: 0,
        deletions: 0,
        openPath: path,
        displayPath: renderedPath,
      },
    ]
  })
}

function mergeFileChange(map: Map<string, AgentFileChange>, change: ToolFileChange): void {
  const key = change.openPath.replace(/\\/g, "/")
  const current = map.get(key)
  if (!current) {
    map.set(key, { ...change, sources: 1 })
    return
  }
  current.sources += 1
  current.additions += change.additions
  current.deletions += change.deletions
  if (current.status === "modified") current.status = change.status
  if (current.before === undefined && change.before !== undefined) current.before = change.before
  if (current.after === undefined && change.after !== undefined) current.after = change.after
}

function collectFromNode(node: CardNode, base: string, out: Map<string, AgentFileChange>, seen: Set<string>): void {
  if (seen.has(node.id)) return
  seen.add(node.id)
  for (const part of node.parts ?? []) {
    if (isRecord(part) && part.type === "tool") {
      for (const change of toolPartFileChanges(part, base)) mergeFileChange(out, change)
    }
    for (const change of patchPartFileChanges(part, base)) mergeFileChange(out, change)
  }
  if (Array.isArray(node.childIDs)) {
    for (const childID of node.childIDs) {
      const child = cardTreeStore.cards[childID]
      if (!child) throw new Error(`file-change-summary: card ${node.id} references missing child ${childID}`)
      collectFromNode(child, base, out, seen)
    }
  } else {
    for (const child of node.children ?? []) collectFromNode(child, base, out, seen)
  }
}

export function collectAgentFileChanges(node: CardNode, base: string): AgentFileChange[] {
  const out = new Map<string, AgentFileChange>()
  collectFromNode(node, base, out, new Set())
  return [...out.values()].sort((a, b) => a.displayPath.localeCompare(b.displayPath))
}
