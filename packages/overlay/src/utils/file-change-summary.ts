import { cardTreeStore, type CardNode } from "../store/card-tree"
import type { FileChange } from "../components/DiffView"
import type { ChangeGroup } from "../services/diff"
import { goalRevisionLabelFromIndexes } from "./goal-label"
import { relativePathFrom } from "./tool"

export interface ToolFileChange extends FileChange {
  openPath: string
  displayPath: string
  goalID?: string
}

export interface AgentFileChange extends ToolFileChange {
  sources: number
}

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
    goalID: asText(raw.goalID),
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

function applyGoal(change: ToolFileChange, goalID: string): ToolFileChange {
  return goalID && !change.goalID ? { ...change, goalID } : change
}

function toolPartFileChanges(part: unknown, base: string, nodeGoalID: string): ToolFileChange[] {
  if (!isRecord(part)) return []
  const state = isRecord(part.state) ? part.state : {}
  if (String(state.status || "").toLowerCase() !== "completed") return []
  const goalID = asText(part.goalID) ?? nodeGoalID
  return toolFileChangesFromState(state, base).map((change) => applyGoal(change, goalID))
}

function patchPartFileChanges(part: unknown, base: string, nodeGoalID: string): ToolFileChange[] {
  if (!isRecord(part) || part.type !== "patch" || !Array.isArray(part.files)) return []
  const goalID = asText(part.goalID) ?? nodeGoalID
  return part.files
    .map((file) => normalizeToolDiff(file, base))
    .filter((change): change is ToolFileChange => !!change)
    .map((change) => applyGoal(change, goalID))
}

function mergeFileChange(map: Map<string, AgentFileChange>, change: ToolFileChange): void {
  const key = `${change.goalID ?? ""}\0${change.openPath.replace(/\\/g, "/")}`
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
  const nodeGoalID = typeof node.goalID === "string" ? node.goalID : ""
  for (const part of node.parts ?? []) {
    if (isRecord(part) && part.type === "tool") {
      for (const change of toolPartFileChanges(part, base, nodeGoalID)) mergeFileChange(out, change)
    }
    for (const change of patchPartFileChanges(part, base, nodeGoalID)) mergeFileChange(out, change)
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

interface GoalChangeMetadata {
  goalID: string
  goalRunID?: string
  goalLabel?: string
  goalTitle?: string
  commitRef?: string
  goalOrderIndex?: number
  goalRetryCount?: number
}

function goalMetadataByID(goalWorkflows: unknown): Map<string, GoalChangeMetadata> {
  if (!Array.isArray(goalWorkflows)) return new Map()
  const map = new Map<string, GoalChangeMetadata>()
  for (const goal of goalWorkflows) {
    const goalID = asText((goal as any)?.goalID)
    if (!goalID) continue
    const goalOrderIndex = Number((goal as any)?.orderIndex)
    const goalRetryCount = Number((goal as any)?.retryCount)
    const payloads = Array.isArray((goal as any)?.steps)
      ? (goal as any).steps.map((step: any) => step?.payload).filter(Boolean)
      : []
    const commitRef = payloads
      .map((payload: any) => asText(payload?.commitRef))
      .find((value): value is string => !!value)
    map.set(goalID, {
      goalID,
      goalRunID: asText((goal as any)?.goalRunID),
      goalLabel: goalRevisionLabelFromIndexes(goalOrderIndex, goalRetryCount),
      goalTitle: asText((goal as any)?.goalTitle),
      commitRef,
      goalOrderIndex: Number.isFinite(goalOrderIndex) ? goalOrderIndex : undefined,
      goalRetryCount: Number.isFinite(goalRetryCount) ? goalRetryCount : undefined,
    })
  }
  return map
}

function groupSortKey(group: ChangeGroup): number {
  return Number.isFinite(group.goalOrderIndex) ? Number(group.goalOrderIndex) : Number.MAX_SAFE_INTEGER
}

function groupMergeKey(group: ChangeGroup): string {
  if (group.goalRunID) return `goal-run:${group.goalRunID}`
  if (group.goalID) return `goal:${group.goalID}`
  if (group.runID) return `run:${group.runID}`
  return group.id
}

function changeMergeKey(change: FileChange): string {
  return change.file.replace(/\\/g, "/")
}

function mergeChange(left: FileChange, right: FileChange): FileChange {
  return {
    ...left,
    ...right,
    status: left.status === "modified" ? right.status : left.status,
    additions: Math.max(left.additions ?? 0, right.additions ?? 0),
    deletions: Math.max(left.deletions ?? 0, right.deletions ?? 0),
    before: left.before !== undefined ? left.before : right.before,
    after: left.after !== undefined ? left.after : right.after,
  }
}

function mergeGroup(left: ChangeGroup, right: ChangeGroup): ChangeGroup {
  const changes = new Map<string, FileChange>()
  for (const change of [...left.changes, ...right.changes]) {
    const key = changeMergeKey(change)
    const current = changes.get(key)
    changes.set(key, current ? mergeChange(current, change) : change)
  }
  const mergedChanges = [...changes.values()].sort((a, b) => a.file.localeCompare(b.file))
  return {
    ...left,
    ...right,
    additions: mergedChanges.reduce((sum, item) => sum + (item.additions ?? 0), 0),
    deletions: mergedChanges.reduce((sum, item) => sum + (item.deletions ?? 0), 0),
    changes: mergedChanges,
  }
}

export function mergeChangeGroups(groups: ChangeGroup[]): ChangeGroup[] {
  const merged = new Map<string, ChangeGroup>()
  for (const group of groups) {
    const key = groupMergeKey(group)
    const current = merged.get(key)
    merged.set(key, current ? mergeGroup(current, group) : group)
  }
  return [...merged.values()]
    .filter((group) => group.changes.length > 0)
    .sort((left, right) => groupSortKey(left) - groupSortKey(right) || left.id.localeCompare(right.id))
}

export function collectAgentFileChangeGroups(
  node: CardNode,
  base: string,
  goalWorkflows: unknown,
): ChangeGroup[] {
  return collectAgentFileChangeGroupsFromNodes([node], base, goalWorkflows)
}

export function collectAgentFileChangeGroupsFromNodes(
  nodes: CardNode[],
  base: string,
  goalWorkflows: unknown,
): ChangeGroup[] {
  const metadata = goalMetadataByID(goalWorkflows)
  const grouped = new Map<string, AgentFileChange[]>()
  const changes = new Map<string, AgentFileChange>()
  const seen = new Set<string>()
  for (const node of nodes) {
    collectFromNode(node, base, changes, seen)
  }
  for (const change of [...changes.values()].sort((a, b) => a.displayPath.localeCompare(b.displayPath))) {
    const groupID = change.goalID || "node"
    const bucket = grouped.get(groupID) ?? []
    bucket.push(change)
    grouped.set(groupID, bucket)
  }
  return [...grouped.entries()]
    .map(([groupID, changes]) => {
      const meta = metadata.get(groupID)
      return {
        id: meta ? `goal:${meta.goalID}:${meta.goalRunID ?? "active"}` : `agent:${groupID}`,
        goalID: meta?.goalID,
        goalRunID: meta?.goalRunID,
        goalOrderIndex: meta?.goalOrderIndex,
        goalRetryCount: meta?.goalRetryCount,
        goalLabel: meta?.goalLabel,
        goalTitle: meta?.goalTitle,
        commitRef: meta?.commitRef,
        additions: changes.reduce((sum, item) => sum + (item.additions ?? 0), 0),
        deletions: changes.reduce((sum, item) => sum + (item.deletions ?? 0), 0),
        changes,
      } satisfies ChangeGroup
    })
    .sort((left, right) => groupSortKey(left) - groupSortKey(right) || left.id.localeCompare(right.id))
}
