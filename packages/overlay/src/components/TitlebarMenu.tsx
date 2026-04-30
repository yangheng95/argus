// ── TitlebarMenu Component ──
// Dropdown menu attached to the "more" button in the titlebar. Hosts:
// language toggle, theme picker, server-config / log entry buttons,
// auto-question toggle, max_runs / max_executor_groups budget sliders, and
// the window opacity slider.

import {
  createSignal,
  createMemo,
  onCleanup,
  onMount,
  For,
} from "solid-js";
import {
  settingsStore,
  setSettingsStore,
  applySettings,
  saveSettings,
} from "../store/settings";
// appStore / setAppStore are imported per the Phase 3 import contract so that
// callers can pass appStore-sourced data (e.g. connection status, log
// entries) into the menu without a separate import line at the call site.
import { appStore, setAppStore } from "../store/app";
import { boardStore } from "../store/board";
import { t } from "../utils/i18n";
import {
  sanitizeTheme,
  sanitizeOpacity,
  applyTheme,
  applyOpacity,
} from "../services/theme";
import { patchConfig } from "../services/config";

// ── Prop types ──

export interface TitlebarMenuProps {
  /**
 * Called when the user clicks "Server Config".
 */
  onOpenSettings?: () => void;

  /**
 * Called when the user clicks "Logs".
 */
  onOpenLog?: () => void;

  /**
 * Called when the user changes locale (toggle zh-CN ↔ en-US).
 * Receives the new locale string.
 */
  onLocaleChange?: (locale: string) => void;
}

// ── Component ──

export function TitlebarMenu(props: TitlebarMenuProps) {
 // ── Local state ──
  const [menuOpen, setMenuOpen] = createSignal(false);

 // ── Derived ──

 // Available themes — each entry drives one row in the theme selector.
  const THEME_OPTIONS: Array<{ id: string; labelKey: string }> = [
    { id: "system", labelKey: "settings.theme.system" },
    { id: "light", labelKey: "settings.theme.light" },
    { id: "dark", labelKey: "settings.theme.dark" },
    { id: "vscode-dark", labelKey: "settings.theme.vscode_dark" },
  ];

  const currentTheme = createMemo(() => sanitizeTheme(settingsStore.theme));
  const themeLabel = createMemo(() => {
    const theme = currentTheme();
    const hit = THEME_OPTIONS.find((opt) => opt.id === theme);
    return hit ? t(hit.labelKey) : t("settings.theme.dark");
  });

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

 // ── Task budget sliders ──
 //
 // Bounds mirror what the backend validates against — max_runs and
 // max_executor_groups are plain numbers on `assistant` config (see
 // opencorvus/src/engine/config.ts). Effective values come from server config
 // (single source of truth — DEFAULTS in engine/config.ts). The slider is
 // disabled until config has loaded; we deliberately do NOT carry a local
 // fallback default, because that would silently mask a missing-config bug
 // and let the user "save" a value the server never advertised.
  const MAX_RUNS_MIN = 1;
  const MAX_RUNS_MAX = 30;
  const MAX_GROUPS_MIN = 1;
  const MAX_GROUPS_MAX = 10;

  const clamp = (v: number, lo: number, hi: number): number =>
    Math.min(Math.max(Math.round(v), lo), hi);

 // Task budget is locked once the task has started — show and disable the
 // slider reflecting `engine_task.budget` values. Otherwise the slider
 // reflects the active global config defaults.
  const taskLockedMaxRuns = createMemo<number | null>(() => {
    const n = Number((boardStore.board as any)?.task?.budget?.maxRuns);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const taskLockedMaxGroups = createMemo<number | null>(() => {
    const n = Number((boardStore.board as any)?.task?.budget?.maxExecutorGroups);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const budgetLocked = createMemo(
    () => !!boardStore.selectedTaskID && taskLockedMaxRuns() !== null,
  );

  // Returns null until server config has loaded — UI must reflect "unknown",
  // not a guessed default. Slider is disabled while null; nothing here invents
  // a number the server never sent.
  const configMaxRuns = createMemo<number | null>(() => {
    const raw = (appStore.config as any)?.assistant?.max_runs;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  });
  const configMaxGroups = createMemo<number | null>(() => {
    const raw = (appStore.config as any)?.assistant?.max_executor_groups;
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  });

  const displayMaxRuns = createMemo<number | null>(() => {
    const v = taskLockedMaxRuns() ?? configMaxRuns();
    return v === null ? null : clamp(v, MAX_RUNS_MIN, MAX_RUNS_MAX);
  });
  const displayMaxGroups = createMemo<number | null>(() => {
    const v = taskLockedMaxGroups() ?? configMaxGroups();
    return v === null ? null : clamp(v, MAX_GROUPS_MIN, MAX_GROUPS_MAX);
  });

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

 // Locale toggle —
  async function handleLocaleToggle() {
    const next =
      settingsStore.locale === "zh-CN" ? "en-US" : "zh-CN";
    props.onLocaleChange?.(next);
    closeMenu();
  }

 // Theme selection — pick an explicit theme from the list
  function handleThemeSelect(next: string) {
    setSettingsStore("theme", next);
    applyTheme(next);
    applySettings({ ...settingsStore, theme: next });
    saveSettings();
  }

 // Settings button —
  function handleOpenSettings() {
    props.onOpenSettings?.();
    closeMenu();
  }

 // Log button —
  function handleOpenLog() {
    props.onOpenLog?.();
    closeMenu();
  }

 // Auto-question toggle — PATCH server config
  async function handleAutoQuestionChange(checked: boolean) {
    try {
      await patchConfig({ experimental: { auto_question: checked } });
    } catch (e) { console.error("[titlebar] failed to update auto_question", e); }
    closeMenu();
  }

 // Opacity range — live update on input, commit on change
  function handleOpacityInput(rawValue: string) {
    const next = sanitizeOpacity(Number(rawValue) / 100);
    setSettingsStore("opacity", next);
    applyOpacity(next);
  }

  function handleOpacityChange(rawValue: string) {
    const next = sanitizeOpacity(Number(rawValue) / 100);
    setSettingsStore("opacity", next);
    applyOpacity(next);
    applySettings({ ...settingsStore, opacity: next });
    saveSettings();
    closeMenu();
  }

 // Budget sliders — commit on `change` (mouseup), not `input`. Each change is
 // a server PATCH, so holding a commit-per-tick contract keeps the write
 // volume bounded. The slider's visible value is driven by the reactive
 // createMemo (config → displayMaxRuns/displayMaxGroups), so optimistic
 // update isn't needed — `patchConfig` will update appStore.config on
 // response and the memo re-renders.
  async function handleMaxRunsChange(rawValue: string) {
    if (budgetLocked()) return;
    if (configMaxRuns() === null) return; // config not loaded — nothing to compare against
    const next = clamp(Number(rawValue), MAX_RUNS_MIN, MAX_RUNS_MAX);
    if (next === configMaxRuns()) return;
    try {
      await patchConfig({ assistant: { max_runs: next } });
    } catch (e) {
      console.error("[titlebar] failed to patch max_runs", e);
    }
  }

  async function handleMaxGroupsChange(rawValue: string) {
    if (budgetLocked()) return;
    if (configMaxGroups() === null) return;
    const next = clamp(Number(rawValue), MAX_GROUPS_MIN, MAX_GROUPS_MAX);
    if (next === configMaxGroups()) return;
    try {
      await patchConfig({ assistant: { max_executor_groups: next } });
    } catch (e) {
      console.error("[titlebar] failed to patch max_executor_groups", e);
    }
  }

 // ── Lifecycle ──

  onMount(() => {
 // Close menu on click outside —
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

 // Close menu on Escape —
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

        {/* ── Theme group ── */}
        <div
          class="titlebar-menu-group"
          id="titlebarThemeGroup"
          data-mode={currentTheme()}
          role="radiogroup"
          aria-label={t("settings.theme")}
        >
          <div class="titlebar-menu-group-head">
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
              <span class="titlebar-menu-meta">{themeLabel()}</span>
            </span>
          </div>
          <div class="titlebar-theme-options">
            <For each={THEME_OPTIONS}>
              {(opt) => (
                <button
                  type="button"
                  class="titlebar-theme-option"
                  role="radio"
                  aria-checked={currentTheme() === opt.id}
                  data-active={currentTheme() === opt.id ? "true" : "false"}
                  data-theme-value={opt.id}
                  title={t(opt.labelKey)}
                  aria-label={t(opt.labelKey)}
                  onClick={() => handleThemeSelect(opt.id)}
                >
                  <span class="titlebar-theme-option-swatch" data-theme={opt.id} aria-hidden="true" />
                  <span class="titlebar-theme-option-label">
                    {t(opt.labelKey)}
                  </span>
                </button>
              )}
            </For>
          </div>
        </div>

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

        {/* ── Divider ── */}
        <div class="titlebar-menu-divider" aria-hidden="true" />

        {/* ── Auto-reject questions toggle ── */}
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
            checked={appStore.config?.experimental?.auto_question === true}
            onChange={(e) =>
              void handleAutoQuestionChange(
                (e.target as HTMLInputElement).checked,
              )
            }
          />
        </label>

        {/* ── Max execution runs slider ── */}
        <label class="titlebar-menu-range" for="budgetMaxRunsRange">
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("titlebar.budget_max_runs")}
            </span>
            <span class="titlebar-menu-meta">
              {budgetLocked()
                ? t("titlebar.budget_locked")
                : t("titlebar.budget_max_runs_hint")}
            </span>
          </span>
          <span class="titlebar-menu-range-control">
            <input
              class="titlebar-menu-slider"
              id="budgetMaxRunsRange"
              type="range"
              min={String(MAX_RUNS_MIN)}
              max={String(MAX_RUNS_MAX)}
              step="1"
              value={String(displayMaxRuns() ?? MAX_RUNS_MIN)}
              disabled={budgetLocked() || displayMaxRuns() === null}
              onChange={(e) =>
                void handleMaxRunsChange((e.target as HTMLInputElement).value)
              }
            />
            <span class="titlebar-menu-value">{displayMaxRuns() ?? "—"}</span>
          </span>
        </label>

        {/* ── Goal parallelism slider ── */}
        <label class="titlebar-menu-range" for="budgetMaxGroupsRange">
          <span class="titlebar-menu-copy">
            <span class="titlebar-menu-title">
              {t("titlebar.budget_max_executor_groups")}
            </span>
            <span class="titlebar-menu-meta">
              {budgetLocked()
                ? t("titlebar.budget_locked")
                : t("titlebar.budget_max_executor_groups_hint")}
            </span>
          </span>
          <span class="titlebar-menu-range-control">
            <input
              class="titlebar-menu-slider"
              id="budgetMaxGroupsRange"
              type="range"
              min={String(MAX_GROUPS_MIN)}
              max={String(MAX_GROUPS_MAX)}
              step="1"
              value={String(displayMaxGroups() ?? MAX_GROUPS_MIN)}
              disabled={budgetLocked() || displayMaxGroups() === null}
              onChange={(e) =>
                void handleMaxGroupsChange((e.target as HTMLInputElement).value)
              }
            />
            <span class="titlebar-menu-value">{displayMaxGroups() ?? "—"}</span>
          </span>
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
                min="50"
                max="100"
                step="5"
                value={String(opacityPct())}
              onInput={(e) =>
                handleOpacityInput((e.target as HTMLInputElement).value)
              }
              onChange={(e) =>
                handleOpacityChange((e.target as HTMLInputElement).value)
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
