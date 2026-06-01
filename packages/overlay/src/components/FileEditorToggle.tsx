import { Show } from "solid-js"
import { activeTaskID } from "../store/board"
import {
  fileEditorFocus,
  selectedFilePath,
  shortWorkbenchPath,
  toggleFileEditorFocus,
} from "../services/file-workbench"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"

export function FileEditorToggle() {
  return (
    <Show when={selectedFilePath() || activeTaskID()}>
      <button
        type="button"
        class="file-editor-toggle"
        data-active={fileEditorFocus() === "editor" ? "true" : "false"}
        title={selectedFilePath() || t("section.files")}
        aria-label={t("file_editor.toggle")}
        onClick={toggleFileEditorFocus}
      >
        <Icon name="file-document" size={13} />
        <span>{selectedFilePath() ? shortWorkbenchPath(selectedFilePath()) : t("section.files")}</span>
      </button>
    </Show>
  )
}
