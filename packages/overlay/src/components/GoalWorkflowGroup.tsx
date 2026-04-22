/**
 * GoalWorkflowGroup — per-goal collapsible card with step-level detail.
 *
 * Each goal shows its workflow steps as emitted by board.goalWorkflows[].
 * Each step is a mini-container that can show:
 *   - Status indicator (pending/running/completed/failed)
 *   - Agent card messages for the matching step
 *   - Structured payload detail (plan nodes, changed files, checks, etc.)
 *
 * This bridges the workflow step tracking system and the live agent event system:
 *   - Step status comes from board.goalWorkflows[].steps[] (structured progress)
 *   - Step content comes from agentCards() (real-time message stream)
 */
import { For, Show, createMemo } from "solid-js";
import { StepPayloadBody } from "./StepPayloadBody";
import { t } from "../utils/i18n";
import { cardExpanded, toggleCard } from "../store/conversation-ui";
import { openBuildSessionDialog } from "../services/dialog";
import type { StepPayload } from "../store/card-tree";

// ── Types ──

/**
 * Per-step structured payload — full content the StepRow renders.
 *
 * Replaces the legacy PlanPanel / ExecutorSummaryPanel / CriteriaPanel /
 * EvaluationPanel reading separate top-level board fields. Each goal's
 * step now carries its own data so the frontend never has to cross-
 * reference task-level state.
 */
interface GoalStep {
  stepID: string;
  label: string;
  status: "pending" | "running" | "completed" | "skipped" | "failed";
  startedAt?: number;
  completedAt?: number;
  /** Summary detail: e.g., "5 steps" for plan, "12 files changed" for execute, "3/4 checks passed" for eval */
  summary?: string;
  /** Structured per-step content — backend-driven, see GoalStepPayload */
  payload?: StepPayload;
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
  /** Architect-authored 1–2 sentence execution directive for this goal.
   *  The real goal summary — acceptance_specs are the pass/fail contract,
   *  objective is the prose description a human reads first. */
  goalObjective?: string;
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
  defaultOpen?: boolean;
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

// ── Step Row (expandable when it has content) ──
//
// The right-hand Board is a CONTROL PANEL — it surfaces high-level status
// (step verdicts, file counts, plan nodes, evaluator checks) and offers a
// "jump to session" affordance. It deliberately does NOT mirror the
// conversation panel's message stream here: a step's LLM chatter (orchestrator
// dispatch brief, agent text/tool parts) belongs in the left-hand Conversation
// where CardParts already renders them properly. Rendering both the control
// summary AND the raw message stream side-by-side produced the unreadable
// JSON wall operators complained about; the stream is removed from this
// surface (rule 10 — no dual-source / duplicate rendering).

function StepRow(props: {
  step: GoalStep;
  goalTitle?: string;
}) {
  // ── Content presence: structured payload only (messages live in the
  //    conversation panel). ──
  const hasPlanNodes = () =>
    !!props.step.payload?.planNodes && props.step.payload.planNodes.length > 0;
  const hasChangedFiles = () =>
    !!props.step.payload?.changedFiles && props.step.payload.changedFiles.length > 0;
  const hasChecks = () =>
    !!props.step.payload?.checks && props.step.payload.checks.length > 0;
  const hasEvalBody = () =>
    hasChecks() || !!props.step.payload?.evalSummary || !!props.step.payload?.verdict;
  // The pipeline workflow uses `build` as the single goal-scope step;
  // the payload carries a pointer to the goal's build worker session
  // (SessionTable kind="build"). Scope-based: any step whose payload
  // ships a build session id surfaces the "open session" affordance.
  const hasOpenSession = () =>
    !!props.step.payload?.buildSessionID;
  const hasContent = createMemo(() =>
    hasPlanNodes() || hasChangedFiles() || hasEvalBody() || hasOpenSession(),
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
        </summary>
        <div class="gwg-step-body">
          <StepPayloadBody payload={props.step.payload} stepID={props.step.stepID} />
          {/* Sidebar-only affordance: jump to the goal's build session
              dialog. The main-conversation Card already renders the session
              inline, so it doesn't need this button. */}
          <Show when={hasOpenSession()}>
            <div class="gwg-open-session">
              <button
                type="button"
                class="gwg-open-session-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  void openBuildSessionDialog(
                    props.step.payload!.buildSessionID!,
                    props.goalTitle ?? "",
                  );
                }}
              >
                {t("goal.open_session")}
              </button>
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
        <div class="gwg-title-row">
          <span class="gwg-title">{props.goal.goalTitle}</span>
          <Show when={props.goal.priority === "advisory"}>
            <span class="gwg-priority-badge">advisory</span>
          </Show>
        </div>
        <div class="gwg-header-actions">
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
      </div>
      <Show when={expanded()}>
        <div class="gwg-body">
          <Show when={props.goal.goalObjective}>
            <div class="gwg-objective">
              <div class="gwg-objective-label">{t("goal.field.objective")}</div>
              <div class="gwg-objective-text">{props.goal.goalObjective}</div>
            </div>
          </Show>
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
                goalTitle={props.goal.goalTitle}
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
  onEditGoal?: (goalID: string, title: string, detail: string) => void;
  onDeleteGoal?: (goalID: string) => void;
}) {
  return (
    <div class="gwg-list">
      <For each={props.goals}>
        {(goal, idx) => (
          <GoalWorkflowGroup
            goal={goal}
            onEditGoal={props.onEditGoal}
            onDeleteGoal={props.onDeleteGoal}
          />
        )}
      </For>
    </div>
  );
}
