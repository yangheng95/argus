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
import { CardParts } from "./CardParts";
import { t } from "../utils/i18n";
import { cardExpanded, toggleCard } from "../store/conversation-ui";
import { orderedMessageParts } from "../utils/message";

// ── Types ──

/**
 * Per-step structured payload — full content the StepRow renders.
 *
 * Replaces the legacy PlanPanel / ExecutorSummaryPanel / CriteriaPanel /
 * EvaluationPanel reading separate top-level board fields. Each goal's
 * step now carries its own data so the frontend never has to cross-
 * reference task-level state.
 */
interface GoalStepPayload {
  // plan
  planNodes?: Array<{ id: string; title: string; brief: string; orderIndex: number }>;
  // execute
  executorSessionID?: string;
  changedFiles?: string[];
  diffStats?: { files?: number; additions?: number; deletions?: number };
  // eval
  checks?: Array<{ name: string; status: string; evidence?: string; family?: string }>;
  evalSummary?: string;
  verdict?: string;
}

interface GoalStep {
  stepID: string;
  label: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  startedAt?: number;
  completedAt?: number;
  /** Summary detail: e.g., "5 steps" for plan, "12 files changed" for execute, "3/4 checks passed" for eval */
  summary?: string;
  /** Structured per-step content — backend-driven, see GoalStepPayload */
  payload?: GoalStepPayload;
}

interface AcceptanceScorerLike {
  type?: string;
  name?: string;
  criteria?: string;
  spec?: { kind?: string; cmd?: string; path?: string };
}

interface AcceptanceSpecLike {
  id?: string;
  title?: string;
  severity?: string;
  scorers?: AcceptanceScorerLike[];
}

interface GoalWorkflow {
  goalID: string;
  goalTitle: string;
  goalStatus: string;
  /** Typed acceptance specs from the backend (board.ts). */
  acceptanceSpecs?: AcceptanceSpecLike[];
  priority: "blocking" | "advisory";
  steps: GoalStep[];
}

/** Reduce an AcceptanceSpec[] to a single short human-readable line for the
 *  per-goal panel preview and the goal-edit textarea seed. We pick the first
 *  scorer's criteria/command so operators see the most actionable signal. */
function previewAcceptance(specs: AcceptanceSpecLike[] | undefined): string {
  if (!Array.isArray(specs) || specs.length === 0) return "";
  const first = specs[0];
  const scorer = first.scorers?.[0];
  if (!scorer) return first.title ?? "";
  if (scorer.type === "llm_judge" && scorer.criteria) return scorer.criteria;
  if (scorer.type === "heuristic" && scorer.spec?.kind === "shell" && scorer.spec.cmd) return scorer.spec.cmd;
  if (scorer.type === "heuristic" && scorer.spec?.kind === "script_ref" && scorer.spec.path) return scorer.spec.path;
  return first.title ?? "";
}

interface GoalWorkflowGroupProps {
  goal: GoalWorkflow;
  /** 1-based display index shown in the header (e.g. #3) */
  goalIndex?: number;
  /** Agent card messages grouped by step: { plan: msg[], execute: msg[], eval: msg[] } */
  stepMessages?: Record<string, any[]>;
  defaultOpen?: boolean;
  /** Optional: jump to the executor session for this goal's execute step. */
  onOpenSession?: (sessionID: string, goalTitle: string) => void;
  /** Optional: edit the goal (title + detail). */
  onEditGoal?: (goalID: string, title: string, detail: string) => void;
  /** Optional: delete the goal. */
  onDeleteGoal?: (goalID: string) => void;
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

function verdictClass(verdict: string): string {
  if (verdict === "accepted") return "gwg-verdict--accepted";
  if (verdict === "rejected") return "gwg-verdict--rejected";
  return "gwg-verdict--inconclusive";
}

// ── Step Row (expandable when it has content) ──

function StepRow(props: {
  step: GoalStep;
  messages?: any[];
  onOpenSession?: (sessionID: string, goalTitle: string) => void;
  goalTitle?: string;
}) {
  // ── Content presence: structured payload OR streaming messages ──
  const hasPlanNodes = () =>
    !!props.step.payload?.planNodes && props.step.payload.planNodes.length > 0;
  const hasChangedFiles = () =>
    !!props.step.payload?.changedFiles && props.step.payload.changedFiles.length > 0;
  const hasChecks = () =>
    !!props.step.payload?.checks && props.step.payload.checks.length > 0;
  const hasEvalBody = () =>
    hasChecks() || !!props.step.payload?.evalSummary || !!props.step.payload?.verdict;
  const hasMessages = () => !!props.messages && props.messages.length > 0;
  const hasOpenSession = () =>
    props.step.stepID === "execute" &&
    !!props.step.payload?.executorSessionID &&
    !!props.onOpenSession;
  const hasContent = createMemo(() =>
    hasPlanNodes() || hasChangedFiles() || hasEvalBody() || hasMessages() || hasOpenSession(),
  );

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
          <Show when={hasMessages()}>
            <span class="gwg-step-count">({props.messages!.length})</span>
          </Show>
        </summary>
        <div class="gwg-step-body">
          {/* Plan nodes — backend-driven, replaces legacy PlanPanel for this goal */}
          <Show when={hasPlanNodes()}>
            <div class="gwg-plan-nodes">
              <For each={props.step.payload!.planNodes}>
                {(node) => (
                  <div class="gwg-plan-node">
                    <div class="gwg-plan-node-title">{node.title}</div>
                    <Show when={node.brief}>
                      <div class="gwg-plan-node-brief">{node.brief}</div>
                    </Show>
                  </div>
                )}
              </For>
            </div>
          </Show>
          {/* Changed files — backend-driven, replaces legacy ExecutorSummaryPanel for this goal */}
          <Show when={hasChangedFiles()}>
            <div class="gwg-changed-files">
              <Show when={props.step.payload!.diffStats?.files !== undefined}>
                <div class="gwg-diff-stats">
                  <span class="gwg-diff-files">{props.step.payload!.diffStats!.files} files</span>
                  <Show when={props.step.payload!.diffStats?.additions !== undefined}>
                    <span class="gwg-diff-additions">+{props.step.payload!.diffStats!.additions}</span>
                  </Show>
                  <Show when={props.step.payload!.diffStats?.deletions !== undefined}>
                    <span class="gwg-diff-deletions">-{props.step.payload!.diffStats!.deletions}</span>
                  </Show>
                </div>
              </Show>
              <For each={props.step.payload!.changedFiles}>
                {(file) => <div class="gwg-changed-file">{file}</div>}
              </For>
            </div>
          </Show>
          {/* Open session link — jumps to executor session for this goal */}
          <Show when={hasOpenSession()}>
            <div class="gwg-open-session">
              <button
                type="button"
                class="gwg-open-session-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  props.onOpenSession!(props.step.payload!.executorSessionID!, props.goalTitle ?? "");
                }}
              >
                {t("goal.open_session")}
              </button>
            </div>
          </Show>
          {/* Eval verdict + summary + checks — backend-driven, replaces legacy EvaluationPanel for this goal */}
          <Show when={props.step.payload?.verdict}>
            <div class={`gwg-verdict ${verdictClass(props.step.payload!.verdict!)}`}>
              {props.step.payload!.verdict}
            </div>
          </Show>
          <Show when={props.step.payload?.evalSummary}>
            <div class="gwg-eval-summary">{props.step.payload!.evalSummary}</div>
          </Show>
          <Show when={hasChecks()}>
            <div class="gwg-checks">
              <For each={props.step.payload!.checks}>
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
          {/* Agent messages for this step */}
          <Show when={hasMessages()}>
            <div class="gwg-step-messages">
              <For each={props.messages}>
                {(msg) => <CardParts parts={orderedMessageParts(msg)} depth={1} />}
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
  // Default expanded when active (running/failed); manual overrides discarded
  // on goalStatus transitions via the unified card-fold store.
  // Key is namespaced with "gwg:" so it never collides with conversation-panel keys.
  const cardKey = () => `gwg:${props.goal.goalID}`;
  const status = () => props.goal.goalStatus;
  const defaultOpen = () =>
    props.defaultOpen ?? (status() === "running" || status() === "failed");
  const expanded = () => cardExpanded(cardKey(), status(), defaultOpen());
  const toggle = () => toggleCard(cardKey(), status(), defaultOpen());

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
        <Show when={props.onEditGoal}>
          <button
            type="button"
            class="gwg-action-btn gwg-action-edit"
            title={t("goal.edit_button_title")}
            onClick={(e) => {
              e.stopPropagation();
              props.onEditGoal!(
                props.goal.goalID,
                props.goal.goalTitle,
                previewAcceptance(props.goal.acceptanceSpecs),
              );
            }}
          >
            {"\u270E"}
          </button>
        </Show>
        <Show when={props.onDeleteGoal}>
          <button
            type="button"
            class="gwg-action-btn gwg-action-delete"
            title={t("goal.delete_button_title")}
            onClick={(e) => {
              e.stopPropagation();
              props.onDeleteGoal!(props.goal.goalID);
            }}
          >
            {"\u2715"}
          </button>
        </Show>
        <span class="gwg-chevron" aria-hidden="true">{"\u25BC"}</span>
      </div>
      <Show when={expanded()}>
        <div class="gwg-body">
          <Show when={previewAcceptance(props.goal.acceptanceSpecs)}>
            <div class="gwg-done-definition">
              <div class="gwg-done-definition-label">
                {t("goal.field.acceptance")}
              </div>
              <div class="gwg-done-definition-text">{previewAcceptance(props.goal.acceptanceSpecs)}</div>
            </div>
          </Show>
          <For each={props.goal.steps}>
            {(step) => (
              <StepRow
                step={step}
                messages={props.stepMessages?.[step.stepID]}
                goalTitle={props.goal.goalTitle}
                onOpenSession={props.onOpenSession}
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
  onOpenSession?: (sessionID: string, goalTitle: string) => void;
  onEditGoal?: (goalID: string, title: string, detail: string) => void;
  onDeleteGoal?: (goalID: string) => void;
}) {
  return (
    <div class="gwg-list">
      <For each={props.goals}>
        {(goal, idx) => (
          <GoalWorkflowGroup
            goal={goal}
            goalIndex={idx() + 1}
            stepMessages={props.goalStepMessages?.[goal.goalID]}
            onOpenSession={props.onOpenSession}
            onEditGoal={props.onEditGoal}
            onDeleteGoal={props.onDeleteGoal}
          />
        )}
      </For>
    </div>
  );
}
