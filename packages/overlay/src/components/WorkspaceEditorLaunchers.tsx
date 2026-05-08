import { For } from "solid-js";
import { type ProjectEditorID } from "../services/host-transport";
import { openDirectoryInEditor, QUICK_PROJECT_EDITORS } from "../services/workspace";
import { settingsStore } from "../store/settings";
import { t } from "../utils/i18n";
import { Icon, type IconName } from "./Icon";
import { Button } from "./ui/Button";

const EDITOR_ICONS: Record<ProjectEditorID, IconName> = {
  vscode: "editor-vscode",
  pycharm: "editor-pycharm",
  webstorm: "editor-webstorm",
  intellij: "editor-intellij",
  cursor: "editor-cursor",
};

export function WorkspaceEditorLaunchers() {
  const disabled = () => !settingsStore.directory;

  return (
    <div class="workspace-editor-launchers" data-no-drag="true" role="toolbar" aria-label={t("workspace.editor_launchers")}>
      <For each={QUICK_PROJECT_EDITORS}>
        {(editor) => {
          const label = () => t("cwd.open_in_editor", { name: editor.label });
          return (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              tone="neutral"
              data-ui="workspace-editor-launcher"
              data-editor={editor.id}
              disabled={disabled()}
              title={label()}
              aria-label={label()}
              onClick={() => void openDirectoryInEditor(editor.id)}
            >
              <Icon name={EDITOR_ICONS[editor.id]} />
            </Button>
          );
        }}
      </For>
    </div>
  );
}
