// ── ChangesPanel Component ──
// Shows the list of changed files for the selected task. Clicking a row
// surfaces the diff in the right-hand workspace via the window.openWorkspaceDiff
// bridge (wired in main.tsx). The panel itself is read-only — it does not
// render the diff inline any more.

import { createMemo, createResource, For, Show } from "solid-js";
import { boardStore } from "../store/board";
import {
  currentChangeGroups,
  resolveCurrentChangeGroups,
  resolveDiff,
  type ChangeGroup,
  type DiffTarget,
} from "../services/diff";
import { changeStatusLabel, type FileChange } from "./DiffView";
import { t, tc } from "../utils/i18n";

// ── ChangesPanel ──

export interface ChangesPanelProps {
  /**
   * File changes to display. If not provided, falls back to reading from
   * the shared diff service (boardStore-derived).
   */
  changes?: FileChange[];
  /** Whether a task is currently selected (affects empty-state messaging). */
  hasSelectedTask?: boolean;
}

export function ChangesPanel(props: ChangesPanelProps) {
  const fallbackGroups = createMemo<ChangeGroup[]>(() => {
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
    const groups = fallbackGroups();
    return props.changes !== undefined
      ? `props:${groups[0]?.changes.length ?? 0}`
      : `${boardStore.selectedTaskID}:${boardStore.snapshotVersion}:${groups.map((group) => group.id).join("|")}`;
  });

  const [resolvedGroups] = createResource(requestKey, async () => {
    if (props.changes !== undefined) return fallbackGroups();
    return resolveCurrentChangeGroups();
  });

  const groups = createMemo<ChangeGroup[]>(() => resolvedGroups() || fallbackGroups());
  const files = createMemo<FileChange[]>(() =>
    groups().flatMap((group) => group.changes),
  );

  const hasGoalGrouping = createMemo(() =>
    groups().some((group) => !!group.goalLabel),
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

  const totalAdditions = createMemo(() =>
    files().reduce((sum, item) => sum + (item.additions ?? 0), 0),
  );
  const totalDeletions = createMemo(() =>
    files().reduce((sum, item) => sum + (item.deletions ?? 0), 0),
  );

  return (
    <div class="changes-panel">
      <Show
        when={files().length > 0}
        fallback={
          <p class="empty-hint">
            {props.hasSelectedTask
              ? t("files.unavailable")
              : t("files.select_target")}
          </p>
        }
      >
        {/* Summary row */}
        <div class="changes-summary">
          <span>{tc("files.changed", files().length)}</span>
          <span class="changes-total">
            <span data-tone="add">+{totalAdditions()}</span>
            <span data-tone="del">-{totalDeletions()}</span>
          </span>
        </div>

        {/* File list */}
        <div class="changes-groups">
          <For each={groups()}>
            {(group) => (
              <section class="changes-group">
                <Show when={group.goalLabel}>
                  <div class="changes-group-head">
                    <span class="changes-group-copy">
                      <span class="changes-group-label">{group.goalLabel}</span>
                      <Show when={group.goalTitle}>
                        <span class="changes-group-title">{group.goalTitle}</span>
                      </Show>
                    </span>
                    <span class="changes-group-total">
                      <span data-tone="add">+{group.additions}</span>
                      <span data-tone="del">-{group.deletions}</span>
                    </span>
                  </div>
                </Show>
                <div class="changes-list" data-grouped={hasGoalGrouping() ? "true" : "false"}>
                  <For each={group.changes}>
                    {(item, index) => (
                      <button
                        type="button"
                        class="change-row"
                        data-change-index={index()}
                        title={item.file}
                        onClick={() => void handleRowClick(group, item)}
                      >
                        <span class="change-main">
                          <span class="change-path">{item.file}</span>
                        </span>
                        <span class="change-meta">
                          <span class="change-status" data-status={item.status}>
                            {changeStatusLabel(item.status)}
                          </span>
                          <span class="diff-dialog-stat" data-tone="add">
                            +{item.additions}
                          </span>
                          <span class="diff-dialog-stat" data-tone="del">
                            -{item.deletions}
                          </span>
                        </span>
                      </button>
                    )}
                  </For>
                </div>
              </section>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}
