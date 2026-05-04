// ── ChangesPanel Component ──
// Shows the list of changed files for the selected task. Clicking a row
// surfaces the diff in the right-hand workspace via the window.openWorkspaceDiff
// bridge (wired in main.tsx). The panel itself is read-only — it does not
// render the diff inline any more.

import { createEffect, createMemo, createResource, createSignal, For, onCleanup, onMount, Show } from "solid-js";
import { boardStore } from "../store/board";
import { Icon } from "./Icon";
import { useDisclosure } from "../solid/disclosure";
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
  // iter49: open/close state for the goal-grouping dropdown that
  // replaces the previous vertical changes-tabs list. Outside-
  // click + Escape close handled by document-level listeners
  // attached at component scope so HMR / unmount disposes them.
  const goalMenu = useDisclosure()
  if (typeof document !== "undefined") {
    const onDocClick = (event: MouseEvent) => {
      if (!goalMenu.open()) return
      const target = event.target as Element | null
      if (target && target.closest && target.closest(".changes-goal-picker")) return
      goalMenu.close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && goalMenu.open()) goalMenu.close()
    }
    document.addEventListener("click", onDocClick, { capture: true })
    document.addEventListener("keydown", onKey)
    onCleanup(() => {
      document.removeEventListener("click", onDocClick, { capture: true })
      document.removeEventListener("keydown", onKey)
    })
  }

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
      if (match) setSelectedGroupID(match.id);
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

        {/* iter49: user feedback (2026-05-03) "文件差异的 tab
            内的不同的 Goal 合并到一个下拉列表（不要用原生
            样式，太难看了）". The previous vertical
            `.changes-tabs` list rendered one button per goal
            group — at 8+ goals the list dominated the panel.
            Replaced with a single dropdown trigger styled
            exactly like other overlay chips (no native
            <select>, no UA chrome). Click toggles a custom
            menu containing one row per goal with
            label + change count. Keyboard nav keeps
            ArrowUp/Down/Home/End semantics. */}
        <Show when={hasGoalGrouping()}>
          <div
            class="changes-goal-picker"
            data-open={goalMenu.open() ? "true" : "false"}
          >
            <button
              type="button"
              class="changes-goal-picker-trigger"
              aria-haspopup="listbox"
              aria-expanded={goalMenu.open() ? "true" : "false"}
              title={activeGroup() ? tabTitle(activeGroup()!) : ""}
              onClick={(e) => {
                e.stopPropagation()
                goalMenu.toggle()
              }}
              onKeyDown={(e) => {
                if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") {
                  e.preventDefault()
                  goalMenu.openIt()
                }
              }}
            >
              <span class="changes-goal-picker-label">
                {activeGroup() ? tabLabel(activeGroup()!) : ""}
              </span>
              <Show when={activeGroup()}>
                <span class="changes-goal-picker-count" aria-hidden="true">
                  {activeGroup()!.changes.length}
                </span>
              </Show>
              <span class="changes-goal-picker-caret" aria-hidden="true">
                <Icon name="caret-down" size={8} />
              </span>
            </button>
            <Show when={goalMenu.open()}>
              <div
                class="changes-goal-picker-menu"
                role="listbox"
                aria-label={t("section.files")}
                onKeyDown={(e) => {
                  const list = groups()
                  if (list.length === 0) return
                  const currentIdx = Math.max(0, list.findIndex((g) => g.id === activeGroup()?.id))
                  let next = currentIdx
                  if (e.key === "ArrowDown") next = (currentIdx + 1) % list.length
                  else if (e.key === "ArrowUp") next = (currentIdx - 1 + list.length) % list.length
                  else if (e.key === "Home") next = 0
                  else if (e.key === "End") next = list.length - 1
                  else if (e.key === "Escape") { goalMenu.close(); return }
                  else return
                  e.preventDefault()
                  setSelectedGroupID(list[next]!.id)
                }}
              >
                <For each={groups()}>
                  {(group) => {
                    const active = () => group.id === activeGroup()?.id
                    return (
                      <button
                        type="button"
                        class="changes-goal-picker-row"
                        role="option"
                        aria-selected={active()}
                        data-active={active() ? "true" : "false"}
                        title={tabTitle(group)}
                        onClick={() => {
                          setSelectedGroupID(group.id)
                          goalMenu.close()
                        }}
                      >
                        <span class="changes-goal-picker-row-label">{tabLabel(group)}</span>
                        <span class="changes-goal-picker-row-count" aria-hidden="true">
                          {group.changes.length}
                        </span>
                      </button>
                    )
                  }}
                </For>
              </div>
            </Show>
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
        <div class="changes-list" data-grouped={hasGoalGrouping() ? "true" : "false"}>
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
            )}
          </For>
        </div>
      </Show>
    </Show>
  );
}
