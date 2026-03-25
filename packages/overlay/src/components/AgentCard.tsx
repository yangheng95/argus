import { createSignal, For, Show } from "solid-js";
import { MessageView } from "./MessageView";

/** Use legacy agentStageLabel/i18n if available. */
function stageLabel(stage: string): string {
  if (typeof (window as any).agentStageLabel === "function") {
    return (window as any).agentStageLabel(stage);
  }
  if (stage === "spec") return "Spec Agent";
  if (stage === "planner") return "Planner";
  if (stage === "goal") return "Goal Agent";
  if (stage === "judge" || stage === "scheduler") return "Evaluator";
  if (stage === "delivery") return "Delivery";
  return "Agent";
}

interface AgentCardProps {
  stage: string;
  status: string;
  messages: any[];
  round: number;
  key: string;
}

export function AgentCard(props: AgentCardProps) {
  // Default to expanded when running, collapsed otherwise
  const [expanded, setExpanded] = createSignal(props.status === "running");

  const label = () => {
    const base = stageLabel(props.stage);
    return props.round > 0 ? `${base} #${props.round}` : base;
  };

  const toggle = () => setExpanded(!expanded());

  return (
    <article
      class="turn msg agent-card"
      classList={{ "agent-card--expanded": expanded() }}
      data-role="agent-card"
      data-stage={props.stage}
      data-card-key={props.key}
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
      <Show when={expanded()}>
        <div class="agent-card-body">
          <For each={props.messages}>{(msg) => <MessageView message={msg} />}</For>
        </div>
      </Show>
    </article>
  );
}
