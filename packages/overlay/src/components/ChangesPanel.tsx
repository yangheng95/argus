// ── ChangesPanel Component ──
// Shows the list of changed files for the selected task. Clicking a row
// surfaces the diff in the right-hand workspace via the window.openWorkspaceDiff
// bridge (wired in main.tsx). The panel itself is read-only — it does not
// render the diff inline any more.

import { createMemo, For, Show } from "solid-js";
import { boardStore } from "../store/board";
import { currentChanges, resolveDiff } from "../services/diff";
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
  const files = createMemo<FileChange[]>(() => {
    if (props.changes !== undefined) return props.changes;
    return currentChanges();
  });

  const totalAdditions = createMemo(() =>
    files().reduce((sum, item) => sum + (item.additions ?? 0), 0),
  );
  const totalDeletions = createMemo(() =>
    files().reduce((sum, item) => sum + (item.deletions ?? 0), 0),
  );

  async function handleRowClick(item: FileChange) {
    const openWorkspaceDiff = (window as any).openWorkspaceDiff as
      | ((filePath: string) => void)
      | undefined;
    if (typeof openWorkspaceDiff !== "function") return;
    // Kick off the resolve in the background so the shared diff cache is
    // warm by the time DiffPreviewPanel mounts; DiffPreviewPanel will also
    // call resolveDiff itself, so this is purely a latency optimisation.
    void resolveDiff(item.file);
    openWorkspaceDiff(item.file);
  }

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
        <div class="changes-list">
          <For each={files()}>
            {(item, index) => (
              <button
                type="button"
                class="change-row"
                data-change-index={index()}
                title={item.file}
                onClick={() => void handleRowClick(item)}
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
    </div>
  );
}
