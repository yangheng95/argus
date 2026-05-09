import { For, createSignal, onCleanup, onMount } from "solid-js";
import { Portal } from "solid-js/web";
import { type ProjectEditorID } from "../services/host-transport";
import { activeDirectory, openDirectoryInEditor, PROJECT_EDITORS } from "../services/workspace";
import { t } from "../utils/i18n";
import { Icon, type IconName } from "./Icon";

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
  const [menuPosition, setMenuPosition] = createSignal<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });
  let rootRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  function close() {
    setOpen(false);
  }

  function positionMenu() {
    if (!buttonRef) {
      throw new Error("workspace editor dropdown button is not mounted");
    }
    const rect = buttonRef.getBoundingClientRect();
    setMenuPosition({
      top: Math.round(rect.bottom + 6),
      right: Math.round(window.innerWidth - rect.right),
    });
  }

  function openMenu() {
    if (disabled()) return;
    positionMenu();
    setOpen(true);
  }

  function toggle() {
    if (disabled()) return;
    if (open()) {
      close();
      return;
    }
    openMenu();
  }

  async function openEditor(editor: ProjectEditorID) {
    close();
    await openDirectoryInEditor(editor);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Escape") {
      close();
      return;
    }
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    toggle();
  }

  const onPointerDown = (event: PointerEvent) => {
    if (!open()) return;
    const target = event.target as Node | null;
    if (rootRef && target && rootRef.contains(target)) return;
    if (menuRef && target && menuRef.contains(target)) return;
    close();
  };

  const onViewportChange = () => {
    if (!open()) return;
    positionMenu();
  };

  onMount(() => {
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onViewportChange);
    window.addEventListener("scroll", onViewportChange, true);
  });
  onCleanup(() => {
    document.removeEventListener("pointerdown", onPointerDown);
    window.removeEventListener("resize", onViewportChange);
    window.removeEventListener("scroll", onViewportChange, true);
  });

  return (
    <div
      class="workspace-editor-launchers"
      data-no-drag="true"
      ref={(el) => (rootRef = el)}
    >
      <button
        type="button"
        class="workspace-editor-select"
        ref={(el) => (buttonRef = el)}
        data-open={open() ? "true" : "false"}
        disabled={disabled()}
        title={t("workspace.editor_launchers")}
        aria-label={t("workspace.editor_launchers")}
        aria-haspopup="menu"
        aria-expanded={open() ? "true" : "false"}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span class="workspace-editor-select-icon" data-editor="vscode" aria-hidden="true">
          <Icon name="editor-vscode" size={18} />
        </span>
        <span class="workspace-editor-select-caret" aria-hidden="true">
          <Icon name="caret-down" size={12} />
        </span>
      </button>
      <Portal>
        <div
          class="workspace-editor-menu"
          role="menu"
          hidden={!open()}
          ref={(el) => (menuRef = el)}
          style={{
            top: `${menuPosition().top}px`,
            right: `${menuPosition().right}px`,
          }}
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
        </div>
      </Portal>
    </div>
  );
}
