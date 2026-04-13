// ── WorkspacePanel ──
// Right-hand secondary workspace. Hosts multiple views (Build, Diff) behind a
// shared tab bar with a close affordance. CodingTab and DiffPreviewPanel are
// both mounted simultaneously and display-toggled so that Build streaming
// state is preserved when the user switches to Diff and back.

import { Show } from "solid-js";
import { CodingTab, type CodingTabAPI } from "./CodingTab";
import { DiffPreviewPanel } from "./DiffPreviewPanel";
import { FileViewPanel } from "./FileViewPanel";
import { t } from "../utils/i18n";

export type WorkspaceView =
  | { kind: "build" }
  | { kind: "diff"; filePath: string }
  | { kind: "file"; filePath: string };

export interface WorkspacePanelProps {
  /** Current view to foreground. */
  view: WorkspaceView;
  /** Called when the user clicks a tab to change views. */
  onSelectView: (view: WorkspaceView) => void;
  /** Called when the user clicks the close (×) button. */
  onClose: () => void;
  /** Exposes the CodingTab imperative handle to the parent composer. */
  onCodingReady?: (api: CodingTabAPI) => void;
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const isBuild = () => props.view.kind === "build";
  const isDiff = () => props.view.kind === "diff";
  const isFile = () => props.view.kind === "file";
  const diffFilePath = () =>
    props.view.kind === "diff" ? props.view.filePath : null;
  const fileFilePath = () =>
    props.view.kind === "file" ? props.view.filePath : null;

  // When the user clicks the Build tab while already viewing a diff, we want
  // to keep the previously-loaded diff around so that clicking Diff again
  // goes back to the same file. The parent holds the authoritative view
  // state; this component just reports clicks.
  function selectBuild() {
    if (props.view.kind !== "build") props.onSelectView({ kind: "build" });
  }
  function selectDiff() {
    if (props.view.kind !== "diff") {
      // No file has been picked yet — enter Diff with an empty placeholder.
      props.onSelectView({ kind: "diff", filePath: "" });
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
            aria-selected={isBuild()}
            data-active={isBuild() ? "true" : "false"}
            onClick={selectBuild}
          >
            <span class="workspace-tab-label">{t("workspace.build")}</span>
          </button>
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
        {/* Build view — always mounted so streaming state survives tab switches */}
        <div
          class="workspace-view"
          data-kind="build"
          style={{ display: isBuild() ? "flex" : "none" }}
        >
          <CodingTab active={isBuild()} onReady={props.onCodingReady} />
        </div>
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
