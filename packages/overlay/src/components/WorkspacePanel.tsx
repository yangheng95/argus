// ── WorkspacePanel ──
// Right-hand secondary workspace. Hosts Diff / File / Trace views behind a
// shared tab bar with a close affordance. Each view is display-toggled so
// that cache/resource state is preserved when switching tabs.
//
// The former "Build" tab (a Copilot-style direct coding pane) was removed —
// build is now a orchestrator tool; its output renders as a card in the task
// conversation, not in a secondary panel.

import { Show } from "solid-js";
import { DiffPreviewPanel } from "./DiffPreviewPanel";
import { FileViewPanel } from "./FileViewPanel";
import { TracePanel } from "./TracePanel";
import { boardStore } from "../store/board";
import { t } from "../utils/i18n";

export type WorkspaceView =
  | { kind: "diff"; filePath: string }
  | { kind: "file"; filePath: string }
  | { kind: "trace" };

export interface WorkspacePanelProps {
  /** Current view to foreground. */
  view: WorkspaceView;
  /** Called when the user clicks a tab to change views. */
  onSelectView: (view: WorkspaceView) => void;
  /** Called when the user clicks the close (×) button. */
  onClose: () => void;
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const isDiff = () => props.view.kind === "diff";
  const isFile = () => props.view.kind === "file";
  const isTrace = () => props.view.kind === "trace";
  const diffFilePath = () =>
    props.view.kind === "diff" ? props.view.filePath : null;
  const fileFilePath = () =>
    props.view.kind === "file" ? props.view.filePath : null;

  function selectDiff() {
    if (props.view.kind !== "diff") {
      props.onSelectView({ kind: "diff", filePath: "" });
    }
  }
  function selectFile() {
    if (props.view.kind !== "file") {
      props.onSelectView({ kind: "file", filePath: "" });
    }
  }
  function selectTrace() {
    if (props.view.kind !== "trace") {
      props.onSelectView({ kind: "trace" });
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
          <button
            type="button"
            class="workspace-tab"
            role="tab"
            aria-selected={isTrace()}
            data-active={isTrace() ? "true" : "false"}
            onClick={selectTrace}
          >
            <span class="workspace-tab-label">{t("workspace.trace")}</span>
          </button>
        </div>
        <button
          type="button"
          class="workspace-close"
          title={t("workspace.close")}
          aria-label={t("workspace.close")}
          onClick={props.onClose}
        >
          ×
        </button>
      </header>
      <div class="workspace-body">
        {/* Diff view — always mounted so resource cache is retained */}
        <div
          class="workspace-view"
          data-kind="diff"
          style={{ display: isDiff() ? "flex" : "none" }}
        >
          <DiffPreviewPanel filePath={diffFilePath()} />
        </div>
        {/* File view — lazy fetches file content via /file/content */}
        <div
          class="workspace-view"
          data-kind="file"
          style={{ display: isFile() ? "flex" : "none" }}
        >
          <FileViewPanel filePath={fileFilePath()} />
        </div>
        {/* Trace view — SSE-driven; mounts only when active so EventSource
            doesn't run for users who never open the tab. */}
        <Show when={isTrace()}>
          <div class="workspace-view" data-kind="trace" style={{ display: "flex" }}>
            <TracePanel taskID={boardStore.selectedTaskID || null} />
          </div>
        </Show>
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
