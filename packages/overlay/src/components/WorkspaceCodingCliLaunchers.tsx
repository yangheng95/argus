import { For, createEffect, createMemo, createSignal } from "solid-js"
import { listCodingCliProfiles, openCodingCli, type CodingCliIcon, type CodingCliProfile } from "../services/coding-cli"
import { currentTerminalProfileID, reloadTerminalProfileSelection } from "../services/terminal-selection"
import { activeDirectory } from "../services/workspace"
import { t } from "../utils/i18n"
import { Icon, type IconName } from "./Icon"
import { WorkspaceSplitLauncher, WorkspaceSplitLauncherItem } from "./WorkspaceSplitLauncher"

const CLI_ICONS: Record<CodingCliIcon, IconName> = {
  "claude-code": "coding-claude-code",
  codex: "coding-codex",
  gemini: "coding-gemini",
  copilot: "coding-copilot",
  glm: "coding-glm",
}

export function WorkspaceCodingCliLaunchers() {
  const [profiles, setProfiles] = createSignal<CodingCliProfile[]>([])
  const [profilesDirectory, setProfilesDirectory] = createSignal("")
  const [selectedCliID, setSelectedCliID] = createSignal("")
  const [open, setOpen] = createSignal(false)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")
  const directory = createMemo(() => activeDirectory().trim())

  const profilesCurrentForDirectory = () => !!directory() && profilesDirectory() === directory()
  const disabled = () =>
    !directory() || loading() || profiles().length === 0 || !profilesCurrentForDirectory() || !currentTerminalProfileID()
  const title = () => error() || t("coding_cli.open")
  const selectedProfile = createMemo(() =>
    profilesCurrentForDirectory() ? profiles().find((profile) => profile.id === selectedCliID()) ?? profiles()[0] ?? null : null,
  )
  const triggerIcon = createMemo(() => {
    const profile = selectedProfile()
    return profile ? CLI_ICONS[profile.icon] : "coding-cli"
  })
  let reloadOwner: symbol | null = null

  async function reloadProfiles(nextDirectory: string) {
    if (!nextDirectory) {
      setProfiles([])
      setProfilesDirectory("")
      return
    }
    const token = Symbol("coding-cli-profile-reload")
    reloadOwner = token
    const ownsReload = () => reloadOwner === token && directory() === nextDirectory
    setLoading(true)
    setError("")
    try {
      const [response] = await Promise.all([
        listCodingCliProfiles(nextDirectory),
        reloadTerminalProfileSelection({
          directory: nextDirectory,
          defaultProfileMissingMessage: t("terminal.default_profile_missing"),
          isCurrentDirectory: ownsReload,
        }),
      ])
      if (!ownsReload()) return
      if (!Array.isArray(response.profiles)) {
        throw new Error("Coding CLI profiles response is missing profiles")
      }
      setProfiles(response.profiles)
      setProfilesDirectory(nextDirectory)
      if (response.profiles.length > 0 && !response.profiles.some((profile) => profile.id === selectedCliID())) {
        setSelectedCliID(response.profiles[0].id)
      }
    } catch (reason) {
      if (ownsReload()) {
        setProfiles([])
        setProfilesDirectory("")
        setError(reason instanceof Error ? reason.message : String(reason))
      }
    } finally {
      if (reloadOwner === token) {
        reloadOwner = null
        if (directory() === nextDirectory) setLoading(false)
      }
    }
  }

  function close() {
    setOpen(false)
  }

  async function launch(profile: CodingCliProfile) {
    const directory = activeDirectory().trim()
    if (!directory) throw new Error("Workspace directory is required")
    if (profilesDirectory() !== directory || !profiles().some((item) => item.id === profile.id)) {
      throw new Error("Coding CLI profiles are stale for the active directory")
    }
    close()
    setSelectedCliID(profile.id)
    setLoading(true)
    setError("")
    try {
      await reloadTerminalProfileSelection({
        directory,
        defaultProfileMissingMessage: t("terminal.default_profile_missing"),
        isCurrentDirectory: () => activeDirectory().trim() === directory,
      })
      const terminalProfileID = currentTerminalProfileID()
      if (!terminalProfileID) throw new Error("Terminal profile is required")
      await openCodingCli({
        cliID: profile.id,
        terminalProfileID,
        cwd: directory,
      })
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  createEffect<string>((previous) => {
    const next = directory()
    if (next === previous) return previous
    close()
    setProfiles([])
    setProfilesDirectory("")
    setSelectedCliID("")
    void reloadProfiles(next)
    return next
  }, "")

  return (
    <WorkspaceSplitLauncher
      rootClass="workspace-coding-cli-launchers"
      menuClass="workspace-coding-cli-menu"
      disabled={disabled()}
      open={open()}
      title={title()}
      primaryAriaLabel={selectedProfile()?.label ?? t("coding_cli.open")}
      menuAriaLabel={t("coding_cli.open_menu")}
      primaryDataUI="workspace-coding-cli-open-default"
      menuDataUI="workspace-coding-cli-menu"
      onPrimaryClick={() => {
        const profile = selectedProfile()
        if (!profile) throw new Error("Coding CLI profile is required")
        return launch(profile)
      }}
      onOpenChange={setOpen}
      primaryChildren={
        <span
          class="workspace-coding-cli-select-icon"
          data-coding-cli-icon={selectedProfile()?.icon ?? "codex"}
          aria-hidden="true"
        >
          <Icon name={triggerIcon()} size={18} />
        </span>
      }
      menuButtonChildren={
        <span class="workspace-coding-cli-select-caret" aria-hidden="true">
          <Icon name="caret-down" size={12} />
        </span>
      }
    >
      <For each={profilesCurrentForDirectory() ? profiles() : []}>
        {(profile) => (
          <WorkspaceSplitLauncherItem
            class="workspace-coding-cli-option"
            dataAttributes={{ "data-coding-cli": profile.id }}
            onSelect={() => launch(profile)}
          >
            <span class="workspace-coding-cli-option-icon" data-coding-cli-icon={profile.icon} aria-hidden="true">
              <Icon name={CLI_ICONS[profile.icon]} size={18} />
            </span>
            <span class="workspace-coding-cli-option-label">{profile.label}</span>
          </WorkspaceSplitLauncherItem>
        )}
      </For>
    </WorkspaceSplitLauncher>
  )
}
