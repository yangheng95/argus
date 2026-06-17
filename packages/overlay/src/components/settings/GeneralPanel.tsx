import { createSignal } from "solid-js"
import { t } from "../../utils/i18n"
import { settingsStore, setSettingsStore, saveSettings } from "../../store/settings"
import { configure as configureApi } from "../../services/api"
import { checkConnection } from "../../services/connection"
import { reloadProjectScope, patchConfig } from "../../services/config"
import { ensureDesktopNotificationPermission } from "../../services/notify"
import { appStore } from "../../store/app"
import { Button } from "../ui/Button"
import { SurfaceHeader } from "../ui/SurfaceHeader"

export default function GeneralPanel() {
  const [saved, setSaved] = createSignal(false)
  const [error, setError] = createSignal("")

  // ── Handlers ──

  function describeError(e: unknown): string {
    return e instanceof Error ? e.message : String(e)
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

  return (
    <div class="general-panel">
      {/* ── Connection ── */}
      <div class="config-panel-group">
        <SurfaceHeader variant="settings-group" title={t("settings.section.connection")} />
        <div class="config-panel-card">
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

          <label class="field">
            <span class="field-label">{t("settings.username")}</span>
            <input class="field-input" type="text" value={settingsStore.username} onInput={handleUsernameChange} />
          </label>

          <label class="field">
            <span class="field-label">{t("settings.password")}</span>
            <input class="field-input" type="password" value={settingsStore.password} onInput={handlePasswordChange} />
          </label>

          <div class="dialog-actions compact">
            <Button type="button" variant="solid" size="sm" tone="accent" onClick={handleSaveServer}>
              {saved() ? t("common.saved") : t("common.save")}
            </Button>
          </div>
          {error() ? (
            <div class="config-status-box" data-status="error">
              <span class="config-status-box__text">{error()}</span>
            </div>
          ) : null}
        </div>
      </div>

      {/* ── Behaviour ── */}
      <div class="config-panel-group">
        <SurfaceHeader variant="settings-group" title={t("settings.section.behaviour")} />
        <div class="config-panel-card">
          <div class="config-toggle-list">
            <label class="config-toggle-list-item">
              <span class="toggle-label">
                {t("settings.desktop_notifications_label")}
                <span class="toggle-hint">{t("settings.desktop_notifications_hint")}</span>
              </span>
              <input
                type="checkbox"
                checked={settingsStore.desktopNotifications}
                onChange={handleDesktopNotificationsChange}
              />
            </label>

            <label class="config-toggle-list-item">
              <span class="toggle-label">
                {t("settings.fail_on_information_missing_label")}
                <span class="toggle-hint">{t("settings.fail_on_information_missing_hint")}</span>
              </span>
              <input
                type="checkbox"
                checked={Boolean((appStore.config as any)?.assistant?.debug?.fail_on_information_missing)}
                onChange={handleInformationMissingChange}
              />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
