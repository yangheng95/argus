import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { FitAddon, Ghostty, Terminal as GhosttyTerminal } from "ghostty-web"
import {
  loadTuiHostSnapshot,
  loadTuiHostStatus,
  resizeTuiHost,
  sendTuiHostInput,
  startTuiHost,
  stopTuiHost,
  type TuiHostSnapshot,
} from "../services/tui-host"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"

const HOST_POLL_INTERVAL_MS = 500
const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30

type GhosttyModule = typeof import("ghostty-web")

let sharedGhostty: Promise<{ mod: GhosttyModule; ghostty: Ghostty }> | undefined

function loadGhostty() {
  if (sharedGhostty) return sharedGhostty
  sharedGhostty = import("ghostty-web")
    .then(async (mod) => ({ mod, ghostty: await mod.Ghostty.load() }))
    .catch((error) => {
      sharedGhostty = undefined
      throw error
    })
  return sharedGhostty
}

export interface TuiHostPanelProps {
  active: Accessor<boolean>
}

export function TuiHostPanel(props: TuiHostPanelProps) {
  let container!: HTMLDivElement
  let term: GhosttyTerminal | undefined
  let fitAddon: FitAddon | undefined
  let pollTimer: ReturnType<typeof setInterval> | undefined
  let resizeFrame: number | undefined
  let resizeObserver: ResizeObserver | undefined
  let disposed = false
  let hostStarted = false
  let renderedBuffer = ""
  let lastSize: { cols: number; rows: number } | undefined

  const [snapshot, setSnapshot] = createSignal<TuiHostSnapshot | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")

  const hostState = () => {
    if (error()) return "error"
    if (loading() && !snapshot()) return "loading"
    return snapshot()?.running ? "running" : "stopped"
  }

  const hostLabel = () => {
    if (error()) return t("tui.host_error")
    if (loading() && !snapshot()) return t("common.loading")
    return snapshot()?.running ? t("tui.host_running") : t("tui.host_stopped")
  }

  function writeBuffer(buffer: string) {
    const current = term
    if (!current) return
    if (buffer === renderedBuffer) return
    if (buffer.startsWith(renderedBuffer)) {
      current.write(buffer.slice(renderedBuffer.length))
      renderedBuffer = buffer
      return
    }
    current.reset()
    current.write(buffer)
    renderedBuffer = buffer
  }

  async function refreshSnapshot() {
    if (!props.active()) return
    const next = await loadTuiHostSnapshot()
    if (disposed) return
    setSnapshot(next)
    writeBuffer(next.buffer)
  }

  async function ensureHostStarted() {
    if (hostStarted) return
    const current = await loadTuiHostStatus()
    if (disposed) return
    hostStarted = current.running
    if (hostStarted) return
    const cols = term?.cols && term.cols > 0 ? term.cols : DEFAULT_COLS
    const rows = term?.rows && term.rows > 0 ? term.rows : DEFAULT_ROWS
    await startTuiHost({ cols, rows })
    hostStarted = true
  }

  async function start() {
    if (!props.active()) return
    setLoading(true)
    setError("")
    try {
      await ensureHostStarted()
      await refreshSnapshot()
      if (pollTimer === undefined) {
        pollTimer = setInterval(() => {
          void refreshSnapshot().catch((err) => {
            if (!disposed) setError(err instanceof Error ? err.message : String(err))
          })
        }, HOST_POLL_INTERVAL_MS)
      }
    } catch (err) {
      if (!disposed) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!disposed) setLoading(false)
    }
  }

  function stopPolling() {
    if (pollTimer === undefined) return
    clearInterval(pollTimer)
    pollTimer = undefined
  }

  function scheduleFit() {
    if (disposed || !fitAddon) return
    if (resizeFrame !== undefined) return
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = undefined
      if (disposed || !fitAddon) return
      fitAddon.fit()
    })
  }

  function pushSize(cols: number, rows: number) {
    if (lastSize?.cols === cols && lastSize.rows === rows) return
    lastSize = { cols, rows }
    if (!hostStarted) return
    void resizeTuiHost({ cols, rows }).catch((err) => {
      if (!disposed) setError(err instanceof Error ? err.message : String(err))
    })
  }

  async function restartHost() {
    setLoading(true)
    setError("")
    try {
      await stopTuiHost()
      hostStarted = false
      renderedBuffer = ""
      term?.reset()
      await start()
    } catch (err) {
      if (!disposed) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!disposed) setLoading(false)
    }
  }

  createEffect(() => {
    if (props.active()) {
      void start()
    } else {
      stopPolling()
    }
  })

  createEffect(() => {
    if (!props.active()) return
    scheduleFit()
  })

  loadGhostty()
    .then(({ mod, ghostty }) => {
      if (disposed) return
      const next = new mod.Terminal({
        cursorBlink: true,
        cursorStyle: "bar",
        cols: DEFAULT_COLS,
        rows: DEFAULT_ROWS,
        fontSize: 13,
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        allowTransparency: false,
        convertEol: false,
        scrollback: 10_000,
        theme: {
          background: "#0b0b0b",
          foreground: "#d4d4d4",
          cursor: "#d4d4d4",
          selectionBackground: "rgba(212, 212, 212, 0.25)",
        },
        ghostty,
      })
      term = next
      const fit = new mod.FitAddon()
      fitAddon = fit
      next.loadAddon(fit)
      next.open(container)
      resizeObserver = new ResizeObserver(() => scheduleFit())
      resizeObserver.observe(container)
      next.onData((data) => {
        if (!hostStarted) return
        void sendTuiHostInput(data).catch((err) => {
          if (!disposed) setError(err instanceof Error ? err.message : String(err))
        })
      })
      next.onResize((size) => pushSize(size.cols, size.rows))
      next.focus()
      scheduleFit()
      if (props.active()) void start()
    })
    .catch((err) => {
      if (!disposed) setError(err instanceof Error ? err.message : String(err))
    })

  onCleanup(() => {
    disposed = true
    stopPolling()
    if (resizeFrame !== undefined) cancelAnimationFrame(resizeFrame)
    resizeObserver?.disconnect()
    fitAddon?.dispose()
    term?.dispose()
  })

  return (
    <section class="tui-host-panel" aria-label={t("tui.title")}>
      <header class="tui-host-toolbar">
        <div class="tui-host-title">
          <Icon name="terminal" size={14} />
          <span>{t("tui.title")}</span>
        </div>
        <div class="tui-host-actions">
          <span class="tui-host-state" data-state={hostState()}>
            {hostLabel()}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-chrome="icon-action"
            data-ui="tui-host-refresh"
            title={t("common.refresh")}
            aria-label={t("common.refresh")}
            disabled={loading()}
            onClick={() => void refreshSnapshot()}
          >
            <Icon name="refresh" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-chrome="icon-action"
            data-ui="tui-host-restart"
            title={t("tui.host_restart")}
            aria-label={t("tui.host_restart")}
            disabled={loading()}
            onClick={() => void restartHost()}
          >
            <Icon name="terminal" />
          </Button>
        </div>
      </header>

      <div ref={container} class="tui-host-terminal" data-state={hostState()} data-testid="tui-host-terminal" />

      {error() ? (
        <div class="tui-host-error" role="status">
          <Icon name="status-failed" size={14} />
          <span>{error()}</span>
        </div>
      ) : null}
    </section>
  )
}
