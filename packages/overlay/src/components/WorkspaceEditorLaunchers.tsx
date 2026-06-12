import { For, createMemo, createSignal } from "solid-js"
import { type ProjectEditorID } from "../services/host-transport"
import { getHostTransport } from "../services/host-transport"
import { activeDirectory, openDirectoryInEditor, PROJECT_EDITORS } from "../services/workspace"
import { saveSettings, settingsStore, setSettingsStore } from "../store/settings"
import { t } from "../utils/i18n"
import { Icon, type IconName } from "./Icon"
import { WorkspaceSplitLauncher, WorkspaceSplitLauncherItem } from "./WorkspaceSplitLauncher"

const EDITOR_ICONS: Record<ProjectEditorID, IconName> = {
  vscode: "editor-vscode",
  pycharm: "editor-pycharm",
  webstorm: "editor-webstorm",
  intellij: "editor-intellij",
  cursor: "editor-cursor",
}

const EDITOR_ICON_SIZES: Record<ProjectEditorID, number> = {
  vscode: 18,
  pycharm: 18,
  webstorm: 20,
  intellij: 20,
  cursor: 20,
}

export function WorkspaceEditorLaunchers() {
  const supportedEditorIDs = getHostTransport().capabilities.ui.projectEditors
  const supportedEditors = createMemo(() => PROJECT_EDITORS.filter((editor) => supportedEditorIDs.includes(editor.id)))
  const disabled = () => !activeDirectory() || supportedEditors().length === 0
  const selectedEditor = () =>
    supportedEditorIDs.includes(settingsStore.projectEditor) ? settingsStore.projectEditor : supportedEditors()[0]?.id
  const selectedEditorLabel = () =>
    PROJECT_EDITORS.find((editor) => editor.id === selectedEditor())?.label ?? selectedEditor()
  const [open, setOpen] = createSignal(false)

  function close() {
    setOpen(false)
  }

  async function openEditor(editor: ProjectEditorID) {
    if (!supportedEditorIDs.includes(editor)) return
    close()
    setSettingsStore("projectEditor", editor)
    saveSettings()
    await openDirectoryInEditor(editor)
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
      primaryAriaLabel={t("cwd.open_in_editor", { name: selectedEditorLabel() })}
      menuAriaLabel={t("workspace.editor_launchers_menu")}
      primaryDataUI="workspace-editor-open-default"
      menuDataUI="workspace-editor-menu"
      onPrimaryClick={() => {
        const editor = selectedEditor()
        if (editor) void openEditor(editor)
      }}
      onOpenChange={setOpen}
      primaryChildren={
        <span class="workspace-editor-select-icon" data-editor={selectedEditor() ?? ""} aria-hidden="true">
          <Icon
            name={EDITOR_ICONS[selectedEditor() ?? "vscode"]}
            size={EDITOR_ICON_SIZES[selectedEditor() ?? "vscode"]}
          />
        </span>
      }
      menuButtonChildren={
        <span class="workspace-editor-select-caret" aria-hidden="true">
          <Icon name="caret-down" size={12} />
        </span>
      }
    >
      <For each={supportedEditors()}>
        {(editor) => (
          <WorkspaceSplitLauncherItem
            class="workspace-editor-option"
            dataAttributes={{ "data-editor": editor.id }}
            onSelect={() => openEditor(editor.id)}
          >
            <span class="workspace-editor-option-icon" aria-hidden="true">
              <Icon name={EDITOR_ICONS[editor.id]} size={EDITOR_ICON_SIZES[editor.id]} />
            </span>
            <span class="workspace-editor-option-label">{t("cwd.open_in_editor", { name: editor.label })}</span>
          </WorkspaceSplitLauncherItem>
        )}
      </For>
    </WorkspaceSplitLauncher>
  )
}
