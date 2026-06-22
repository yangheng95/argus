import { For, createEffect, createMemo, createSignal } from "solid-js"
import {
  clearTerminalProfileSelection,
  defaultTerminalProfileID,
  reloadTerminalProfileSelection,
  selectTerminalProfileID,
  selectedTerminalProfileID,
  terminalProfiles,
} from "../services/terminal-selection"
import { openSystemTerminal, type TerminalProfileIcon } from "../services/terminal"
import { activeDirectory } from "../services/workspace"
import { t } from "../utils/i18n"
import { Icon, type IconName } from "./Icon"
import { WorkspaceSplitLauncher, WorkspaceSplitLauncherItem } from "./WorkspaceSplitLauncher"

const TERMINAL_ICONS: Record<TerminalProfileIcon, IconName> = {
  terminal: "terminal",
  powershell: "terminal-powershell",
  "command-prompt": "terminal-command-prompt",
  bash: "terminal-bash",
}

export function WorkspaceLayoutControls() {
  const [open, setOpen] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")
  const directory = createMemo(() => activeDirectory().trim())

  const disabled = () => !directory() || loading() || terminalProfiles().length === 0
  const selectedProfile = createMemo(
    () =>
      terminalProfiles().find((profile) => profile.id === selectedTerminalProfileID()) ??
      terminalProfiles().find((profile) => profile.id === defaultTerminalProfileID()) ??
      null,
  )
  const triggerIcon = createMemo(() => {
    const profile = selectedProfile()
    if (!profile) return "terminal" as IconName
    return terminalIconName(profile.icon)
  })
  const title = () => error() || t("terminal.open")

  function terminalIconName(icon: TerminalProfileIcon): IconName {
    const value = TERMINAL_ICONS[icon]
    if (!value) throw new Error(`Unknown terminal profile icon: ${icon}`)
    return value
  }

  async function reloadProfiles(nextDirectory: string) {
    if (!nextDirectory) {
      clearTerminalProfileSelection()
      return
    }
    setLoading(true)
    setError("")
    try {
      await reloadTerminalProfileSelection({
        directory: nextDirectory,
        defaultProfileMissingMessage: t("terminal.default_profile_missing"),
      })
    } catch (reason) {
      clearTerminalProfileSelection()
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  function close() {
    setOpen(false)
  }

  async function openProfile(profileID: string) {
    const cwd = activeDirectory().trim()
    if (!cwd) throw new Error("Workspace directory is required")
    selectTerminalProfileID(profileID)
    close()
    setError("")
    try {
      await openSystemTerminal({ cwd, profileID })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    }
  }

  createEffect<string>((previous) => {
    const next = directory()
    if (next === previous) return previous
    void reloadProfiles(next)
    return next
  }, "")

  return (
    <WorkspaceSplitLauncher
      rootClass="workspace-layout-controls"
      rootRole="toolbar"
      rootAriaLabel={t("terminal.open")}
      menuClass="workspace-terminal-menu"
      disabled={disabled()}
      open={open()}
      title={title()}
      primaryAriaLabel={t("terminal.open")}
      menuAriaLabel={t("terminal.open_menu")}
      primaryDataUI="workspace-terminal-open"
      menuDataUI="workspace-terminal-menu"
      onPrimaryClick={() => openProfile(selectedProfile()?.id ?? "")}
      onOpenChange={setOpen}
      primaryChildren={
        <span
          class="workspace-terminal-select-icon"
          data-terminal-icon={selectedProfile()?.icon ?? "terminal"}
          aria-hidden="true"
        >
          <Icon name={triggerIcon()} size={18} />
        </span>
      }
      menuButtonChildren={
        <span class="workspace-terminal-select-caret" aria-hidden="true">
          <Icon name="caret-down" size={12} />
        </span>
      }
    >
      <For each={terminalProfiles()}>
        {(profile) => (
          <WorkspaceSplitLauncherItem
            class="workspace-terminal-option"
            dataAttributes={{ "data-terminal-profile": profile.id }}
            onSelect={() => openProfile(profile.id)}
          >
            <span class="workspace-terminal-option-icon" data-terminal-icon={profile.icon} aria-hidden="true">
              <Icon name={terminalIconName(profile.icon)} size={18} />
            </span>
            <span class="workspace-terminal-option-label">
              {profile.label}
              {profile.id === defaultTerminalProfileID() ? ` ${t("terminal.default_profile_suffix")}` : ""}
            </span>
          </WorkspaceSplitLauncherItem>
        )}
      </For>
    </WorkspaceSplitLauncher>
  )
}
