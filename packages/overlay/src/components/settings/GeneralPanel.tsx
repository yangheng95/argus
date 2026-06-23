import { createSignal } from "solid-js"
import { t } from "../../utils/i18n"
import { settingsStore, setSettingsStore, saveSettings } from "../../store/settings"
import { configure as configureApi } from "../../services/api"
import { checkConnection } from "../../services/connection"
import { reloadProjectScope, patchConfig, resetDatabase } from "../../services/config"
import type { DatabaseResetTarget } from "../../services/config"
import { ensureDesktopNotificationPermission } from "../../services/notify"
import { activeProjectDirectory } from "../../services/project-directory"
import { appStore } from "../../store/app"
import { Button } from "../ui/Button"
import { SettingsGroup, SettingsPanel, SettingsRow } from "./primitives"

export default function GeneralPanel() {
  const [saved, setSaved] = createSignal(false)
  const [error, setError] = createSignal("")
  const [dbResetting, setDbResetting] = createSignal(false)
  const [dbResetNotice, setDbResetNotice] = createSignal("")
  const [dbResetNoticeStatus, setDbResetNoticeStatus] = createSignal<"active" | "warn" | "error">("active")

  // ── Handlers ──

  function describeError(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
  }

  function summarizeResetTargets(targets: DatabaseResetTarget[]): string {
    return targets
      .map(
        (target) =>
          `${target.ok ? "OK" : "FAILED"} ${target.label}: ${target.path}${target.error ? ` (${target.error})` : ""}`,
      )
      .join("; ")
  }

  function handleServerUrlChange(e: Event) {
    setSettingsStore("serverUrl", (e.currentTarget as HTMLInputElement).value.trim())
  }

  function handlePasswordChange(e: Event) {
    setSettingsStore("password", (e.currentTarget as HTMLInputElement).value)
  }

  function handleUsernameChange(e: Event) {
    setSettingsStore("username", (e.currentTarget as HTMLInputElement).value.trim())
  }

  async function handleSaveServer() {
    const url = settingsStore.serverUrl
    const password = settingsStore.password
    const username = settingsStore.username
    configureApi({ serverUrl: url, password, username })
    try {
      await saveSettings()
    } catch (e) {
      setSaved(false)
      setError(t("settings.save_failed", { error: describeError(e) }))
      return
    }
    setError("")
    setSaved(true)
    setTimeout(() => setSaved(false), 1800)
    try {
      await checkConnection()
      await reloadProjectScope()
    } catch {
      /* reconnect monitor will retry */
    }
  }

  async function handleDesktopNotificationsChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const enabled = input.checked
    const previous = settingsStore.desktopNotifications
    setSettingsStore("desktopNotifications", enabled)
    try {
      await saveSettings()
    } catch (error) {
      setSettingsStore("desktopNotifications", previous)
      input.checked = previous
      setError(t("settings.save_failed", { error: describeError(error) }))
      return
    }
    setError("")
    if (enabled) void ensureDesktopNotificationPermission()
  }

  async function handleInformationMissingChange(e: Event) {
    const input = e.currentTarget as HTMLInputElement
    const previous = Boolean((appStore.config as any)?.assistant?.debug?.fail_on_information_missing)
    const enabled = input.checked
    try {
      await patchConfig({
        assistant: { debug: { fail_on_information_missing: enabled } },
      })
    } catch (error) {
      input.checked = previous
      setError(t("settings.config_save_failed", { error: describeError(error) }))
      return
    }
    setError("")
  }

  async function handleDatabaseReset() {
    const directory = activeProjectDirectory().trim()
    if (!directory) {
      setDbResetNoticeStatus("error")
      setDbResetNotice(t("settings.db_reset_missing_directory"))
      return
    }
    if (!window.confirm(t("settings.db_reset_confirm", { directory }))) return

    setDbResetting(true)
    setDbResetNotice("")
    setError("")
    try {
      const result = await resetDatabase(directory)
      const summary = summarizeResetTargets(result.targets)
      setDbResetNoticeStatus(result.ok ? "active" : "warn")
      setDbResetNotice(
        `${t(result.ok ? "settings.db_reset_complete" : "settings.db_reset_partial", {
          count: result.targets.length,
        })}${summary ? ` ${summary}` : ""}`,
      )
      try {
        await checkConnection()
        await reloadProjectScope()
      } catch (reloadError) {
        setDbResetNoticeStatus("warn")
        setDbResetNotice(
          (current) => `${current} ${t("settings.db_reset_reload_failed", { error: describeError(reloadError) })}`,
        )
      }
    } catch (resetError) {
      setDbResetNoticeStatus("error")
      setDbResetNotice(t("settings.db_reset_failed", { error: describeError(resetError) }))
    } finally {
      setDbResetting(false)
    }
  }

  return (
    <SettingsPanel class="general-panel">
      {/* ── Connection ── */}
      <SettingsGroup title={t("settings.section.connection")}>
        <SettingsRow>
          <label class="field">
            <span class="field-label">{t("settings.server_url")}</span>
            <input
              class="field-input"
              type="url"
              value={settingsStore.serverUrl}
              placeholder="http://127.0.0.1:7878"
              onInput={handleServerUrlChange}
            />
          </label>
        </SettingsRow>

        <SettingsRow>
          <label class="field">
            <span class="field-label">{t("settings.username")}</span>
            <input class="field-input" type="text" value={settingsStore.username} onInput={handleUsernameChange} />
          </label>
        </SettingsRow>

        <SettingsRow>
          <label class="field">
            <span class="field-label">{t("settings.password")}</span>
            <input class="field-input" type="password" value={settingsStore.password} onInput={handlePasswordChange} />
          </label>
        </SettingsRow>

        <SettingsRow
          align="center"
          actions={
            <Button
              type="button"
              variant="solid"
              size="sm"
              tone="accent"
              data-ui="settings-server-save"
              onClick={handleSaveServer}
            >
              {saved() ? t("common.saved") : t("common.save")}
            </Button>
          }
        />
        {error() ? (
          <div class="config-status-box" data-status="error">
            <span class="config-status-box__text">{error()}</span>
          </div>
        ) : null}
      </SettingsGroup>

      {/* ── Database ── */}
      <SettingsGroup title={t("settings.section.database")}>
        <SettingsRow
          title={t("settings.db_reset_label")}
          desc={t("settings.db_reset_hint")}
          align="center"
          interactive
          actions={
            <Button
              type="button"
              variant="solid"
              size="sm"
              tone="danger"
              data-ui="settings-db-reset"
              disabled={dbResetting() || !appStore.connected}
              onClick={handleDatabaseReset}
            >
              {dbResetting() ? t("settings.db_reset_running") : t("settings.db_reset_button")}
            </Button>
          }
        />
        {dbResetNotice() ? (
          <div class="config-status-box" data-status={dbResetNoticeStatus()}>
            <span class="config-status-box__text">{dbResetNotice()}</span>
          </div>
        ) : null}
      </SettingsGroup>

      {/* ── Behaviour ── */}
      <SettingsGroup title={t("settings.section.behaviour")}>
        <SettingsRow
          title={<label for="settings-desktop-notifications">{t("settings.desktop_notifications_label")}</label>}
          desc={t("settings.desktop_notifications_hint")}
          align="center"
          interactive
          actions={
            <input
              id="settings-desktop-notifications"
              type="checkbox"
              checked={settingsStore.desktopNotifications}
              onChange={handleDesktopNotificationsChange}
            />
          }
        />

        <SettingsRow
          title={
            <label for="settings-fail-on-information-missing">{t("settings.fail_on_information_missing_label")}</label>
          }
          desc={t("settings.fail_on_information_missing_hint")}
          align="center"
          interactive
          actions={
            <input
              id="settings-fail-on-information-missing"
              type="checkbox"
              checked={Boolean((appStore.config as any)?.assistant?.debug?.fail_on_information_missing)}
              onChange={handleInformationMissingChange}
            />
          }
        />
      </SettingsGroup>
    </SettingsPanel>
  )
}
