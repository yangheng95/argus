import { createSignal } from "solid-js";
import { t } from "../../utils/i18n";
import { settingsStore, setSettingsStore, saveSettings } from "../../store/settings";
import { appStore } from "../../store/app";
import { configure as configureApi } from "../../services/api";
import { checkConnection } from "../../services/connection";
import { reloadProjectScope, patchConfig } from "../../services/config";

export default function GeneralPanel() {
  const [saved, setSaved] = createSignal(false);

  // ── Handlers ──

  function handleThemeChange(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    setSettingsStore("theme", value as "light" | "dark" | "vscode-dark");
    saveSettings();
  }

  function handleLocaleChange(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    setSettingsStore("locale", value);
    saveSettings();
  }

  function handleOpacityChange(e: Event) {
    const raw = Number((e.currentTarget as HTMLInputElement).value);
    const value = Math.min(1, Math.max(0.1, raw / 100));
    setSettingsStore("opacity", value);
    saveSettings();
  }

  function handleToggle(
    key: "alwaysOnTop" | "showTranscriptDetails",
    e: Event,
  ) {
    setSettingsStore(key, (e.currentTarget as HTMLInputElement).checked);
    saveSettings();
  }

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

  const opacityPercent = () => Math.round(settingsStore.opacity * 100);

  const experimental = () => (appStore.config as any)?.experimental ?? {};

  function handleExperimentalToggle(key: "auto_permission", e: Event) {
    void patchConfig({ experimental: { [key]: (e.currentTarget as HTMLInputElement).checked } });
  }

  return (
    <div class="general-panel">
      {/* ── Connection ── */}
      <div class="config-panel-group">
        <h4 class="config-panel-group-title">{t("settings.section.connection")}</h4>
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
            <button
              type="button"
              class="btn btn-primary mini"
              onClick={handleSaveServer}
            >
              {saved() ? t("common.saved") : t("common.save")}
            </button>
          </div>
        </div>
      </div>

      {/* ── Appearance ── */}
      <div class="config-panel-group">
        <h4 class="config-panel-group-title">{t("settings.section.appearance")}</h4>
        <div class="config-panel-card">
          <label class="field">
            <span class="field-label">{t("settings.theme.label")}</span>
            <select
              class="field-input"
              value={settingsStore.theme}
              onChange={handleThemeChange}
            >
              <option value="dark">{t("settings.theme.dark")}</option>
              <option value="vscode-dark">{t("settings.theme.vscode_dark")}</option>
              <option value="light">{t("settings.theme.light")}</option>
              <option value="system">{t("settings.theme.system")}</option>
            </select>
          </label>

          <label class="field">
            <span class="field-label">{t("settings.locale.label")}</span>
            <select
              class="field-input"
              value={settingsStore.locale}
              onChange={handleLocaleChange}
            >
              <option value="zh-CN">中文</option>
              <option value="en-US">English</option>
            </select>
          </label>

          <div class="field opacity-field">
            <div class="opacity-header">
              <span class="field-label">{t("settings.opacity.label")}</span>
              <span class="opacity-value">{opacityPercent()}%</span>
            </div>
            <input
              type="range"
              min={10}
              max={100}
              step={1}
              value={opacityPercent()}
              onInput={handleOpacityChange}
              onChange={handleOpacityChange}
            />
          </div>
        </div>
      </div>

      {/* ── Behaviour ── */}
      <div class="config-panel-group">
        <h4 class="config-panel-group-title">{t("settings.section.behaviour")}</h4>
        <div class="config-panel-card">
          <div class="config-toggle-list">
            <label class="config-toggle-list-item">
              <span class="toggle-label">{t("settings.always_on_top")}</span>
              <input
                type="checkbox"
                checked={settingsStore.alwaysOnTop}
                onChange={(e) => handleToggle("alwaysOnTop", e)}
              />
            </label>

            <label class="config-toggle-list-item">
              <span class="toggle-label">{t("settings.show_transcript_details")}</span>
              <input
                type="checkbox"
                checked={settingsStore.showTranscriptDetails}
                onChange={(e) => handleToggle("showTranscriptDetails", e)}
              />
            </label>

            <label class="config-toggle-list-item">
              <span class="toggle-label">{t("settings.auto_permission")}</span>
              <input
                type="checkbox"
                checked={!!experimental().auto_permission}
                onChange={(e) => handleExperimentalToggle("auto_permission", e)}
              />
            </label>

          </div>
        </div>
      </div>
    </div>
  );
}
