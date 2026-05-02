// ── WorkspacePanel ──
// Right-hand secondary workspace. Hosts Diff / File views behind a shared
// tab bar with a close affordance. Each view is display-toggled so that
// cache/resource state is preserved when switching tabs.

import { Show } from "solid-js";
import { DiffPreviewPanel } from "./DiffPreviewPanel";
import { FileViewPanel } from "./FileViewPanel";
import type { DiffTarget } from "../services/diff";
import { t } from "../utils/i18n";

export type WorkspaceView =
  | { kind: "diff"; target: DiffTarget }
  | { kind: "file"; filePath: string };

export interface WorkspacePanelProps {
  /** Current view to foreground. */
  view: WorkspaceView;
  /** Called when the user clicks a tab to change views. */
  onSelectView: (view: WorkspaceView) => void;
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const isDiff = () => props.view.kind === "diff";
  const isFile = () => props.view.kind === "file";
  const diffTarget = () =>
    props.view.kind === "diff" ? props.view.target : null;
  const diffFilePath = () =>
    props.view.kind === "diff" ? props.view.target.filePath : null;
  const fileFilePath = () =>
    props.view.kind === "file" ? props.view.filePath : null;

  function selectDiff() {
    if (props.view.kind !== "diff") {
      props.onSelectView({ kind: "diff", target: { filePath: "" } });
    }
  }
  function selectFile() {
    if (props.view.kind !== "file") {
      props.onSelectView({ kind: "file", filePath: "" });
    }
  }

  return (
    <section class="workspace" id="workspacePanel">
      <header class="workspace-header">
        <div class="workspace-tabs" role="tablist">
          <button
            type="button"
            class="workspace-tab"
            role="tab"
            aria-selected={isDiff()}
            data-active={isDiff() ? "true" : "false"}
            onClick={selectDiff}
          >
            <span class="workspace-tab-label">
              {t("workspace.diff")}
              <Show when={diffFilePath()}>
                <span class="workspace-tab-file">
                  {" · "}
                  {shortFileName(diffFilePath() || "")}
                </span>
              </Show>
            </span>
          </button>
          <button
            type="button"
            class="workspace-tab"
            role="tab"
            aria-selected={isFile()}
            data-active={isFile() ? "true" : "false"}
            onClick={selectFile}
          >
            <span class="workspace-tab-label">
              {t("workspace.file")}
              <Show when={fileFilePath()}>
                <span class="workspace-tab-file">
                  {" · "}
                  {shortFileName(fileFilePath() || "")}
                </span>
              </Show>
            </span>
          </button>
        </div>
      </header>
      <div class="workspace-body">
        {/* Diff view — always mounted so resource cache is retained.
            data-active drives display via CSS so the inline style toggle
            doesn't have to reproduce the layout's `display: flex`. */}
        <div
          class="workspace-view"
          data-kind="diff"
          data-active={isDiff() ? "true" : "false"}
        >
          <DiffPreviewPanel target={diffTarget()} />
        </div>
        {/* File view — lazy fetches file content via /file/content */}
        <div
          class="workspace-view"
          data-kind="file"
          data-active={isFile() ? "true" : "false"}
        >
          <FileViewPanel filePath={fileFilePath()} />
        </div>
      </div>
    </section>
  );
}

/** Last two path segments — "src/foo/bar.ts" → "foo/bar.ts" — to keep the tab label short. */
function shortFileName(path: string): string {
  if (!path) return "";
  const parts = path.split(/[\\/]/).filter(Boolean);
  if (parts.length <= 2) return path;
  return parts.slice(-2).join("/");
}
