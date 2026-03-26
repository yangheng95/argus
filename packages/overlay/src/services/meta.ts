// ── Meta Service ──
// TypeScript port of meta/changes functions from app.js:
//   loadMeta, loadChanges, normalizeDiffs, diffStatus, openDiffDialog.
//
// DOM-rendering functions (renderMeta, renderChanges, renderDiffPreview,
// openDiffDialog with DOM mutations) are intentionally NOT ported here —
// they are superseded by declarative Solid.js components (MetaPanel.tsx,
// ChangesPanel.tsx).

import { appStore, setAppStore } from "../store/app";
import { boardStore, setPath, setVcs } from "../store/board";
import { settingsStore } from "../store/settings";
import { AppLog } from "../utils/log";
import { apiJson } from "./api";
import { setWorkspaceDirectory } from "./workspace";

// ── Types ──

export type DiffStatus = "added" | "deleted" | "modified";

export interface DiffItem {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
  status: DiffStatus;
}

// ── loadMeta ──

/**
 * Fetches the current working path and VCS info from the server and updates
 * the app store.
 *
 * Mirrors loadMeta in app.js.  The directoryEpoch guard and the
 * setWorkspaceDirectory / renderMeta calls from app.js are omitted — callers
 * that need that coordination should implement it at the call site.
 */
export async function loadMeta(): Promise<void> {
  const epoch = settingsStore.directoryEpoch;
  try {
    const [path, vcs] = await Promise.all([
      apiJson("path"),
      apiJson("vcs"),
    ]);
    if (epoch !== settingsStore.directoryEpoch) return;
    const directory =
      path && typeof path.directory === "string"
        ? path.directory.trim()
        : "";
    setPath(directory ? { directory } : null);
    if (!settingsStore.directory && directory) {
      setWorkspaceDirectory(directory, "auto");
    }
    setVcs(vcs ?? null);
    setAppStore("config", (prev: any) => ({
      ...(prev ?? {}),
      _metaPath: directory ? { directory } : null,
      _metaVcs: vcs ?? null,
    }));
  } catch (e) {
    AppLog.debug("meta", "loadMeta failed, resetting path/vcs", {
      error: String(e),
    });
    if (epoch !== settingsStore.directoryEpoch) return;
    setPath(null);
    setVcs(null);
    setAppStore("config", (prev: any) => ({
      ...(prev ?? {}),
      _metaPath: null,
      _metaVcs: null,
    }));
  } finally {
    const { renderMeta } = await import("./legacy");
    renderMeta();
  }
}

// ── Diff helpers ──

/**
 * Normalises a raw diff list from the server into a consistent DiffItem array,
 * sorted by filename.
 *
 * Mirrors normalizeDiffs in app.js.
 */
export function normalizeDiffs(list: any[]): DiffItem[] {
  return (Array.isArray(list) ? list : [])
    .filter((item) => item && typeof item.file === "string")
    .map((item) => ({
      file: String(item.file || "").replace(/^[ab]\//, ""),
      before: typeof item.before === "string" ? item.before : "",
      after: typeof item.after === "string" ? item.after : "",
      additions: Number.isFinite(Number(item.additions))
        ? Number(item.additions)
        : 0,
      deletions: Number.isFinite(Number(item.deletions))
        ? Number(item.deletions)
        : 0,
      status: diffStatus(item),
    }))
    .sort((a, b) => a.file.localeCompare(b.file));
}

/**
 * Derives the diff status for a single raw diff item.
 *
 * Mirrors diffStatus in app.js.
 */
export function diffStatus(item: any): DiffStatus {
  if (
    item.status === "added" ||
    item.status === "deleted" ||
    item.status === "modified"
  ) {
    return item.status as DiffStatus;
  }
  if (!item.before && item.after) return "added";
  if (item.before && !item.after) return "deleted";
  return "modified";
}

// ── loadChanges ──

/**
 * Derives the current changes from the board store's delivery result diffs and
 * returns the normalised DiffItem list.
 *
 * NOTE: The original loadChanges in app.js wrote to state.changes and called
 * renderChanges().  This function returns the data instead, so callers can
 * update their own Solid signals/stores.
 *
 * Mirrors loadChanges in app.js (data derivation portion).
 */
export function deriveChanges(): DiffItem[] {
  if (!boardStore.selectedTaskID) return [];
  const board = boardStore.board as any;
  const delivery =
    board?.acceptedDelivery?.result?.diffs ||
    board?.delivery?.result?.diffs ||
    board?.candidateDelivery?.result?.diffs ||
    [];
  return normalizeDiffs(delivery);
}
