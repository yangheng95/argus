import { For, Show, onCleanup } from "solid-js";
import { MessageView } from "./MessageView";
import {
  agentCardExpanded,
  toggleAgentCardExpanded,
} from "../store/conversation-ui";
import { setupAutoScroll } from "../utils/dom-utils";

interface GoalStepInfo {
  stepID: string;
  label: string;
  status: string;
  summary?: string;
}

interface ExecutorGoalGroupProps {
  cardID: string;
  goalTitle: string;
  goalDescription?: string;
  goalSteps?: GoalStepInfo[];
  architect?: { summary: string; categories?: string[] };
  goalStatus: string;
  status: string;
  /** Per-stage child cards: each has _agentStage and _agentMessages */
  internalCards?: any[];
}

/** Canonical step order for per-goal stages */
const STEP_ORDER = ["planner", "executor", "evaluator"];

/** Map workflow stepID to the agent stage name used in internalCards */
function stepIDToStage(stepID: string): string {
  if (stepID === "plan") return "planner";
  if (stepID === "execute") return "executor";
  if (stepID === "eval") return "evaluator";
  return stepID;
}

function stepStatusIcon(status: string): string {
  if (status === "completed") return "\u2713";
  if (status === "running") return "\u25CB";
  if (status === "failed") return "\u2717";
  if (status === "skipped") return "\u2014";
  return "\u00B7";
}

function stepStatusClass(status: string): string {
  if (status === "completed") return "goal-step--done";
  if (status === "running") return "goal-step--running";
  if (status === "failed" || status === "error") return "goal-step--error";
  if (status === "skipped") return "goal-step--skipped";
  return "goal-step--pending";
}

export function ExecutorGoalGroup(props: ExecutorGoalGroupProps) {
  const running = () => props.status === "running";
  const expanded = () => agentCardExpanded(props.cardID, running());

  const toggle = () => {
    toggleAgentCardExpanded(props.cardID, running());
  };

  const badgeClass = () => {
    if (props.status === "running") return "executor-goal-badge executor-goal-badge--running";
    if (props.goalStatus === "passed") return "executor-goal-badge executor-goal-badge--done";
    if (props.goalStatus === "failed") return "executor-goal-badge executor-goal-badge--error";
    if (props.status === "error") return "executor-goal-badge executor-goal-badge--error";
    if (props.status === "pending") return "executor-goal-badge executor-goal-badge--pending";
    return "executor-goal-badge executor-goal-badge--done";
  };

  const badgeContent = () => {
    if (props.status === "pending") return "\u00B7";
    if (props.status === "running") return "";
    if (props.goalStatus === "passed") return "\u2713";
    if (props.goalStatus === "failed") return "\u2717";
    if (props.status === "error") return "\u2717";
    return "\u2713";
  };

  /** Build a map from agent stage → internal card for quick lookup */
  const cardsByStage = () => {
    const map = new Map<string, any>();
    for (const card of props.internalCards || []) {
      map.set(card._agentStage, card);
    }
    return map;
  };

  /** Sort internal cards into canonical step order (fallback when no workflow steps) */
  const sortedCards = () => {
    const cards = props.internalCards || [];
    return cards.slice().sort((a: any, b: any) =>
      STEP_ORDER.indexOf(a._agentStage) - STEP_ORDER.indexOf(b._agentStage)
    );
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
        <span class="executor-goal-label">{props.goalTitle || "Goal"}</span>
        <span class="executor-goal-chevron" aria-hidden="true">{"\u25BC"}</span>
      </div>
      <div
        class="executor-goal-body"
        classList={{ "executor-goal-body--preview": !expanded() }}
        ref={(el) => onCleanup(setupAutoScroll(el))}
      >
        {/* Goal description (done_definition from decompose) */}
        <Show when={props.goalDescription}>
          <div class="executor-goal-description">{props.goalDescription}</div>
        </Show>

        {/* Architect decisions (shared across goals) */}
        <Show when={props.architect?.summary}>
          <div class="executor-goal-architect">
            <span class="executor-goal-architect-icon">{"\u2692"}</span>
            <span class="executor-goal-architect-text">{props.architect!.summary}</span>
            <Show when={props.architect!.categories?.length}>
              <span class="executor-goal-architect-cats">
                {props.architect!.categories!.join(", ")}
              </span>
            </Show>
          </div>
        </Show>

        {/* Workflow-driven steps (plan → execute → eval) with messages */}
        <Show
          when={(props.goalSteps || []).length > 0}
          fallback={
            <For each={sortedCards()}>
              {(card: any) => (
                <GoalStepCard
                  stage={card._agentStage}
                  status={card._agentStatus}
                  messages={card._agentMessages || []}
                />
              )}
            </For>
          }
        >
          <For each={props.goalSteps}>
            {(step) => {
              const stage = stepIDToStage(step.stepID);
              const card = () => cardsByStage().get(stage);
              const msgs = () => card()?._agentMessages || [];
              const effectiveStatus = () => card()?._agentStatus || step.status;
              return (
                <WorkflowStepRow
                  step={step}
                  effectiveStatus={effectiveStatus()}
                  messages={msgs()}
                />
              );
            }}
          </For>
        </Show>
      </div>
    </article>
  );
}

/** A workflow step row: shows step label + status + summary + messages directly */
function WorkflowStepRow(props: {
  step: GoalStepInfo;
  effectiveStatus: string;
  messages: any[];
}) {
  return (
    <div class={`goal-step ${stepStatusClass(props.effectiveStatus)}`}>
      <div class="goal-step-header">
        <Show
          when={props.effectiveStatus !== "running"}
          fallback={<span class="goal-step-icon goal-step-icon--running"><span class="agent-card-spinner" /></span>}
        >
          <span class="goal-step-icon">{stepStatusIcon(props.effectiveStatus)}</span>
        </Show>
        <span class="goal-step-label">{props.step.label}</span>
        <Show when={props.step.summary}>
          <span class="goal-step-summary">{props.step.summary}</span>
        </Show>
      </div>
      <Show when={props.messages.length > 0}>
        <div class="goal-step-body">
          <For each={props.messages.filter((m: any) => String(m?.info?.role || "").toLowerCase() !== "user")}>
            {(msg) => <MessageView message={msg} />}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Fallback step card when goalWorkflows data is absent */
function GoalStepCard(props: { stage: string; status: string; messages: any[] }) {
  return (
    <div class={`goal-step ${stepStatusClass(props.status)}`}>
      <div class="goal-step-header">
        <Show
          when={props.status !== "running"}
          fallback={<span class="goal-step-icon goal-step-icon--running"><span class="agent-card-spinner" /></span>}
        >
          <span class="goal-step-icon">{stepStatusIcon(props.status)}</span>
        </Show>
        <span class="goal-step-label">{props.stage}</span>
      </div>
      <Show when={props.messages.length > 0}>
        <div class="goal-step-body">
          <For each={props.messages.filter((m: any) => String(m?.info?.role || "").toLowerCase() !== "user")}>
            {(msg) => <MessageView message={msg} />}
          </For>
        </div>
      </Show>
    </div>
  );
}
