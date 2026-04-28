// ── WindowControls Component ──
// Tauri window management buttons: minimize, maximize/restore, close (hide).
// Ports setupTauri() plus maximizeLabel / maximizeIcon helpers and the
// CLOSE_HINT_KEY logic.

import { createSignal, onCleanup, onMount, Show } from "solid-js";
import { t } from "../utils/i18n";
import { nativeMessage } from "../services/app-dialog";

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


// ── Label helpers (

function maximizeLabel(isMaximized: boolean): string {
  return isMaximized ? t("titlebar.restore") : t("titlebar.maximize");
}

function maximizeIcon(isMaximized: boolean): string {
 // SVG icons matching the existing inline SVGs
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

 // ── Lifecycle: init Tauri and attach resize listener ──
  onMount(async () => {
    const win = await currentTauriWindow();
    if (!win) return;
    setTauriWin(win);

    await syncMaximize(win);

 // Re-sync on window resize events (Tauri fires onResized when restored)
    let cleanupResized: (() => void) | undefined;
    if (typeof win.onResized === "function") {
      const unlisten = await win.onResized(() => {
        void syncMaximize(win);
      }).catch(() => undefined);
      if (typeof unlisten === "function") cleanupResized = unlisten;
    }

    const titlebar = document.getElementById("titlebar");
    const handleTitlebarPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      if (!(event.target instanceof Element)) return;
      if (
        event.target.closest(
          '[data-no-drag="true"], button, input, textarea, select, a, label, summary, [contenteditable="true"]',
        )
      ) {
        return;
      }
      event.preventDefault();
      win.startDragging?.().catch(() => undefined);
    };
    titlebar?.addEventListener("pointerdown", handleTitlebarPointerDown);

    onCleanup(() => cleanupResized?.());
    onCleanup(() => titlebar?.removeEventListener("pointerdown", handleTitlebarPointerDown));
  });

  const maxLabel = () => maximizeLabel(isMaximized());

  return (
    <div class="titlebar-window-controls" data-no-drag="true">
      {/* Minimize */}
      <Show when={tauriWin() !== null}>
        <button
          type="button"
          id="btnMinimize"
          class="titlebar-btn"
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
          class="titlebar-btn"
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
          class="titlebar-btn titlebar-close"
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
