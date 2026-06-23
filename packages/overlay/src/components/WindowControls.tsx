// ── WindowControls Component ──
// Tauri window management buttons: minimize, maximize/restore, close.
// Ports setupTauri() plus maximizeLabel logic.

import { createSignal, onCleanup, onMount, Show } from "solid-js"
import { t } from "../utils/i18n"
import { getHostTransport } from "../services/host-transport"
import { getTauriWindowHandle } from "../services/tauri-transport"
import { quitOverlay } from "../services/window"
import { nativeConfirm } from "../utils/native"
import { formatErrorDetails, notifyError } from "../services/notify"
import { Button } from "./ui/Button"
import { Icon } from "./Icon"

// ── Tauri window helpers ──

/** Retrieve the Tauri current-window handle, or null in non-Tauri environments.
 *  Routes through services/tauri-transport.ts so this component does not
 *  reach for `window.__TAURI__` directly (CLAUDE.md §二-8). The function is
 *  async to preserve the pre-M3 call-site shape; the handle is resolved
 *  synchronously inside tauri-transport. */
async function currentTauriWindow(): Promise<any | null> {
  return getTauriWindowHandle()
}

// ── Label helpers ──

function maximizeLabel(isMaximized: boolean): string {
  return isMaximized ? t("titlebar.restore") : t("titlebar.maximize")
}

function windowControlErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function reportWindowControlError(owner: string, error: unknown): void {
  notifyError({
    id: `window-control:${owner}`,
    title: t("common.error"),
    message: windowControlErrorMessage(error),
    details: formatErrorDetails(error),
  })
}

function runWindowControlAction(owner: string, action: () => void | Promise<void>): void {
  try {
    void Promise.resolve(action()).catch((error) => reportWindowControlError(owner, error))
  } catch (error) {
    reportWindowControlError(owner, error)
  }
}

// ── Component ──

export function WindowControls() {
  const [isMaximized, setIsMaximized] = createSignal(false)
  const [tauriWin, setTauriWin] = createSignal<any | null>(null)
  const hostCapabilities = getHostTransport().capabilities

  // ── Sync maximize state ──
  const syncMaximize = async (win: any): Promise<boolean> => {
    if (!win) return false
    const maximized = await win.isMaximized?.().catch(() => false)
    setIsMaximized(!!maximized)
    return !!maximized
  }

  // ── Handle minimize ──
  const handleMinimize = () => {
    return tauriWin()?.minimize?.()
  }

  // ── Handle maximize / restore ──
  const handleMaximize = async () => {
    const win = tauriWin()
    if (!win) return
    // Read current state first, then toggle
    const current = await syncMaximize(win)
    if (typeof win.toggleMaximize === "function") {
      await win.toggleMaximize()
    } else if (current) {
      await win.unmaximize?.()
    } else {
      await win.maximize?.()
    }
    await syncMaximize(win)
  }

  // ── Handle close ──
  const handleClose = async () => {
    if (!tauriWin()) return
    const confirmed = await nativeConfirm(t("titlebar.close_confirm_message"), {
      title: t("titlebar.close_confirm_title"),
      okLabel: t("titlebar.close_confirm_quit"),
      cancelLabel: t("common.cancel"),
      kind: "warning",
    })
    if (!confirmed) return
    await quitOverlay()
  }

  // ── Lifecycle: init Tauri and attach resize listener ──
  onMount(() =>
    runWindowControlAction("init", async () => {
      if (!hostCapabilities.ui.windowControls) return
      const win = await currentTauriWindow()
      if (!win) return
      setTauriWin(win)

      await syncMaximize(win)

      // Re-sync on window resize events (Tauri fires onResized when restored)
      let cleanupResized: (() => void) | undefined
      if (typeof win.onResized === "function") {
        const unlisten = await win
          .onResized(() => {
            runWindowControlAction("resize-sync", () => syncMaximize(win).then(() => undefined))
          })
          .catch(() => undefined)
        if (typeof unlisten === "function") cleanupResized = unlisten
      }

      const titlebar = hostCapabilities.ui.windowDrag ? document.getElementById("titlebar") : null
      const handleTitlebarPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return
        if (!(event.target instanceof Element)) return
        if (
          event.target.closest(
            '[data-no-drag="true"], button, input, textarea, select, a, label, summary, [contenteditable="true"]',
          )
        ) {
          return
        }
        event.preventDefault()
        win.startDragging?.().catch(() => undefined)
      }
      titlebar?.addEventListener("pointerdown", handleTitlebarPointerDown)

      onCleanup(() => cleanupResized?.())
      onCleanup(() => titlebar?.removeEventListener("pointerdown", handleTitlebarPointerDown))
    }),
  )

  const maxLabel = () => maximizeLabel(isMaximized())

  return (
    <div class="titlebar-window-controls" data-no-drag="true">
      {/* Minimize */}
      <Show when={hostCapabilities.ui.windowControls && tauriWin() !== null}>
        <Button
          type="button"
          id="btnMinimize"
          variant="ghost"
          size="icon"
          tone="neutral"
          data-chrome="window-control"
          title={t("titlebar.minimize")}
          aria-label={t("titlebar.minimize")}
          onClick={() => runWindowControlAction("minimize", handleMinimize)}
        >
          <Icon name="minimize" />
        </Button>
      </Show>

      {/* Maximize / Restore */}
      <Show when={hostCapabilities.ui.windowControls && tauriWin() !== null}>
        <Button
          type="button"
          id="btnMaximize"
          variant="ghost"
          size="icon"
          tone="neutral"
          data-chrome="window-control"
          data-maximized={isMaximized() ? "true" : "false"}
          title={maxLabel()}
          aria-label={maxLabel()}
          onClick={() => runWindowControlAction("maximize", handleMaximize)}
        >
          <Icon name={isMaximized() ? "restore" : "maximize"} />
        </Button>
      </Show>

      {/* Close / hide */}
      <Show when={hostCapabilities.ui.windowControls && tauriWin() !== null}>
        <Button
          type="button"
          id="btnClose"
          variant="ghost"
          size="icon"
          tone="danger"
          data-chrome="window-control"
          title={t("titlebar.close")}
          aria-label={t("titlebar.close")}
          onClick={() => runWindowControlAction("close", handleClose)}
        >
          <Icon name="close" />
        </Button>
      </Show>
    </div>
  )
}
