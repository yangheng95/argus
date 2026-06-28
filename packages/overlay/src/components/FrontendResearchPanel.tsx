import { Show } from "solid-js"
import { t } from "../utils/i18n"

interface FrontendResearchPanelProps {
  status?: string
}

export function FrontendResearchPanel(props: FrontendResearchPanelProps) {
  const status = () => String(props.status || "pending")
  const isGenerating = () => status() === "running"
  const isFailed = () => status() === "failed"

  return (
    <div class="frontend-research-panel" data-status={status()}>
      <Show when={isGenerating()}>
        <div class="req-streaming">
          <div class="req-streaming-indicator" role="status" aria-live="polite" aria-busy="true">
            <span class="card__spinner" />
            <span class="req-streaming-label">{t("workflow.frontend_research_generating")}</span>
          </div>
        </div>
      </Show>

      <Show when={isFailed()}>
        <p class="empty-hint empty-hint--card">{t("workflow.frontend_research_failed")}</p>
      </Show>

      <Show when={!isGenerating() && !isFailed()}>
        <p class="empty-hint empty-hint--card">{t("workflow.frontend_research_pending")}</p>
      </Show>
    </div>
  )
}
