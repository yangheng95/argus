import { For, createEffect, createMemo, createSignal, onCleanup, onMount } from "solid-js";
import type { Accessor } from "solid-js";
import { Portal } from "solid-js/web";
import {
  listTerminalProfiles,
  type TerminalProfile,
  type TerminalProfileIcon,
} from "../services/terminal";
import { activeDirectory } from "../services/workspace";
import { t } from "../utils/i18n";
import { Icon, type IconName } from "./Icon";

interface WorkspaceLayoutControlsProps {
  terminalOpen: Accessor<boolean>;
  onOpenTerminal: (profileID: string) => void;
  onTerminalProfileSelected: (profileID: string) => void;
}

const TERMINAL_ICONS: Record<TerminalProfileIcon, IconName> = {
  terminal: "terminal",
  powershell: "terminal-powershell",
  "command-prompt": "terminal-command-prompt",
  bash: "terminal-bash",
};

export function WorkspaceLayoutControls(props: WorkspaceLayoutControlsProps) {
  const [profiles, setProfiles] = createSignal<TerminalProfile[]>([]);
  const [defaultProfileID, setDefaultProfileID] = createSignal("");
  const [selectedProfileID, setSelectedProfileID] = createSignal("");
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

  const disabled = () => !activeDirectory() || loading() || profiles().length === 0;
  const selectedProfile = createMemo(() =>
    profiles().find((profile) => profile.id === selectedProfileID()) ??
    profiles().find((profile) => profile.id === defaultProfileID()) ??
    null,
  );
  const triggerIcon = createMemo(() => {
    const profile = selectedProfile();
    if (!profile) return "terminal" as IconName;
    return terminalIconName(profile.icon);
  });
  const title = () => error() || t("terminal.open");

  function terminalIconName(icon: TerminalProfileIcon): IconName {
    const value = TERMINAL_ICONS[icon];
    if (!value) throw new Error(`Unknown terminal profile icon: ${icon}`);
    return value;
  }

  async function reloadProfiles() {
    if (!activeDirectory()) {
      setProfiles([]);
      setDefaultProfileID("");
      setSelectedProfileID("");
      props.onTerminalProfileSelected("");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const response = await listTerminalProfiles();
      if (!response.profiles.some((profile) => profile.id === response.defaultProfileID)) {
        throw new Error(t("terminal.default_profile_missing"));
      }
      const current = selectedProfileID();
      const selected = response.profiles.some((profile) => profile.id === current)
        ? current
        : response.defaultProfileID;
      setProfiles(response.profiles);
      setDefaultProfileID(response.defaultProfileID);
      setSelectedProfileID(selected);
      props.onTerminalProfileSelected(selected);
    } catch (reason) {
      setProfiles([]);
      setDefaultProfileID("");
      setSelectedProfileID("");
      props.onTerminalProfileSelected("");
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
      throw new Error("workspace terminal dropdown button is not mounted");
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

  function openProfile(profileID: string) {
    if (!profiles().some((profile) => profile.id === profileID)) {
      throw new Error(`Unknown terminal profile selected: ${profileID}`);
    }
    setSelectedProfileID(profileID);
    props.onTerminalProfileSelected(profileID);
    close();
    props.onOpenTerminal(profileID);
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
    activeDirectory();
    void reloadProfiles();
  });

  return (
    <div
      class="workspace-layout-controls"
      data-no-drag="true"
      role="toolbar"
      aria-label={t("terminal.open")}
      ref={(el) => (rootRef = el)}
    >
      <button
        type="button"
        class="workspace-terminal-select"
        data-ui="workspace-terminal-open"
        data-open={open() ? "true" : "false"}
        aria-pressed={props.terminalOpen()}
        title={title()}
        aria-label={t("terminal.open")}
        aria-haspopup="menu"
        aria-expanded={open() ? "true" : "false"}
        disabled={disabled()}
        ref={(el) => (buttonRef = el)}
        onClick={toggle}
        onKeyDown={onKeyDown}
      >
        <span class="workspace-terminal-select-icon" data-terminal-icon={selectedProfile()?.icon ?? "terminal"} aria-hidden="true">
          <Icon name={triggerIcon()} size={16} />
        </span>
        <span class="workspace-terminal-select-caret" aria-hidden="true">
          <Icon name="caret-down" size={12} />
        </span>
      </button>
      <Portal>
        <div
          class="workspace-terminal-menu"
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
                class="workspace-terminal-option"
                data-terminal-profile={profile.id}
                onClick={() => openProfile(profile.id)}
              >
                <span
                  class="workspace-terminal-option-icon"
                  data-terminal-icon={profile.icon}
                  aria-hidden="true"
                >
                  <Icon name={terminalIconName(profile.icon)} size={16} />
                </span>
                <span class="workspace-terminal-option-label">
                  {profile.label}{profile.id === defaultProfileID() ? ` ${t("terminal.default_profile_suffix")}` : ""}
                </span>
              </button>
            )}
          </For>
        </div>
      </Portal>
    </div>
  );
}
