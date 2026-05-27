// ── ChangesPanel Component ──
// Shows the list of changed files for the selected task. Clicking a row
// surfaces the diff in the right-hand workspace via the window.openWorkspaceDiff
// bridge (wired in main.tsx). The panel itself is read-only — it does not
// render the diff inline any more.

import { createMemo, createResource } from "solid-js";
import { boardStore,
  activeTaskID,
} from "../store/board";
import {
  changeGroupsRevisionKey,
  currentChangeGroups,
  resolveCurrentChangeGroups,
  resolveDiff,
  type ChangeGroup,
  type DiffTarget,
} from "../services/diff";
import type { FileChange } from "./DiffView";
import { FileChangesView } from "./FileChangesView";

// ── ChangesPanel ──

export interface ChangesPanelProps {
  /** File changes to display. If omitted, the shared diff service supplies board-derived groups. */
  changes?: FileChange[];
  /** Whether a task is currently selected (affects empty-state messaging). */
  hasSelectedTask?: boolean;
}

export function ChangesPanel(props: ChangesPanelProps) {
  const sourceGroups = createMemo<ChangeGroup[]>(() => {
    if (props.changes === undefined) return currentChangeGroups();
    const changes = props.changes;
    return [
      {
        id: "props",
        additions: changes.reduce((sum, item) => sum + (item.additions ?? 0), 0),
        deletions: changes.reduce((sum, item) => sum + (item.deletions ?? 0), 0),
        changes,
      },
    ];
  });

  const requestKey = createMemo(() => {
    const groups = sourceGroups();
    return props.changes !== undefined
      ? `props:${groups[0]?.changes.length ?? 0}`
      : `${activeTaskID()}:${boardStore.snapshotVersion}:${changeGroupsRevisionKey(groups)}`;
  });

  const [resolvedGroups] = createResource(requestKey, async () => {
    if (props.changes !== undefined) return sourceGroups();
    return resolveCurrentChangeGroups();
  });

  const groups = createMemo<ChangeGroup[]>(() =>
    (resolvedGroups() || sourceGroups()).filter((group) => group.changes.length > 0),
  );
  const openWorkspaceDiff = (window as any).openWorkspaceDiff as
    | ((target: DiffTarget) => void)
    | undefined;

  async function handleRowClick(group: ChangeGroup, item: FileChange) {
    if (typeof openWorkspaceDiff !== "function") return;
    const target: DiffTarget = {
      filePath: item.file,
      ...(group.goalRunID ? { goalRunID: group.goalRunID } : {}),
      ...(group.goalLabel ? { goalLabel: group.goalLabel } : {}),
    };
    void resolveDiff(target);
    openWorkspaceDiff(target);
  }

  return (
    <FileChangesView
      groups={groups()}
      hasSelectedTask={props.hasSelectedTask}
      focusEvent="delivery:focus-changes"
      onRowClick={handleRowClick}
    />
  );
}
