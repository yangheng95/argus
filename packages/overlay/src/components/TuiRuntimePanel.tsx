import { createEffect, createSignal, onCleanup, type Accessor } from "solid-js"
import { loadTuiRuntimeStatus, type TuiRuntimeStatus } from "../services/tui-runtime"
import { t } from "../utils/i18n"
import { Icon } from "./Icon"
import { Button } from "./ui/Button"

const TUI_RUNTIME_REFRESH_INTERVAL_MS = 5_000

export interface TuiRuntimePanelProps {
  active: Accessor<boolean>
}

export function TuiRuntimePanel(props: TuiRuntimePanelProps) {
  const [status, setStatus] = createSignal<TuiRuntimeStatus | null>(null)
  const [loading, setLoading] = createSignal(false)
  const [error, setError] = createSignal("")

  async function refresh(): Promise<void> {
    if (!props.active()) return
    setLoading(true)
    setError("")
    try {
      setStatus(await loadTuiRuntimeStatus())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }

  createEffect(() => {
    if (!props.active()) return
    void refresh()
    const timer = window.setInterval(() => void refresh(), TUI_RUNTIME_REFRESH_INTERVAL_MS)
    onCleanup(() => window.clearInterval(timer))
  })

  const runtimeState = () => {
    const current = status()
    if (error()) return "error"
    if (loading() && !current) return "loading"
    return current?.running ? "running" : "stopped"
  }

  const runtimeLabel = () => {
    if (error()) return t("tui.runtime_error")
    if (loading() && !status()) return t("common.loading")
    return status()?.running ? t("tui.runtime_running") : t("tui.runtime_stopped")
  }

  return (
    <section class="tui-runtime-panel" aria-label={t("tui.title")}>
      <header class="tui-runtime-header">
        <div class="tui-runtime-title">
          <Icon name="terminal" size={14} />
          <span>{t("tui.title")}</span>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tone="neutral"
          data-chrome="icon-action"
          data-ui="tui-runtime-refresh"
          title={t("common.refresh")}
          aria-label={t("common.refresh")}
          disabled={loading()}
          onClick={() => void refresh()}
        >
          <Icon name="refresh" />
        </Button>
      </header>

      <div class="tui-runtime-status" data-state={runtimeState()}>
        <span class="tui-runtime-status-dot" aria-hidden="true" />
        <span>{runtimeLabel()}</span>
      </div>

      <div class="tui-runtime-detail">
        <div class="tui-runtime-row">
          <span>{t("tui.runtime_mode")}</span>
          <code>{status()?.mode ?? "none"}</code>
        </div>
        <div class="tui-runtime-row">
          <span>{t("tui.runtime_url")}</span>
          <code>{status()?.url ?? "-"}</code>
        </div>
        <div class="tui-runtime-row">
          <span>{t("tui.runtime_session")}</span>
          <code>{status()?.sessionID ?? "-"}</code>
        </div>
      </div>

      <div class="tui-runtime-note" data-state={error() ? "error" : "info"}>
        <Icon name={error() ? "status-failed" : "info-circle"} size={14} />
        <span>{error() || t("tui.embedded_host_pending")}</span>
      </div>
    </section>
  )
}
