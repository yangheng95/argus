// ── ChangesPanel Component ──
// Shows the list of changed files for the selected task. Clicking a row
// surfaces the diff in the right-hand workspace via the window.openWorkspaceDiff
// bridge (wired in main.tsx). The panel itself is read-only — it does not
// render the diff inline any more.

import { createEffect, createMemo, createResource, createSignal, For, Show } from "solid-js";
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
  const [selectedGroupID, setSelectedGroupID] = createSignal("");

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

  const groups = createMemo<ChangeGroup[]>(() =>
    (resolvedGroups() || fallbackGroups()).filter((group) => group.changes.length > 0),
  );
  const files = createMemo<FileChange[]>(() =>
    groups().flatMap((group) => group.changes),
  );
  const hideEmptySelection = createMemo(() => !!props.hasSelectedTask && files().length === 0);

  const hasGoalGrouping = createMemo(() =>
    groups().some((group) => !!group.goalLabel),
  );
  const activeGroup = createMemo<ChangeGroup | null>(() => {
    const currentGroups = groups();
    if (currentGroups.length === 0) return null;
    const selectedID = selectedGroupID();
    return currentGroups.find((group) => group.id === selectedID) || currentGroups[0] || null;
  });
  const visibleEntries = createMemo<Array<{ group: ChangeGroup; item: FileChange }>>(() => {
    if (hasGoalGrouping()) {
      const group = activeGroup();
      if (!group) return [];
      return group.changes.map((item) => ({ group, item }));
    }
    return groups().flatMap((group) => group.changes.map((item) => ({ group, item })));
  });

  const openWorkspaceDiff = (window as any).openWorkspaceDiff as
    | ((target: DiffTarget) => void)
    | undefined;

  createEffect(() => {
    const currentGroups = groups();
    const selectedID = selectedGroupID();
    if (currentGroups.length === 0) {
      if (selectedID) setSelectedGroupID("");
      return;
    }
    if (selectedID && currentGroups.some((group) => group.id === selectedID)) return;
    setSelectedGroupID(currentGroups[0]!.id);
  });

  createEffect(() => {
    const section = document.getElementById("changesSection");
    if (!(section instanceof HTMLElement)) return;
    section.hidden = hideEmptySelection();
  });

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
  const tabLabel = (group: ChangeGroup): string =>
    group.goalLabel || group.goalTitle || group.id;
  const tabTitle = (group: ChangeGroup): string =>
    [group.goalLabel, group.goalTitle].filter(Boolean).join(" · ") || group.id;

  return (
    <Show when={!hideEmptySelection()}>
      <Show
        when={files().length > 0}
        fallback={
          <Show when={!props.hasSelectedTask}>
            <p class="empty-hint">{t("files.select_target")}</p>
          </Show>
        }
      >
        <div class="changes-summary">
          <span>{tc("files.changed", files().length)}</span>
          <span class="changes-total">
            <span data-tone="add">+{totalAdditions()}</span>
            <span data-tone="del">-{totalDeletions()}</span>
          </span>
        </div>

        <Show when={hasGoalGrouping()}>
          <div class="changes-tabs" role="tablist" aria-label={t("section.files")}>
            <For each={groups()}>
              {(group) => {
                const active = () => activeGroup()?.id === group.id;
                return (
                  <button
                    type="button"
                    class="changes-tab"
                    role="tab"
                    aria-selected={active()}
                    data-active={active() ? "true" : "false"}
                    title={tabTitle(group)}
                    onClick={() => setSelectedGroupID(group.id)}
                  >
                    <span class="changes-tab-label">{tabLabel(group)}</span>
                    <span class="changes-tab-count">{group.changes.length}</span>
                  </button>
                );
              }}
            </For>
          </div>
        </Show>

        <div class="changes-list" data-grouped={hasGoalGrouping() ? "true" : "false"}>
          <For each={visibleEntries()}>
            {({ group, item }, index) => (
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
      </Show>
    </Show>
  );
}
