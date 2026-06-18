/**
 * GoalWorkflowGroup — per-goal expandable summary card for the sidebar.
 *
 * The right-side goal panel should stay goal-scoped: title, objective,
 * acceptance, and overall status. Step-by-step executor detail belongs in
 * the conversation timeline, not duplicated here as a second Executor pane.
 */
import { For, Show } from "solid-js"
import { t } from "../utils/i18n"
import { cardExpanded, setCardExpanded } from "../store/conversation-ui"
import { goalRevisionLabelFromIndexes } from "../utils/goal-label"
import { goalStatusToTaskStatus, statusIconName } from "../utils/status-mapping"
import { relativePathFrom } from "../utils/path"
import { activeDirectory, openDirectory } from "../services/workspace"
import { getHostTransport } from "../services/host-transport"
import { StaticTextPart } from "./TextPart"
import { Icon } from "./Icon"

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
  stepID: string
  label: string
  status: "pending" | "running" | "completed" | "skipped" | "failed"
  startedAt?: number
  completedAt?: number
  /** Summary detail: e.g., "5 steps" for plan, "12 files changed" for execute, "3/4 checks passed" for eval */
  summary?: string
}

interface AcceptanceScorerLike {
  type?: string
  name?: string
  criteria?: string
  spec?: { kind?: string; cmd?: string; path?: string }
}

interface AcceptanceSpecLike {
  id?: string
  title?: string
  severity?: string
  scorers?: AcceptanceScorerLike[]
}

interface GoalWorkflow {
  goalID: string
  goalTitle: string
  orderIndex?: number
  retryCount?: number
  /** Architect-authored 1–2 sentence execution directive for this goal.
   *  The real goal summary — acceptance_specs are the pass/fail contract,
   *  objective is the prose description a human reads first. */
  goalObjective?: string
  goalStatus: string
  /** Persistent worktree pointer for this goal (single source — projected
   *  from goal_run_attempt artifact via findGoalLatestWorkspace; not a
   *  status-priority sort, just append-only tip + supersede). */
  workspaceDir?: string
  workspaceBranch?: string
  /** Typed acceptance specs from the backend (board.ts). */
  acceptanceSpecs?: AcceptanceSpecLike[]
  priority: "blocking" | "advisory"
  steps: GoalStep[]
}

/** Reduce an AcceptanceSpec[] to a single short human-readable line for the
 *  per-goal panel preview and the goal-edit textarea seed. We pick the first
 *  scorer's criteria/command so operators see the most actionable signal. */
function previewAcceptance(specs: AcceptanceSpecLike[] | undefined): string {
  if (!Array.isArray(specs) || specs.length === 0) return ""
  const first = specs[0]
  const scorer = first.scorers?.[0]
  if (!scorer) return first.title ?? ""
  if (scorer.type === "llm_judge" && scorer.criteria) return scorer.criteria
  if (scorer.type === "heuristic" && scorer.spec?.kind === "shell" && scorer.spec.cmd) return scorer.spec.cmd
  if (scorer.type === "heuristic" && scorer.spec?.kind === "script_ref" && scorer.spec.path) return scorer.spec.path
  return first.title ?? ""
}

interface GoalWorkflowGroupProps {
  goal: GoalWorkflow
  defaultOpen?: boolean
  /** Optional: edit the goal (title + detail). */
  onEditGoal?: (goalID: string, title: string, detail: string) => void
  /** Optional: delete the goal. */
  onDeleteGoal?: (goalID: string) => void
}

// ── Main GoalWorkflowGroup ──

export function GoalWorkflowGroup(props: GoalWorkflowGroupProps) {
  const canOpenWorktreeDirectory = getHostTransport().capabilities.nativeCommands["open-path"]
  // Default expanded when active (running/failed); manual overrides discarded
  // on goalStatus transitions via the unified card-fold store.
  // Key is namespaced with "gwg:" so it never collides with conversation-panel keys.
  const cardKey = () => `gwg:${props.goal.goalID}`
  const status = () => props.goal.goalStatus
  const defaultOpen = () => props.defaultOpen ?? (status() === "running" || status() === "failed")
  const expanded = () => cardExpanded(cardKey(), status(), defaultOpen())
  const toggleExpanded = () => {
    setCardExpanded(cardKey(), !expanded(), status())
  }
  const revisionLabel = () => goalRevisionLabelFromIndexes(props.goal.orderIndex, props.goal.retryCount)
  /** Display label for the worktree row. Returns empty string when the
   *  relative path cannot be resolved (rule 7: no fallback to shortPath /
   *  absolute path / hydration placeholder — the row is hidden instead). */
  const worktreeLabel = () => {
    const wt = props.goal.workspaceDir
    if (!wt) return ""
    const base = activeDirectory()
    return relativePathFrom(base, wt)
  }
  const worktreeContent = () => (
    <>
      <span class="gwg-worktree-label">{t("goal.field.worktree")}</span>
      <span class="gwg-worktree-path">{worktreeLabel()}</span>
      <Show when={props.goal.workspaceBranch}>
        <span class="gwg-worktree-branch">⎇ {props.goal.workspaceBranch}</span>
      </Show>
    </>
  )

  return (
    <div class="gwg" data-goal-status={props.goal.goalStatus} classList={{ "gwg--expanded": expanded() }}>
      <button
        type="button"
        class="gwg-header"
        aria-expanded={expanded()}
        onClick={toggleExpanded}
      >
        <span class="gwg-status-icon" data-status={props.goal.goalStatus}>
          <Icon name={statusIconName(goalStatusToTaskStatus(props.goal.goalStatus))} />
        </span>
        <span class="gwg-title-row">
          <span class="gwg-title">{props.goal.goalTitle}</span>
        </span>
        <span class="gwg-header-meta">
          <Show when={revisionLabel()}>
            <span class="gwg-revision">{revisionLabel()}</span>
          </Show>
          <Show when={props.goal.priority === "advisory"}>
            <span class="gwg-priority-badge">advisory</span>
          </Show>
          <Show when={props.goal.workspaceBranch}>
            <span
              class="gwg-branch-pill"
              title={props.goal.workspaceDir}
              aria-label={`worktree: ${props.goal.workspaceDir ?? ""}`}
            >
              ⎇ {props.goal.workspaceBranch}
            </span>
          </Show>
        </span>
        {/* iter44: edit + delete buttons removed per user feedback
            (2026-05-03) \u2014 goal authoring lives elsewhere (the
            requirements/architect flow owns goal definition; manual
            edit/delete from the conversation surface was confusing
            and rarely the right action). The `onEditGoal` / `onDeleteGoal`
            props remain on the component so callers don't break;
            they're just no-ops on this surface now. */}
      </button>
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
              <div class="gwg-done-definition-label">{t("goal.field.acceptance")}</div>
              <div class="gwg-done-definition-text">
                <StaticTextPart text={previewAcceptance(props.goal.acceptanceSpecs)} />
              </div>
            </div>
          </Show>
          <Show when={worktreeLabel()}>
            <Show
              when={canOpenWorktreeDirectory}
              fallback={
                <div class="gwg-worktree" title={props.goal.workspaceDir} data-card-dblclick-ignore="true">
                  {worktreeContent()}
                </div>
              }
            >
              <button
                type="button"
                class="gwg-worktree"
                data-ui="goal-worktree-open"
                title={props.goal.workspaceDir}
                aria-label={`${t("cwd.open")}: ${props.goal.workspaceDir ?? ""}`}
                onClick={() => void openDirectory(props.goal.workspaceDir!)}
                data-card-dblclick-ignore="true"
              >
                {worktreeContent()}
              </button>
            </Show>
          </Show>
        </div>
      </Show>
    </div>
  )
}

/** Render a list of GoalWorkflowGroups */
export function GoalWorkflowList(props: {
  goals: GoalWorkflow[]
  onEditGoal?: (goalID: string, title: string, detail: string) => void
  onDeleteGoal?: (goalID: string) => void
}) {
  return (
    <div class="gwg-list">
      <For each={props.goals}>
        {(goal) => <GoalWorkflowGroup goal={goal} onEditGoal={props.onEditGoal} onDeleteGoal={props.onDeleteGoal} />}
      </For>
    </div>
  )
}
