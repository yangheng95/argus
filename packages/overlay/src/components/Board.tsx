// ── Board Panel Components ──
// Solid.js components that mirror the board rendering logic
// renderBoard, renderSpec, renderPlan, renderGoals, renderCriteria,
// renderEvaluation, renderBudget, renderDeliverySection, renderTaskActions,
// renderInteractions, statusIcon, statusLabel.
// Data is read from boardStore (store/board.ts); no direct DOM manipulation.

import { createMemo, For, Show, createSignal, onMount, onCleanup } from "solid-js";
import { boardStore } from "../store/board";
import { t, tc } from "../utils/i18n";
import { renderMarkdown } from "../utils/markdown";
import { stamp } from "../utils/time";
import { TextPart } from "./TextPart";

// ── Types ──

interface CriteriaSpec {
  key: string;
  name: string;
  label: string;
  kind: string;
  family: string | undefined;
  group: string;
  enabled: boolean;
  readOnly: boolean;
}

interface CheckGroup {
  key: string;
  label: string;
  items: CriteriaSpec[];
}

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
    planning: t("task.status.planning"),
    running: t("task.status.running"),
    blocked: t("task.status.blocked"),
    evaluating: t("task.status.evaluating"),
    delivering: t("task.status.delivering"),
    completed: t("task.status.completed"),
    failed: t("task.status.failed"),
    cancelled: t("task.status.cancelled"),
  };
  return map[status] || status;
}

export function statusIcon(status: string): string {
  const map: Record<string, string> = {
    idle: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><circle data-fill="true" cx="8" cy="8" r="1.25"/></svg>`,
    queued: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="8" cy="8" r="4.5"/><path data-stroke="true" d="M8 5.4v2.8l2.1 1.3"/></svg>`,
    planning: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-stroke="true" d="M5 3.5v9"/><path data-stroke="true" d="M5 5.5h6"/><path data-stroke="true" d="M5 10.5h4"/><circle data-fill="true" cx="5" cy="3.5" r="1.15"/><circle data-fill="true" cx="11" cy="5.5" r="1.15"/><circle data-fill="true" cx="9" cy="10.5" r="1.15"/></svg>`,
    running: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-fill="true" d="M6 4.6L11.3 8 6 11.4Z"/></svg>`,
    blocked: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-fill="true" d="M8 3.1L13 12H3Z"/><path data-stroke="true" d="M8 5.8v2.8"/><circle data-fill="true" cx="8" cy="10.8" r="0.9" style="fill: var(--surface-strong);"/></svg>`,
    evaluating: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle data-stroke="true" cx="6.7" cy="6.7" r="3.5"/><path data-stroke="true" d="M9.5 9.5l2.9 2.9"/><circle data-fill="true" cx="6.7" cy="6.7" r="1.2"/></svg>`,
    delivering: `<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path data-stroke="true" d="M3.5 8h9"/><path data-stroke="true" d="M9 4.5L12.5 8 9 11.5"/><circle data-fill="true" cx="3.5" cy="8" r="1"/></svg>`,
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

// ── SpecPanel ──

interface SpecPanelProps {
  spec: any;
  preview?: string;
}

export function SpecPanel(props: SpecPanelProps) {
  const content = () => props.spec?.content || props.preview || "";
  const isPreview = () => !props.spec?.content && !!props.preview;
  return (
    <Show
      when={content()}
      fallback={<p class="empty-hint">{t("empty.spec")}</p>}
    >
      <TextPart text={content()} />
      <Show when={!isPreview()}>
        <div class="plan-version">{stamp(props.spec?.time?.created)}</div>
      </Show>
      <Show when={isPreview()}>
        <div class="plan-version streaming-indicator">{t("common.generating") || "Generating..."}</div>
      </Show>
    </Show>
  );
}

// ── PlanPanel ──
// Shows only active (running) goals with their plan context.
// Each active goal is rendered as "Goal#N Plan VX" + goal description + criteria.

interface PlanPanelProps {
  plan: any;
  preview?: string;
  /** All goal cards from the goals lane */
  goalCards?: any[];
  /** Set of currently running goal IDs */
  runningGoalIDs?: Set<string>;
}

export function PlanPanel(props: PlanPanelProps) {
  const isPreview = () => !props.plan?.prompt && !props.plan?.summary && !!props.preview;
  const hasPlan = () => !!props.plan?.prompt || !!props.plan?.summary;

  // Active goals: running status from goalRuns
  const activeGoals = createMemo(() => {
    const cards: any[] = props.goalCards || [];
    const running = props.runningGoalIDs;
    if (!running || running.size === 0) return [];
    return cards
      .map((card, idx) => ({ ...card, goalIndex: idx + 1 }))
      .filter((card) => running.has(card.id));
  });

  // All goals (for display when no goals are explicitly running, e.g. single-executor mode)
  const allGoals = createMemo(() => {
    const cards: any[] = props.goalCards || [];
    return cards.map((card, idx) => ({ ...card, goalIndex: idx + 1 }));
  });

  const displayGoals = () => activeGoals().length > 0 ? activeGoals() : allGoals();

  const version = () => props.plan?.version;

  return (
    <>
      <Show when={isPreview()}>
        <div class="plan-version streaming-indicator">{t("common.generating") || "Generating..."}</div>
      </Show>
      <Show when={!isPreview()}>
        <Show when={hasPlan() && props.plan?.summary}>
          <div class="plan-summary md-content" innerHTML={renderMarkdown(props.plan.summary)} />
        </Show>
        <Show
          when={displayGoals().length > 0}
          fallback={<Show when={!hasPlan()}><p class="empty-hint">{t("empty.plan")}</p></Show>}
        >
          <div class="goals-list">
            <For each={displayGoals()}>
              {(goal) => {
                const isRunning = () => props.runningGoalIDs?.has(goal.id);
                const goalStatus = () => goal.status || (isRunning() ? "running" : "pending");
                const shortTitle = () => {
                  const raw = goal.title || "";
                  const first = raw.split("\n")[0].replace(/^#+\s*/, "").trim();
                  return first.length > 60 ? first.slice(0, 57) + "..." : first;
                };
                return (
                  <details class="goal-item">
                    <summary class="goal-item-head">
                      <span class="goal-item-chevron" aria-hidden="true">{"\u25B6"}</span>
                      <span class="goal-desc-inline">
                        {`Goal#${goal.goalIndex}`}
                      </span>
                      <span class="goal-title-brief">{shortTitle()}</span>
                      <Show when={goalStatus() === "passed"}>
                        <span class="extension-status" data-state="passed">{"\u2713"}</span>
                      </Show>
                      <Show when={goalStatus() === "failed"}>
                        <span class="extension-status" data-state="failed">{"\u2717"}</span>
                      </Show>
                      <Show when={isRunning()}>
                        <span class="extension-status" data-state="active">
                          {t("goal.running")}
                        </span>
                      </Show>
                    </summary>
                    <div class="goal-item-body">
                      <div class="goal-content">
                        <div class="plan-version">{`Plan V${version()}`}</div>
                        <div
                          class="goal-desc md-content"
                          innerHTML={renderMarkdown(goal.title || "")}
                        />
                        <Show when={goal.detail}>
                          <div
                            class="goal-criteria md-content"
                            innerHTML={renderMarkdown(goal.detail)}
                          />
                        </Show>
                      </div>
                    </div>
                  </details>
                );
              }}
            </For>
          </div>
        </Show>
      </Show>
    </>
  );
}

// ── GoalIcon helper ──

function goalIcon(status: string): string {
  if (status === "passed") return "\u2713";
  if (status === "failed") return "\u2717";
  return "\u2022";
}

// ── GoalsPanel ──

interface GoalsPanelProps {
  cards: any[];
  /** Running goal IDs from board.goalRuns */
  runningGoalIDs: Set<string>;
  onEditGoal?: (id: string, title: string, detail: string) => void;
  onDeleteGoal?: (id: string) => void;
  onOpenSession?: (sessionID: string, goalTitle: string) => void;
}

export function GoalsPanel(props: GoalsPanelProps) {
  const passed = createMemo(() =>
    (props.cards || []).filter((c) => c.status === "passed").length,
  );
  const total = createMemo(() => (props.cards || []).length);

  return (
    <Show
      when={total() > 0}
      fallback={<p class="empty-hint">{t("empty.goals")}</p>}
    >
      <div class="goals-list">
        <For each={props.cards}>
          {(card, idx) => (
            <details class="goal-item">
              <summary class="goal-item-head">
                <span class="goal-item-chevron" aria-hidden="true">{"\u25B6"}</span>
                <span class="goal-desc-inline">{`Goal#${idx() + 1}`}</span>
                <span class="goal-title-brief">
                  {(() => {
                    const raw = card.title || "";
                    const first = raw.split("\n")[0].replace(/^#+\s*/, "").trim();
                    return first.length > 50 ? first.slice(0, 47) + "..." : first;
                  })()}
                </span>
                <Show when={card.status === "passed"}>
                  <span class="extension-status" data-state="passed">{"\u2713"}</span>
                </Show>
                <Show when={card.status === "failed"}>
                  <span class="extension-status" data-state="failed">{"\u2717"}</span>
                </Show>
                <Show when={props.runningGoalIDs.has(card.id) && card.status !== "passed" && card.status !== "failed"}>
                  <span class="extension-status" data-state="active">
                    {t("goal.running")}
                  </span>
                </Show>
                <Show when={card.metadata?.priority}>
                  <span
                    class="goal-priority"
                    data-priority={card.metadata.priority}
                  >
                    {card.metadata.priority}
                  </span>
                </Show>
              </summary>
              <div class="goal-item-body">
                <div class="goal-content">
                  <div
                    class="goal-desc md-content"
                    innerHTML={renderMarkdown(card.title || "")}
                  />
                  <Show when={card.detail}>
                    <div
                      class="goal-criteria md-content"
                      innerHTML={renderMarkdown(card.detail)}
                    />
                  </Show>
                </div>
                <Show when={props.onOpenSession && card.metadata?.sessionID}>
                  <button
                    type="button"
                    class="btn btn-ghost mini"
                    data-goal-action="view-session"
                    data-goal-id={card.id}
                    title="View executor session"
                    aria-label="View executor session"
                    onClick={() =>
                      props.onOpenSession?.(card.metadata.sessionID, card.title || card.id)
                    }
                  >
                    View
                  </button>
                </Show>
                <Show when={props.onEditGoal || props.onDeleteGoal}>
                  <div class="goal-actions">
                    <Show when={props.onEditGoal}>
                      <button
                        type="button"
                        class="btn btn-ghost mini"
                        data-goal-action="edit"
                        data-goal-id={card.id}
                        title={t("goal.edit_button_title")}
                        aria-label={t("goal.edit_button_title")}
                        onClick={() =>
                          props.onEditGoal?.(card.id, card.title, card.detail || "")
                        }
                      >
                        {t("common.edit")}
                      </button>
                    </Show>
                    <Show when={props.onDeleteGoal}>
                      <button
                        type="button"
                        class="btn btn-ghost mini danger"
                        data-goal-action="delete"
                        data-goal-id={card.id}
                        title={t("goal.delete_button_title")}
                        aria-label={t("goal.delete_button_title")}
                        onClick={() => props.onDeleteGoal?.(card.id)}
                      >
                        {t("common.delete")}
                      </button>
                    </Show>
                  </div>
                </Show>
              </div>
            </details>
          )}
        </For>
      </div>
    </Show>
  );
}

// ── CriteriaPanel helpers ──

const COMMAND_CHECKS = [
  { key: "build", label: "Build", kind: "command", family: "build" },
  { key: "test", label: "Unit Tests", kind: "command", family: "test" },
  { key: "lint", label: "Lint", kind: "command", family: "lint" },
  { key: "verify_cmd", label: "Verify Command", kind: "command", family: "verify_cmd" },
];

const TOGGLE_CHECKS = [
  { key: "startup", label: "Startup", kind: "toggle", family: "runtime" },
  { key: "artifact", label: "Artifacts", kind: "toggle", family: "artifact" },
  { key: "visual", label: "Visual Check", kind: "toggle", family: "runtime" },
  { key: "puppeteer", label: "Puppeteer", kind: "toggle", family: "runtime" },
  { key: "ui_review", label: "UI Review", kind: "toggle", family: "review" },
  { key: "code_quality", label: "Code Quality", kind: "toggle", family: "review" },
  { key: "code_review", label: "Code Review", kind: "toggle", family: "review" },
  { key: "dead_code_review", label: "Dead Code Review", kind: "toggle", family: "review" },
  { key: "spec_check", label: "Spec Check", kind: "toggle", family: "acceptance" },
];

const CHECK_FAMILIES = [
  { key: "command", order: 0 },
  { key: "runtime", order: 1 },
  { key: "artifact", order: 2 },
  { key: "review", order: 3 },
  { key: "acceptance", order: 4 },
  { key: "custom", order: 5 },
];

function normalizeCheckName(value: string): string {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9_#:-]/g, "_");
}

function baseCheckName(value: string): string {
  return normalizeCheckName(value).replace(/#\d+$/, "");
}

function checkLabel(key: string): string {
  const known: Record<string, string> = {
    build: t("checks.build"),
    test: t("checks.test"),
    lint: t("checks.lint"),
    verify_cmd: t("checks.verify_cmd"),
    py_compile: t("checks.py_compile"),
    pytest: t("checks.pytest"),
    typecheck: t("checks.typecheck"),
    ruff: t("checks.ruff"),
    mypy: t("checks.mypy"),
    startup: t("checks.startup"),
    artifact: t("checks.artifact"),
    visual: t("checks.visual"),
    puppeteer: t("checks.puppeteer"),
    ui_review: t("checks.ui_review"),
    code_quality: t("checks.code_quality"),
    code_review: t("checks.code_review"),
    dead_code_review: t("checks.dead_code_review"),
    spec_check: t("checks.spec_check"),
  };
  if (known[key]) return known[key];
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((item) => (item[0]?.toUpperCase() ?? "") + item.slice(1))
    .join(" ");
}

function checkFamilyKey(family: string, name: string): string {
  const base = baseCheckName(name);
  if (
    ["build", "test", "lint", "verify_cmd"].includes(family) ||
    ["build", "test", "lint", "verify_cmd"].includes(base)
  ) {
    return "command";
  }
  if (["runtime", "artifact", "review", "acceptance", "custom"].includes(family)) return family;
  if (["startup", "visual", "puppeteer"].includes(base)) return "runtime";
  if (base === "artifact") return "artifact";
  if (["ui_review", "code_quality", "code_review", "dead_code_review"].includes(base)) return "review";
  if (base === "spec_check") return "acceptance";
  return "custom";
}

function checkFamilyText(key: string): string {
  if (key === "command") return t("checks.family.command");
  if (key === "runtime") return t("checks.family.runtime");
  if (key === "artifact") return t("checks.family.artifact");
  if (key === "review") return t("checks.family.review");
  if (key === "acceptance") return t("checks.family.acceptance");
  return t("checks.family.custom");
}

// 14x14 SVG icons for criteria family group headers
const CHECK_FAMILY_ICONS: Record<string, string> = {
  command: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2.5" width="10" height="9" rx="1.2"/><polyline points="4.5,6 6,7.5 4.5,9"/><line x1="7.5" y1="9" x2="9.5" y2="9"/></svg>`,
  runtime: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.5 3.5L9.5 7 4.5 10.5Z"/></svg>`,
  artifact: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><path d="M2.5 4.5L7 2l4.5 2.5v5L7 12l-4.5-2.5Z"/><polyline points="2.5,4.5 7,7 11.5,4.5"/><line x1="7" y1="7" x2="7" y2="12"/></svg>`,
  review: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6.2" cy="6.2" r="3.5"/><line x1="9" y1="9" x2="11.5" y2="11.5"/></svg>`,
  acceptance: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="1.5" width="9" height="11" rx="1.2"/><polyline points="5,6.5 6.5,8 9,5.5"/><line x1="5" y1="10" x2="9" y2="10"/></svg>`,
  custom: `<svg viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="7" cy="7" r="1"/><path d="M6.1 2.5l-.2 1.2a3.4 3.4 0 0 0-.9.5L3.8 3.8l-.9.9.4 1.2a3.4 3.4 0 0 0-.5.9l-1.2.2v1.2l1.2.2c.1.3.3.6.5.9l-.4 1.2.9.9 1.2-.4c.3.2.6.4.9.5l.2 1.2h1.2l.2-1.2c.3-.1.6-.3.9-.5l1.2.4.9-.9-.4-1.2c.2-.3.4-.6.5-.9l1.2-.2V6.8l-1.2-.2a3.4 3.4 0 0 0-.5-.9l.4-1.2-.9-.9-1.2.4a3.4 3.4 0 0 0-.9-.5L7.9 2.5Z"/></svg>`,
};

function record(value: any): boolean {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function aggregateCheckStatus(checks: any[], key: string): string {
  const matches = (Array.isArray(checks) ? checks : []).filter(
    (item) => baseCheckName(item.name || item.label) === key,
  );
  if (matches.length === 0) return "pending";
  if (matches.some((item) => item.status === "failed")) return "failed";
  if (matches.some((item) => item.status === "passed")) return "passed";
  if (matches.every((item) => item.status === "skipped")) return "skipped";
  return "pending";
}

function criteriaEnabledValue(key: string, value: any, fallback: boolean): boolean {
  if (["build", "test", "lint", "verify_cmd"].includes(key)) {
    return value !== false && (value !== undefined || fallback);
  }
  if (key === "spec_check" && value === undefined) return true;
  if (value === true) return true;
  if (!value || !record(value)) return false;
  return (value as any).enabled !== false;
}

function criteriaSpecs(task: any, evaluation: any): CriteriaSpec[] {
  const checksConfig = task?.metadata?.checks;
  const config =
    checksConfig && record(checksConfig) ? { ...checksConfig } : {};
  const named =
    config.named && record(config.named) ? config.named : {};
  const seen = new Set<string>();
  const specs: CriteriaSpec[] = [];
  const showDefault =
    Object.keys(config).length === 0 &&
    (!evaluation?.checks || evaluation.checks.length === 0);

  const push = (spec: CriteriaSpec) => {
    if (seen.has(spec.key)) return;
    seen.add(spec.key);
    specs.push(spec);
  };

  for (const item of COMMAND_CHECKS) {
    const value = config[item.key];
    const visible =
      value !== undefined ||
      aggregateCheckStatus(evaluation?.checks, item.key) !== "pending" ||
      (showDefault && ["build", "test", "lint"].includes(item.key));
    if (!visible) continue;
    push({
      key: item.key,
      name: item.key,
      label: checkLabel(item.key),
      kind: item.kind,
      family: item.family,
      group: checkFamilyKey(item.family, item.key),
      enabled: criteriaEnabledValue(item.key, value, showDefault),
      readOnly: false,
    });
  }

  for (const item of TOGGLE_CHECKS) {
    const value = config[item.key];
    const canToggle = [
      "artifact",
      "ui_review",
      "code_quality",
      "code_review",
      "dead_code_review",
      "spec_check",
    ].includes(item.key);
    const visible =
      value !== undefined ||
      aggregateCheckStatus(evaluation?.checks, item.key) !== "pending" ||
      canToggle;
    if (!visible) continue;
    push({
      key: item.key,
      name: item.key,
      label: checkLabel(item.key),
      kind: item.kind,
      family: item.family,
      group: checkFamilyKey(item.family, item.key),
      enabled: criteriaEnabledValue(item.key, value, false),
      readOnly: false,
    });
  }

  for (const [key, value] of Object.entries(named)) {
    if (!value || !record(value)) continue;
    push({
      key: `named:${key}`,
      name: key,
      label: (value as any).label || checkLabel(key),
      kind: "named",
      family: (value as any).family || undefined,
      group: checkFamilyKey((value as any).family || "", key),
      enabled: (value as any).enabled !== false,
      readOnly: false,
    });
  }

  for (const check of evaluation?.checks || []) {
    const key = baseCheckName(check.name || check.label);
    if (!key) continue;
    if (seen.has(key) || seen.has(`named:${key}`)) continue;
    push({
      key,
      name: key,
      label: check.label || checkLabel(key),
      kind: "named",
      family: check.family || undefined,
      group: checkFamilyKey(check.family || "", key),
      enabled: true,
      readOnly: true,
    });
  }

  return specs;
}

function groupChecks(items: CriteriaSpec[]): CheckGroup[] {
  const groups = new Map<string, CheckGroup>();
  const order = new Map(CHECK_FAMILIES.map((item) => [item.key, item.order]));
  for (const item of items) {
    const key = item.group || "custom";
    if (!groups.has(key)) {
      groups.set(key, { key, label: checkFamilyText(key), items: [] });
    }
    groups.get(key)!.items.push(item);
  }
  return [...groups.values()].sort(
    (a, b) => (order.get(a.key) ?? 99) - (order.get(b.key) ?? 99),
  );
}

function criteriaResultText(status: string): string {
  if (status === "off") return t("checks.off");
  if (status === "passed") return t("checks.pass");
  if (status === "failed") return t("checks.fail");
  if (status === "skipped") return t("checks.skip");
  return t("checks.pending");
}

// ── CriteriaPanel ──

interface CriteriaPanelProps {
  task: any;
  evaluation: any;
  onToggle?: (key: string, enabled: boolean) => void;
}

export function CriteriaPanel(props: CriteriaPanelProps) {
  const specs = createMemo(() => criteriaSpecs(props.task, props.evaluation));
  const groups = createMemo(() => groupChecks(specs()));

  const checkStatuses = createMemo(() => {
    const result: Record<string, string> = {};
    for (const spec of specs()) {
      const status = spec.enabled
        ? aggregateCheckStatus(props.evaluation?.checks, spec.name)
        : "off";
      result[spec.key] = status;
    }
    return result;
  });

  return (
    <Show
      when={specs().length > 0}
      fallback={<div class="empty-hint">{t("empty.checks")}</div>}
    >
      <For each={groups()}>
        {(group) => (
          <section class="criteria-group" data-family={group.key}>
            <div class="criteria-group-head">
              <span
                class="criteria-group-icon"
                aria-hidden="true"
                innerHTML={CHECK_FAMILY_ICONS[group.key] || ""}
              />
              <div class="criteria-group-title">{group.label}</div>
              <div class="criteria-group-count">
                {tc("checks.group_count", group.items.length, { count: group.items.length })}
              </div>
            </div>
            <div class="criteria-group-list">
              <For each={group.items}>
                {(spec) => {
                  const status = () => checkStatuses()[spec.key] || "pending";
                  return (
                    <label
                      class="criteria-item"
                      data-readonly={spec.readOnly ? "true" : undefined}
                    >
                      <input
                        type="checkbox"
                        data-check={spec.key}
                        checked={spec.enabled}
                        disabled={spec.readOnly}
                        onChange={(e) =>
                          props.onToggle?.(spec.key, e.currentTarget.checked)
                        }
                      />
                      <span class="check-mark" />
                      <span class="criteria-copy">
                        <span class="criteria-name">{spec.label}</span>
                        <span class="criteria-desc">
                          {spec.readOnly
                            ? t("detail.observed")
                            : spec.enabled
                              ? t("detail.enabled")
                              : t("detail.disabled")}
                        </span>
                      </span>
                      <span class="criteria-status" data-result={status()} />
                      <span class="criteria-result">{criteriaResultText(status())}</span>
                    </label>
                  );
                }}
              </For>
            </div>
          </section>
        )}
      </For>
    </Show>
  );
}

// ── EvaluationPanel ──

function evaluationVerdictLabel(status: string): string {
  if (status === "accepted") return t("evaluation.verdict.accepted");
  if (status === "rejected") return t("evaluation.verdict.rejected");
  return t("evaluation.verdict.pending");
}

function checkFamilyLabel(family: string, name: string): string {
  return checkFamilyText(checkFamilyKey(family, name));
}

interface EvaluationPanelProps {
  evaluation: any;
}

export function EvaluationPanel(props: EvaluationPanelProps) {
  const errors = createMemo(() => {
    const result: Array<{ name: string; family: string; evidence: string }> = [];
    for (const check of props.evaluation?.checks || []) {
      if (check.status === "failed" && check.evidence) {
        result.push({
          name: check.label || checkLabel(baseCheckName(check.name || check.label)),
          family: checkFamilyLabel(check.family || "", check.name || check.label || ""),
          evidence: check.evidence,
        });
      }
    }
    return result;
  });

  return (
    <Show when={props.evaluation}>
      <For each={errors()}>
        {(err) => (
          <div class="eval-error">
            <div class="eval-error-name">{"\u2717"} {err.name}</div>
            <Show when={err.family}>
              <div class="eval-error-meta">{err.family}</div>
            </Show>
            <div
              class="eval-error-detail md-content"
              innerHTML={renderMarkdown(err.evidence.slice(0, 400))}
            />
          </div>
        )}
      </For>
      <Show when={props.evaluation?.summary}>
        <div
          class="eval-summary md-content"
          innerHTML={renderMarkdown(props.evaluation.summary)}
        />
      </Show>
    </Show>
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

function interactionIcon(interaction: Interaction): string {
  return interaction.type === "permission" ? "\uD83D\uDD12" : "\u2753";
}

function InteractionAlert(props: InteractionAlertProps) {
  const icon = () => interactionIcon(props.interaction);

  return (
    <div class="interaction-alert" data-id={props.interaction.id}>
      <div class="interaction-title">
        {icon()} {props.interaction.title}
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

// ── ExecutorPanel ──
// Mirrors renderExecutor() — shows the engine bar state (read-only view).
// Actual executor selection buttons live in ; this component
// provides a Solid-friendly read-only view of the active executor.

interface ExecutorPanelProps {
  executors: any[];
  selectedExecutor: string;
}

export function ExecutorPanel(props: ExecutorPanelProps) {
  const current = createMemo(() =>
    props.executors.find((e) => e.id === props.selectedExecutor),
  );

  return (
    <Show when={current()}>
      <div class="executor-status">
        <span class="executor-id">{current()!.id}</span>
        <Show when={current()!.model}>
          <span class="executor-model">{current()!.model}</span>
        </Show>
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
  onToggleCriteria?: (key: string, enabled: boolean) => void;
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
  const evaluation = () => board()?.evaluation;
  const delivery = () => board()?.delivery;
  const interactions = () => board()?.interactions || [];
  const overview = () => board()?.overview;

  const goalsCards = createMemo(() => {
    const lanes: any[] = board()?.lanes || [];
    const goalsLane = lanes.find((l) => l.id === "goals");
    return goalsLane?.cards || [];
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

 // Badge helpers
  const goalsBadgeText = createMemo(() => {
    const cards = goalsCards();
    if (cards.length === 0) return "";
    const passed = cards.filter((c: any) => c.status === "passed").length;
    return `${passed}/${cards.length}`;
  });

  const goalsBadgeTone = createMemo(() => {
    const cards = goalsCards();
    if (cards.length === 0) return "";
    const passed = cards.filter((c: any) => c.status === "passed").length;
    return passed === cards.length ? "good" : passed > 0 ? "warn" : "";
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

      <SectionFrame
        id="specSection"
        title={t("section.spec")}
        icon={SECTION_ICONS.spec}
        bodyId="specBody"
        badgeId="specBadge"
        badgeText={spec() ? t("common.active") : ""}
        badgeTone={spec() ? "accent" : ""}
      >
        <SpecPanel spec={spec()} preview={boardStore.specPreview} />
      </SectionFrame>

      <SectionFrame
        id="goalsSection"
        title={t("section.goals")}
        icon={SECTION_ICONS.goals}
        bodyId="goalsBody"
        badgeId="goalsBadge"
        badgeText={goalsBadgeText()}
        badgeTone={goalsBadgeTone()}
      >
        <GoalsPanel
          cards={goalsCards()}
          runningGoalIDs={runningGoalIDs()}
          onEditGoal={props.onEditGoal}
          onDeleteGoal={props.onDeleteGoal}
          onOpenSession={props.onOpenSession}
        />
        <InteractionsList
          interactions={interactions()}
          onResolve={props.onResolveInteraction}
          onReject={props.onRejectInteraction}
        />
      </SectionFrame>

      <SectionFrame
        id="planSection"
        title={t("section.plan")}
        icon={SECTION_ICONS.plan}
        bodyId="planBody"
        badgeId="planBadge"
        badgeText={runningGoalIDs().size > 0 ? String(runningGoalIDs().size) : ""}
        badgeTone={runningGoalIDs().size > 0 ? "accent" : ""}
      >
        <PlanPanel
          plan={plan()}
          preview={boardStore.planPreview}
          goalCards={goalsCards()}
          runningGoalIDs={runningGoalIDs()}
        />
      </SectionFrame>

      <SectionFrame
        id="criteriaSection"
        title={t("section.evaluation")}
        icon={SECTION_ICONS.criteria}
        bodyId="criteriaBody"
        badgeId="criteriaBadge"
        badgeText={(() => {
          const specs = criteriaSpecs(task(), evaluation());
          if (specs.length === 0) return "";
          const enabled = specs.filter((item) => item.enabled).length;
          if (enabled === 0) return t("checks.zero_enabled");
          const passed = specs.filter((item) => item.enabled && aggregateCheckStatus(evaluation()?.checks, item.name) === "passed").length;
          return `${passed}/${enabled}`;
        })()}
      >
        <CriteriaPanel
          task={task()}
          evaluation={evaluation()}
          onToggle={props.onToggleCriteria}
        />
        <EvaluationPanel evaluation={evaluation()} />
      </SectionFrame>

      <SectionFrame
        id="deliverySection"
        title={t("section.delivery")}
        icon={SECTION_ICONS.delivery}
        bodyId="evalBody"
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

    </>
  );
}

// ── CriteriaBadge ──
// Computed badge for the criteria section header.

function CriteriaBadge(props: { task: any; evaluation: any }) {
  const specs = createMemo(() => criteriaSpecs(props.task, props.evaluation));

  const { enabledCount, passedCount } = {
    enabledCount: createMemo(() => {
      let count = 0;
      for (const spec of specs()) {
        if (spec.enabled) count++;
      }
      return count;
    }),
    passedCount: createMemo(() => {
      let count = 0;
      for (const spec of specs()) {
        if (!spec.enabled) continue;
        const status = aggregateCheckStatus(props.evaluation?.checks, spec.name);
        if (status === "passed") count++;
      }
      return count;
    }),
  };

  const text = createMemo(() => {
    if (specs().length === 0) return "";
    if (enabledCount() === 0) return t("checks.zero_enabled");
    return `${passedCount()}/${enabledCount()}`;
  });

  const tone = createMemo(() => {
    if (enabledCount() === 0) return "";
    return passedCount() === enabledCount()
      ? "good"
      : passedCount() > 0
        ? "warn"
        : "";
  });

  return (
    <Show when={text()}>
      <span class="section-badge" data-tone={tone()}>
        {text()}
      </span>
    </Show>
  );
}
