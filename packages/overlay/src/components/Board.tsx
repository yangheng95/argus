// ── Board Panel Components ──
// Solid.js components that mirror the board rendering logic
// renderBoard, renderSpec, renderPlan, renderGoals, renderCriteria,
// renderEvaluation, renderBudget, renderDeliverySection, renderTaskActions,
// renderInteractions, statusIcon, statusLabel.
// Data is read from boardStore (store/board.ts); no direct DOM manipulation.

import { createMemo, For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { boardStore } from "../store/board";
import { messageStore, agentCards, agentCardOrder } from "../store/messages";
import { t, tc } from "../utils/i18n";
import { renderMarkdown } from "../utils/markdown";
import { stamp } from "../utils/time";
import { TextPart } from "./TextPart";
import { WorkflowProgressBar } from "./WorkflowProgressBar";
import { GoalWorkflowList } from "./GoalWorkflowGroup";
import { RequirementsPanel } from "./RequirementsPanel";
import { ArchitectPanel } from "./ArchitectPanel";
import { EvaluationCriteriaPanel } from "./EvaluationCriteriaPanel";

// ── Types ──

interface Interaction {
  id: string;
  type: "permission" | "question" | string;
  status: string;
  title: string;
  body: string;
}

// ── Status utilities ──

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    idle: t("task.status.idle"),
    queued: t("task.status.queued"),
    active: t("task.status.active"),
    completed: t("task.status.completed"),
    failed: t("task.status.failed"),
    cancelled: t("task.status.cancelled"),
  };
  return map[status] || status;
}

export function statusIcon(status: string): string {
  const activeIcon = `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-fill="true" d="M6 4.6L11.3 8 6 11.4Z"/></svg>`;
  const map: Record<string, string> = {
    idle: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><circle data-fill="true" cx="8" cy="8" r="1.25"/></svg>`,
    queued: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M8 5.4v2.8l2.1 1.3"/></svg>`,
    active: activeIcon,
    completed: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.1 8.2l2 2 3.8-3.8"/></svg>`,
    failed: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.4 5.4l5.2 5.2"/><path data-stroke="true" d="M10.6 5.4l-5.2 5.2"/></svg>`,
    cancelled: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M5.2 10.8l5.6-5.6"/></svg>`,
  };
  return map[status] || map.idle;
}

// ── StatusBadge ──
// General-purpose status badge with an icon + label.

interface StatusBadgeProps {
  status: string;
  class?: string;
}

export function StatusBadge(props: StatusBadgeProps) {
  return (
    <span class={`status-badge ${props.class || ""}`} data-status={props.status}>
      <span class="status-dot" innerHTML={statusIcon(props.status)} />
      <span class="status-label">{statusLabel(props.status)}</span>
    </span>
  );
}

// ── DeliveryPanel ──

function deliveryStatusLabel(status: string): string {
  if (status === "delivered") return t("delivery.status.delivered");
  if (status === "publishing") return t("delivery.status.publishing");
  if (status === "failed") return t("delivery.status.failed");
  return t("delivery.status.candidate");
}

interface DeliveryPanelProps {
  delivery: any;
}

export function DeliveryPanel(props: DeliveryPanelProps) {
  return (
    <Show
      when={props.delivery}
      fallback={<p class="empty-hint">{t("empty.delivery")}</p>}
    >
      <div class="delivery-card">
        <div class="delivery-title">{deliveryStatusLabel(props.delivery?.status)}</div>
        <div
          class="delivery-summary md-content"
          innerHTML={renderMarkdown(
            props.delivery?.summary || props.delivery?.result?.summary || "",
          )}
        />
        <Show
          when={
            props.delivery?.result?.changedFiles?.length > 0
          }
        >
          <div class="delivery-files">
            {tc("delivery.files_changed", props.delivery.result.changedFiles.length, {
              count: props.delivery.result.changedFiles.length,
            })}
          </div>
        </Show>
      </div>
    </Show>
  );
}

// ── TaskActionsPanel ──

interface TaskActionsPanelProps {
  overview: any;
  onRetry?: () => void;
  onReplan?: () => void;
  onCancel?: () => void;
}

export function TaskActionsPanel(props: TaskActionsPanelProps) {
  const controls = createMemo(() => props.overview?.controls || {});
  const hasButtons = createMemo(
    () => controls().canRetry || controls().canReplan,
  );
  const visible = createMemo(() => hasButtons());

  return (
    <Show when={visible()}>
      <div class="task-actions-bar">
        <Show when={hasButtons()}>
          <div class="task-actions-buttons">
            <Show when={controls().canRetry}>
              <button
                type="button"
                class="btn btn-primary"
                data-task-action="retry"
                title={t("task.action.retry_title")}
                aria-label={t("task.action.retry_title")}
                onClick={() => props.onRetry?.()}
              >
                {t("task.action.retry")}
              </button>
            </Show>
            <Show when={controls().canReplan}>
              <button
                type="button"
                class="btn btn-ghost"
                data-task-action="replan"
                title={t("task.action.replan_title")}
                aria-label={t("task.action.replan_title")}
                onClick={() => props.onReplan?.()}
              >
                {t("task.action.replan")}
              </button>
            </Show>
          </div>
        </Show>
      </div>
    </Show>
  );
}

// ── InteractionsList ──
// Shows pending interactions as alert cards.

interface InteractionAlertProps {
  interaction: Interaction;
  onResolve?: (id: string, action: string) => void;
  onReject?: (id: string) => void;
}

function InteractionAlert(props: InteractionAlertProps) {
  const iconGlyph = () => props.interaction.type === "permission" ? "\uD83D\uDD12" : "\u2753";
  const iconLabel = () => props.interaction.type === "permission"
    ? t("interaction.icon.permission")
    : t("interaction.icon.question");

  return (
    <div class="interaction-alert" data-id={props.interaction.id}>
      <div class="interaction-title">
        <span role="img" aria-label={iconLabel()}>{iconGlyph()}</span> {props.interaction.title}
      </div>
      <div
        class="interaction-body md-content"
        innerHTML={renderMarkdown(props.interaction.body || "")}
      />
      <div class="interaction-actions">
        <Show
          when={props.interaction.type === "permission"}
          fallback={
            <>
              <button
                class="btn btn-primary"
                data-action="answer"
                title={t("interaction.answer_title")}
                aria-label={t("interaction.answer_title")}
                onClick={() => props.onResolve?.(props.interaction.id, "answer")}
              >
                {t("interaction.answer")}
              </button>
              <button
                class="btn btn-ghost"
                data-action="reject"
                title={t("interaction.skip_title")}
                aria-label={t("interaction.skip_title")}
                onClick={() => props.onReject?.(props.interaction.id)}
              >
                {t("interaction.skip")}
              </button>
            </>
          }
        >
          <button
            class="btn btn-primary"
            data-action="always"
            title={t("interaction.always_allow_title")}
            aria-label={t("interaction.always_allow_title")}
            onClick={() => props.onResolve?.(props.interaction.id, "always")}
          >
            {t("interaction.always_allow")}
          </button>
          <button
            class="btn btn-ghost"
            data-action="once"
            title={t("interaction.allow_once_title")}
            aria-label={t("interaction.allow_once_title")}
            onClick={() => props.onResolve?.(props.interaction.id, "once")}
          >
            {t("interaction.allow_once")}
          </button>
          <button
            class="btn btn-ghost"
            data-action="reject"
            title={t("interaction.reject_title")}
            aria-label={t("interaction.reject_title")}
            onClick={() => props.onReject?.(props.interaction.id)}
          >
            {t("interaction.reject")}
          </button>
        </Show>
      </div>
    </div>
  );
}

interface InteractionsListProps {
  interactions: Interaction[];
  onResolve?: (id: string, action: string) => void;
  onReject?: (id: string) => void;
}

export function InteractionsList(props: InteractionsListProps) {
  const pending = createMemo(() =>
    (props.interactions || []).filter((item) => item.status === "pending"),
  );

  return (
    <Show when={pending().length > 0}>
      <div class="interactions-list">
        <For each={pending()}>
          {(interaction) => (
            <InteractionAlert
              interaction={interaction}
              onResolve={props.onResolve}
              onReject={props.onReject}
            />
          )}
        </For>
      </div>
    </Show>
  );
}

// ── Board (top-level) ──
// Main board panel that orchestrates all sub-panels.
// Reads from boardStore; action callbacks are passed via props so that
// the parent (or ) can wire up the actual API calls.

interface BoardProps {
  onRetry?: () => void;
  onReplan?: () => void;
  onCancel?: () => void;
  onEditGoal?: (id: string, title: string, detail: string) => void;
  onDeleteGoal?: (id: string) => void;
  onOpenSession?: (sessionID: string, goalTitle: string) => void;
  onResolveInteraction?: (id: string, action: string) => void;
  onRejectInteraction?: (id: string) => void;
}

interface SectionFrameProps {
  id: string;
  title: string;
  bodyId: string;
  icon?: string;
  badgeId?: string;
  badgeText?: string;
  badgeTone?: string;
  children: any;
}

// 16x16 SVG icons for section headers — all use currentColor so they
// inherit the section-icon color (soft text / accent when open).
const SECTION_ICONS: Record<string, string> = {
  overview: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="9" y="2.5" width="4.5" height="4.5" rx="1"/><rect x="2.5" y="9" width="4.5" height="4.5" rx="1"/><rect x="9" y="9" width="4.5" height="4.5" rx="1"/></svg>`,
  spec: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9.5 2H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.5L9.5 2Z"/><polyline points="9.5,2 9.5,4.5 12,4.5"/><line x1="6" y1="7" x2="10" y2="7"/><line x1="6" y1="9.5" x2="10" y2="9.5"/></svg>`,
  plan: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><line x1="6" y1="4" x2="13" y2="4"/><line x1="6" y1="8" x2="13" y2="8"/><line x1="6" y1="12" x2="13" y2="12"/><circle cx="3.5" cy="4" r="0.8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="8" r="0.8" fill="currentColor" stroke="none"/><circle cx="3.5" cy="12" r="0.8" fill="currentColor" stroke="none"/></svg>`,
  goals: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><circle cx="8" cy="8" r="5.5"/><circle cx="8" cy="8" r="3"/><circle cx="8" cy="8" r="0.8" fill="currentColor" stroke="none"/></svg>`,
  executor: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M6 4.6L11.3 8 6 11.4Z"/></svg>`,
  criteria: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="2" width="10" height="12" rx="1.2"/><path d="M6 6l1.2 1.2L9.5 5"/><line x1="6" y1="9.5" x2="10" y2="9.5"/><line x1="6" y1="11.5" x2="9" y2="11.5"/></svg>`,
  delivery: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 5.5L8 2.5l5.5 3v5L8 13.5l-5.5-3Z"/><polyline points="2.5,5.5 8,8.5 13.5,5.5"/><line x1="8" y1="8.5" x2="8" y2="13.5"/></svg>`,
  files: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"><path d="M9 2H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V5L9 2Z"/><polyline points="9,2 9,5 12,5"/></svg>`,
};

function SectionFrame(props: SectionFrameProps) {
  return (
    <details class="section" id={props.id}>
      <summary class="section-head">
        <span
          class="section-icon"
          aria-hidden="true"
          innerHTML={props.icon || ""}
        />
        <span class="section-title">{props.title}</span>
        <span
          class="section-badge"
          id={props.badgeId}
          data-tone={props.badgeTone}
        >
          {props.badgeText || ""}
        </span>
      </summary>
      <div class="section-body" id={props.bodyId}>
        {props.children}
      </div>
    </details>
  );
}

export function Board(props: BoardProps) {
  const board = () => boardStore.board;

  const task = () => board()?.task;
  const plan = () => board()?.plan;
  const spec = () => board()?.spec;
  const delivery = () => board()?.delivery;
  const interactions = () => board()?.interactions || [];
  const overview = () => board()?.overview;
  // Task-level evaluation criteria rollup. Backend aggregates per-goal
  // evaluator outcomes, delivery agent verifications, and external quality
  // gates (PATCH /task/:id/criteria — visual-diff etc.) into one list.
  const criteriaResults = () => board()?.criteriaResults as
    | Array<{ name: string; label?: string; family?: string; status: "passed" | "failed" | "skipped"; evidence?: string }>
    | undefined;

  const goalsCards = createMemo(() => {
    const gws: any[] = board()?.goalWorkflows || [];
    return gws.map((gw) => ({
      id: gw.goalID,
      title: gw.goalTitle,
      status: gw.goalStatus,
    }));
  });

  const runningGoalIDs = createMemo(() => {
    const goalRuns: any[] = board()?.goalRuns || [];
    return new Set<string>(
      goalRuns
        .filter((gr) => gr.status === "running" || gr.status === "accepted")
        .map((gr) => gr.goalID)
        .filter(Boolean),
    );
  });

  // executorCards / executorBadge* / showExecutor removed in M2c:
  // per-goal executor info is now rendered inside GoalWorkflowGroup.StepRow
  // (execute step) using backend-driven payload (changedFiles + diffStats).
  // ExecutorSummaryPanel deleted.

  // ── Workflow-structured data (new) ──
  const workflow = () => board()?.workflow;
  const requirements = () => board()?.requirements;
  const architect = () => board()?.architect;
  const goalWorkflows = () => board()?.goalWorkflows || [];

  // Derive streaming state from workflow step statuses
  const isRequirementsGenerating = createMemo(() => {
    const wf = workflow();
    if (!wf) return false;
    const reqStep = wf.steps.find((s: any) => s.id === "requirements");
    return reqStep?.status === "running";
  });
  const isArchitectGenerating = createMemo(() => {
    const wf = workflow();
    if (!wf) return false;
    const archStep = wf.steps.find((s: any) => s.id === "architect");
    return archStep?.status === "running";
  });

  // Collect agent messages for requirements stage (spec/goal stages map to requirements).
  // Data-driven: emit whenever spec/goal cards exist, independent of workflow mode.
  const requirementsMessages = createMemo(() => {
    const cards = agentCards();
    const order = agentCardOrder();
    const msgs: any[] = [];
    for (const cardID of order) {
      const card = cards[cardID];
      if (!card) continue;
      const stage: string = card.stage || "";
      if (stage === "spec" || stage === "goal") {
        const m = Array.isArray((card as any).messages) ? (card as any).messages : [];
        msgs.push(...m);
      }
    }
    return msgs;
  });

  // Bridge: map agent card messages to workflow goal steps.
  // Agent stages → workflow step IDs:
  //   planner → plan, executor → execute, evaluator → eval
  const STAGE_TO_STEP: Record<string, string> = {
    planner: "plan",
    executor: "execute",
    evaluator: "eval",
  };

  const goalStepMessages = createMemo(() => {
    const cards = agentCards();
    const order = agentCardOrder();
    const result: Record<string, Record<string, any[]>> = {};

    for (const cardID of order) {
      const card = cards[cardID];
      if (!card) continue;
      const stage: string = card.stage || "";
      const stepID = STAGE_TO_STEP[stage];
      if (!stepID) continue;

      // goalID only exists on kind="goal" cards; stage cards (kind="agent")
      // never carry it. This branch was dead by construction in the legacy
      // schema and remains so under the typed AgentCardData union.
      const goalID = card.kind === "goal" ? card.goalID : undefined;
      if (!goalID) continue;

      if (!result[goalID]) result[goalID] = {};
      if (!result[goalID][stepID]) result[goalID][stepID] = [];
      const msgs = Array.isArray((card as any).messages) ? (card as any).messages : [];
      result[goalID][stepID].push(...msgs);
    }
    return result;
  });

  // ── Data-driven visibility signals ──
  // Each section appears when its data exists, independent of mode.
  const showWorkflowProgress = createMemo(() => !!workflow());
  const showRequirements = createMemo(() =>
    !!requirements() || !!spec() || isRequirementsGenerating() || requirementsMessages().length > 0,
  );
  const showArchitect = createMemo(() => !!architect() || isArchitectGenerating());
  const showGoals = createMemo(() => goalWorkflows().length > 0 || goalsCards().length > 0);
  const showDelivery = createMemo(() => !!delivery());
  const showInteractions = createMemo(() =>
    interactions().some((i: any) => i.status === "pending"),
  );

  return (
    <>
      <div id="taskActionsBar">
        <TaskActionsPanel
          overview={overview()}
          onRetry={props.onRetry}
          onReplan={props.onReplan}
          onCancel={props.onCancel}
        />
      </div>

      {/* ── Data-driven unified layout ── */}
      {/* Sections appear based on their data availability, not a mode flag. */}
      {/* Matches Task Agent's adaptive pipeline (per specs/new-arch.svg). */}

      <Show when={showWorkflowProgress()}>
        <WorkflowProgressBar workflow={workflow()} />
      </Show>

      <Show when={showRequirements()}>
        <SectionFrame
          id="requirementsSection"
          title={t("workflow.requirements")}
          icon={SECTION_ICONS.spec}
          bodyId="requirementsBody"
          badgeId="requirementsBadge"
          badgeText={
            requirements()?.length
              ? String(requirements()!.length)
              : isRequirementsGenerating()
                ? t("common.active")
                : ""
          }
          badgeTone={requirements()?.length || isRequirementsGenerating() ? "accent" : ""}
        >
          <RequirementsPanel
            requirements={requirements()}
            specContent={spec()?.content}
            isGenerating={isRequirementsGenerating()}
            streamingMessages={requirementsMessages()}
          />
        </SectionFrame>
      </Show>

      <Show when={showArchitect()}>
        <SectionFrame
          id="architectSection"
          title={t("workflow.architect")}
          icon={SECTION_ICONS.plan}
          bodyId="architectBody"
          badgeId="architectBadge"
          badgeText={architect() ? String(architect()!.contractCount) : ""}
          badgeTone={architect() ? "accent" : ""}
        >
          <ArchitectPanel architect={architect()} isGenerating={isArchitectGenerating()} />
        </SectionFrame>
      </Show>

      <Show when={showGoals()}>
        <SectionFrame
          id="goalWorkflowsSection"
          title={t("workflow.goals")}
          icon={SECTION_ICONS.goals}
          bodyId="goalWorkflowsBody"
          badgeId="goalWorkflowsBadge"
          badgeText={(() => {
            const gw = goalWorkflows();
            const passed = gw.filter((g) => g.goalStatus === "passed").length;
            return gw.length > 0 ? `${passed}/${gw.length}` : "";
          })()}
          badgeTone={(() => {
            const gw = goalWorkflows();
            if (gw.length === 0) return "";
            const passed = gw.filter((g) => g.goalStatus === "passed").length;
            return passed === gw.length
              ? "good"
              : gw.some((g) => g.goalStatus === "failed")
                ? "bad"
                : "accent";
          })()}
        >
          <GoalWorkflowList
            goals={goalWorkflows()}
            goalStepMessages={goalStepMessages()}
            onOpenSession={props.onOpenSession}
            onEditGoal={props.onEditGoal}
            onDeleteGoal={props.onDeleteGoal}
          />
        </SectionFrame>
      </Show>

      <Show when={(criteriaResults()?.length ?? 0) > 0}>
        <SectionFrame
          id="evaluationCriteriaSection"
          title={t("section.criteria") || "评估指标"}
          icon={SECTION_ICONS.criteria}
          bodyId="evaluationCriteriaBody"
          badgeId="evaluationCriteriaBadge"
          badgeText={(() => {
            const list = criteriaResults() ?? [];
            const failed = list.filter((c) => c.status === "failed").length;
            const passed = list.filter((c) => c.status === "passed").length;
            return failed > 0 ? `${failed} failed` : `${passed}/${list.length}`;
          })()}
          badgeTone={(() => {
            const list = criteriaResults() ?? [];
            const failed = list.filter((c) => c.status === "failed").length;
            const passed = list.filter((c) => c.status === "passed").length;
            return failed > 0 ? "bad" : passed === list.length ? "good" : "accent";
          })()}
        >
          <EvaluationCriteriaPanel checks={criteriaResults() ?? []} />
        </SectionFrame>
      </Show>

      <Show when={showDelivery()}>
        <SectionFrame
          id="deliverySection"
          title={t("section.delivery")}
          icon={SECTION_ICONS.delivery}
          bodyId="deliveryBody"
          badgeId="deliveryBadge"
          badgeText={delivery() ? deliveryStatusLabel(delivery()?.status) : ""}
          badgeTone={
            delivery()?.status === "delivered"
              ? "good"
              : delivery()?.status === "failed"
                ? "bad"
                : delivery()
                  ? "accent"
                  : ""
          }
        >
          <DeliveryPanel delivery={delivery()} />
        </SectionFrame>
      </Show>

      <Show when={showInteractions()}>
        <SectionFrame
          id="interactionsSection"
          title={t("workflow.interactions")}
          icon={SECTION_ICONS.criteria}
          bodyId="interactionsBody"
          badgeId="interactionsBadge"
          badgeText={String(interactions().filter((i: any) => i.status === "pending").length)}
          badgeTone="warn"
        >
          <InteractionsList
            interactions={interactions()}
            onResolve={props.onResolveInteraction}
            onReject={props.onRejectInteraction}
          />
        </SectionFrame>
      </Show>
    </>
  );
}

