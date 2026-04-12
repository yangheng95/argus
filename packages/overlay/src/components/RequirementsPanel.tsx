/**
 * RequirementsPanel — structured requirements list from Requirements Agent output.
 *
 * Three states:
 * 1. Generating — shows streaming agent messages (spec/goal stage messages)
 * 2. Complete — shows structured requirements list with type/priority badges
 * 3. Pending — shows "pending" hint when no data and not generating
 */
import { For, Show } from "solid-js";
import { MessageView } from "./MessageView";
import { t } from "../utils/i18n";

interface Requirement {
  id: string;
  description: string;
  type: "explicit" | "inferred" | "system";
  priority: "blocking" | "advisory";
}

interface RequirementsPanelProps {
  requirements: Requirement[] | undefined;
  /** Spec content (legacy, shown as collapsible detail) */
  specContent?: string;
  /** Whether the requirements step is currently running */
  isGenerating?: boolean;
  /** Streaming agent messages from the requirements stage */
  streamingMessages?: any[];
}

function typeBadgeClass(type: string): string {
  switch (type) {
    case "explicit": return "req-type--explicit";
    case "inferred": return "req-type--inferred";
    case "system": return "req-type--system";
    default: return "";
  }
}

export function RequirementsPanel(props: RequirementsPanelProps) {
  const hasData = () => props.requirements && props.requirements.length > 0;
  const hasStream = () => props.streamingMessages && props.streamingMessages.length > 0;

  return (
    <div class="req-panel">
      {/* State 1: Generating — show streaming messages */}
      <Show when={props.isGenerating && hasStream() && !hasData()}>
        <div class="req-streaming">
          <div class="req-streaming-indicator">
            <span class="agent-card-spinner" />
            <span class="req-streaming-label">{t("workflow.requirements_generating")}</span>
          </div>
          <div class="req-streaming-messages">
            <For each={props.streamingMessages}>
              {(msg) => <MessageView message={msg} />}
            </For>
          </div>
        </div>
      </Show>

      {/* State 2: Complete — show structured list */}
      <Show when={hasData()}>
        <div class="req-list">
          <For each={props.requirements}>
            {(req) => (
              <div class="req-item">
                <span class="req-id">{req.id}</span>
                <span class={`req-type ${typeBadgeClass(req.type)}`}>{req.type}</span>
                <span class="req-desc">{req.description}</span>
                <Show when={req.priority === "advisory"}>
                  <span class="req-priority">advisory</span>
                </Show>
              </div>
            )}
          </For>
        </div>
      </Show>

      {/* State 3: Pending — no data and not generating */}
      <Show when={!hasData() && !props.isGenerating}>
        <p class="req-empty">{t("workflow.requirements_pending")}</p>
      </Show>

      {/* Spec content — always available as collapsible detail when present */}
      <Show when={props.specContent}>
        <details class="req-spec-detail">
          <summary>{t("workflow.spec_detail")}</summary>
          <pre class="req-spec-content">{props.specContent}</pre>
        </details>
      </Show>
    </div>
  );
}
