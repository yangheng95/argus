import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import type { FitAddon, Ghostty, Terminal as GhosttyTerminal } from "ghostty-web"
import {
  buildTuiHostConnectUrl,
  formatTuiHostError,
  loadTuiHostStatus,
  resizeTuiHost,
  startTuiHost,
  stopTuiHost,
  type TuiHostPanelInfo,
} from "../services/tui-host"
import { hasTuiHostTerminalSizeChanged } from "../services/tui-host-terminal"
import { SerializeAddon } from "../addons/serialize"
import { terminalWriter } from "../utils/terminal-writer"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"

const DEFAULT_COLS = 100
const DEFAULT_ROWS = 30

type GhosttyModule = typeof import("ghostty-web")
type TerminalSnapshot = {
  buffer?: unknown
  cursor?: unknown
  rows?: unknown
  cols?: unknown
  scrollY?: unknown
}
type TerminalTheme = {
  background: string
  foreground: string
  cursor: string
  selectionBackground: string
}

let sharedGhostty: Promise<{ mod: GhosttyModule; ghostty: Ghostty }> | undefined
const SNAPSHOT_VERSION = "v1"

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

function resolveCssColor(host: HTMLElement, token: string, property: "backgroundColor" | "color"): string {
  const raw = getComputedStyle(host).getPropertyValue(token).trim()
  if (!raw) throw new Error(`Missing overlay theme token ${token}`)
  const probe = document.createElement("span")
  probe.style.position = "absolute"
  probe.style.pointerEvents = "none"
  probe.style.opacity = "0"
  if (property === "backgroundColor") probe.style.backgroundColor = raw
  else probe.style.color = raw
  host.append(probe)
  const resolved = getComputedStyle(probe)[property].trim()
  probe.remove()
  if (!resolved || resolved === "rgba(0, 0, 0, 0)") throw new Error(`Invalid overlay theme token ${token}: ${raw}`)
  return resolved
}

function overlayTerminalTheme(host: HTMLElement): TerminalTheme {
  return {
    background: resolveCssColor(host, "--surface-inset", "backgroundColor"),
    foreground: resolveCssColor(host, "--text-strong", "color"),
    cursor: resolveCssColor(host, "--accent", "color"),
    selectionBackground: resolveCssColor(host, "--accent-dim", "backgroundColor"),
  }
}

function useTerminalUiBindings(input: {
  container: HTMLDivElement
  term: GhosttyTerminal
  cleanups: VoidFunction[]
  focusTerminal: () => void
}) {
  const handleCopy = (event: ClipboardEvent) => {
    const selection = input.term.getSelection()
    if (!selection) return

    const clipboard = event.clipboardData
    if (!clipboard) return

    event.preventDefault()
    clipboard.setData("text/plain", selection)
  }

  const handlePaste = (event: ClipboardEvent) => {
    const clipboard = event.clipboardData
    const text = clipboard?.getData("text/plain") ?? clipboard?.getData("text") ?? ""
    if (!text) return

    event.preventDefault()
    event.stopPropagation()
    input.term.paste(text)
  }

  const handlePointerDown = () => {
    const activeElement = document.activeElement
    if (activeElement instanceof HTMLElement && activeElement !== input.container && !input.container.contains(activeElement)) {
      activeElement.blur()
    }
    input.focusTerminal()
  }

  const handleTextareaFocus = () => {
    input.term.options.cursorBlink = true
  }

  const handleTextareaBlur = () => {
    input.term.options.cursorBlink = false
  }

  input.container.addEventListener("copy", handleCopy, true)
  input.cleanups.push(() => input.container.removeEventListener("copy", handleCopy, true))

  input.container.addEventListener("paste", handlePaste, true)
  input.cleanups.push(() => input.container.removeEventListener("paste", handlePaste, true))

  input.container.addEventListener("pointerdown", handlePointerDown)
  input.cleanups.push(() => input.container.removeEventListener("pointerdown", handlePointerDown))

  input.term.textarea?.addEventListener("focus", handleTextareaFocus)
  input.term.textarea?.addEventListener("blur", handleTextareaBlur)
  input.cleanups.push(() => input.term.textarea?.removeEventListener("focus", handleTextareaFocus))
  input.cleanups.push(() => input.term.textarea?.removeEventListener("blur", handleTextareaBlur))
}

export interface TuiHostPanelProps {
  active: Accessor<boolean>
}

export function TuiHostPanel(props: TuiHostPanelProps) {
  let container!: HTMLDivElement
  let term: GhosttyTerminal | undefined
  let fitAddon: FitAddon | undefined
  let serializeAddon: SerializeAddon | undefined
  let output: ReturnType<typeof terminalWriter> | undefined
  let socket: WebSocket | undefined
  let resizeFrame: number | undefined
  let snapshotSaveFrame: number | undefined
  let resizeObserver: ResizeObserver | undefined
  let themeObserver: MutationObserver | undefined
  let disposed = false
  let hostStarted = false
  let hostCursor = 0
  let lastSize: { cols: number; rows: number } | undefined
  const cleanups: VoidFunction[] = []

  const [hostInfo, setHostInfo] = createSignal<TuiHostPanelInfo | null>(null)
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

  function snapshotKey(info: TuiHostPanelInfo | null | undefined) {
    if (!info?.id || !info.directory) return
    return `opencorvus:tui-host:${SNAPSHOT_VERSION}:${info.directory}:${info.id}`
  }

  function saveTerminalSnapshot(info = hostInfo()) {
    const key = snapshotKey(info)
    const addon = serializeAddon
    const current = term
    if (!key || !addon || !current) return
    try {
      const buffer = addon.serialize({ scrollback: 10_000 })
      localStorage.setItem(
        key,
        JSON.stringify({
          buffer,
          cursor: hostCursor,
          rows: current.rows,
          cols: current.cols,
          scrollY: current.getViewportY(),
        }),
      )
    } catch (err) {
      console.warn("[tui-host] failed to save terminal snapshot", err)
    }
  }

  function removeTerminalSnapshot(info = hostInfo()) {
    const key = snapshotKey(info)
    if (!key) return
    localStorage.removeItem(key)
  }

  function scheduleTerminalSnapshotSave() {
    if (disposed) return
    if (snapshotSaveFrame !== undefined) return
    snapshotSaveFrame = requestAnimationFrame(() => {
      snapshotSaveFrame = undefined
      if (!disposed) saveTerminalSnapshot()
    })
  }

  function restoreTerminalSnapshot(info: TuiHostPanelInfo | null | undefined) {
    const key = snapshotKey(info)
    const current = term
    if (!key || !current) return
    const raw = localStorage.getItem(key)
    if (!raw) return
    try {
      const parsed = JSON.parse(raw) as TerminalSnapshot
      if (
        typeof parsed.cols === "number" &&
        Number.isSafeInteger(parsed.cols) &&
        parsed.cols > 0 &&
        typeof parsed.rows === "number" &&
        Number.isSafeInteger(parsed.rows) &&
        parsed.rows > 0
      ) {
        current.resize(parsed.cols, parsed.rows)
      }
      if (typeof parsed.buffer === "string" && parsed.buffer) {
        current.write(parsed.buffer, () => {
          if (typeof parsed.scrollY === "number" && Number.isFinite(parsed.scrollY) && parsed.scrollY >= 0) {
            current.scrollToLine(parsed.scrollY)
          }
        })
      } else if (typeof parsed.scrollY === "number" && Number.isFinite(parsed.scrollY) && parsed.scrollY >= 0) {
        current.scrollToLine(parsed.scrollY)
      }
      if (typeof parsed.cursor === "number" && Number.isSafeInteger(parsed.cursor)) hostCursor = parsed.cursor
    } catch (err) {
      console.warn("[tui-host] failed to restore terminal snapshot", err)
    }
  }

  function writeSocketOutput(data: string) {
    hostCursor += data.length
    output?.push(data)
    scheduleTerminalSnapshotSave()
  }

  function flushTerminalOutput(done?: VoidFunction) {
    const writer = output
    if (!writer) {
      done?.()
      return
    }
    writer.flush(done)
  }

  function closeSocket() {
    const current = socket
    socket = undefined
    current?.close(1000)
  }

  function focusTerminal() {
    const current = term
    if (!current) return
    current.focus()
    current.textarea?.focus()
    setTimeout(() => current.textarea?.focus(), 0)
  }

  function sendTerminalInput(data: string) {
    if (!hostStarted) {
      setError("TUI host is not running. Press refresh to reconnect.")
      return
    }
    if (socket?.readyState !== WebSocket.OPEN) {
      setError("TUI host is not connected. Press refresh to reconnect.")
      return
    }
    socket.send(data)
  }

  function socketFailureMessage(id: string): string {
    return `TUI host WebSocket failed for ${id}`
  }

  function socketCloseMessage(id: string, event: CloseEvent): string {
    const reason = event.reason.trim()
    return `TUI host WebSocket closed abnormally for ${id}: ${event.code}${reason ? ` ${reason}` : ""}`
  }

  function applyTerminalTheme() {
    const current = term
    if (!current) return
    current.options.theme = overlayTerminalTheme(container)
  }

  async function ensureHostStarted() {
    if (hostStarted) return hostInfo()
    const current = await loadTuiHostStatus()
    if (disposed) return
    setHostInfo(current)
    hostStarted = current.running
    if (hostStarted) {
      restoreTerminalSnapshot(current)
      return current
    }
    const cols = term?.cols && term.cols > 0 ? term.cols : DEFAULT_COLS
    const rows = term?.rows && term.rows > 0 ? term.rows : DEFAULT_ROWS
    const started = await startTuiHost({ cols, rows })
    setHostInfo(started)
    hostStarted = true
    restoreTerminalSnapshot(started)
    return started
  }

  async function connectHostSocket() {
    if (!props.active() || socket) return
    const id = hostInfo()?.id
    if (!id) return
    if (disposed || !props.active()) return
    const nextSocket = new WebSocket(buildTuiHostConnectUrl({ id, cursor: hostCursor }))
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
        const bytes = new Uint8Array(event.data)
        if (bytes[0] === 0) {
          const meta = JSON.parse(new TextDecoder().decode(bytes.slice(1))) as { cursor?: unknown }
          if (typeof meta.cursor === "number" && Number.isSafeInteger(meta.cursor)) hostCursor = meta.cursor
          return
        }
        writeSocketOutput(new TextDecoder().decode(bytes))
      }
    }
    nextSocket.onerror = () => {
      if (!disposed) setError(socketFailureMessage(id))
    }
    nextSocket.onclose = (event) => {
      if (socket === nextSocket) socket = undefined
      if (disposed || event.code === 1000) return
      setError(socketCloseMessage(id, event))
    }
  }

  async function reconnectHostSocket() {
    if (!props.active()) return
    setLoading(true)
    setError("")
    try {
      closeSocket()
      await ensureHostStarted()
      await connectHostSocket()
      focusTerminal()
    } catch (err) {
      if (!disposed) setError(formatTuiHostError(err))
    } finally {
      if (!disposed) setLoading(false)
    }
  }

  async function start() {
    if (!props.active()) return
    if (!term) return
    setLoading(true)
    setError("")
    try {
      await ensureHostStarted()
      await connectHostSocket()
    } catch (err) {
      if (!disposed) setError(formatTuiHostError(err))
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
    const id = hostInfo()?.id
    if (!id) return
    void resizeTuiHost({ id, cols, rows }).catch((err) => {
      if (!disposed) setError(formatTuiHostError(err))
    })
  }

  async function restartHost() {
    setLoading(true)
    setError("")
    try {
      const id = hostInfo()?.id
      if (id) await stopTuiHost({ id })
      closeSocket()
      await new Promise<void>((resolve) => flushTerminalOutput(resolve))
      if (snapshotSaveFrame !== undefined) cancelAnimationFrame(snapshotSaveFrame)
      snapshotSaveFrame = undefined
      removeTerminalSnapshot()
      hostStarted = false
      hostCursor = 0
      term?.reset()
      await start()
    } catch (err) {
      if (!disposed) setError(formatTuiHostError(err))
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
        theme: overlayTerminalTheme(container),
        ghostty,
      })
      term = next
      const fit = new mod.FitAddon()
      fitAddon = fit
      const serialize = new SerializeAddon()
      serializeAddon = serialize
      next.loadAddon(fit)
      next.loadAddon(serialize)
      output = terminalWriter((data, done) => {
        next.write(data, () => {
          saveTerminalSnapshot()
          done?.()
        })
      })
      next.open(container)
      useTerminalUiBindings({ container, term: next, cleanups, focusTerminal })
      resizeObserver = new ResizeObserver(() => scheduleFit())
      resizeObserver.observe(container)
      themeObserver = new MutationObserver(() => applyTerminalTheme())
      themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] })
      themeObserver.observe(document.body, { attributes: true, attributeFilter: ["data-theme"] })
      next.onData((data) => {
        sendTerminalInput(data)
      })
      next.onResize((size) => pushSize(size.cols, size.rows))
      focusTerminal()
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
    if (snapshotSaveFrame !== undefined) cancelAnimationFrame(snapshotSaveFrame)
    resizeObserver?.disconnect()
    themeObserver?.disconnect()

    const finalize = () => {
      saveTerminalSnapshot()
      for (const fn of cleanups.splice(0).reverse()) fn()
      fitAddon?.dispose()
      serializeAddon?.dispose()
      term?.dispose()
    }

    flushTerminalOutput(finalize)
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
            onClick={() => void reconnectHostSocket()}
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
