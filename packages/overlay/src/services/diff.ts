// ── Diff service ──
// Module-level cache + lazy-loader for full file diffs fetched from the
// acceptance API. Shared by ChangesPanel and DiffPreviewPanel so the first
// fetch for a given run is reused across all consumers.

import { apiJson } from "./api"
import { boardStore } from "../store/board"
import { deriveChanges, normalizeDiffs } from "./meta"
import type { FileChange } from "../components/DiffView"
import { goalRevisionLabelFromIndexes } from "../utils/goal-label"
import { directoryScopedPath } from "./task-path"

export interface DiffTarget {
  filePath: string
  goalRunID?: string
  goalLabel?: string
}

export interface ChangeGroup {
  id: string
  goalID?: string
  goalRunID?: string
  goalOrderIndex?: number
  goalRetryCount?: number
  goalLabel?: string
  goalTitle?: string
  commitRef?: string
  runID?: string
  additions: number
  deletions: number
  changes: FileChange[]
}

const diffCache = new Map<string, FileChange[]>()
const diffInFlight = new Map<string, Promise<FileChange[]>>()

export function changeGroupsRevisionKey(groups: ChangeGroup[]): string {
  return groups
    .map((group) =>
      [
        group.id,
        group.goalRunID ?? "",
        group.runID ?? "",
        group.commitRef ?? "",
        group.additions,
        group.deletions,
        ...group.changes.map((change) =>
          [
            change.file,
            change.status,
            change.additions ?? 0,
            change.deletions ?? 0,
            change.before === undefined ? "no-before" : "has-before",
            change.after === undefined ? "no-after" : "has-after",
          ].join(","),
        ),
      ].join(":"),
    )
    .join("|")
}

function normalizeAcceptanceDiffs(rawDiffs: unknown): FileChange[] {
  return (normalizeDiffs(Array.isArray(rawDiffs) ? rawDiffs : []) as FileChange[]).map((change) => ({
    ...change,
    isText: change.isText === false ? false : true,
  }))
}

function normalizeDiffPath(file: string): string {
  const normalized = String(file || "")
    .replace(/\\/g, "/")
    .replace(/^[ab]\//, "")
    .replace(/\/+/g, "/")
    .replace(/^\.?\//, "")
  const base = String((boardStore.board as any)?.task?.directory || "")
    .replace(/\\/g, "/")
    .replace(/\/+$/, "")
  const withoutBase = base && normalized.startsWith(`${base}/`) ? normalized.slice(base.length + 1) : normalized
  const arrowTarget = withoutBase.includes(" -> ") ? withoutBase.split(" -> ").at(-1) || withoutBase : withoutBase
  return arrowTarget.toLowerCase()
}

export function hasDiffBody(change: FileChange | null | undefined): change is FileChange {
  return !!change && (change.before !== undefined || change.after !== undefined)
}

export function isKnownTextDiff(change: FileChange | null | undefined): boolean {
  return change?.isText !== false
}

function findDiffByPath(changes: FileChange[], filePath: string): FileChange | null {
  const target = normalizeDiffPath(filePath)
  return changes.find((change) => normalizeDiffPath(change.file) === target) || null
}

function sumAdditions(changes: FileChange[]): number {
  return changes.reduce((sum, item) => sum + (item.additions ?? 0), 0)
}

function sumDeletions(changes: FileChange[]): number {
  return changes.reduce((sum, item) => sum + (item.deletions ?? 0), 0)
}

function acceptanceDirectory(): string {
  const directory = String((boardStore.board as any)?.task?.directory || "").trim()
  if (!directory) throw new Error("acceptance diff requires the selected task directory")
  return directory
}

function scopeCacheKey(scope: { goalRunID?: string; runID?: string; directory: string }): string {
  if (scope.goalRunID) return `${scope.directory}:goal-run:${scope.goalRunID}`
  if (scope.runID) return `${scope.directory}:run:${scope.runID}`
  return ""
}

function goalWorkflowStubs(workflows: any[]): ChangeGroup[] {
  return workflows
    .map((goal) => {
      const payloads = Array.isArray(goal?.steps)
        ? goal.steps
            .map((step: any) => step?.payload)
            .filter(
              (payload: any) =>
                payload &&
                (Array.isArray(payload.changedFiles) || Array.isArray(payload.changedFileDiffs) || payload.diffStats),
            )
        : []
      const goalRunID = typeof goal?.goalRunID === "string" && goal.goalRunID ? goal.goalRunID : undefined
      const seen = new Set<string>()
      const changes: FileChange[] = []
      // Prefer payload.changedFileDiffs (carries per-file additions/deletions
      // from the persisted goal_run acceptance row, populated by board.ts)
      // over the bare `changedFiles` string list, which has no stat numbers
      // and renders as +0/-0 on every row until scoped diff bodies are available.
      for (const payload of payloads) {
        for (const entry of Array.isArray(payload?.changedFileDiffs) ? payload.changedFileDiffs : []) {
          const file = typeof entry?.file === "string" ? entry.file : ""
          if (!file || seen.has(file)) continue
          seen.add(file)
          changes.push({
            file,
            status: entry?.status === "added" || entry?.status === "deleted" ? entry.status : "modified",
            additions: typeof entry?.additions === "number" ? entry.additions : 0,
            deletions: typeof entry?.deletions === "number" ? entry.deletions : 0,
          })
        }
        for (const file of Array.isArray(payload?.changedFiles) ? payload.changedFiles : []) {
          if (typeof file !== "string" || !file || seen.has(file)) continue
          seen.add(file)
          changes.push({
            file,
            status: "modified",
            additions: 0,
            deletions: 0,
          })
        }
      }
      const stats = payloads.find((payload: any) => payload?.diffStats)?.diffStats
      const commitRef = payloads
        .map((payload: any) => (typeof payload?.commitRef === "string" ? payload.commitRef.trim() : ""))
        .find(Boolean)
      if (changes.length === 0 && !goalRunID) return null
      return {
        id: `goal:${String(goal?.goalID || "")}:${String(goal?.goalRunID || "pre")}`,
        goalID: typeof goal?.goalID === "string" ? goal.goalID : undefined,
        goalRunID,
        goalOrderIndex: Number.isFinite(Number(goal?.orderIndex)) ? Number(goal.orderIndex) : undefined,
        goalRetryCount: Number.isFinite(Number(goal?.retryCount)) ? Number(goal.retryCount) : undefined,
        goalLabel: goalRevisionLabelFromIndexes(goal?.orderIndex, goal?.retryCount),
        goalTitle: typeof goal?.goalTitle === "string" ? goal.goalTitle : undefined,
        commitRef: commitRef || undefined,
        additions: typeof stats?.additions === "number" ? stats.additions : 0,
        deletions: typeof stats?.deletions === "number" ? stats.deletions : 0,
        changes,
      } satisfies ChangeGroup
    })
    .flatMap((group) => (group ? [group] : []))
    .sort(
      (left, right) =>
        (left.goalOrderIndex ?? Number.MAX_SAFE_INTEGER) - (right.goalOrderIndex ?? Number.MAX_SAFE_INTEGER),
    )
}

function taskAcceptanceGroup(): ChangeGroup[] {
  const changes = deriveChanges() as FileChange[]
  if (changes.length === 0) return []
  return [
    {
      id: "task-acceptance",
      runID: acceptanceRunID(),
      additions: sumAdditions(changes),
      deletions: sumDeletions(changes),
      changes,
    },
  ]
}

/** Find the acceptance runID for the currently selected task's acceptance. */
export function acceptanceRunID(): string {
  const board = boardStore.board as any
  const acceptance = board?.acceptedAcceptance || board?.acceptance || board?.candidateAcceptance
  return typeof acceptance?.runID === "string" ? acceptance.runID : ""
}

/** Goal-aware change groups for the currently selected task. */
export function currentChangeGroups(): ChangeGroup[] {
  const workflows = Array.isArray((boardStore.board as any)?.goalWorkflows)
    ? ((boardStore.board as any).goalWorkflows as any[])
    : []
  if (workflows.length > 0) return goalWorkflowStubs(workflows)
  const taskGroups = taskAcceptanceGroup()
  if (taskGroups.length > 0) return taskGroups
  if (Array.isArray(boardStore.changes) && boardStore.changes.length > 0) {
    const changes = boardStore.changes as FileChange[]
    return [
      {
        id: "store-changes",
        additions: sumAdditions(changes),
        deletions: sumDeletions(changes),
        changes,
      },
    ]
  }
  const raw = (boardStore.board as any)?.changes
  if (!Array.isArray(raw) || raw.length === 0) return []
  const changes = raw as FileChange[]
  return [
    {
      id: "board-changes",
      additions: sumAdditions(changes),
      deletions: sumDeletions(changes),
      changes,
    },
  ]
}

async function fetchScopedDiffs(scope: { goalRunID?: string; runID?: string }): Promise<FileChange[]> {
  const directory = acceptanceDirectory()
  const key = scopeCacheKey({ ...scope, directory })
  if (!key) return []
  const cached = diffCache.get(key)
  if (cached) return cached
  const active = diffInFlight.get(key)
  if (active) return active
  const pending = (async () => {
    const data = scope.goalRunID
      ? await apiJson(
          directoryScopedPath(`goal-run/${encodeURIComponent(scope.goalRunID)}/acceptance`, directory, "goal-run diff"),
        )
      : await apiJson(directoryScopedPath(`run/${encodeURIComponent(String(scope.runID))}/acceptance`, directory, "run diff"))
    const diffs = normalizeAcceptanceDiffs((data as any)?.result?.diffs)
    if (diffs.length > 0) diffCache.set(key, diffs)
    return diffs
  })()
  diffInFlight.set(key, pending)
  try {
    return await pending
  } finally {
    if (diffInFlight.get(key) === pending) diffInFlight.delete(key)
  }
}

/**
 * Fetch full diffs for the given acceptance run. Returns cached result for the
 * runID and throws on network failure.
 */
export async function fetchFullDiffs(runID: string): Promise<FileChange[]> {
  return fetchScopedDiffs({ runID })
}

export async function fetchGoalRunDiffs(goalRunID: string): Promise<FileChange[]> {
  return fetchScopedDiffs({ goalRunID })
}

export async function resolveCurrentChangeGroups(): Promise<ChangeGroup[]> {
  const groups = currentChangeGroups()
  return Promise.all(
    groups.map(async (group) => {
      if (!group.goalRunID && !group.runID) return group
      // Skip the API fetch when the stub already carries real per-file numbers
      // (board payload's changedFileDiffs path). The fetch is only needed to
      // upgrade to full before/after blobs for the workspace diff dialog,
      // which lazy-loads via resolveDiff() at click time.
      const hasRealStats = group.changes.some((c) => (c.additions ?? 0) > 0 || (c.deletions ?? 0) > 0)
      if (hasRealStats) return group
      try {
        const changes = group.goalRunID
          ? await fetchGoalRunDiffs(group.goalRunID)
          : await fetchFullDiffs(String(group.runID))
        if (changes.length === 0) return group
        return {
          ...group,
          additions: sumAdditions(changes),
          deletions: sumDeletions(changes),
          changes,
        } satisfies ChangeGroup
      } catch {
        return group
      }
    }),
  )
}

/**
 * Resolve a FileChange by path, fetching the full diff if needed. Returns
 * null when the scoped acceptance source has no preview body for that path.
 */
export async function resolveDiff(target: DiffTarget): Promise<FileChange | null> {
  const groups = currentChangeGroups()
  const group = target.goalRunID
    ? groups.find((candidate) => candidate.goalRunID === target.goalRunID) || null
    : groups.find((candidate) => candidate.changes.some((change) => change.file === target.filePath)) || null
  const stub = group?.changes.find((change) => change.file === target.filePath) || null
  if (stub?.isText === false) return stub
  if (hasDiffBody(stub)) {
    return stub
  }
  const goalRunID = target.goalRunID || group?.goalRunID
  const runID = goalRunID ? group?.runID : group?.runID || acceptanceRunID()
  if (goalRunID || runID) {
    const full = goalRunID ? await fetchGoalRunDiffs(goalRunID) : await fetchFullDiffs(String(runID))
    const scopedHit = findDiffByPath(full, target.filePath)
    if (scopedHit?.isText === false) return scopedHit
    if (hasDiffBody(scopedHit)) return scopedHit
  }
  return null
}
