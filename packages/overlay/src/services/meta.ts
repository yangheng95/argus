// ── Meta Service ──
// TypeScript port of meta/changes functions
// loadMeta, loadChanges, normalizeDiffs, diffStatus, openDiffDialog.

import { setAppStore } from "../store/app"
import { boardStore, setPath, setVcs, activeTaskID } from "../store/board"
import { settingsStore } from "../store/settings"
import { AppLog } from "../utils/log"
import { apiJson } from "./api"
import { setWorkspaceDirectory } from "./workspace"

// ── Types ──

export type DiffStatus = "added" | "deleted" | "modified"

export interface DiffItem {
  file: string
  before?: string
  after?: string
  additions: number
  deletions: number
  status: DiffStatus
}

// ── loadMeta ──

/**
 * Fetches the current working path and VCS info from the server and updates
 * the app store. Work Ledger project groups manage already-opened projects,
 * while the compact VCS badge renders through the right toolbar
 * ProjectRuntimeToolbarActions component (TaskDirBar.tsx). Both react to
 * settingsStore.directory / boardStore.path automatically; loadMeta only
 * pushes data into the stores. Per-goal worktree display lives on the
 * right-side GoalWorkflowGroup card, not on this surface.
 */
export async function loadMeta(): Promise<void> {
  const epoch = settingsStore.directoryEpoch
  try {
    const [path, vcs] = await Promise.all([apiJson("path"), apiJson("vcs")])
    if (epoch !== settingsStore.directoryEpoch) return
    const directory = path && typeof path.directory === "string" ? path.directory.trim() : ""
    setPath(directory ? { directory } : null)
    if (!settingsStore.directory && directory) {
      setWorkspaceDirectory(directory, "auto")
    }
    setVcs(vcs ?? null)
    setAppStore("config", (prev: any) => ({
      ...(prev ?? {}),
      _metaPath: directory ? { directory } : null,
      _metaVcs: vcs ?? null,
    }))
  } catch (e) {
    AppLog.debug("meta", "loadMeta failed", {
      error: String(e),
    })
    if (epoch !== settingsStore.directoryEpoch) return
    throw e
  }
}

// ── Diff helpers ──

/**
 * Normalises a raw diff list from the server into a consistent DiffItem array,
 * sorted by filename.
 * Mirrors normalizeDiffs.
 */
export function normalizeDiffs(list: any[]): DiffItem[] {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item.file === "string")
    .map((item) => ({
      file: String(item.file || "").replace(/^[ab]\//, ""),
      before: typeof item.before === "string" ? item.before : undefined,
      after: typeof item.after === "string" ? item.after : undefined,
      additions: Number.isFinite(Number(item.additions)) ? Number(item.additions) : 0,
      deletions: Number.isFinite(Number(item.deletions)) ? Number(item.deletions) : 0,
      status: diffStatus(item),
    }))
    .sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * Derives the diff status for a single raw diff item.
 * Mirrors diffStatus.
 */
export function diffStatus(item: any): DiffStatus {
  if (item.status === "added" || item.status === "deleted" || item.status === "modified") {
    return item.status as DiffStatus
  }
  if (!item.before && item.after) return "added"
  if (item.before && !item.after) return "deleted"
  return "modified"
}

// ── loadChanges ──

/**
 * Derives the current changes from the board store's acceptance result diffs and
 * returns the normalised DiffItem list.
 * NOTE: The original loadChanges.changes and called
 * renderChanges(). This function returns the data instead, so callers can
 * update their own Solid signals/stores.
 * Mirrors loadChanges.
 */
export function deriveChanges(): DiffItem[] {
  if (!activeTaskID()) return []
  const board = boardStore.board as any
  const acceptance =
    board?.acceptedAcceptance?.result?.diffs ||
    board?.acceptance?.result?.diffs ||
    board?.candidateAcceptance?.result?.diffs ||
    []
  return normalizeDiffs(acceptance)
}
