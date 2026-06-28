/**
 * RequirementsPanel — structured requirements list from Requirements Agent output.
 *
 * Three states:
 * 1. Generating — shows streaming agent messages (spec/goal stage messages)
 * 2. Complete — shows structured requirements list with type/priority badges
 * 3. Pending — shows "pending" hint when no data and not generating
 */
import { For, Show } from "solid-js"
import { t } from "../utils/i18n"

interface Requirement {
  id: string
  description: string
  type: "explicit" | "inferred" | "system"
  priority: "blocking" | "advisory"
  status?: string
}

interface RequirementsPanelProps {
  requirements: Requirement[] | undefined
  /** Spec content shown as a collapsible detail below the requirements list. */
  specContent?: string
  /** Whether the requirements step is currently running */
  isGenerating?: boolean
}

function typeBadgeClass(type: string): string {
  switch (type) {
    case "explicit":
      return "req-type--explicit"
    case "inferred":
      return "req-type--inferred"
    case "system":
      return "req-type--system"
    default:
      return ""
  }
}

export function RequirementsPanel(props: RequirementsPanelProps) {
  const hasData = () => props.requirements && props.requirements.length > 0

  return (
    <div class="req-panel">
      {/* State 1: Generating — show streaming messages */}
      <Show when={props.isGenerating && !hasData()}>
        <div class="req-streaming">
          <div class="req-streaming-indicator" role="status" aria-live="polite" aria-busy="true">
            <span class="card__spinner" />
            <span class="req-streaming-label">{t("workflow.requirements_generating")}</span>
          </div>
        </div>
      </Show>

      {/* State 2: Complete — show structured list */}
      <Show when={hasData()}>
        <div class="req-list">
          <For each={props.requirements}>
            {(req, index) => (
              <div class="req-item">
                <div class="req-item-main">
                  <span class="req-index" title={req.id}>
                    REQ {String(index() + 1).padStart(2, "0")}
                  </span>
                  <span class="req-desc">{req.description}</span>
                </div>
                <div class="req-item-meta">
                  <span class={`req-type ${typeBadgeClass(req.type)}`}>{req.type}</span>
                  <span class="req-status" data-req-status={req.status || "pending"}>
                    {req.status || "pending"}
                  </span>
                  <Show when={req.priority === "advisory"}>
                    <span class="req-priority">advisory</span>
                  </Show>
                </div>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* State 3: Pending — no data and not generating */}
      <Show when={!hasData() && !props.isGenerating}>
        <p class="empty-hint empty-hint--card">{t("workflow.requirements_pending")}</p>
      </Show>

      {/* Spec content — always available as collapsible detail when present */}
      <Show when={props.specContent}>
        <details class="req-spec-detail">
          <summary>{t("workflow.spec_detail")}</summary>
          <pre class="req-spec-content">{props.specContent}</pre>
        </details>
      </Show>
    </div>
  )
}
