import { For, Show } from "solid-js";
import { MessageView } from "./MessageView";
import {
  agentCardExpanded,
  toggleAgentCardExpanded,
} from "../store/conversation-ui";
import { agentStageLabel } from "../utils/message";

interface AgentCardProps {
  cardID: string;
  stage: string;
  status: string;
  messages: any[];
  round: number;
}

export function AgentCard(props: AgentCardProps) {
  const expanded = () => agentCardExpanded(props.cardID, props.status === "running");

  const toggle = () => {
    toggleAgentCardExpanded(props.cardID, props.status === "running");
  };

  const badgeClass = () => {
    if (props.status === "running") return "agent-card-badge agent-card-badge--running";
    if (props.status === "error") return "agent-card-badge agent-card-badge--error";
    return "agent-card-badge agent-card-badge--done";
  };

  const badgeContent = () => {
    if (props.status === "running") return "";
    if (props.status === "error") return "\u2717";
    return "\u2713";
  };

  return (
    <article
      class="turn msg agent-card"
      classList={{ "agent-card--expanded": expanded() }}
      data-role="agent-card"
      data-agent-stage={props.stage}
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
          <span class={badgeClass()} title={props.status}>
            {badgeContent()}
          </span>
        </Show>
        <span class="agent-card-label">{agentStageLabel(props.stage)}</span>
        <Show when={props.round > 0}>
          <span class="agent-card-round">#{props.round}</span>
        </Show>
        <span class="agent-card-count">
          <Show when={props.messages.length > 0}>
            ({props.messages.length})
          </Show>
        </span>
        <span class="agent-card-chevron" aria-hidden="true">{"\u25BC"}</span>
      </div>
      <Show when={expanded()}>
        <div class="agent-card-body">
          <For each={props.messages}>
            {(msg) => <MessageView message={msg} />}
          </For>
        </div>
      </Show>
    </article>
  );
}
