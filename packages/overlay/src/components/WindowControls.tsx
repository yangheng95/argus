// ── WindowControls Component ──
// Tauri window management buttons: minimize, maximize/restore, close (hide),
// and always-on-top pin toggle. Ports setupTauri() from app.js lines 10325–10411
// plus maximizeLabel / maximizeIcon helpers and the CLOSE_HINT_KEY logic.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { settingsStore, setSettingsStore, saveSettings } from "../store/settings";
import { t } from "../utils/i18n";

// ── Constants ──

const CLOSE_HINT_KEY = "oc_close_hint_seen";

// ── Tauri window helpers ──

/** Retrieve the Tauri current-window handle, or null in non-Tauri environments. */
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

/** Show a native dialog via Tauri's dialog plugin (if available). */
async function nativeMessage(message: string, options?: { title?: string }): Promise<void> {
  const dialog = (window as any).__TAURI__?.dialog;
  if (typeof dialog?.message === "function") {
    await dialog.message(message, options).catch(() => undefined);
  }
}

// ── Label helpers (mirrors app.js maximizeLabel / maximizeIcon) ──

function maximizeLabel(isMaximized: boolean): string {
  return isMaximized ? t("titlebar.restore") : t("titlebar.maximize");
}

function maximizeIcon(isMaximized: boolean): string {
  // SVG icons matching the existing app.js inline SVGs
  if (isMaximized) {
    // Restore icon
    return `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <rect x="3" y="0.5" width="7" height="7" rx="0.5" stroke="currentColor"/>
      <path d="M1 3.5V10H7.5" stroke="currentColor" stroke-linecap="round"/>
    </svg>`;
  }
  // Maximize icon
  return `<svg width="11" height="11" viewBox="0 0 11 11" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
    <rect x="0.5" y="0.5" width="10" height="10" rx="0.5" stroke="currentColor"/>
  </svg>`;
}

// ── Component ──

export function WindowControls() {
  const [isMaximized, setIsMaximized] = createSignal(false);
  const [tauriWin, setTauriWin] = createSignal<any | null>(null);

  // ── Sync maximize state ──
  const syncMaximize = async (win: any): Promise<boolean> => {
    if (!win) return false;
    const maximized = await win.isMaximized?.().catch(() => false);
    setIsMaximized(!!maximized);
    return !!maximized;
  };

  // ── Sync pin (always-on-top) state ──
  const syncPin = async (win: any): Promise<void> => {
    if (!win) return;
    const pinned = await win.isAlwaysOnTop?.().catch(() => false);
    setSettingsStore("alwaysOnTop", !!pinned);
    saveSettings();
  };

  // ── Handle minimize ──
  const handleMinimize = () => {
    tauriWin()?.minimize?.().catch(() => undefined);
  };

  // ── Handle maximize / restore ──
  const handleMaximize = async () => {
    const win = tauriWin();
    if (!win) return;
    // Read current state first, then toggle
    const current = await syncMaximize(win);
    if (typeof win.toggleMaximize === "function") {
      await win.toggleMaximize().catch(() => undefined);
    } else if (current) {
      await win.unmaximize?.().catch(() => undefined);
    } else {
      await win.maximize?.().catch(() => undefined);
    }
    await syncMaximize(win);
  };

  // ── Handle close (hide window; first time shows background-notice) ──
  const handleClose = async () => {
    const win = tauriWin();
    if (!win) return;
    if (localStorage.getItem(CLOSE_HINT_KEY) !== "true") {
      localStorage.setItem(CLOSE_HINT_KEY, "true");
      await nativeMessage(t("titlebar.background_notice"), {
        title: t("titlebar.background_notice_title"),
      }).catch(() => undefined);
    }
    if (typeof win.hide === "function") {
      await win.hide().catch(() => undefined);
    } else {
      await win.minimize?.().catch(() => undefined);
    }
  };

  // ── Handle pin toggle ──
  const handlePin = async () => {
    const win = tauriWin();
    if (!win) return;
    const next = !settingsStore.alwaysOnTop;
    await win.setAlwaysOnTop?.(next).catch(() => undefined);
    await syncPin(win);
  };

  // ── Lifecycle: init Tauri and attach resize listener ──
  onMount(async () => {
    const win = await currentTauriWindow();
    if (!win) return;
    setTauriWin(win);

    // Apply persisted always-on-top value and sync actual state
    await win.setAlwaysOnTop?.(settingsStore.alwaysOnTop).catch(() => undefined);
    await syncPin(win);
    await syncMaximize(win);

    // Re-sync on window resize events (Tauri fires onResized when restored)
    let cleanupResized: (() => void) | undefined;
    if (typeof win.onResized === "function") {
      const unlisten = await win.onResized(() => {
        void syncMaximize(win);
      }).catch(() => undefined);
      if (typeof unlisten === "function") cleanupResized = unlisten;
    }
    onCleanup(() => cleanupResized?.());
  });

  const pinLabel = () =>
    settingsStore.alwaysOnTop ? t("titlebar.pin.unpin") : t("titlebar.pin.pin");

  const maxLabel = () => maximizeLabel(isMaximized());

  return (
    <div class="window-controls" data-no-drag="true">
      {/* Always-on-top pin */}
      <Show when={tauriWin() !== null}>
        <button
          type="button"
          id="btnPin"
          class="btn btn-ghost icon-btn titlebar-btn"
          data-pinned={settingsStore.alwaysOnTop ? "true" : "false"}
          title={pinLabel()}
          aria-label={pinLabel()}
          onClick={() => void handlePin()}
        >
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M9.5 2L14 6.5l-4 1.5-4 4-1.5-1.5 4-4L7 2.5 9.5 2z"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linejoin="round"
            />
            <line
              x1="2"
              y1="14"
              x2="6"
              y2="10"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </Show>

      {/* Minimize */}
      <Show when={tauriWin() !== null}>
        <button
          type="button"
          id="btnMinimize"
          class="btn btn-ghost icon-btn titlebar-btn"
          title={t("titlebar.minimize")}
          aria-label={t("titlebar.minimize")}
          onClick={handleMinimize}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <line
              x1="1"
              y1="5.5"
              x2="10"
              y2="5.5"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </Show>

      {/* Maximize / Restore */}
      <Show when={tauriWin() !== null}>
        <button
          type="button"
          id="btnMaximize"
          class="btn btn-ghost icon-btn titlebar-btn"
          data-maximized={isMaximized() ? "true" : "false"}
          title={maxLabel()}
          aria-label={maxLabel()}
          onClick={() => void handleMaximize()}
          // innerHTML is safest here because the SVG path differs for maximize vs
          // restore and we want a single reactive expression.
          innerHTML={maximizeIcon(isMaximized())}
        />
      </Show>

      {/* Close / hide */}
      <Show when={tauriWin() !== null}>
        <button
          type="button"
          id="btnClose"
          class="btn btn-ghost icon-btn titlebar-btn titlebar-btn-close"
          title={t("titlebar.close")}
          aria-label={t("titlebar.close")}
          onClick={() => void handleClose()}
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
            <line
              x1="1"
              y1="1"
              x2="10"
              y2="10"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
            <line
              x1="10"
              y1="1"
              x2="1"
              y2="10"
              stroke="currentColor"
              stroke-width="1.3"
              stroke-linecap="round"
            />
          </svg>
        </button>
      </Show>
    </div>
  );
}
