import { For, createSignal } from "solid-js";
import { type ProjectEditorID } from "../services/host-transport";
import { activeDirectory, openDirectoryInEditor, PROJECT_EDITORS } from "../services/workspace";
import { saveSettings, setSettingsStore, settingsStore } from "../store/settings";
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
  const currentEditor = () =>
    PROJECT_EDITORS.find((item) => item.id === settingsStore.preferredProjectEditor)?.id ?? "vscode";
  const currentEditorLabel = () =>
    PROJECT_EDITORS.find((item) => item.id === currentEditor())?.label ?? "VS Code";

  function close() {
    setOpen(false);
  }

  function setPreferredEditor(editor: ProjectEditorID) {
    setSettingsStore("preferredProjectEditor", editor);
    saveSettings();
  }

  async function openEditor(editor: ProjectEditorID) {
    close();
    setPreferredEditor(editor);
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
      primaryAriaLabel={t("cwd.open_in_editor", { name: currentEditorLabel() })}
      menuAriaLabel={t("workspace.editor_launchers_menu")}
      primaryDataUI="workspace-editor-open-default"
      menuDataUI="workspace-editor-menu"
      onPrimaryClick={() => openEditor(currentEditor())}
      onOpenChange={setOpen}
      primaryChildren={(
        <span class="workspace-editor-select-icon" data-editor={currentEditor()} aria-hidden="true">
          <Icon name={EDITOR_ICONS[currentEditor()]} size={EDITOR_ICON_SIZES[currentEditor()]} />
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
