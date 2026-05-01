// ── Board Panel Components ──
// Solid.js components that mirror the board rendering logic
// renderBoard, renderSpec, renderPlan, renderGoals, renderCriteria,
// renderEvaluation, renderBudget, renderDeliverySection, renderTaskActions,
// renderInteractions, statusIcon, statusLabel.
// Data is read from boardStore (store/board.ts); no direct DOM manipulation.

import { createEffect, createMemo, createSignal, For, Show, onMount } from "solid-js";
import { boardStore } from "../store/board";
import { cardTreeStore, type CardNode } from "../store/card-tree";
import { t, tc } from "../utils/i18n";
import { renderMarkdown } from "../utils/markdown";
import { deliveryGoalProgress } from "../utils/goal-workflow";
import { GoalWorkflowList } from "./GoalWorkflowGroup";
import { RequirementsPanel } from "./RequirementsPanel";
import { ArchitectPanel } from "./ArchitectPanel";
import { EvaluationCriteriaPanel } from "./EvaluationCriteriaPanel";
import { InteractionCardList, type InteractionData } from "./InteractionCard";
import { BoardIntro } from "./BoardIntro";
import { taskScopeSectionVisibility } from "../utils/task-scope-sections";

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
//
// Surfaces every delivery activity reaching the board: deterministic gate
// (build/test/lint/typecheck), runtime flows (preview / SSE / golden-path),
// and per-reviewer specialist reviews — split into three collapsible groups
// because they have categorically different remediation paths (compile-time
// vs. running-server vs. LLM judgement). The panel's left-edge accent comes
// from `verdictTone` so verdict — not lifecycle status — drives the visual.
// CCE = canonical click-through event; emits `delivery:focus-changes` on the
// `window` so ChangesPanel can scope its tab without prop drilling.
//
// Visual primitive `.verdict-pill` is shared with IntegrityCard.

type DeliveryEvidenceKind = "check" | "runtime" | "review";

interface DeliveryEvidenceRow {
  id: string;
  label: string;
  status: string;
  goalRunID?: string;
}

type VerdictTone = "accepted" | "rejected" | "inflight" | "empty";

function deriveVerdictTone(delivery: any): VerdictTone {
  if (!delivery) return "empty";
  if (delivery.verdict === "accepted") return "accepted";
  if (delivery.verdict === "rejected") return "rejected";
  return "inflight";
}

function verdictPillLabel(tone: VerdictTone): string {
  return t(`delivery.verdict.${tone}`);
}

function deliveryEvidenceGroup(
  delivery: any,
  kind: DeliveryEvidenceKind,
): DeliveryEvidenceRow[] {
  const manifest = delivery?.evidenceManifest;
  if (!manifest) return [];
  const source: any[] | undefined =
    kind === "check"
      ? manifest.checkResults
      : kind === "runtime"
        ? manifest.runtimeFlows
        : manifest.reviewEvidence;
  if (!Array.isArray(source)) return [];
  // No `.slice(0, N)` cap — the operator must see every failed row, not the
  // first 12. Per-group volume is naturally bounded by the manifest schema
  // (≤ a few dozen each in practice); a runaway list signals a real bug
  // upstream, not a UX problem to paper over.
  return source.map((item, idx) => ({
    id: String(item?.id || item?.name || `${kind}-${idx}`),
    label: String(item?.label || item?.name || item?.reviewer || item?.id || kind),
    status: String(item?.status || "unknown"),
    goalRunID:
      typeof item?.goalRunID === "string"
        ? item.goalRunID
        : typeof item?.goalRunId === "string"
          ? item.goalRunId
          : undefined,
  }));
}

function groupSummary(rows: DeliveryEvidenceRow[]): {
  total: number;
  failed: number;
  defaultOpen: boolean;
} {
  const total = rows.length;
  const failed = rows.filter((row) =>
    row.status === "failed" || row.status === "needs_correction" || row.status === "concerns",
  ).length;
  return { total, failed, defaultOpen: failed > 0 };
}

function rowVerdict(status: string): string {
  if (status === "passed" || status === "pass") return "accepted";
  if (status === "failed" || status === "needs_correction" || status === "concerns") return "rejected";
  return "inflight";
}

function focusChangesPanel(goalRunID: string | undefined) {
  // CCE — canonical click-through event. ChangesPanel listens and calls
  // setSelectedGroupID(goalRunID) so the right tab opens. No prop drilling.
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent("delivery:focus-changes", { detail: { goalRunID } }),
  );
}

interface DeliveryEvidenceGroupProps {
  label: string;
  kind: DeliveryEvidenceKind;
  rows: DeliveryEvidenceRow[];
}

export function DeliveryEvidenceGroup(props: DeliveryEvidenceGroupProps) {
  return (
    <Show when={props.rows.length > 0}>
      {(() => {
        const summary = groupSummary(props.rows);
        return (
          <details
            class="delivery-evidence-group"
            data-kind={props.kind}
            open={summary.defaultOpen}
          >
            <summary class="delivery-evidence-group-head">
              <span class="delivery-evidence-group-label">{props.label}</span>
              <span class="delivery-evidence-group-count">
                {summary.failed > 0
                  ? tc("delivery.group_count_failing", summary.failed, {
                      failed: summary.failed,
                      total: summary.total,
                    })
                  : tc("delivery.group_count_all_pass", summary.total, {
                      total: summary.total,
                    })}
              </span>
            </summary>
            <ul class="delivery-evidence-list">
              <For each={props.rows}>
                {(row) => (
                  <li class="delivery-evidence-row" data-status={row.status}>
                    <Show when={row.goalRunID}>
                      <button
                        class="delivery-evidence-goal-pill"
                        type="button"
                        title={t("delivery.row_goal_pill_title")}
                        onClick={() => focusChangesPanel(row.goalRunID)}
                      >
                        {row.goalRunID ? row.goalRunID.slice(-6) : ""}
                      </button>
                    </Show>
                    <span class="delivery-evidence-name">{row.label}</span>
                    <span class="verdict-pill" data-verdict={rowVerdict(row.status)}>
                      {row.status}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </details>
        );
      })()}
    </Show>
  );
}

interface DeliveryPanelProps {
  delivery: any;
}

const DEFAULT_SUMMARY_LINES = 10;

export function DeliveryPanel(props: DeliveryPanelProps) {
  const [summaryExpanded, setSummaryExpanded] = createSignal(false);

  const tone = createMemo<VerdictTone>(() => deriveVerdictTone(props.delivery));
  const summaryText = createMemo(() => {
    const d = props.delivery;
    if (!d) return "";
    return d.verdict === "rejected"
      ? d.verdictSummary || d.summary || d.result?.summary || ""
      : d.summary || d.result?.summary || "";
  });
  const summaryNeedsClamp = createMemo(
    () => summaryText().split("\n").length > DEFAULT_SUMMARY_LINES,
  );
  const checks = createMemo(() => deliveryEvidenceGroup(props.delivery, "check"));
  const runtime = createMemo(() => deliveryEvidenceGroup(props.delivery, "runtime"));
  const reviews = createMemo(() => deliveryEvidenceGroup(props.delivery, "review"));
  const filesChanged = createMemo(
    () => (props.delivery?.result?.changedFiles?.length as number | undefined) ?? 0,
  );
  const iteration = createMemo<number>(
    () => Number(props.delivery?.evidenceManifest?.iteration ?? 0),
  );

  return (
    <Show
      when={props.delivery}
      fallback={
        <section class="delivery-panel" data-verdict="empty">
          <header class="delivery-panel-header">
            <span class="verdict-pill" data-verdict="empty">
              {verdictPillLabel("empty")}
            </span>
          </header>
          <p class="delivery-empty-hint">{t("delivery.empty.hint")}</p>
        </section>
      }
    >
      <section class="delivery-panel" data-verdict={tone()}>
        <header class="delivery-panel-header">
          <span class="verdict-pill" data-verdict={tone()}>
            {verdictPillLabel(tone())}
          </span>
          <Show when={iteration() > 0}>
            <span class="delivery-iteration">
              {t("delivery.iteration", { n: String(iteration()) })}
            </span>
          </Show>
        </header>

        <Show when={summaryText()}>
          <div
            class="delivery-summary md-content"
            data-clamped={summaryNeedsClamp() && !summaryExpanded() ? "true" : "false"}
            innerHTML={renderMarkdown(summaryText())}
          />
          <Show when={summaryNeedsClamp()}>
            <button
              class="delivery-summary-toggle"
              type="button"
              onClick={() => setSummaryExpanded((v) => !v)}
            >
              {summaryExpanded() ? t("delivery.show_less") : t("delivery.show_more")}
            </button>
          </Show>
        </Show>

        <DeliveryEvidenceGroup
          label={t("delivery.checks")}
          kind="check"
          rows={checks()}
        />
        <DeliveryEvidenceGroup
          label={t("delivery.runtime")}
          kind="runtime"
          rows={runtime()}
        />
        <DeliveryEvidenceGroup
          label={t("delivery.reviews")}
          kind="review"
          rows={reviews()}
        />

        <Show when={filesChanged() > 0}>
          <button
            class="delivery-files-link"
            type="button"
            onClick={() => focusChangesPanel(undefined)}
          >
            {tc("delivery.files_changed", filesChanged(), { count: filesChanged() })}
          </button>
        </Show>
      </section>
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
  const hasButtons = createMemo(() => controls().canRetry || controls().canReplan);

  return (
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
  );
}

// Pending-interaction rendering is delegated to the shared <InteractionCard>
// component, which is also used inline in the conversation timeline. The
// component owns its own busy / error state and dispatches replies through
// the per-id-mutex'd interaction-reply service — Board no longer needs to
// pipe callbacks down for this surface.

// ── Board (top-level) ──
// Main board panel that orchestrates all sub-panels.
// Reads from boardStore; action callbacks are passed via props so that
// the parent (or ) can wire up the actual API calls.
// Interaction reply/reject is self-contained inside <InteractionCard> and
// no longer takes parent-supplied callbacks.

interface BoardProps {
  onRetry?: () => void;
  onReplan?: () => void;
  onCancel?: () => void;
  onEditGoal?: (id: string, title: string, detail: string) => void;
  onDeleteGoal?: (id: string) => void;
}

interface SectionFrameProps {
  id: string;
  title: string;
  bodyId: string;
  icon?: string;
  badgeId?: string;
  badgeText?: string;
  badgeTone?: string;
  badgeVariant?: "status" | "metric";
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
  // First mount: open the section so the operator sees the data that just
  // became available (the section only renders when taskScopeSections marks
  // it visible — i.e. it has concrete state or data). Without this, the
  // pre-bug behaviour was "section appears collapsed after the agent already
  // ran" and operators had to click to see what the agent produced.
  onMount(() => {
    if (!detailsEl) return;
    if (props.defaultOpen ?? true) detailsEl.open = true;
  });
  // Re-open whenever the section transitions back to "active" (e.g. requirements
  // running again after a rewind, or architect being re-entered). The effect
  // never force-closes — once the user manually collapses, it stays collapsed
  // until phaseState flips away and back, matching the spirit of the original
  // "user toggle is preserved" comment.
  createEffect(() => {
    if (!detailsEl) return;
    if (props.phaseState === "active") detailsEl.open = true;
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
          data-variant={props.badgeVariant || "status"}
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
  const taskScopeSections = createMemo(() =>
    taskScopeSectionVisibility({
      workflow: workflow(),
      requirements: requirements(),
      architect: architect(),
    }),
  );

  // ── Active section tracking ──
  // Map the workflow's current (running) step to a right-pane section id so
  // the section gets `data-phase-state="active"` highlighting. Falls back to
  // the most recently completed/failed step when nothing is running.
  // Step ID → right-pane section. Pipeline workflow has exactly ONE goal-scope
  // step now: `build`.
  const STEP_TO_SECTION: Record<string, string> = {
    design_analysis: "requirements",
    requirements: "requirements",
    architect: "architect",
    build: "goalWorkflows",
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

  // Messages feeding the RequirementsPanel / GoalWorkflowList live-stream
  // surfaces. Single source of truth: `cardTreeStore.cards` — the same
  // store that powers the left conversation panel. Each agent session card
  // already carries a stage (spec / goal / requirements / planner / build
  // / executor / evaluator / ...), a goalID, and a flat `parts` array with
  // boundary markers between the messages it aggregated.
  //
  // We re-split the card's parts at boundary markers so each message segment
  // preserves per-turn reasoning ordering when `CardParts` re-renders
  // them in the panel. One card -> N message segments (N = boundary count + 1,
  // minus empty trailing groups).
  function cardToMessageSegments(card: CardNode): any[] {
    const parts = card.parts || [];
    if (parts.length === 0) return [];
    const groups: any[] = [];
    let boundary: { role?: string; time?: number } | null = null;
    let buffer: any[] = [];
    const flush = () => {
      if (buffer.length === 0) return;
      // No assistant-fallback (一个萝卜一个坑). The grouping boundary marker
      // must carry a role; if missing, the source emitter is wrong — surface
      // it instead of silently attributing the parts to the generic assistant.
      if (!boundary || typeof boundary.role !== "string" || boundary.role.length === 0) {
        throw new Error(`Board grouping: card ${card.id} parts have no role boundary; emitter must mark role transitions explicitly`);
      }
      groups.push({
        info: {
          id: `${card.id}:msg:${groups.length}`,
          role: boundary.role,
          time: { created: boundary.time ?? card.time ?? 0 },
        },
        parts: buffer,
      });
      buffer = [];
    };
    for (const part of parts) {
      if (part?.type === "boundary") {
        flush();
        boundary = part;
        continue;
      }
      buffer.push(part);
    }
    flush();
    return groups;
  }

  /** Agent cards for a given stage, in chronological order. */
  function agentCardsForStage(stage: string): CardNode[] {
    const ids = Object.keys(cardTreeStore.cards);
    const matched: CardNode[] = [];
    for (const id of ids) {
      const card = cardTreeStore.cards[id];
      if (!card || card.kind !== "agent") continue;
      if (card.stage !== stage) continue;
      matched.push(card);
    }
    return matched.sort((a, b) => (a.time ?? 0) - (b.time ?? 0));
  }

  // Requirements surface reads the actual requirements stage plus legacy
  // spec/goal cards created by older task snapshots.
  const requirementsMessages = createMemo(() => {
    const out: any[] = [];
    for (const stage of ["requirements", "spec", "goal"]) {
      for (const card of agentCardsForStage(stage)) {
        out.push(...cardToMessageSegments(card));
      }
    }
    return out;
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

      {/* Empty-state intro: when no task is selected the right panel was
          a blank box. Show a brief explainer of the two task modes
          (workflow / build) and the main agents in the pipeline so the
          operator knows what they're about to invoke. Disappears the
          moment a task is selected. */}
      <Show when={!boardStore.selectedTaskID && !board()?.task?.id}>
        <BoardIntro />
      </Show>

      {/* ── Data-driven unified layout ── */}
      {/* Sections appear based on their data availability, not a mode flag. */}

      {/* Trace surface 2026-04-26: only the per-card 🔍 button (Card.tsx)
          mounts <TracePanel sessionID={...}>. Both the right-panel and the
          conversation-level "Show all session trace" toggle were removed —
          task-trace was a slow whole-task disk read with frequent
          path-mismatch failure modes. Operators wanting cross-session
          context now use the per-session 📋 Copy button on each TracePanel
          to dump the JSON dump into a log viewer or LLM. */}

      <Show when={taskScopeSections().requirements}>
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
      </Show>

      <Show when={taskScopeSections().architect}>
        <SectionFrame
          id="architectSection"
          title={t("workflow.architect")}
          icon={SECTION_ICONS.plan}
          bodyId="architectBody"
          badgeId="architectBadge"
          phaseState={phaseFor("architect")}
          badgeText={architect() ? String(architect()!.contractCount) : ""}
          badgeTone={architect() ? "accent" : ""}
        >
          <ArchitectPanel architect={architect()} isGenerating={isArchitectGenerating()} />
        </SectionFrame>
      </Show>

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
        badgeVariant="metric"
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
          onEditGoal={props.onEditGoal}
          onDeleteGoal={props.onDeleteGoal}
        />
      </SectionFrame>

      {/* TODO(2026-04-20): 评估指标 / 交付 / interactions 三个板块同步下线待重做。
          理由同上——避免与 goal 卡片信息重复；重做时评估每块是否该独立 section
          还是内嵌 goal step payload。不要无脑恢复。 */}
      <Show when={false}>
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
            const d = delivery();
            return d ? verdictPillLabel(deriveVerdictTone(d)) : "";
          }
          const progress = deliveryGoalProgress(gs);
          return `${progress.completed}/${progress.total}`;
        })()}
        badgeVariant="metric"
        badgeTone={(() => {
          const gs = goalWorkflows();
          if (gs.length === 0) {
            // Verdict drives the badge tone — same single source the panel
            // uses. Lifecycle status (publishing / candidate) deliberately
            // ignored here so a rejected verdict never paints the section
            // header green.
            const tone = deriveVerdictTone(delivery());
            return tone === "accepted"
              ? "good"
              : tone === "rejected"
                ? "bad"
                : tone === "inflight"
                  ? "accent"
                  : "";
          }
          const progress = deliveryGoalProgress(gs);
          return progress.failed > 0
            ? "bad"
            : progress.completed === progress.total
              ? "good"
              : progress.completed > 0
                ? "accent"
                : "";
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
        <InteractionCardList
          interactions={interactions() as InteractionData[]}
        />
      </SectionFrame>
      </Show>
    </>
  );
}
