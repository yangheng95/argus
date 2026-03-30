import { createMemo, For, Show } from "solid-js";
import { MessageView } from "./MessageView";
import { agentStageLabel } from "../utils/message";
import {
  agentCardExpanded,
  toggleAgentCardExpanded,
} from "../store/conversation-ui";
import { boardStore } from "../store/board";
import { renderMarkdown } from "../utils/markdown";

function stageLabel(stage: string): string {
  return agentStageLabel(stage);
}

function goalIcon(status: string): string {
  if (status === "passed") return "\u2713";
  if (status === "failed") return "\u2717";
  return "\u2022";
}

function checkIcon(status: string): string {
  if (status === "passed") return "\u2713";
  if (status === "failed") return "\u2717";
  if (status === "skipped") return "\u2013";
  return "\u2022";
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

  // ── Summary data — each memo reads only the board path it needs ──

  const specContent = createMemo(() => {
    if (props.stage !== "spec") return "";
    const content = boardStore.board?.spec?.content || "";
    if (!content) return "";
    const lines = content.split("\n").filter((l: string) => l.trim());
    const preview = lines.slice(0, 4).join("\n");
    return lines.length > 4 ? preview + "\n…" : preview;
  });

  const planData = createMemo(() => {
    if (props.stage !== "planner") return null;
    const plan = boardStore.board?.plan;
    if (!plan?.summary) return null;
    return { summary: plan.summary as string, version: plan.version as number | undefined };
  });

  const goalsData = createMemo(() => {
    if (props.stage !== "goal") return [];
    const lanes = (boardStore.board?.lanes || []) as any[];
    const goalsLane = lanes.find((lane: any) => lane.id === "goals");
    return (goalsLane?.cards || []) as any[];
  });

  const evaluationData = createMemo(() => {
    if (props.stage !== "evaluator") return null;
    const evaluation = boardStore.board?.evaluation as any;
    if (!evaluation) return null;
    return {
      verdict: (evaluation.verdict || "") as string,
      checks: (Array.isArray(evaluation.checks) ? evaluation.checks : []) as any[],
    };
  });

  const deliveryData = createMemo(() => {
    if (props.stage !== "delivery") return null;
    const delivery = boardStore.board?.acceptedDelivery || boardStore.board?.delivery;
    if (!delivery) return null;
    return {
      status: ((delivery as any).status || "") as string,
    };
  });

  const hasSummary = createMemo(() => {
    switch (props.stage) {
      case "spec": return !!specContent();
      case "planner": return !!planData();
      case "goal": return goalsData().length > 0;
      case "evaluator": return !!evaluationData();
      case "delivery": return !!deliveryData();
      default: return false;
    }
  });

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
        {/* ── Stage summary ── */}
        <Show when={hasSummary()}>
          <div class="agent-card-summary">

            {/* Spec: document preview */}
            <Show when={props.stage === "spec" && specContent()}>
              <div class="agent-card-summary-content md-content"
                   innerHTML={renderMarkdown(specContent())} />
            </Show>

            {/* Planner: plan summary + version */}
            <Show when={props.stage === "planner" && planData()}>
              <div class="agent-card-summary-plan">
                <Show when={planData()!.version}>
                  <span class="plan-version">v{planData()!.version}</span>
                </Show>
                <div class="agent-card-summary-content md-content"
                     innerHTML={renderMarkdown(planData()!.summary)} />
              </div>
            </Show>

            {/* Goal: goals list with status */}
            <Show when={props.stage === "goal" && goalsData().length > 0}>
              <div class="goals-list">
                <For each={goalsData()}>
                  {(card: any) => (
                    <div class="goal-item agent-card-summary-goal">
                      <span class="goal-status-icon"
                            data-status={card.status || "pending"}>
                        {goalIcon(card.status)}
                      </span>
                      <div class="goal-content">
                        <div class="goal-desc md-content"
                             innerHTML={renderMarkdown(card.title || "")} />
                        <Show when={card.detail}>
                          <div class="goal-criteria md-content"
                               innerHTML={renderMarkdown(card.detail)} />
                        </Show>
                      </div>
                      <Show when={card.metadata?.priority}>
                        <span class="goal-priority"
                              data-priority={card.metadata.priority}>
                          {card.metadata.priority}
                        </span>
                      </Show>
                    </div>
                  )}
                </For>
              </div>
            </Show>

            {/* Evaluator: verdict + checks */}
            <Show when={props.stage === "evaluator" && evaluationData()}>
              <div class="agent-card-summary-eval">
                <Show when={evaluationData()!.verdict}>
                  <span class="section-badge"
                        data-tone={evaluationData()!.verdict === "accepted" ? "good" : evaluationData()!.verdict === "rejected" ? "bad" : "warn"}>
                    {evaluationData()!.verdict}
                  </span>
                </Show>
                <Show when={evaluationData()!.checks.length > 0}>
                  <div class="agent-card-summary-checks">
                    <For each={evaluationData()!.checks}>
                      {(check: any) => (
                        <span class="agent-card-summary-check"
                              data-status={check.status}>
                          <span class="agent-card-summary-check-icon">
                            {checkIcon(check.status)}
                          </span>
                          {check.label || check.name}
                        </span>
                      )}
                    </For>
                  </div>
                </Show>
              </div>
            </Show>

            {/* Delivery: status badge */}
            <Show when={props.stage === "delivery" && deliveryData()}>
              <span class="section-badge"
                    data-tone={deliveryData()!.status === "delivered" ? "good" : deliveryData()!.status === "failed" ? "bad" : "accent"}>
                {deliveryData()!.status}
              </span>
            </Show>

          </div>
          <hr class="agent-card-summary-divider" />
        </Show>

        {/* ── Message list ── */}
        <For each={props.messages}>{(msg) => <MessageView message={msg} />}</For>
      </div>
    </article>
  );
}
