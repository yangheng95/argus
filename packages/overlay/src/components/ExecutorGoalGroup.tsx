import { For, Show } from "solid-js";
import { MessageView } from "./MessageView";
import {
  agentCardExpanded,
  toggleAgentCardExpanded,
} from "../store/conversation-ui";

interface ExecutorGoalGroupProps {
  cardID: string;
  goalTitle: string;
  goalStatus: string;
  status: string;
  messages: any[];
}

export function ExecutorGoalGroup(props: ExecutorGoalGroupProps) {
  const expanded = () => agentCardExpanded(props.cardID, props.status === "running");

  const toggle = () => {
    toggleAgentCardExpanded(props.cardID, props.status === "running");
  };

  const badgeClass = () => {
    if (props.status === "running") return "executor-goal-badge executor-goal-badge--running";
    if (props.status === "error") return "executor-goal-badge executor-goal-badge--error";
    return "executor-goal-badge executor-goal-badge--done";
  };

  const badgeContent = () => {
    if (props.status === "running") return "";
    if (props.status === "error") return "\u2717";
    return "\u2713";
  };

  return (
    <article
      class="turn msg executor-goal-block"
      classList={{ "executor-goal-block--expanded": expanded() }}
      data-role="executor-goal-group"
      data-goal-id={props.cardID}
    >
      <div
        class="executor-goal-header"
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
            <span class="executor-goal-badge executor-goal-badge--running" title="Running">
              <span class="agent-card-spinner" />
            </span>
          }
        >
          <span class={badgeClass()} title={props.status}>
            {badgeContent()}
          </span>
        </Show>
        <span class="executor-goal-label">{props.goalTitle || "Executor"}</span>
        <span class="executor-goal-count">
          <Show when={props.messages.length > 0}>
            ({props.messages.length})
          </Show>
        </span>
        <span class="executor-goal-chevron" aria-hidden="true">{"\u25BC"}</span>
      </div>
      <Show when={expanded()}>
        <div class="executor-goal-body">
          <For each={props.messages}>
            {(msg) => <MessageView message={msg} />}
          </For>
        </div>
      </Show>
    </article>
  );
}
