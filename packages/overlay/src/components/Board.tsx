// ── Board Panel Components ──
// Solid.js components that mirror the board rendering logic
// renderBoard, renderSpec, renderPlan, renderGoals, renderCriteria,
// renderEvaluation, renderBudget, renderDeliverySection, renderTaskActions,
// renderInteractions, statusIcon, statusLabel.
// Data is read from boardStore (store/board.ts); no direct DOM manipulation.

import { createMemo, For, Show, onMount } from "solid-js";
import { boardStore } from "../store/board";
import { agentCards, agentCardOrder } from "../store/messages";
import { t, tc } from "../utils/i18n";
import { renderMarkdown } from "../utils/markdown";
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
  phaseState?: "active" | "related" | "";
  /** Initial open state at mount only; user toggle is preserved afterwards. */
  defaultOpen?: boolean;
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
  let detailsEl: HTMLDetailsElement | undefined;
  onMount(() => {
    if (!detailsEl) return;
    // Apply defaultOpen once at mount; afterwards user toggle is preserved.
    if (props.defaultOpen ?? props.phaseState === "active") {
      detailsEl.open = true;
    }
  });
  return (
    <details
      ref={detailsEl}
      class="section"
      id={props.id}
      attr:data-phase-state={props.phaseState || undefined}
    >
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

  const spec = () => board()?.spec;
  const delivery = () => board()?.delivery;
  const interactions = () => board()?.interactions || [];
  const overview = () => board()?.overview;
  // Task-level criteria rollup. Backend (workbench/board.ts) folds the
  // delivery-agent verdict (deferred_checks + rejection_details + overall
  // verdict) and the in-process visual-diff gate into one list per task.
  // Hidden entirely for kind=build tasks since build self-verifies and does
  // not produce delivery-stage criteria.
  const criteriaResults = () => board()?.criteriaResults as
    | Array<{ name: string; label?: string; family?: string; status: "passed" | "failed" | "skipped"; evidence?: string }>
    | undefined;
  const taskKind = () => (board()?.task as { kind?: string } | undefined)?.kind;

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

  // ── Active section tracking ──
  // Map the workflow's current (running) step to a right-pane section id so
  // the section gets `data-phase-state="active"` highlighting. Falls back to
  // the most recently completed/failed step when nothing is running.
  const STEP_TO_SECTION: Record<string, string> = {
    design_analysis: "requirements",
    requirements: "requirements",
    architect: "architect",
    plan: "goalWorkflows",
    execute: "goalWorkflows",
    eval: "goalWorkflows",
    deliver: "delivery",
    refine: "delivery",
  };
  const activeSection = createMemo<string>(() => {
    const interactionsPending = interactions().some(
      (i: any) => i.status === "pending",
    );
    if (interactionsPending) return "interactions";
    const wf = workflow();
    if (!wf || !Array.isArray(wf.steps)) return "";
    const running = wf.steps.find((s: any) => s.status === "running");
    if (running) return STEP_TO_SECTION[running.id] ?? "";
    let lastDone: any = null;
    for (const s of wf.steps) {
      if (s.status === "completed" || s.status === "failed") lastDone = s;
    }
    if (lastDone) return STEP_TO_SECTION[lastDone.id] ?? "";
    return "";
  });
  const phaseFor = (id: string): "active" | "" =>
    activeSection() === id ? "active" : "";

  // Goal-derived step status. The board always has goals once a task has
  // been planned; downstream section badges must render progress as
  // "done/total goals" so the panel is never blank when execution artifacts
  // (delivery rows, evaluation rows) haven't been produced yet.
  const stepStatus = (g: any, id: string): string =>
    g?.steps?.find((s: any) => s.stepID === id)?.status ?? "pending";
  const stepDone = (g: any, id: string): boolean =>
    stepStatus(g, id) === "completed";

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
    build: "execute",
    evaluator: "eval",
  };

  const goalStepMessages = createMemo(() => {
    const cards = agentCards();
    const order = agentCardOrder();
    const result: Record<string, Record<string, any[]>> = {};

    // Walk the nested session tree under each goal so a stage like "build"
    // (child of executor) still lands in the matching step bucket via
    // STAGE_TO_STEP. Recursion is required because internalCards is no
    // longer flat — sub-agents nest under their parent session's card.
    const collect = (node: any, bucket: Record<string, any[]>) => {
      if (!node || node.kind !== "agent") return;
      const stepID = STAGE_TO_STEP[node.stage];
      if (stepID) {
        (bucket[stepID] ??= []).push(...(node.messages || []));
      }
      for (const child of node.children || []) collect(child, bucket);
    };

    for (const cardID of order) {
      const card = cards[cardID];
      if (!card || card.kind !== "goal") continue;
      const bucket = (result[card.goalID] ??= {});
      for (const inner of card.internalCards || []) collect(inner, bucket);
    }
    return result;
  });

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

      <WorkflowProgressBar workflow={workflow()} />

      <SectionFrame
        id="requirementsSection"
        title={t("workflow.requirements")}
        icon={SECTION_ICONS.spec}
        bodyId="requirementsBody"
        badgeId="requirementsBadge"
        phaseState={phaseFor("requirements")}
        badgeText={(() => {
          const rs = requirements() ?? [];
          if (rs.length > 0) {
            const passed = rs.filter((r: any) => r.status === "passed").length;
            return `${passed}/${rs.length}`;
          }
          if (isRequirementsGenerating()) return t("common.active");
          return goalWorkflows().length > 0 ? "—" : "";
        })()}
        badgeTone={(() => {
          const rs = requirements() ?? [];
          if (rs.length === 0) return isRequirementsGenerating() ? "accent" : "";
          const passed = rs.filter((r: any) => r.status === "passed").length;
          const failed = rs.filter((r: any) => r.status === "failed").length;
          return failed > 0 ? "bad" : passed === rs.length ? "good" : "accent";
        })()}
      >
        <RequirementsPanel
          requirements={requirements()}
          specContent={spec()?.content}
          isGenerating={isRequirementsGenerating()}
          streamingMessages={requirementsMessages()}
        />
      </SectionFrame>

      <SectionFrame
        id="architectSection"
        title={t("workflow.architect")}
        icon={SECTION_ICONS.plan}
        bodyId="architectBody"
        badgeId="architectBadge"
        phaseState={phaseFor("architect")}
        badgeText={(() => {
          const gs = goalWorkflows();
          if (gs.length === 0) {
            return architect() ? String(architect()!.contractCount) : "";
          }
          const bound = gs.filter((g: any) => (g.contracts?.length ?? 0) > 0).length;
          return `${bound}/${gs.length}`;
        })()}
        badgeTone={(() => {
          const gs = goalWorkflows();
          if (gs.length === 0) return architect() ? "accent" : "";
          const bound = gs.filter((g: any) => (g.contracts?.length ?? 0) > 0).length;
          return bound === gs.length ? "good" : bound > 0 ? "accent" : "";
        })()}
      >
        <ArchitectPanel architect={architect()} isGenerating={isArchitectGenerating()} />
      </SectionFrame>

      <SectionFrame
        id="goalWorkflowsSection"
        title={t("workflow.goals")}
        icon={SECTION_ICONS.goals}
        bodyId="goalWorkflowsBody"
        badgeId="goalWorkflowsBadge"
        phaseState={phaseFor("goalWorkflows")}
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
          onEditGoal={props.onEditGoal}
          onDeleteGoal={props.onDeleteGoal}
        />
      </SectionFrame>

      <Show when={taskKind() !== "build"}>
        <SectionFrame
          id="evaluationCriteriaSection"
          title={t("section.criteria") || "评估指标"}
          icon={SECTION_ICONS.criteria}
          bodyId="evaluationCriteriaBody"
          badgeId="evaluationCriteriaBadge"
          badgeText={(() => {
            // badge MUST read the same source as the body (criteriaResults)
            // — falling back to goalWorkflows when criteria is empty made
            // the badge claim "0/1" while the body showed nothing, which
            // is a pure fallback (CLAUDE.md 1) that lied to operators.
            const list = criteriaResults() ?? [];
            if (list.length === 0) return "";
            const failed = list.filter((c) => c.status === "failed").length;
            const passed = list.filter((c) => c.status === "passed").length;
            return failed > 0 ? `${failed} failed` : `${passed}/${list.length}`;
          })()}
          badgeTone={(() => {
            const list = criteriaResults() ?? [];
            if (list.length === 0) return "";
            const failed = list.filter((c) => c.status === "failed").length;
            const passed = list.filter((c) => c.status === "passed").length;
            return failed > 0 ? "bad" : passed === list.length ? "good" : "accent";
          })()}
        >
          <EvaluationCriteriaPanel checks={criteriaResults() ?? []} />
        </SectionFrame>
      </Show>

      <SectionFrame
        id="deliverySection"
        title={t("section.delivery")}
        icon={SECTION_ICONS.delivery}
        bodyId="deliveryBody"
        badgeId="deliveryBadge"
        phaseState={phaseFor("delivery")}
        badgeText={(() => {
          const gs = goalWorkflows();
          if (gs.length === 0) {
            return delivery() ? deliveryStatusLabel(delivery()?.status) : "";
          }
          const delivered = gs.filter(
            (g: any) => stepDone(g, "execute") || g.goalStatus === "passed",
          ).length;
          return `${delivered}/${gs.length}`;
        })()}
        badgeTone={(() => {
          const gs = goalWorkflows();
          if (gs.length === 0) {
            return delivery()?.status === "delivered"
              ? "good"
              : delivery()?.status === "failed"
                ? "bad"
                : delivery()
                  ? "accent"
                  : "";
          }
          const failed = gs.filter((g: any) => stepStatus(g, "execute") === "failed").length;
          const delivered = gs.filter(
            (g: any) => stepDone(g, "execute") || g.goalStatus === "passed",
          ).length;
          return failed > 0 ? "bad" : delivered === gs.length ? "good" : delivered > 0 ? "accent" : "";
        })()}
      >
        <DeliveryPanel delivery={delivery()} />
      </SectionFrame>

      <SectionFrame
        id="interactionsSection"
        title={t("workflow.interactions")}
        icon={SECTION_ICONS.criteria}
        bodyId="interactionsBody"
        badgeId="interactionsBadge"
        phaseState={phaseFor("interactions")}
        badgeText={(() => {
          const n = interactions().filter((i: any) => i.status === "pending").length;
          return n > 0 ? String(n) : "";
        })()}
        badgeTone="warn"
      >
        <InteractionsList
          interactions={interactions()}
          onResolve={props.onResolveInteraction}
          onReject={props.onRejectInteraction}
        />
      </SectionFrame>
    </>
  );
}

