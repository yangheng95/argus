import { createEffect, createSignal, For, onCleanup, Show, type Accessor } from "solid-js"
import {
  formatTuiEmbedError,
  loadTuiEmbedStatus,
  resizeTuiEmbed,
  sendTuiEmbedInput,
  startTuiEmbed,
  stopTuiEmbed,
  type CodingAgentTuiPanelInfo,
  type EmbeddedTuiFrame,
  type EmbeddedTuiLine,
  type EmbeddedTuiSpan,
} from "./embedded-target"
import { hasTuiHostTerminalSizeChanged } from "./terminal-size"
import { resolvedTheme } from "../../services/theme"
import { t } from "../../utils/i18n"
import { Icon } from "../../components/Icon"
import { Button } from "../../components/ui/Button"

const DEFAULT_COLS = 100
const MIN_READABLE_COLS = 80
const DEFAULT_ROWS = 30
const ATTR_BOLD = 1 << 0
const ATTR_DIM = 1 << 1
const ATTR_ITALIC = 1 << 2
const ATTR_UNDERLINE = 1 << 3
const TUI_DEFAULT_BACKGROUND = "var(--tui-default-background)"
type TuiThemeMode = "dark" | "light"
type TuiInputPayload = Omit<Parameters<typeof sendTuiEmbedInput>[0], "directory">

export interface CodingAgentTuiPanelProps {
  active: Accessor<boolean>
  directory: Accessor<string>
}

function isDefaultTuiBackground(color: string) {
  const text = color.trim().toLowerCase()
  if (text === "transparent") return true
  const match = text.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([0-9.]+))?\)$/)
  if (!match) return false
  const [, red, green, blue, alpha] = match
  if (alpha !== undefined && Number(alpha) <= 0) return true
  return Number(red) <= 12 && Number(green) <= 12 && Number(blue) <= 12
}

function tuiBackground(color: string) {
  return isDefaultTuiBackground(color) ? TUI_DEFAULT_BACKGROUND : color
}

function lineHasContent(line: EmbeddedTuiLine) {
  return line.spans.some((span) => span.text.trim())
}

function spanBackground(span: EmbeddedTuiSpan, line: EmbeddedTuiLine) {
  return lineHasContent(line) ? span.bg : tuiBackground(span.bg)
}

function spanStyle(span: EmbeddedTuiSpan, line: EmbeddedTuiLine) {
  const styles = [
    `color: ${span.fg}`,
    `background-color: ${spanBackground(span, line)}`,
    `width: calc(${span.width} * var(--tui-cell-width))`,
  ]
  if (span.attributes & ATTR_BOLD) styles.push("font-weight: 700")
  if (span.attributes & ATTR_DIM) styles.push("opacity: 0.72")
  if (span.attributes & ATTR_ITALIC) styles.push("font-style: italic")
  if (span.attributes & ATTR_UNDERLINE) styles.push("text-decoration: underline")
  return styles.join("; ")
}

function lineBackground(line: EmbeddedTuiLine) {
  const bg = line.spans.find((span) => span.bg)?.bg
  if (!bg) return undefined
  return lineHasContent(line) ? bg : tuiBackground(bg)
}

function lineStyle(line: EmbeddedTuiLine) {
  const bg = lineBackground(line)
  return bg ? `background-color: ${bg}` : ""
}

function frameStyle(frame: EmbeddedTuiFrame) {
  return `--tui-cols: ${frame.cols}; --tui-rows: ${frame.rows}; background-color: ${TUI_DEFAULT_BACKGROUND}`
}

function tuiThemeMode(): TuiThemeMode {
  return resolvedTheme() === "light" ? "light" : "dark"
}

function keyPayload(event: KeyboardEvent): TuiInputPayload | undefined {
  if (event.metaKey || event.altKey) return
  if (event.ctrlKey && event.key.toLowerCase() !== "c") return
  if (event.key.length === 1 && !event.ctrlKey) return { text: event.key }
  if (event.ctrlKey && event.key.toLowerCase() === "c") return { text: "\u0003", ctrl: true }
  switch (event.key) {
    case "Enter":
      return { key: "enter", ctrl: event.ctrlKey }
    case "Escape":
      return { key: "escape", ctrl: event.ctrlKey }
    case "Tab":
      return { key: "tab", ctrl: event.ctrlKey }
    case "Backspace":
      return { key: "backspace", ctrl: event.ctrlKey }
    case "Delete":
      return { key: "delete", ctrl: event.ctrlKey }
    case "ArrowUp":
      return { key: "arrow-up", ctrl: event.ctrlKey }
    case "ArrowDown":
      return { key: "arrow-down", ctrl: event.ctrlKey }
    case "ArrowLeft":
      return { key: "arrow-left", ctrl: event.ctrlKey }
    case "ArrowRight":
      return { key: "arrow-right", ctrl: event.ctrlKey }
  }
  return
}

export function CodingAgentTuiPanel(props: CodingAgentTuiPanelProps) {
  let viewport!: HTMLDivElement
  let measure!: HTMLSpanElement
  let resizeObserver: ResizeObserver | undefined
  let refreshTimer: ReturnType<typeof setInterval> | undefined
  let disposed = false
  let started = false
  let startTask: Promise<CodingAgentTuiPanelInfo | undefined> | undefined
  let lastSize: { cols: number; rows: number } | undefined

  const [info, setInfo] = createSignal<CodingAgentTuiPanelInfo | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")

  const activeDirectory = () => props.directory().trim()

  function requireActiveDirectory() {
    const directory = activeDirectory()
    if (!directory) throw new Error("Coding agent TUI requires an active workspace directory.")
    return directory
  }

  function hostDirectory() {
    return info()?.directory?.trim() || requireActiveDirectory()
  }

  const hostState = () => {
    if (error()) return "error"
    if (loading() && !info()) return "loading"
    return info()?.running ? "running" : "stopped"
  }

  const hostLabel = () => {
    if (error()) return t("tui.host_error")
    if (loading() && !info()) return t("common.loading")
    return info()?.running ? t("tui.host_running") : t("tui.host_stopped")
  }

  function measuredSize() {
    const width = viewport?.clientWidth || 0
    const height = viewport?.clientHeight || 0
    const rect = measure?.getBoundingClientRect()
    const charWidth = rect?.width && rect.width > 0 ? rect.width : 8
    const lineHeight = rect?.height && rect.height > 0 ? rect.height : 16
    return {
      cols: Math.max(MIN_READABLE_COLS, Math.floor(width / charWidth) || DEFAULT_COLS),
      rows: Math.max(5, Math.floor(height / lineHeight) || DEFAULT_ROWS),
    }
  }

  async function refreshStatus() {
    const directory = requireActiveDirectory()
    const next = await loadTuiEmbedStatus({ directory })
    if (disposed) return
    setInfo(next)
    started = next.running
  }

  async function ensureStarted() {
    if (started) return info()
    if (startTask) return startTask
    const directory = requireActiveDirectory()
    startTask = (async () => {
      const mode = tuiThemeMode()
      const current = await loadTuiEmbedStatus({ directory })
      if (disposed) return
      if (current.running && current.mode === mode) {
        setInfo(current)
        started = true
        lastSize = current.cols && current.rows ? { cols: current.cols, rows: current.rows } : undefined
        return current
      }
      const size = measuredSize()
      const next = await startTuiEmbed({ ...size, mode, directory })
      if (disposed) return
      setInfo(next)
      started = true
      lastSize = size
      return next
    })()
    try {
      return await startTask
    } finally {
      startTask = undefined
    }
  }

  async function start() {
    if (!props.active()) return
    setLoading(true)
    setError("")
    try {
      await ensureStarted()
      viewport?.focus()
    } catch (err) {
      if (!disposed) setError(formatTuiEmbedError(err))
    } finally {
      if (!disposed) setLoading(false)
    }
  }

  function schedulePolling() {
    if (refreshTimer !== undefined) return
    refreshTimer = setInterval(() => {
      if (!props.active() || !started) return
      void refreshStatus().catch((err) => {
        if (!disposed) setError(formatTuiEmbedError(err))
      })
    }, 250)
  }

  function stopPolling() {
    if (refreshTimer === undefined) return
    clearInterval(refreshTimer)
    refreshTimer = undefined
  }

  function pushSize() {
    if (!started || !props.active()) return
    const nextSize = measuredSize()
    if (!hasTuiHostTerminalSizeChanged(lastSize, nextSize)) return
    lastSize = nextSize
    void resizeTuiEmbed({ ...nextSize, directory: hostDirectory() })
      .then((next) => {
        if (!disposed) setInfo(next)
      })
      .catch((err) => {
        if (!disposed) setError(formatTuiEmbedError(err))
      })
  }

  function sendInput(payload: TuiInputPayload) {
    if (!started) return
    void sendTuiEmbedInput({ ...payload, directory: hostDirectory() })
      .then((next) => {
        if (!disposed) setInfo(next)
      })
      .catch((err) => {
        if (!disposed) setError(formatTuiEmbedError(err))
      })
  }

  async function restartHost() {
    setLoading(true)
    setError("")
    try {
      await stopTuiEmbed({ directory: hostDirectory() })
      started = false
      lastSize = undefined
      setInfo(null)
      await start()
    } catch (err) {
      if (!disposed) setError(formatTuiEmbedError(err))
    } finally {
      if (!disposed) setLoading(false)
    }
  }

  createEffect(() => {
    if (!props.active()) {
      stopPolling()
      return
    }
    activeDirectory()
    tuiThemeMode()
    schedulePolling()
    started = false
    startTask = undefined
    lastSize = undefined
    setInfo(null)
    void start()
  })

  queueMicrotask(() => {
    if (disposed) return
    resizeObserver = new ResizeObserver(() => pushSize())
    resizeObserver.observe(viewport)
  })

  onCleanup(() => {
    disposed = true
    stopPolling()
    resizeObserver?.disconnect()
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
            onClick={() => void start()}
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

      <div
        ref={viewport}
        class="tui-host-terminal tui-host-frame"
        data-state={hostState()}
        data-testid="tui-host-terminal"
        tabIndex={0}
        onKeyDown={(event) => {
          const payload = keyPayload(event)
          if (!payload) return
          event.preventDefault()
          event.stopPropagation()
          sendInput(payload)
        }}
        onPaste={(event) => {
          const text = event.clipboardData?.getData("text/plain") ?? ""
          if (!text) return
          event.preventDefault()
          sendInput({ text })
        }}
        onPointerDown={() => viewport.focus()}
      >
        <span ref={measure} class="tui-host-measure">
          W
        </span>
        <Show when={info()?.frame}>
          {(frame) => (
            <div class="tui-host-frame-lines" style={frameStyle(frame())}>
              <For each={frame().lines}>
                {(line) => (
                  <div class="tui-host-frame-line" style={lineStyle(line)}>
                    <For each={line.spans}>{(span) => <span style={spanStyle(span, line)}>{span.text}</span>}</For>
                  </div>
                )}
              </For>
            </div>
          )}
        </Show>
      </div>

      {error() ? (
        <div class="tui-host-error" role="status">
          <Icon name="status-failed" size={14} />
          <span>{error()}</span>
        </div>
      ) : null}
    </section>
  )
}
