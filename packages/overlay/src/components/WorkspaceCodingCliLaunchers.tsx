import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import {
  listCodingCliProfiles,
  openCodingCli,
  type CodingCliIcon,
  type CodingCliProfile,
} from "../services/coding-cli";
import { settingsStore } from "../store/settings";
import { t } from "../utils/i18n";
import { Icon, type IconName } from "./Icon";

interface WorkspaceCodingCliLaunchersProps {
  terminalProfileID: Accessor<string>;
}

const CLI_ICONS: Record<CodingCliIcon, IconName> = {
  "claude-code": "coding-claude-code",
  codex: "coding-codex",
  gemini: "coding-gemini",
  copilot: "coding-copilot",
  glm: "coding-glm",
};

export function WorkspaceCodingCliLaunchers(props: WorkspaceCodingCliLaunchersProps) {
  const [profiles, setProfiles] = createSignal<CodingCliProfile[]>([]);
  const [open, setOpen] = createSignal(false);
  const [loading, setLoading] = createSignal(false);
  const [error, setError] = createSignal("");
  const [menuPosition, setMenuPosition] = createSignal<{ top: number; right: number }>({
    top: 0,
    right: 0,
  });
  let rootRef: HTMLDivElement | undefined;
  let buttonRef: HTMLButtonElement | undefined;
  let menuRef: HTMLDivElement | undefined;

  const disabled = () =>
    !settingsStore.directory || !props.terminalProfileID() || loading() || profiles().length === 0;
  const title = () => error() || t("coding_cli.open");
  const triggerIcon = createMemo(() => profiles()[0]?.icon ? CLI_ICONS[profiles()[0].icon] : "coding-cli");

  async function reloadProfiles() {
    if (!settingsStore.directory) {
      setProfiles([]);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await listCodingCliProfiles();
      if (!Array.isArray(response.profiles)) {
        throw new Error("Coding CLI profiles response is missing profiles");
      }
      setProfiles(response.profiles);
    } catch (reason) {
      setProfiles([]);
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setLoading(false);
    }
  }

  function close() {
    setOpen(false);
  }

  function positionMenu() {
    if (!buttonRef) {
      throw new Error("workspace coding CLI dropdown button is not mounted");
    }
    const rect = buttonRef.getBoundingClientRect();
    setMenuPosition({
      top: Math.round(rect.bottom + 6),
      right: Math.round(window.innerWidth - rect.right),
    });
  }

  function toggle() {
    if (disabled()) return;
    if (open()) {
      close();
      return;
    }
    positionMenu();
    setOpen(true);
  }

  async function launch(profile: CodingCliProfile) {
    if (!settingsStore.directory) throw new Error("Workspace directory is required");
    const terminalProfileID = props.terminalProfileID();
    if (!terminalProfileID) throw new Error("Terminal profile ID is required");
    close();
    setError("");
    try {
      await openCodingCli({
        cliID: profile.id,
        terminalProfileID,
        cwd: settingsStore.directory,
      });
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
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

  createEffect(() => {
    settingsStore.directory;
    void reloadProfiles();
  });

  return (
    <div
      class="workspace-coding-cli-launchers"
      data-no-drag="true"
      ref={(el) => (rootRef = el)}
    >
      <button
        type="button"
        class="workspace-coding-cli-select"
        ref={(el) => (buttonRef = el)}
        data-open={open() ? "true" : "false"}
        disabled={disabled()}
        title={title()}
        aria-label={t("coding_cli.open")}
        aria-haspopup="menu"
        aria-expanded={open() ? "true" : "false"}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span class="workspace-coding-cli-select-icon" aria-hidden="true">
          <Icon name={triggerIcon()} size={18} />
        </span>
        <span class="workspace-coding-cli-select-caret" aria-hidden="true">
          <Icon name="caret-down" size={12} />
        </span>
      </button>
      <Portal>
        <div
          class="workspace-coding-cli-menu"
          role="menu"
          hidden={!open()}
          ref={(el) => (menuRef = el)}
          style={{
            top: `${menuPosition().top}px`,
            right: `${menuPosition().right}px`,
          }}
        >
          <For each={profiles()}>
            {(profile) => (
              <button
                type="button"
                role="menuitem"
                class="workspace-coding-cli-option"
                data-coding-cli={profile.id}
                onClick={() => void launch(profile)}
              >
                <span
                  class="workspace-coding-cli-option-icon"
                  data-coding-cli-icon={profile.icon}
                  aria-hidden="true"
                >
                  <Icon name={CLI_ICONS[profile.icon]} size={18} />
                </span>
                <span class="workspace-coding-cli-option-label">{profile.label}</span>
              </button>
            )}
          </For>
        </div>
      </Portal>
    </div>
  );
}
