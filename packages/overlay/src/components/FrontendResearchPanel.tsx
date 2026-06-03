import { Index, Show } from "solid-js";
import { CardParts } from "./CardParts";
import { orderedMessageParts } from "../utils/message";
import { t } from "../utils/i18n";

interface FrontendResearchPanelProps {
  status?: string;
  streamingMessages?: any[];
}

function hasStream(messages: any[] | undefined): boolean {
  return Array.isArray(messages) && messages.length > 0;
}

export function FrontendResearchPanel(props: FrontendResearchPanelProps) {
  const status = () => String(props.status || "pending");
  const isGenerating = () => status() === "running";
  const isFailed = () => status() === "failed";

  return (
    <div class="frontend-research-panel" data-status={status()}>
      <Show when={isGenerating()}>
        <div class="req-streaming">
          <div class="req-streaming-indicator">
            <span class="card__spinner" />
            <span class="req-streaming-label">{t("workflow.frontend_research_generating")}</span>
          </div>
        </div>
      </Show>

      <Show when={hasStream(props.streamingMessages)}>
        <div class="req-streaming-messages">
          <Index each={props.streamingMessages}>
            {(msg) => <CardParts parts={orderedMessageParts(msg())} depth={1} streaming={isGenerating()} />}
          </Index>
        </div>
      </Show>

      <Show when={isFailed()}>
        <p class="empty-hint empty-hint--card">{t("workflow.frontend_research_failed")}</p>
      </Show>

      <Show when={!isGenerating() && !isFailed() && !hasStream(props.streamingMessages)}>
        <p class="empty-hint empty-hint--card">{t("workflow.frontend_research_pending")}</p>
      </Show>
    </div>
  );
}
