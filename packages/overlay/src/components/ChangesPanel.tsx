// ── ChangesPanel Component ──
// Shows the list of changed files for the selected task. Clicking a row
// surfaces the diff in the right-hand workspace via the window.openWorkspaceDiff
// bridge (wired in main.tsx). The panel itself is read-only — it does not
// render the diff inline any more.

import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { boardStore } from "../store/board";
import {
  currentChangeGroups,
  resolveCurrentChangeGroups,
  resolveDiff,
  type ChangeGroup,
  type DiffTarget,
} from "../services/diff";
import { type FileChange } from "./DiffView";
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
  const scrollByGroup = new Map<string, number>();
  let listRef: HTMLDivElement | undefined;

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
  const activeGroupID = createMemo(() => activeGroup()?.id || "");
  const openWorkspaceDiff = (window as any).openWorkspaceDiff as
    | ((target: DiffTarget) => void)
    | undefined;

  const saveActiveGroupScroll = () => {
    const id = activeGroupID();
    if (!id || !listRef) return;
    scrollByGroup.set(id, listRef.scrollTop);
  };

  const restoreGroupScroll = (groupID: string) => {
    if (!listRef) return;
    const nextTop = scrollByGroup.get(groupID) ?? 0;
    requestAnimationFrame(() => {
      if (listRef) listRef.scrollTop = nextTop;
    });
  };

  const selectGroupID = (groupID: string) => {
    if (!groupID || groupID === activeGroupID()) return;
    saveActiveGroupScroll();
    setSelectedGroupID(groupID);
    restoreGroupScroll(groupID);
  };

  createEffect(() => {
    const currentGroups = groups();
    const selectedID = selectedGroupID();
    if (currentGroups.length === 0) {
      if (selectedID) setSelectedGroupID("");
      return;
    }
    if (selectedID && currentGroups.some((group) => group.id === selectedID)) {
      restoreGroupScroll(selectedID);
      return;
    }
    const nextID = currentGroups[0]!.id;
    setSelectedGroupID(nextID);
    restoreGroupScroll(nextID);
  });

  // CCE = canonical click-through event from DeliveryPanel. When the
  // operator clicks a goal-pill or files-changed footer in the delivery
  // panel, we surface that goal's tab here without prop drilling. detail
  // .goalRunID may be undefined (whole-task focus) — in that case we
  // leave the existing selection alone and the parent <details> opens
  // via the natural `[open]` attribute on FilesSection.
  onMount(() => {
    if (typeof window === "undefined") return;
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<{ goalRunID?: string }>).detail;
      const requestedRunID = detail?.goalRunID;
      if (!requestedRunID) return;
      const candidates = groups();
      const match = candidates.find((group) => group.goalRunID === requestedRunID);
      if (match) selectGroupID(match.id);
    };
    window.addEventListener("delivery:focus-changes", handler as EventListener);
    onCleanup(() => {
      window.removeEventListener("delivery:focus-changes", handler as EventListener);
    });
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
          <div
            class="changes-tabs"
            role="tablist"
            aria-label={t("section.files")}
            onKeyDown={(e) => {
              const list = groups()
              if (list.length <= 1) return
              const currentIdx = Math.max(0, list.findIndex((g) => g.id === activeGroup()?.id))
              let next = currentIdx
              if (e.key === "ArrowRight") next = (currentIdx + 1) % list.length
              else if (e.key === "ArrowLeft") next = (currentIdx - 1 + list.length) % list.length
              else if (e.key === "Home") next = 0
              else if (e.key === "End") next = list.length - 1
              else return
              e.preventDefault()
              selectGroupID(list[next]!.id)
            }}
          >
            <For each={groups()}>
              {(group) => {
                const active = () => group.id === activeGroup()?.id
                return (
                  <button
                    type="button"
                    class="changes-tab"
                    role="tab"
                    aria-selected={active()}
                    data-active={active() ? "true" : "false"}
                    tabindex={active() ? 0 : -1}
                    title={tabTitle(group)}
                    onClick={() => selectGroupID(group.id)}
                  >
                    <span class="changes-tab-label">{tabLabel(group)}</span>
                    <span class="changes-tab-count" aria-hidden="true">
                      {group.changes.length}
                    </span>
                  </button>
                )
              }}
            </For>
          </div>
        </Show>

        {/*
          All-groups list strategy: mount every group's rows once and toggle
          visibility via `data-active-group` on the list ancestor + a
          `data-group-id` attribute on each chunk. Switching tabs flips one
          attribute and CSS hides the inactive chunks — no Solid reconcile
          runs on the row list, so goal-count × file-count stays off the
          critical path of clicking a tab.
        */}
        <div
          ref={(el) => (listRef = el)}
          class="changes-list"
          data-grouped={hasGoalGrouping() ? "true" : "false"}
          onScroll={saveActiveGroupScroll}
        >
          <For each={hasGoalGrouping() ? groups() : [groups()[0]].filter(Boolean) as ChangeGroup[]}>
            {(group) => (
              <div
                class="changes-list-chunk"
                data-group-id={group.id}
                data-active={
                  !hasGoalGrouping() || activeGroup()?.id === group.id ? "true" : "false"
                }
              >
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
            )}
          </For>
        </div>
      </Show>
    </Show>
  );
}
