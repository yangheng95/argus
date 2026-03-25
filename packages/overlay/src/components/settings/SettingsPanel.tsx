// ── SettingsPanel ──
// Solid.js top-level settings panel component.
// Mirrors openConfigDialog / switchConfigTab / focusConfigSection from app.js
// and wraps all settings sub-panels with a tabbed sidebar layout.
//
// Tabs:
//   general   — server URL, theme, locale, opacity, misc toggles
//   llm       — LLM provider/model configuration  (→ LlmPanel)
//   channel   — channel configuration              (→ ChannelsPanel)
//   prompts   — prompt catalog / overrides         (→ PromptCatalog)
//   skills    — skill market + installed skills    (→ SkillMarketPanel)
//
// The component reads/writes settingsStore for General settings and delegates
// the domain-specific panels to their own subcomponents.

import {
  createSignal,
  Show,
  onMount,
  onCleanup,
  For,
} from "solid-js";
import { t } from "../../utils/i18n";
import { settingsStore, setSettingsStore, saveSettings } from "../../store/settings";
import LlmPanel from "./LlmPanel";
import ChannelsPanel from "./ChannelsPanel";
import PromptCatalog from "./PromptCatalog";
import SkillMarketPanel from "./SkillMarketPanel";

// ── Tab definitions ──

type TabID = "general" | "llm" | "channel" | "prompts" | "skills";

interface Tab {
  id: TabID;
  label: () => string;
  icon: string;
}

const TABS: Tab[] = [
  {
    id: "general",
    label: () => t("settings.tab.general"),
    icon: `<svg class="config-nav-icon" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="3" stroke="currentColor" stroke-width="1.5"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  {
    id: "llm",
    label: () => t("llm.title"),
    icon: `<svg class="config-nav-icon" viewBox="0 0 24 24" fill="none"><rect x="2" y="3" width="20" height="14" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M8 21h8M12 17v4" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  },
  {
    id: "channel",
    label: () => t("channel.title"),
    icon: `<svg class="config-nav-icon" viewBox="0 0 24 24" fill="none"><path d="M4 11a9 9 0 0 1 9-9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><path d="M4 16a14 14 0 0 1 14-14" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><circle cx="5" cy="19" r="2" stroke="currentColor" stroke-width="1.5"/></svg>`,
  },
  {
    id: "prompts",
    label: () => t("prompt.title"),
    icon: `<svg class="config-nav-icon" viewBox="0 0 24 24" fill="none"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  },
  {
    id: "skills",
    label: () => t("extensions.title"),
    icon: `<svg class="config-nav-icon" viewBox="0 0 24 24" fill="none"><path d="M13.5 2H10v4a2 2 0 1 1-4 0V2H2v4.5C2 7.9 3.1 9 4.5 9S7 7.9 7 6.5V6h4v.5C11 7.9 12.1 9 13.5 9S16 7.9 16 6.5V2h-2.5z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" transform="translate(2,2) scale(0.85)"/><rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="1.5"/><path d="M14 16h6M17 13v6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  },
];

// ── SettingsPanel Props ──

interface SettingsPanelProps {
  /** Initial tab to activate. Defaults to "general". */
  initialTab?: TabID;
  /** Called when the user requests to close the panel. */
  onClose?: () => void;
}

// ── GeneralTab ──
// Mirrors the titlebar-menu controls: theme, locale, opacity, toggles, and
// the server / connection settings (mirrors openServerSettings).

function GeneralTab() {
  const [saved, setSaved] = createSignal(false);

  function handleThemeChange(e: Event) {
    const value = (e.currentTarget as HTMLSelectElement).value;
    setSettingsStore("theme", value as "light" | "dark");
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
    key: "alwaysOnTop" | "unattended" | "autoPermission" | "autoQuestion" | "showTranscriptDetails",
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

  function handleSaveServer() {
    saveSettings();
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }

  const opacityPercent = () =>
    Math.round(settingsStore.opacity * 100);

  return (
    <div class="config-tab-panel active" data-config-panel="general">
      {/* ── Connection ── */}
      <section class="config-section">
        <h3 class="config-section-title">{t("settings.section.connection")}</h3>

        <label class="field">
          <span class="field-label">{t("settings.server_url")}</span>
          <input
            class="field-input"
            type="url"
            id="serverUrl"
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
            id="serverUsername"
            value={settingsStore.username}
            onInput={handleUsernameChange}
          />
        </label>

        <label class="field">
          <span class="field-label">{t("settings.password")}</span>
          <input
            class="field-input"
            type="password"
            id="serverPassword"
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
      </section>

      {/* ── Appearance ── */}
      <section class="config-section">
        <h3 class="config-section-title">{t("settings.section.appearance")}</h3>

        <label class="field">
          <span class="field-label">{t("settings.theme.label")}</span>
          <select
            class="field-input"
            id="btnThemeValue"
            value={settingsStore.theme}
            onChange={handleThemeChange}
          >
            <option value="dark">{t("settings.theme.dark")}</option>
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

        <label class="field">
          <span class="field-label">
            {t("settings.opacity.label")} {opacityPercent()}%
          </span>
          <input
            id="opacityRange"
            type="range"
            min={10}
            max={100}
            step={1}
            value={opacityPercent()}
            onInput={handleOpacityChange}
            onChange={handleOpacityChange}
          />
        </label>
      </section>

      {/* ── Behaviour ── */}
      <section class="config-section">
        <h3 class="config-section-title">{t("settings.section.behaviour")}</h3>

        <label class="field field-inline">
          <span class="field-label">{t("settings.always_on_top")}</span>
          <input
            id="chkAlwaysOnTop"
            type="checkbox"
            checked={settingsStore.alwaysOnTop}
            onChange={(e) => handleToggle("alwaysOnTop", e)}
          />
        </label>

        <label class="field field-inline">
          <span class="field-label">{t("settings.unattended")}</span>
          <input
            id="chkUnattended"
            type="checkbox"
            checked={settingsStore.unattended}
            onChange={(e) => handleToggle("unattended", e)}
          />
        </label>

        <label class="field field-inline">
          <span class="field-label">{t("settings.auto_permission")}</span>
          <input
            id="chkAutoPermission"
            type="checkbox"
            checked={settingsStore.autoPermission}
            onChange={(e) => handleToggle("autoPermission", e)}
          />
        </label>

        <label class="field field-inline">
          <span class="field-label">{t("settings.auto_question")}</span>
          <input
            id="chkAutoQuestion"
            type="checkbox"
            checked={settingsStore.autoQuestion}
            onChange={(e) => handleToggle("autoQuestion", e)}
          />
        </label>

        <label class="field field-inline">
          <span class="field-label">{t("settings.show_transcript_details")}</span>
          <input
            id="chkShowTranscriptDetails"
            type="checkbox"
            checked={settingsStore.showTranscriptDetails}
            onChange={(e) => handleToggle("showTranscriptDetails", e)}
          />
        </label>
      </section>
    </div>
  );
}

// ── SettingsPanel ──

export default function SettingsPanel(props: SettingsPanelProps) {
  const [activeTab, setActiveTab] = createSignal<TabID>(
    props.initialTab ?? "general",
  );

  // Allow external code to switch tabs by exposing a custom event handler
  // that listens for "settings:focus" custom events on the root element.
  let rootEl!: HTMLDivElement;

  onMount(() => {
    function handleFocus(e: Event) {
      const detail = (e as CustomEvent).detail;
      if (typeof detail === "string") {
        setActiveTab(detail as TabID);
      }
    }
    rootEl?.addEventListener("settings:focus", handleFocus);
    onCleanup(() => rootEl?.removeEventListener("settings:focus", handleFocus));
  });

  // ── Keyboard: Escape closes panel ──
  onMount(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") props.onClose?.();
    }
    document.addEventListener("keydown", onKeyDown);
    onCleanup(() => document.removeEventListener("keydown", onKeyDown));
  });

  return (
    <div
      ref={rootEl}
      class="config-dialog-layout settings-panel"
      role="dialog"
      aria-modal="true"
      aria-label={t("settings.title")}
    >
      {/* ── Sidebar nav ── */}
      <nav class="config-sidebar" id="settingsSidebar" aria-label={t("settings.nav_label")}>
        <For each={TABS}>
          {(tab) => (
            <button
              type="button"
              class="config-nav-item"
              classList={{ active: activeTab() === tab.id }}
              data-config-tab={tab.id}
              aria-selected={activeTab() === tab.id}
              onClick={() => setActiveTab(tab.id)}
              innerHTML={tab.icon + `<span>${tab.label()}</span>`}
            />
          )}
        </For>
      </nav>

      {/* ── Resizer (decorative; resize logic stays in app.js) ── */}
      <div class="config-resizer" aria-hidden="true" />

      {/* ── Content area ── */}
      <div class="config-content" id="settingsContent">
        <Show when={activeTab() === "general"}>
          <GeneralTab />
        </Show>
        <Show when={activeTab() === "llm"}>
          <LlmPanel />
        </Show>
        <Show when={activeTab() === "channel"}>
          <ChannelsPanel />
        </Show>
        <Show when={activeTab() === "prompts"}>
          <PromptCatalog />
        </Show>
        <Show when={activeTab() === "skills"}>
          <SkillMarketPanel />
        </Show>
      </div>
    </div>
  );
}
