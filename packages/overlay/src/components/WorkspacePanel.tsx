// ── WorkspacePanel ──
// Right-hand secondary workspace. Hosts the diff view with a close
// affordance. File links now open in the selected IDE instead of rendering an
// inline file preview surface.

import { Show } from "solid-js"
import { DiffPreviewPanel } from "./DiffPreviewPanel"
import type { DiffTarget } from "../services/diff"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"

export interface WorkspacePanelProps {
  /** Current diff target to foreground. */
  target: DiffTarget
  /** Called when the user clicks the close (×) button. */
  onClose: () => void
}

export function WorkspacePanel(props: WorkspacePanelProps) {
  const diffFilePath = () => props.target?.filePath || null
  return (
    <section class="workspace" id="workspacePanel">
      <header class="workspace-header">
        <div class="workspace-tabs" data-ui="workspace-view-label">
          <div class="workspace-tab" data-active="true">
            <span class="workspace-tab-label">
              {t("workspace.diff")}
              <Show when={diffFilePath()}>
                <span class="workspace-tab-file">
                  {" · "}
                  {shortFileName(diffFilePath() || "")}
                </span>
              </Show>
            </span>
          </div>
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
        <div class="workspace-view" data-kind="diff" data-active="true">
          <DiffPreviewPanel target={props.target} />
        </div>
      </div>
    </section>
  )
}

/** Last two path segments — "src/foo/bar.ts" → "foo/bar.ts" — to keep the tab label short. */
function shortFileName(path: string): string {
  if (!path) return ""
  const parts = path.split(/[\\/]/).filter(Boolean)
  if (parts.length <= 2) return path
  return parts.slice(-2).join("/")
}
