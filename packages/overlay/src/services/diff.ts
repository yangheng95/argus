// ── Diff service ──
// Module-level cache + lazy-loader for full file diffs fetched from the
// delivery API. Shared by ChangesPanel and DiffPreviewPanel so the first
// fetch for a given run is reused across all consumers.

import { apiJson } from "./api";
import { boardStore } from "../store/board";
import { deriveChanges } from "./meta";
import type { FileChange } from "../components/DiffView";

// Cache is keyed by delivery runID. A new run invalidates the previous cache.
let cache: { runID: string; diffs: FileChange[] } | null = null;

/** Find the delivery runID for the currently selected task's delivery. */
export function deliveryRunID(): string {
  const board = boardStore.board as any;
  const delivery =
    board?.acceptedDelivery || board?.delivery || board?.candidateDelivery;
  return typeof delivery?.runID === "string" ? delivery.runID : "";
}

/** List of files currently derivable from boardStore without a fetch. */
export function currentChanges(): FileChange[] {
  const derived = deriveChanges();
  if (derived.length > 0) return derived as FileChange[];
  if (Array.isArray(boardStore.changes) && boardStore.changes.length > 0) {
    return boardStore.changes as FileChange[];
  }
  const raw = (boardStore.board as any)?.changes;
  return Array.isArray(raw) ? (raw as FileChange[]) : [];
}

/**
 * Fetch full diffs for the given delivery run. Returns cached result if the
 * runID matches the last fetch. Throws on network failure; callers decide
 * whether to fall back to a stub FileChange.
 */
export async function fetchFullDiffs(runID: string): Promise<FileChange[]> {
  if (cache && cache.runID === runID) return cache.diffs;
  const data = await apiJson(`run/${encodeURIComponent(runID)}/delivery`);
  const rawDiffs = (data as any)?.result?.diffs;
  const diffs: FileChange[] = (Array.isArray(rawDiffs) ? rawDiffs : [])
    .filter((d: any) => d && typeof d.file === "string")
    .map((d: any) => ({
      file: String(d.file || "").replace(/^[ab]\//, ""),
      status:
        d.status ||
        (!d.before && d.after
          ? "added"
          : d.before && !d.after
            ? "deleted"
            : "modified"),
      additions: typeof d.additions === "number" ? d.additions : 0,
      deletions: typeof d.deletions === "number" ? d.deletions : 0,
      before: typeof d.before === "string" ? d.before : undefined,
      after: typeof d.after === "string" ? d.after : undefined,
    }));
  cache = { runID, diffs };
  return diffs;
}

/**
 * Resolve a FileChange by path, fetching the full diff if needed. Returns
 * null when the file cannot be located. Never throws — on failure falls back
 * to whatever metadata is available in boardStore.
 */
export async function resolveDiff(filePath: string): Promise<FileChange | null> {
  const changes = currentChanges();
  const stub = changes.find((c) => c.file === filePath) || null;
  if (stub && (stub.before !== undefined || stub.after !== undefined)) {
    return stub;
  }
  const runID = deliveryRunID();
  if (!runID) return stub;
  try {
    const full = await fetchFullDiffs(runID);
    const hit = full.find((d) => d.file === filePath);
    return hit || stub;
  } catch {
    return stub;
  }
}
