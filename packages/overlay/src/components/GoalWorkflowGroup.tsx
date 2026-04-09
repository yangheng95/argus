/**
 * GoalWorkflowGroup — per-goal collapsible card with step-level detail.
 *
 * Each goal shows its workflow steps (plan → execute → eval).
 * Each step is a mini-container that can show:
 *   - Status indicator (pending/running/completed/failed)
 *   - Agent card messages (when available, e.g., planner/executor/evaluator output)
 *   - Evaluation check details (for eval step)
 *
 * This bridges the workflow step tracking system and the live agent event system:
 *   - Step status comes from board.goalWorkflows[].steps[] (structured progress)
 *   - Step content comes from agentCards() (real-time message stream)
 */
import { For, Show, createMemo, JSX } from "solid-js";
import { MessageView } from "./MessageView";
import { t } from "../utils/i18n";
import { agentCardExpanded, toggleAgentCardExpanded } from "../store/conversation-ui";

// ── Types ──

interface GoalStep {
  stepID: string;
  label: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  startedAt?: number;
  completedAt?: number;
  /** Summary detail: e.g., "5 steps" for plan, "12 files changed" for execute, "3/4 checks passed" for eval */
  summary?: string;
}

interface EvalCheck {
  name: string;
  status: string;
  evidence?: string;
}

interface GoalWorkflow {
  goalID: string;
  goalTitle: string;
  goalStatus: string;
  priority: "blocking" | "advisory";
  steps: GoalStep[];
}

interface GoalWorkflowGroupProps {
  goal: GoalWorkflow;
  /** 1-based display index shown in the header (e.g. #3) */
  goalIndex?: number;
  /** Agent card messages grouped by step: { plan: msg[], execute: msg[], eval: msg[] } */
  stepMessages?: Record<string, any[]>;
  /** Evaluation checks for this goal (from board.evaluation or per-goal eval) */
  evalChecks?: EvalCheck[];
  defaultOpen?: boolean;
}

// ── Helpers ──

function stepIcon(status: string): string {
  switch (status) {
    case "completed": return "\u2713";
    case "running": return "\u25CB";
    case "failed": return "\u2717";
    case "skipped": return "\u2014";
    default: return "\u00B7";
  }
}

function stepClass(status: string): string {
  switch (status) {
    case "completed": return "gwg-step--done";
    case "running": return "gwg-step--running";
    case "failed": return "gwg-step--failed";
    case "skipped": return "gwg-step--skipped";
    default: return "gwg-step--pending";
  }
}

function goalStatusIcon(status: string): string {
  switch (status) {
    case "passed": return "\u2713";
    case "failed": return "\u2717";
    case "running": return "\u25CB";
    default: return "\u00B7";
  }
}

function goalStatusClass(status: string): string {
  switch (status) {
    case "passed": return "gwg--passed";
    case "failed": return "gwg--failed";
    case "running": return "gwg--running";
    default: return "gwg--pending";
  }
}

function checkStatusIcon(status: string): string {
  if (status === "passed") return "\u2713";
  if (status === "failed") return "\u2717";
  return "\u00B7";
}

function checkStatusClass(status: string): string {
  if (status === "passed") return "gwg-check--passed";
  if (status === "failed") return "gwg-check--failed";
  return "gwg-check--pending";
}

// ── Step Row (expandable when it has content) ──

function StepRow(props: {
  step: GoalStep;
  messages?: any[];
  checks?: EvalCheck[];
}) {
  const hasContent = createMemo(() => {
    const msgs = props.messages;
    const checks = props.checks;
    return (msgs && msgs.length > 0) || (checks && checks.length > 0);
  });

  const isActive = () =>
    props.step.status === "running" || props.step.status === "failed";

  return (
    <Show
      when={hasContent()}
      fallback={
        <div class={`gwg-step ${stepClass(props.step.status)}`}>
          <span class="gwg-step-icon">{stepIcon(props.step.status)}</span>
          <span class="gwg-step-label">{props.step.label}</span>
          <Show when={props.step.summary}>
            <span class="gwg-step-summary">{props.step.summary}</span>
          </Show>
          <span class="gwg-step-status">{props.step.status}</span>
        </div>
      }
    >
      <details class={`gwg-step-detail ${stepClass(props.step.status)}`} open={isActive()}>
        <summary class={`gwg-step ${stepClass(props.step.status)}`}>
          <span class="gwg-step-icon">{stepIcon(props.step.status)}</span>
          <span class="gwg-step-label">{props.step.label}</span>
          <Show when={props.step.summary}>
            <span class="gwg-step-summary">{props.step.summary}</span>
          </Show>
          <span class="gwg-step-status">{props.step.status}</span>
          <Show when={props.messages && props.messages.length > 0}>
            <span class="gwg-step-count">({props.messages!.length})</span>
          </Show>
        </summary>
        <div class="gwg-step-body">
          {/* Agent messages for this step */}
          <Show when={props.messages && props.messages.length > 0}>
            <div class="gwg-step-messages">
              <For each={props.messages}>
                {(msg) => <MessageView message={msg} />}
              </For>
            </div>
          </Show>
          {/* Evaluation checks (only for eval step) */}
          <Show when={props.checks && props.checks.length > 0}>
            <div class="gwg-checks">
              <For each={props.checks}>
                {(check) => (
                  <div class={`gwg-check ${checkStatusClass(check.status)}`}>
                    <span class="gwg-check-icon">{checkStatusIcon(check.status)}</span>
                    <span class="gwg-check-name">{check.name}</span>
                    <Show when={check.evidence}>
                      <span class="gwg-check-evidence">{check.evidence}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
        </div>
      </details>
    </Show>
  );
}

// ── Main GoalWorkflowGroup ──

export function GoalWorkflowGroup(props: GoalWorkflowGroupProps) {
  // "active" means running or failed — both warrant the card being open.
  const active = () =>
    props.goal.goalStatus === "running" || props.goal.goalStatus === "failed";

  // Use the same store-based mechanism as AgentCard so that:
  //   • Cards auto-open when active (running/failed) and auto-close when done.
  //   • Manual overrides are remembered only within the same active/inactive phase;
  //     a state transition (e.g. failed → running retry) resets to the protocol default.
  // Key is namespaced with "gwg:" so it never collides with conversation-panel keys.
  const cardKey = () => `gwg:${props.goal.goalID}`;
  const expanded = () =>
    props.defaultOpen ?? agentCardExpanded(cardKey(), active());
  const toggle = () => toggleAgentCardExpanded(cardKey(), active());

  return (
    <div
      class={`gwg ${goalStatusClass(props.goal.goalStatus)}`}
      classList={{ "gwg--expanded": expanded() }}
    >
      <div
        class="gwg-header"
        role="button"
        tabindex="0"
        aria-expanded={expanded()}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
        }}
      >
        <span class="gwg-status-icon">{goalStatusIcon(props.goal.goalStatus)}</span>
        <Show when={props.goalIndex !== undefined}>
          <span class="gwg-index">#{props.goalIndex}</span>
        </Show>
        <span class="gwg-title">{props.goal.goalTitle}</span>
        <span
          class="gwg-id"
          title={props.goal.goalID}
          onClick={(e) => {
            e.stopPropagation();
            navigator.clipboard.writeText(props.goal.goalID).catch(() => {});
          }}
        >
          {props.goal.goalID.slice(-8)}
        </span>
        <Show when={props.goal.priority === "advisory"}>
          <span class="gwg-priority-badge">advisory</span>
        </Show>
        <span class="gwg-chevron" aria-hidden="true">{"\u25BC"}</span>
      </div>
      <Show when={expanded()}>
        <div class="gwg-body">
          <For each={props.goal.steps}>
            {(step) => (
              <StepRow
                step={step}
                messages={props.stepMessages?.[step.stepID]}
                checks={step.stepID === "eval" ? props.evalChecks : undefined}
              />
            )}
          </For>
        </div>
      </Show>
    </div>
  );
}

/** Render a list of GoalWorkflowGroups */
export function GoalWorkflowList(props: {
  goals: GoalWorkflow[];
  /** Per-goal step messages: { [goalID]: { [stepID]: msg[] } } */
  goalStepMessages?: Record<string, Record<string, any[]>>;
  /** Per-goal eval checks: { [goalID]: EvalCheck[] } */
  goalEvalChecks?: Record<string, EvalCheck[]>;
}) {
  return (
    <div class="gwg-list">
      <For each={props.goals}>
        {(goal, idx) => (
          <GoalWorkflowGroup
            goal={goal}
            goalIndex={idx() + 1}
            stepMessages={props.goalStepMessages?.[goal.goalID]}
            evalChecks={props.goalEvalChecks?.[goal.goalID]}
          />
        )}
      </For>
    </div>
  );
}
