import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { FitAddon, Ghostty, Terminal as GhosttyTerminal } from "ghostty-web"
import {
  buildTuiHostConnectUrl,
  createTuiHostConnectToken,
  loadTuiHostStatus,
  resizeTuiHost,
  startTuiHost,
  stopTuiHost,
  type TuiHostInfo,
} from "../services/tui-host"
import { hasTuiHostTerminalSizeChanged } from "../services/tui-host-terminal"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"

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
  let socket: WebSocket | undefined
  let resizeFrame: number | undefined
  let resizeObserver: ResizeObserver | undefined
  let disposed = false
  let hostStarted = false
  let hostCursor = 0
  let lastSize: { cols: number; rows: number } | undefined

  const [hostInfo, setHostInfo] = createSignal<TuiHostInfo | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")

  const hostState = () => {
    if (error()) return "error"
    if (loading() && !hostInfo()) return "loading"
    return hostInfo()?.running ? "running" : "stopped"
  }

  const hostLabel = () => {
    if (error()) return t("tui.host_error")
    if (loading() && !hostInfo()) return t("common.loading")
    return hostInfo()?.running ? t("tui.host_running") : t("tui.host_stopped")
  }

  function writeSocketOutput(data: string) {
    const current = term
    if (!current) return
    current.write(data)
    hostCursor += data.length
  }

  function closeSocket() {
    const current = socket
    socket = undefined
    current?.close(1000)
  }

  async function ensureHostStarted() {
    if (hostStarted) return hostInfo()
    const current = await loadTuiHostStatus()
    if (disposed) return
    setHostInfo(current)
    hostStarted = current.running
    if (hostStarted) return current
    const cols = term?.cols && term.cols > 0 ? term.cols : DEFAULT_COLS
    const rows = term?.rows && term.rows > 0 ? term.rows : DEFAULT_ROWS
    const started = await startTuiHost({ cols, rows })
    setHostInfo(started)
    hostStarted = true
    return started
  }

  async function connectHostSocket() {
    if (!props.active() || socket) return
    const token = await createTuiHostConnectToken()
    if (disposed || !props.active()) return
    const nextSocket = new WebSocket(buildTuiHostConnectUrl({ ticket: token.ticket, cursor: hostCursor }))
    socket = nextSocket
    nextSocket.binaryType = "arraybuffer"
    nextSocket.onopen = () => {
      if (!disposed) setError("")
    }
    nextSocket.onmessage = (event) => {
      if (disposed) return
      if (typeof event.data === "string") {
        writeSocketOutput(event.data)
        return
      }
      if (event.data instanceof ArrayBuffer) {
        writeSocketOutput(new TextDecoder().decode(event.data))
      }
    }
    nextSocket.onerror = () => {
      if (!disposed) setError("TUI host WebSocket failed")
    }
    nextSocket.onclose = () => {
      if (socket === nextSocket) socket = undefined
    }
  }

  async function start() {
    if (!props.active()) return
    setLoading(true)
    setError("")
    try {
      await ensureHostStarted()
      await connectHostSocket()
    } catch (err) {
      if (!disposed) setError(err instanceof Error ? err.message : String(err))
    } finally {
      if (!disposed) setLoading(false)
    }
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
    const nextSize = { cols, rows }
    if (!hasTuiHostTerminalSizeChanged(lastSize, nextSize)) return
    lastSize = nextSize
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
      closeSocket()
      hostStarted = false
      hostCursor = 0
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
      closeSocket()
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
        if (!hostStarted || socket?.readyState !== WebSocket.OPEN) return
        socket.send(data)
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
    closeSocket()
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
            onClick={() => void connectHostSocket()}
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
