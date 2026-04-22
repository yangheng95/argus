/**
 * GoalWorkflowGroup — per-goal collapsible summary card for the sidebar.
 *
 * The right-side goal panel should stay goal-scoped: title, objective,
 * acceptance, and overall status. Step-by-step executor detail belongs in
 * the conversation timeline, not duplicated here as a second Executor pane.
 */
import { For, Show } from "solid-js";
import { t } from "../utils/i18n";
import { cardExpanded, toggleCard } from "../store/conversation-ui";
import { goalRevisionLabelFromIndexes } from "../utils/goal-label";
import { StaticTextPart } from "./TextPart";

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
  orderIndex?: number;
  retryCount?: number;
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
  const revisionLabel = () =>
    goalRevisionLabelFromIndexes(props.goal.orderIndex, props.goal.retryCount);

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
          <Show when={revisionLabel()}>
            <span class="gwg-revision">{revisionLabel()}</span>
          </Show>
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
              }}
              onDblClick={(e) => {
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
              <div class="gwg-objective-text">
                <StaticTextPart text={props.goal.goalObjective!} />
              </div>
            </div>
          </Show>
          <Show when={previewAcceptance(props.goal.acceptanceSpecs)}>
            <div class="gwg-done-definition">
              <div class="gwg-done-definition-label">
                {t("goal.field.acceptance")}
              </div>
              <div class="gwg-done-definition-text">
                <StaticTextPart text={previewAcceptance(props.goal.acceptanceSpecs)} />
              </div>
            </div>
          </Show>
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
        {(goal) => (
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
