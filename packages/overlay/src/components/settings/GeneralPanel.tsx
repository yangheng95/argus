import { createSignal } from "solid-js";
import { t } from "../../utils/i18n";
import { settingsStore, setSettingsStore, saveSettings } from "../../store/settings";
import { configure as configureApi } from "../../services/api";
import { checkConnection } from "../../services/connection";
import { reloadProjectScope } from "../../services/config";
import { requestNotificationPermission, notificationPermissionState } from "../../services/notify";
import { nativeMessage } from "../../services/app-dialog";
import { Button } from "../ui/Button";
import { SurfaceHeader } from "../ui/SurfaceHeader";

export default function GeneralPanel() {
  const [saved, setSaved] = createSignal(false);

  // ── Handlers ──

  function handleServerUrlChange(e: Event) {
    setSettingsStore("serverUrl", (e.currentTarget as HTMLInputElement).value.trim());
  }

  function handlePasswordChange(e: Event) {
    setSettingsStore("password", (e.currentTarget as HTMLInputElement).value);
  }

  function handleUsernameChange(e: Event) {
    setSettingsStore("username", (e.currentTarget as HTMLInputElement).value.trim());
  }

  async function handleSaveServer() {
    const url = settingsStore.serverUrl;
    const password = settingsStore.password;
    const username = settingsStore.username;
    configureApi({ serverUrl: url, password, username });
    saveSettings();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
    try {
      await checkConnection();
      await reloadProjectScope();
    } catch {
      /* reconnect monitor will retry */
    }
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
            <input
              class="field-input"
              type="text"
              value={settingsStore.username}
              onInput={handleUsernameChange}
            />
          </label>

          <label class="field">
            <span class="field-label">{t("settings.password")}</span>
            <input
              class="field-input"
              type="password"
              value={settingsStore.password}
              onInput={handlePasswordChange}
            />
          </label>

          <div class="dialog-actions compact">
            <Button
              type="button"
              variant="solid"
              size="sm"
              tone="accent"
              onClick={handleSaveServer}
            >
              {saved() ? t("common.saved") : t("common.save")}
            </Button>
          </div>
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
                onChange={(e) => {
                  const enabled = (e.currentTarget as HTMLInputElement).checked;
                  setSettingsStore("desktopNotifications", enabled);
                  saveSettings();
                  if (!enabled) return;
                  const state = notificationPermissionState();
                  if (state === "unsupported") {
                    void nativeMessage(t("settings.desktop_notifications_unsupported"), {
                      title: t("settings.desktop_notifications_label"),
                    });
                    return;
                  }
                  if (state === "granted") return;
                  // Eager prompt — Chrome/Edge respect a re-prompt after a
                  // prior denial when triggered from a fresh user gesture
                  // (this onChange handler is a click). Firefox treats
                  // denial as sticky and we surface that with a dialog.
                  void requestNotificationPermission().then((result) => {
                    if (result !== "granted") {
                      void nativeMessage(t("settings.desktop_notifications_blocked"), {
                        title: t("settings.desktop_notifications_label"),
                      });
                    }
                  });
                }}
              />
            </label>

          </div>
        </div>
      </div>
    </div>
  );
}
