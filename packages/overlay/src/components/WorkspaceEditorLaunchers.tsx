import { For, createSignal } from "solid-js";
import { type ProjectEditorID } from "../services/host-transport";
import { activeDirectory, openDirectoryInEditor, PROJECT_EDITORS } from "../services/workspace";
import { t } from "../utils/i18n";
import { Icon, type IconName } from "./Icon";
import { WorkspaceSplitLauncher } from "./WorkspaceSplitLauncher";

const EDITOR_ICONS: Record<ProjectEditorID, IconName> = {
  vscode: "editor-vscode",
  pycharm: "editor-pycharm",
  webstorm: "editor-webstorm",
  intellij: "editor-intellij",
  cursor: "editor-cursor",
};

const EDITOR_ICON_SIZES: Record<ProjectEditorID, number> = {
  vscode: 18,
  pycharm: 18,
  webstorm: 20,
  intellij: 20,
  cursor: 20,
};

export function WorkspaceEditorLaunchers() {
  const disabled = () => !activeDirectory();
  const [open, setOpen] = createSignal(false);

  function close() {
    setOpen(false);
  }

  async function openEditor(editor: ProjectEditorID) {
    close();
    await openDirectoryInEditor(editor);
  }

  return (
    <WorkspaceSplitLauncher
      rootClass="workspace-editor-launchers"
      primaryClass="workspace-editor-open"
      menuButtonClass="workspace-editor-menu-button"
      menuClass="workspace-editor-menu"
      disabled={disabled()}
      open={open()}
      title={t("workspace.editor_launchers")}
      primaryAriaLabel={t("cwd.open_in_editor", { name: "VS Code" })}
      menuAriaLabel={t("workspace.editor_launchers_menu")}
      primaryDataUI="workspace-editor-open-default"
      menuDataUI="workspace-editor-menu"
      onPrimaryClick={() => openEditor("vscode")}
      onOpenChange={setOpen}
      primaryChildren={(
        <span class="workspace-editor-select-icon" data-editor="vscode" aria-hidden="true">
          <Icon name="editor-vscode" size={18} />
        </span>
      )}
      menuButtonChildren={(
        <span class="workspace-editor-select-caret" aria-hidden="true">
          <Icon name="caret-down" size={12} />
        </span>
      )}
    >
      <For each={PROJECT_EDITORS}>
        {(editor) => (
          <button
            type="button"
            role="menuitem"
            class="workspace-editor-option"
            data-editor={editor.id}
            onClick={() => void openEditor(editor.id)}
          >
            <span class="workspace-editor-option-icon" aria-hidden="true">
              <Icon name={EDITOR_ICONS[editor.id]} size={EDITOR_ICON_SIZES[editor.id]} />
            </span>
            <span class="workspace-editor-option-label">
              {t("cwd.open_in_editor", { name: editor.label })}
            </span>
          </button>
        )}
      </For>
    </WorkspaceSplitLauncher>
  );
}
