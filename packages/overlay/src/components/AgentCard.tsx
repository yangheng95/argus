import { For, Show } from "solid-js";
import { MessageView } from "./MessageView";
import { agentStageLabel } from "../utils/message";
import {
  agentCardExpanded,
  toggleAgentCardExpanded,
} from "../store/conversation-ui";

function stageLabel(stage: string): string {
  return agentStageLabel(stage);
}

interface AgentCardProps {
  stage: string;
  status: string;
  messages: any[];
  round: number;
  cardID: string;
}

export function AgentCard(props: AgentCardProps) {
  const expanded = () => agentCardExpanded(props.cardID, props.status === "running");

  const label = () => {
    const base = stageLabel(props.stage);
    return props.round > 0 ? `${base} #${props.round}` : base;
  };

  const toggle = () => {
    toggleAgentCardExpanded(props.cardID, props.status === "running");
  };

  return (
    <article
      class="turn msg agent-card"
      classList={{ "agent-card--expanded": expanded() }}
      data-role="agent-card"
      data-stage={props.stage}
      data-card-key={props.cardID}
    >
      <div
        class="agent-card-header"
        role="button"
        tabindex="0"
        aria-expanded={expanded()}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            toggle();
          }
        }}
      >
        <Show
          when={props.status !== "running"}
          fallback={
            <span class="agent-card-badge agent-card-badge--running" title="Running">
              <span class="agent-card-spinner" />
            </span>
          }
        >
          <Show
            when={props.status === "completed"}
            fallback={
              <span class="agent-card-badge agent-card-badge--error" title="Error">
                {"\u2717"}
              </span>
            }
          >
            <span class="agent-card-badge agent-card-badge--done" title="Completed">
              {"\u2713"}
            </span>
          </Show>
        </Show>
        <span class="agent-card-label">{label()}</span>
        <span class="agent-card-count">
          <Show when={props.messages.length > 0}>({props.messages.length})</Show>
        </span>
        <span class="agent-card-chevron" aria-hidden="true">{"\u25BC"}</span>
      </div>
      <div class="agent-card-body">
        <For each={props.messages}>{(msg) => <MessageView message={msg} />}</For>
      </div>
    </article>
  );
}
