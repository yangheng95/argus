// ── Diff service ──
// Module-level cache + lazy-loader for full file diffs fetched from the
// delivery API. Shared by ChangesPanel and DiffPreviewPanel so the first
// fetch for a given run is reused across all consumers.

import { apiJson } from "./api";
import { boardStore } from "../store/board";
import { deriveChanges, normalizeDiffs } from "./meta";
import type { FileChange } from "../components/DiffView";
import { goalRevisionLabelFromIndexes } from "../utils/goal-label";

export interface DiffTarget {
  filePath: string;
  goalRunID?: string;
  goalLabel?: string;
}

export interface ChangeGroup {
  id: string;
  goalID?: string;
  goalRunID?: string;
  goalOrderIndex?: number;
  goalRetryCount?: number;
  goalLabel?: string;
  goalTitle?: string;
  runID?: string;
  additions: number;
  deletions: number;
  changes: FileChange[];
}

const diffCache = new Map<string, FileChange[]>();

function normalizeDeliveryDiffs(rawDiffs: unknown): FileChange[] {
  return normalizeDiffs(Array.isArray(rawDiffs) ? rawDiffs : []) as FileChange[];
}

function sumAdditions(changes: FileChange[]): number {
  return changes.reduce((sum, item) => sum + (item.additions ?? 0), 0);
}

function sumDeletions(changes: FileChange[]): number {
  return changes.reduce((sum, item) => sum + (item.deletions ?? 0), 0);
}

function scopeCacheKey(scope: { goalRunID?: string; runID?: string }): string {
  if (scope.goalRunID) return `goal-run:${scope.goalRunID}`;
  if (scope.runID) return `run:${scope.runID}`;
  return "";
}

function goalWorkflowStubs(workflows: any[]): ChangeGroup[] {
  return workflows
    .map((goal) => {
      const payloads = Array.isArray(goal?.steps)
        ? goal.steps
            .map((step: any) => step?.payload)
            .filter((payload: any) => payload && (Array.isArray(payload.changedFiles) || payload.diffStats))
        : [];
      const goalRunID = typeof goal?.goalRunID === "string" && goal.goalRunID
        ? goal.goalRunID
        : undefined;
      const seen = new Set<string>();
      const changes: FileChange[] = [];
      for (const payload of payloads) {
        for (const file of Array.isArray(payload?.changedFiles) ? payload.changedFiles : []) {
          if (typeof file !== "string" || !file || seen.has(file)) continue;
          seen.add(file);
          changes.push({
            file,
            status: "modified",
            additions: 0,
            deletions: 0,
          });
        }
      }
      const stats = payloads.find((payload: any) => payload?.diffStats)?.diffStats;
      if (changes.length === 0 && !goalRunID) return null;
      return {
        id: `goal:${String(goal?.goalID || "")}:${String(goal?.goalRunID || "pre")}`,
        goalID: typeof goal?.goalID === "string" ? goal.goalID : undefined,
        goalRunID,
        goalOrderIndex: Number.isFinite(Number(goal?.orderIndex)) ? Number(goal.orderIndex) : undefined,
        goalRetryCount: Number.isFinite(Number(goal?.retryCount)) ? Number(goal.retryCount) : undefined,
        goalLabel: goalRevisionLabelFromIndexes(goal?.orderIndex, goal?.retryCount),
        goalTitle: typeof goal?.goalTitle === "string" ? goal.goalTitle : undefined,
        additions: typeof stats?.additions === "number" ? stats.additions : 0,
        deletions: typeof stats?.deletions === "number" ? stats.deletions : 0,
        changes,
      } satisfies ChangeGroup;
    })
    .flatMap((group) => (group ? [group] : []))
    .sort((left, right) => (left.goalOrderIndex ?? Number.MAX_SAFE_INTEGER) - (right.goalOrderIndex ?? Number.MAX_SAFE_INTEGER));
}

function taskDeliveryGroup(): ChangeGroup[] {
  const changes = deriveChanges() as FileChange[];
  if (changes.length === 0) return [];
  return [
    {
      id: "task-delivery",
      runID: deliveryRunID(),
      additions: sumAdditions(changes),
      deletions: sumDeletions(changes),
      changes,
    },
  ];
}

/** Find the delivery runID for the currently selected task's delivery. */
export function deliveryRunID(): string {
  const board = boardStore.board as any;
  const delivery =
    board?.acceptedDelivery || board?.delivery || board?.candidateDelivery;
  return typeof delivery?.runID === "string" ? delivery.runID : "";
}

/** Goal-aware change groups for the currently selected task. */
export function currentChangeGroups(): ChangeGroup[] {
  const workflows = Array.isArray((boardStore.board as any)?.goalWorkflows)
    ? ((boardStore.board as any).goalWorkflows as any[])
    : [];
  if (workflows.length > 0) return goalWorkflowStubs(workflows);
  const taskGroups = taskDeliveryGroup();
  if (taskGroups.length > 0) return taskGroups;
  if (Array.isArray(boardStore.changes) && boardStore.changes.length > 0) {
    const changes = boardStore.changes as FileChange[];
    return [
      {
        id: "store-changes",
        additions: sumAdditions(changes),
        deletions: sumDeletions(changes),
        changes,
      },
    ];
  }
  const raw = (boardStore.board as any)?.changes;
  if (!Array.isArray(raw) || raw.length === 0) return [];
  const changes = raw as FileChange[];
  return [
    {
      id: "board-changes",
      additions: sumAdditions(changes),
      deletions: sumDeletions(changes),
      changes,
    },
  ];
}

/** Flattened view of currentChangeGroups() for legacy callers. */
export function currentChanges(): FileChange[] {
  return currentChangeGroups().flatMap((group) => group.changes);
}

async function fetchScopedDiffs(scope: { goalRunID?: string; runID?: string }): Promise<FileChange[]> {
  const key = scopeCacheKey(scope);
  if (!key) return [];
  const cached = diffCache.get(key);
  if (cached) return cached;
  const data = scope.goalRunID
    ? await apiJson(`goal-run/${encodeURIComponent(scope.goalRunID)}/delivery`)
    : await apiJson(`run/${encodeURIComponent(String(scope.runID))}/delivery`);
  const diffs = normalizeDeliveryDiffs((data as any)?.result?.diffs);
  diffCache.set(key, diffs);
  return diffs;
}

/**
 * Fetch full diffs for the given delivery run. Returns cached result if the
 * runID matches the last fetch. Throws on network failure; callers decide
 * whether to fall back to a stub FileChange.
 */
export async function fetchFullDiffs(runID: string): Promise<FileChange[]> {
  return fetchScopedDiffs({ runID });
}

export async function fetchGoalRunDiffs(goalRunID: string): Promise<FileChange[]> {
  return fetchScopedDiffs({ goalRunID });
}

export async function resolveCurrentChangeGroups(): Promise<ChangeGroup[]> {
  const groups = currentChangeGroups();
  return Promise.all(
    groups.map(async (group) => {
      if (!group.goalRunID && !group.runID) return group;
      try {
        const changes = group.goalRunID
          ? await fetchGoalRunDiffs(group.goalRunID)
          : await fetchFullDiffs(String(group.runID));
        if (changes.length === 0) return group;
        return {
          ...group,
          additions: sumAdditions(changes),
          deletions: sumDeletions(changes),
          changes,
        } satisfies ChangeGroup;
      } catch {
        return group;
      }
    }),
  );
}

/**
 * Resolve a FileChange by path, fetching the full diff if needed. Returns
 * null when the file cannot be located. Never throws — on failure falls back
 * to whatever metadata is available in boardStore.
 */
export async function resolveDiff(target: DiffTarget): Promise<FileChange | null> {
  const groups = currentChangeGroups();
  const group = target.goalRunID
    ? groups.find((candidate) => candidate.goalRunID === target.goalRunID) || null
    : groups.find((candidate) => candidate.changes.some((change) => change.file === target.filePath)) || null;
  const stub = group?.changes.find((change) => change.file === target.filePath) || null;
  if (stub && (stub.before !== undefined || stub.after !== undefined)) {
    return stub;
  }
  const goalRunID = target.goalRunID || group?.goalRunID;
  const runID = goalRunID ? group?.runID : group?.runID || deliveryRunID();
  if (!goalRunID && !runID) return stub;
  try {
    const full = goalRunID ? await fetchGoalRunDiffs(goalRunID) : await fetchFullDiffs(runID);
    const hit = full.find((d) => d.file === target.filePath);
    return hit || stub;
  } catch {
    return stub;
  }
}
