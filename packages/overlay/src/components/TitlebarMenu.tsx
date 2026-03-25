// ── TitlebarMenu Component ──
// Exact port of the titlebar "more" dropdown menu from app.js.
//
// Covers:
//   - renderTitlebarMenu()       (lines 1697-1728)
//   - setTitlebarMenu()          (lines 1686-1691)
//   - closeTitlebarMenu()        (lines 1693-1695)
//   - event handlers:
//       btnTitlebarMenu click    (line 9943-9947)
//       pointerdown outside      (lines 9949-9957)
//       Escape key               (lines 9959-9962)
//       btnLocale click          (lines 9933-9936)
//       btnTheme click           (lines 9926-9931)
//       btnSettings click        (lines 9938-9941)
//       btnLog click             (lines 11119-11122)
//       btnPin click             (lines 10392-10410)
//       chkUnattended change     (lines 9972-9979)
//       chkAutoPermission change (lines 9964-9970)
//       chkAutoQuestion change   (lines 9981-9987)
//       chkShowTranscript change (lines 9989-9995)
//       opacityRange input/change (lines 9997-10007)
//
// Import contract:
//   settingsStore  — reactive settings (theme, alwaysOnTop, unattended, …)
//   applySettings  — validate + write partial settings into store
//   saveSettings   — persist store to localStorage
//   appStore       — runtime UI state (used by callers; exposed via props)
//   setAppStore    — update runtime state
//   t              — i18n translation helper

import {
  createSignal,
  createMemo,
  onCleanup,
  onMount,
} from "solid-js";
import {
  settingsStore,
  setSettingsStore,
  applySettings,
  saveSettings,
} from "../store/settings";
// appStore / setAppStore are imported per the Phase 3 import contract so that
// callers can bridge appStore-sourced data (e.g. connection status, log
// entries) into the menu without a separate import line at the call site.
import { appStore, setAppStore } from "../store/app";
import { t } from "../utils/i18n";
import {
  sanitizeTheme,
  sanitizeOpacity,
  resolvedTheme,
  applyTheme,
  applyOpacity,
} from "../services/theme";

// ── Prop types ──

export interface TitlebarMenuProps {
  /**
   * Called when the user clicks "Server Config".
   * Mirrors app.js openServerSettings().
   */
  onOpenSettings?: () => void;

  /**
   * Called when the user clicks "Logs".
   * Mirrors app.js openLogViewer().
   */
  onOpenLog?: () => void;

  /**
   * Called when the user changes locale (toggle zh-CN ↔ en-US).
   * Receives the new locale string.
   * Mirrors app.js setLocale().
   */
  onLocaleChange?: (locale: string) => void;
}

// ── Tauri window helper (internal) ──

async function currentTauriWindow(): Promise<any | null> {
  const getCurrent = (window as any).__TAURI__?.window?.getCurrentWindow;
  if (typeof getCurrent === "function") {
    try {
      return getCurrent() as any;
    } catch {
      // Not running inside Tauri
    }
  }
  return null;
}

// ── Component ──

export function TitlebarMenu(props: TitlebarMenuProps) {
  // ── Local state ──
  const [menuOpen, setMenuOpen] = createSignal(false);

  // ── Derived ──

  // Theme label shown in the menu item (mirrors renderTitlebarMenu btnThemeValue)
  const themeLabel = createMemo(() => {
    const theme = sanitizeTheme(settingsStore.theme);
    if (theme === "light") return t("settings.theme.light");
    if (theme === "system") return t("settings.theme.system");
    return t("settings.theme.dark");
  });

  // Pin label (mirrors renderTitlebarMenu btnPinValue)
  const pinLabel = createMemo(() =>
    settingsStore.alwaysOnTop ? t("common.yes") : t("common.no"),
  );

  // Locale label shown in the menu item (mirrors renderLocale btnLocaleLabel)
  const localeLabel = createMemo(() =>
    settingsStore.locale === "zh-CN"
      ? t("settings.language.zh_cn")
      : t("settings.language.en_us"),
  );

  // Locale toggle title / aria-label (mirrors renderLocale btnLocale.title)
  const localeToggleTitle = createMemo(() => {
    const next = settingsStore.locale === "zh-CN" ? "en-US" : "zh-CN";
    return next === "zh-CN"
      ? t("settings.switch_to_zh")
      : t("settings.switch_to_en");
  });

  // Opacity as integer percent (mirrors renderTitlebarMenu opacityRange / opacityValue)
  const opacityPct = createMemo(() =>
    Math.round(sanitizeOpacity(settingsStore.opacity) * 100),
  );

  // ── Menu open / close helpers ──

  function openMenu() {
    setMenuOpen(true);
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  function toggleMenu() {
    setMenuOpen((v) => !v);
  }

  // ── Action handlers ──

  // Locale toggle — mirrors app.js dom.btnLocale click handler
  async function handleLocaleToggle() {
    const next =
      settingsStore.locale === "zh-CN" ? "en-US" : "zh-CN";
    props.onLocaleChange?.(next);
    closeMenu();
  }

  // Theme cycle — mirrors app.js dom.btnTheme click handler
  // resolvedTheme() === "light" → switch to "dark"; otherwise → "light"
  async function handleThemeToggle() {
    const next = resolvedTheme() === "light" ? "dark" : "light";
    setSettingsStore("theme", next);
    applyTheme(next);
    applySettings({ ...settingsStore, theme: next });
    saveSettings();
    closeMenu();
  }

  // Settings button — mirrors app.js dom.btnSettings click handler
  function handleOpenSettings() {
    props.onOpenSettings?.();
    closeMenu();
  }

  // Log button — mirrors app.js dom.btnLog click handler
  function handleOpenLog() {
    props.onOpenLog?.();
    closeMenu();
  }

  // Pin (always on top) toggle — mirrors app.js dom.btnPin click handler
  async function handlePinToggle() {
    const next = !settingsStore.alwaysOnTop;
    const win = await currentTauriWindow();
    if (win && typeof win.setAlwaysOnTop === "function") {
      await win.setAlwaysOnTop(next).catch(() => undefined);
      // Sync back the actual state from the window (mirrors app.js syncPin)
      const actual = await win
        .isAlwaysOnTop?.()
        .catch(() => next);
      setSettingsStore("alwaysOnTop", !!actual);
    } else {
      setSettingsStore("alwaysOnTop", next);
    }
    saveSettings();
    closeMenu();
  }

  // Unattended toggle — mirrors app.js dom.chkUnattended change handler
  async function handleUnattendedChange(checked: boolean) {
    setSettingsStore("unattended", checked);
    applySettings({ ...settingsStore, unattended: checked });
    saveSettings();
    closeMenu();
  }

  // Auto-permission toggle — mirrors app.js dom.chkAutoPermission change handler
  async function handleAutoPermissionChange(checked: boolean) {
    setSettingsStore("autoPermission", checked);
    applySettings({ ...settingsStore, autoPermission: checked });
    saveSettings();
    closeMenu();
  }

  // Auto-question toggle — mirrors app.js dom.chkAutoQuestion change handler
  async function handleAutoQuestionChange(checked: boolean) {
    setSettingsStore("autoQuestion", checked);
    applySettings({ ...settingsStore, autoQuestion: checked });
    saveSettings();
    closeMenu();
  }

  // Show transcript details toggle — mirrors app.js dom.chkShowTranscriptDetails change handler
  async function handleShowTranscriptDetailsChange(checked: boolean) {
    setSettingsStore("showTranscriptDetails", checked);
    applySettings({ ...settingsStore, showTranscriptDetails: checked });
    saveSettings();
    closeMenu();
  }

  // Opacity range — mirrors app.js opacityRange input handler (live update)
  function handleOpacityInput(rawValue: string) {
    const next = sanitizeOpacity(Number(rawValue) / 100);
    setSettingsStore("opacity", next);
    void applyOpacity(next);
  }

  // Opacity range — mirrors app.js opacityRange change handler (commit + persist)
  async function handleOpacityChange(rawValue: string) {
    const next = sanitizeOpacity(Number(rawValue) / 100);
    setSettingsStore("opacity", next);
    await applyOpacity(next);
    applySettings({ ...settingsStore, opacity: next });
    saveSettings();
    closeMenu();
  }

  // ── Lifecycle ──

  onMount(() => {
    // Close menu on click outside — mirrors app.js pointerdown handler
    function onPointerDown(event: PointerEvent) {
      if (!menuOpen()) return;
      const target = event.target;
      if (!(target instanceof Element)) {
        closeMenu();
        return;
      }
      if (target.closest("#titlebarMenu, #btnTitlebarMenu")) return;
      closeMenu();
    }

    // Close menu on Escape — mirrors app.js keydown handler
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      closeMenu();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);

    onCleanup(() => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    });
  });

  // ── Render ──

  return (
    <div class="titlebar-menu-wrap" data-no-drag="true">
      {/* ── Toggle button ── */}
      <button
        type="button"
        id="btnTitlebarMenu"
        class="titlebar-btn"
        title={t("titlebar.more")}
        aria-label={t("titlebar.more")}
        aria-expanded={menuOpen() ? "true" : "false"}
        aria-controls="titlebarMenu"
        aria-haspopup="true"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          toggleMenu();
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
          <circle cx="8" cy="8" r="1.2" fill="currentColor" />
          <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
        </svg>
      </button>

      {/* ── Dropdown panel ── */}
      <div
        id="titlebarMenu"
        class="titlebar-menu-panel"
        data-no-drag="true"
        hidden={!menuOpen()}
      >
        {/* ── Language / Locale ── */}
        <button
          type="button"
          id="btnLocale"
          class="titlebar-menu-item"
          title={localeToggleTitle()}
          aria-label={localeToggleTitle()}
          onClick={() => void handleLocaleToggle()}
        >
          <span class="titlebar-menu-icon" aria-hidden="true">
            A
          </span>
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("settings.language")}
            </span>
            <span class="titlebar-menu-meta" id="btnLocaleLabel">
              {localeLabel()}
            </span>
          </span>
        </button>

        {/* ── Theme ── */}
        <button
          type="button"
          id="btnTheme"
          class="titlebar-menu-item"
          title={
            resolvedTheme() === "light"
              ? t("titlebar.theme.dark")
              : t("titlebar.theme.light")
          }
          aria-label={
            resolvedTheme() === "light"
              ? t("titlebar.theme.dark")
              : t("titlebar.theme.light")
          }
          data-theme={resolvedTheme()}
          data-mode={sanitizeTheme(settingsStore.theme)}
          onClick={() => void handleThemeToggle()}
        >
          <span class="titlebar-menu-icon" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
            >
              <circle
                cx="8"
                cy="8"
                r="3"
                stroke="currentColor"
                stroke-width="1.2"
              />
              <path
                d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("settings.theme")}
            </span>
            <span class="titlebar-menu-meta" id="btnThemeValue">
              {themeLabel()}
            </span>
          </span>
        </button>

        {/* ── Server Config ── */}
        <button
          type="button"
          id="btnSettings"
          class="titlebar-menu-item"
          title={t("titlebar.server_config")}
          aria-label={t("titlebar.server_config")}
          onClick={handleOpenSettings}
        >
          <span class="titlebar-menu-icon" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M3 4h10M3 8h10M3 12h10"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
              />
              <circle cx="6" cy="4" r="1.6" fill="currentColor" />
              <circle cx="10" cy="8" r="1.6" fill="currentColor" />
              <circle cx="7.5" cy="12" r="1.6" fill="currentColor" />
            </svg>
          </span>
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("titlebar.server_config")}
            </span>
            <span class="titlebar-menu-meta">{t("common.open")}</span>
          </span>
        </button>

        {/* ── Logs ── */}
        <button
          type="button"
          id="btnLog"
          class="titlebar-menu-item"
          title={t("titlebar.logs")}
          aria-label={t("titlebar.logs")}
          onClick={handleOpenLog}
        >
          <span class="titlebar-menu-icon" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M3 3h10M3 6.5h8M3 10h6M3 13.5h9"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("titlebar.logs")}
            </span>
            <span class="titlebar-menu-meta">{t("common.open")}</span>
          </span>
        </button>

        {/* ── Always on top (pin) ── */}
        <button
          type="button"
          id="btnPin"
          class="titlebar-menu-item"
          title={t("titlebar.pin")}
          aria-label={t("titlebar.pin")}
          data-pinned={settingsStore.alwaysOnTop ? "true" : "false"}
          onClick={() => void handlePinToggle()}
        >
          <span class="titlebar-menu-icon" aria-hidden="true">
            <svg
              width="14"
              height="14"
              viewBox="0 0 16 16"
              fill="none"
            >
              <path
                d="M8 1v6M5.5 7h5l-.5 4H6l-.5-4z"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
                stroke-linejoin="round"
              />
              <path
                d="M8 11v4"
                stroke="currentColor"
                stroke-width="1.2"
                stroke-linecap="round"
              />
            </svg>
          </span>
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("titlebar.pin")}
            </span>
            <span class="titlebar-menu-meta" id="btnPinValue">
              {pinLabel()}
            </span>
          </span>
        </button>

        {/* ── Divider ── */}
        <div class="titlebar-menu-divider" aria-hidden="true" />

        {/* ── Unattended mode toggle ── */}
        <label class="titlebar-menu-toggle" for="chkUnattended">
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("titlebar.unattended")}
            </span>
            <span class="titlebar-menu-meta">
              {t("titlebar.unattended_hint")}
            </span>
          </span>
          <input
            class="titlebar-menu-check"
            id="chkUnattended"
            type="checkbox"
            checked={settingsStore.unattended}
            onChange={(e) =>
              void handleUnattendedChange(
                (e.target as HTMLInputElement).checked,
              )
            }
          />
        </label>

        {/* ── Auto-approve permissions toggle ── */}
        <label class="titlebar-menu-toggle" for="chkAutoPermission">
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("titlebar.auto_permission")}
            </span>
            <span class="titlebar-menu-meta">
              {t("titlebar.auto_permission_hint")}
            </span>
          </span>
          <input
            class="titlebar-menu-check"
            id="chkAutoPermission"
            type="checkbox"
            checked={settingsStore.autoPermission}
            onChange={(e) =>
              void handleAutoPermissionChange(
                (e.target as HTMLInputElement).checked,
              )
            }
          />
        </label>

        {/* ── Auto-confirm questions toggle ── */}
        <label class="titlebar-menu-toggle" for="chkAutoQuestion">
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("titlebar.auto_question")}
            </span>
            <span class="titlebar-menu-meta">
              {t("titlebar.auto_question_hint")}
            </span>
          </span>
          <input
            class="titlebar-menu-check"
            id="chkAutoQuestion"
            type="checkbox"
            checked={settingsStore.autoQuestion}
            onChange={(e) =>
              void handleAutoQuestionChange(
                (e.target as HTMLInputElement).checked,
              )
            }
          />
        </label>

        {/* ── Show full transcript details toggle ── */}
        <label
          class="titlebar-menu-toggle"
          for="chkShowTranscriptDetails"
        >
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("titlebar.full_transcript")}
            </span>
            <span class="titlebar-menu-meta">
              {t("titlebar.full_transcript_hint")}
            </span>
          </span>
          <input
            class="titlebar-menu-check"
            id="chkShowTranscriptDetails"
            type="checkbox"
            checked={settingsStore.showTranscriptDetails}
            onChange={(e) =>
              void handleShowTranscriptDetailsChange(
                (e.target as HTMLInputElement).checked,
              )
            }
          />
        </label>

        {/* ── Window opacity slider ── */}
        <label class="titlebar-menu-range" for="opacityRange">
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("titlebar.opacity")}
            </span>
            <span class="titlebar-menu-meta">
              {t("titlebar.opacity_hint")}
            </span>
          </span>
          <span class="titlebar-menu-range-control">
            <input
              class="titlebar-menu-slider"
              id="opacityRange"
              type="range"
              min="70"
              max="100"
              step="5"
              value={String(opacityPct())}
              onInput={(e) =>
                handleOpacityInput((e.target as HTMLInputElement).value)
              }
              onChange={(e) =>
                void handleOpacityChange(
                  (e.target as HTMLInputElement).value,
                )
              }
            />
            <span class="titlebar-menu-value" id="opacityValue">
              {opacityPct()}%
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}
