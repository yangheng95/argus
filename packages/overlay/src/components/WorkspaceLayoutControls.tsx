import { For, createEffect, createMemo, createSignal } from "solid-js";
import type { Accessor } from "solid-js";
import {
  listTerminalProfiles,
  type TerminalProfile,
  type TerminalProfileIcon,
} from "../services/terminal";
import { activeDirectory } from "../services/workspace";
import { t } from "../utils/i18n";
import { Icon, type IconName } from "./Icon";
import { WorkspaceSplitLauncher } from "./WorkspaceSplitLauncher";

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

  function openProfile(profileID: string) {
    if (!profiles().some((profile) => profile.id === profileID)) {
      throw new Error(`Unknown terminal profile selected: ${profileID}`);
    }
    setSelectedProfileID(profileID);
    props.onTerminalProfileSelected(profileID);
    close();
    props.onOpenTerminal(profileID);
  }

  createEffect(() => {
    activeDirectory();
    void reloadProfiles();
  });

  return (
    <WorkspaceSplitLauncher
      rootClass="workspace-layout-controls"
      rootRole="toolbar"
      rootAriaLabel={t("terminal.open")}
      primaryClass="workspace-terminal-open"
      menuButtonClass="workspace-terminal-menu-button"
      menuClass="workspace-terminal-menu"
      disabled={disabled()}
      open={open()}
      title={title()}
      primaryAriaLabel={t("terminal.open")}
      menuAriaLabel={t("terminal.open_menu")}
      primaryDataUI="workspace-terminal-open"
      menuDataUI="workspace-terminal-menu"
      pressed={props.terminalOpen()}
      onPrimaryClick={() => openProfile(selectedProfile()?.id ?? "")}
      onOpenChange={setOpen}
      primaryChildren={(
        <span class="workspace-terminal-select-icon" data-terminal-icon={selectedProfile()?.icon ?? "terminal"} aria-hidden="true">
          <Icon name={triggerIcon()} size={16} />
        </span>
      )}
      menuButtonChildren={(
        <span class="workspace-terminal-select-caret" aria-hidden="true">
          <Icon name="caret-down" size={12} />
        </span>
      )}
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
    </WorkspaceSplitLauncher>
  );
}
