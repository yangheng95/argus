// ── WorkspacePanel ──
// Right-hand secondary workspace. Hosts the diff preview with a close
// affordance. Plain file links open in the selected IDE instead of this panel.

import { Show } from "solid-js";
import { DiffPreviewPanel } from "./DiffPreviewPanel";
import type { DiffTarget } from "../services/diff";
import { t } from "../utils/i18n";
import { Icon } from "./Icon";

export type WorkspaceView = { kind: "diff"; target: DiffTarget };

export interface WorkspacePanelProps {
  /** Current view to foreground. */
  view: WorkspaceView;
  /** Called when the user clicks a tab to refresh the view contract. */
  onSelectView: (view: WorkspaceView) => void;
  /** Called when the user clicks the close (×) button. */
  onClose: () => void;
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const isDiff = () => props.view.kind === "diff";
  const diffTarget = () => props.view.target;
  const diffFilePath = () => props.view.target.filePath;

  function selectDiff() {
    props.onSelectView(props.view);
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
        </div>
        <button
          type="button"
          class="workspace-close"
          title={t("workspace.close")}
          aria-label={t("workspace.close")}
          onClick={props.onClose}
        >
          <Icon name="close" />
        </button>
      </header>
      <div class="workspace-body">
        {/* Diff view only. Plain file links open in the selected IDE. */}
        <div
          class="workspace-view"
          data-kind="diff"
          data-active={isDiff() ? "true" : "false"}
        >
          <DiffPreviewPanel target={diffTarget()} />
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
