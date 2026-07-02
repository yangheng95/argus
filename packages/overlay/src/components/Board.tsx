// ── Task-scope panel components ──
// Solid.js components that render requirements, architect contracts, goals,
// acceptance evidence, task actions, and status badges.
// Data is read from boardStore (store/board.ts); no direct DOM manipulation.

import { createEffect, createMemo, createSignal, For, Show, onMount } from "solid-js"
import { useDisclosure } from "../solid/disclosure"
import { boardStore } from "../store/board"
import { t, tc } from "../utils/i18n"
import { renderMarkdown } from "../utils/markdown"
import { statusIconName } from "../utils/status-mapping"
import { taskLifecycleStatusOrIdleLabel } from "../utils/status-labels"
import { activeTone, verdictTone } from "../utils/verdict-tone"
import { GoalWorkflowList } from "./GoalWorkflowGroup"
import { RequirementsPanel } from "./RequirementsPanel"
import { ArchitectPanel } from "./ArchitectPanel"
import { taskScopeWorkflowSectionID } from "../utils/task-scope-sections"
import { Button } from "./ui/Button"
import { Icon, type IconName } from "./Icon"
import { Section } from "./primitives/Section"

// ── StatusBadge ──
// General-purpose status badge with an icon + label.

interface StatusBadgeProps {
  status: string
  class?: string
}

export function StatusBadge(props: StatusBadgeProps) {
  return (
    <span class={`status-badge ${props.class || ""}`}>
      <span class="status-icon" data-status={props.status}>
        <Icon name={statusIconName(props.status)} />
      </span>
      <span class="status-label">{taskLifecycleStatusOrIdleLabel(props.status)}</span>
    </span>
  )
}

// ── AcceptancePanel ──
//
// Surfaces every acceptance activity reaching the board: deterministic gate
// (build/test/lint/typecheck), runtime flows (preview / SSE / golden-path),
// and per-reviewer specialist reviews — split into three collapsible groups
// because they have categorically different remediation paths (compile-time
// vs. running-server vs. LLM judgement). The panel's left-edge accent comes
// from `verdictTone` so verdict — not lifecycle status — drives the visual.
// CCE = canonical click-through event; emits `acceptance:focus-changes` on the
// `window` so the right-panel Files tab can focus the matching run.
//
// Visual primitive `.verdict-pill` is shared with IntegrityCard.

type AcceptanceEvidenceKind = "check" | "review"

interface AcceptanceEvidenceRow {
  id: string
  label: string
  status: string
  goalRunID?: string
}

type VerdictTone = "accepted" | "rejected" | "inflight" | "empty"

function deriveVerdictTone(acceptance: any): VerdictTone {
  if (!acceptance) return "empty"
  if (acceptance.verdict === "accepted") return "accepted"
  if (acceptance.verdict === "rejected") return "rejected"
  return "inflight"
}

function verdictPillLabel(tone: VerdictTone): string {
  return t(`acceptance.verdict.${tone}`)
}

function acceptanceEvidenceGroup(acceptance: any, kind: AcceptanceEvidenceKind): AcceptanceEvidenceRow[] {
  const manifest = acceptance?.evidenceManifest
  if (!manifest) return []
  const source: any[] | undefined = kind === "check" ? manifest.checkResults : manifest.reviewEvidence
  if (!Array.isArray(source)) return []
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
  }))
}

function groupSummary(rows: AcceptanceEvidenceRow[]): {
  total: number
  failed: number
  defaultOpen: boolean
} {
  const total = rows.length
  const failed = rows.filter(
    (row) => row.status === "failed" || row.status === "needs_correction" || row.status === "concerns",
  ).length
  return { total, failed, defaultOpen: failed > 0 }
}

function rowVerdict(status: string): string {
  if (status === "passed" || status === "pass") return "accepted"
  if (status === "failed" || status === "needs_correction" || status === "concerns") return "rejected"
  return "inflight"
}

function focusChangesPanel(goalRunID: string | undefined) {
  // CCE = canonical click-through event; the right-panel Files tab handles focus.
  if (typeof window === "undefined") return
  window.dispatchEvent(new CustomEvent("acceptance:focus-changes", { detail: { goalRunID } }))
}

interface AcceptanceEvidenceGroupProps {
  label: string
  kind: AcceptanceEvidenceKind
  rows: AcceptanceEvidenceRow[]
}

export function AcceptanceEvidenceGroup(props: AcceptanceEvidenceGroupProps) {
  return (
    <Show when={props.rows.length > 0}>
      {(() => {
        const summary = groupSummary(props.rows)
        return (
          <details class="acceptance-evidence-group" data-kind={props.kind} open={summary.defaultOpen}>
            <summary class="acceptance-evidence-group-head">
              <span class="acceptance-evidence-group-label">{props.label}</span>
              <span class="acceptance-evidence-group-count">
                {summary.failed > 0
                  ? tc("acceptance.group_count_failing", summary.failed, {
                      failed: summary.failed,
                      total: summary.total,
                    })
                  : tc("acceptance.group_count_all_pass", summary.total, {
                      total: summary.total,
                    })}
              </span>
            </summary>
            <ul class="acceptance-evidence-list">
              <For each={props.rows}>
                {(row) => (
                  <li
                    class="acceptance-evidence-row"
                    data-status={row.status}
                    attr:data-has-pill={row.goalRunID ? "true" : undefined}
                  >
                    <Show when={row.goalRunID}>
                      <Button
                        variant="outline"
                        size="mini"
                        tone="neutral"
                        data-ui="acceptance-evidence-goal-pill"
                        type="button"
                        title={t("acceptance.row_goal_pill_title")}
                        onClick={() => focusChangesPanel(row.goalRunID)}
                      >
                        {row.goalRunID ? row.goalRunID.slice(-6) : ""}
                      </Button>
                    </Show>
                    <span class="acceptance-evidence-name">{row.label}</span>
                    <span class="verdict-pill" data-verdict={rowVerdict(row.status)}>
                      {row.status}
                    </span>
                  </li>
                )}
              </For>
            </ul>
          </details>
        )
      })()}
    </Show>
  )
}

interface AcceptancePanelProps {
  acceptance: any
  phaseState?: "active" | ""
}

const LIVE_RUN_STATUSES = new Set(["queued", "accepted", "running", "blocked"])
const ACCEPTANCE_PHASES = new Set(["deliver", "refine"])

export function hasActiveAcceptanceRun(board: any): boolean {
  const run = board?.run
  const workflowSteps = Array.isArray(board?.workflow?.steps) ? board.workflow.steps : []
  const workflowAcceptanceRunning = workflowSteps.some(
    (step: any) => ACCEPTANCE_PHASES.has(String(step?.id || "")) && step?.status === "running",
  )
  const runAcceptanceActive =
    ACCEPTANCE_PHASES.has(String(run?.phase || "")) && LIVE_RUN_STATUSES.has(String(run?.status || ""))
  return workflowAcceptanceRunning || runAcceptanceActive
}

export function acceptancePanelAcceptance(board: any): any {
  return (
    board?.candidateAcceptance ||
    board?.acceptedAcceptance ||
    board?.acceptance ||
    (hasActiveAcceptanceRun(board)
      ? {
          pending: true,
          status: "publishing",
          verdict: "inconclusive",
        }
      : null)
  )
}

const DEFAULT_SUMMARY_LINES = 10

export function AcceptancePanel(props: AcceptancePanelProps) {
  // Migrated to the shared disclosure primitive (Step 9.H of the
  // flat-redesign rollout). `summary` is the canonical open/close
  // state for the acceptance summary clamp affordance.
  const summary = useDisclosure(false)

  const tone = createMemo<VerdictTone>(() => deriveVerdictTone(props.acceptance))
  const summaryText = createMemo(() => {
    const d = props.acceptance
    if (!d) return ""
    if (d.pending === true) return t("acceptance.inflight.hint")
    return d.verdict === "rejected"
      ? d.verdictSummary || d.summary || d.result?.summary || ""
      : d.summary || d.result?.summary || ""
  })
  const summaryNeedsClamp = createMemo(() => summaryText().split("\n").length > DEFAULT_SUMMARY_LINES)
  const checks = createMemo(() => acceptanceEvidenceGroup(props.acceptance, "check"))
  const reviews = createMemo(() => acceptanceEvidenceGroup(props.acceptance, "review"))
  const filesChanged = createMemo(() => (props.acceptance?.result?.changedFiles?.length as number | undefined) ?? 0)
  const iteration = createMemo<number>(() => Number(props.acceptance?.evidenceManifest?.iteration ?? 0))

  return (
    <Section
      id="acceptanceSection"
      bodyId="acceptanceBody"
      title={t("section.acceptance")}
      icon={<Icon name="acceptance" />}
      badge={props.acceptance ? verdictPillLabel(tone()) : undefined}
      badgeTone={
        props.acceptance?.verdict === "accepted"
          ? "good"
          : props.acceptance?.verdict === "rejected"
            ? "bad"
            : props.acceptance
              ? "accent"
              : undefined
      }
      defaultOpen
      attr:data-phase-state={props.phaseState || undefined}
    >
      <Show when={props.acceptance}>
        <section class="acceptance-panel" data-verdict={tone()}>
          <Show when={iteration() > 0}>
            <div class="acceptance-panel-meta">
              <span class="acceptance-iteration">{t("acceptance.iteration", { n: String(iteration()) })}</span>
            </div>
          </Show>

          <Show when={summaryText()}>
            <div
              class="acceptance-summary md-content"
              data-clamped={summaryNeedsClamp() && !summary.open() ? "true" : "false"}
              innerHTML={renderMarkdown(summaryText())}
            />
            <Show when={summaryNeedsClamp()}>
              <Button
                variant="ghost"
                size="mini"
                tone="accent"
                data-ui="acceptance-summary-toggle"
                type="button"
                onClick={summary.toggle}
              >
                {summary.open() ? t("acceptance.show_less") : t("acceptance.show_more")}
              </Button>
            </Show>
          </Show>

          <AcceptanceEvidenceGroup label={t("acceptance.checks")} kind="check" rows={checks()} />
          <AcceptanceEvidenceGroup label={t("acceptance.reviews")} kind="review" rows={reviews()} />

          <Show when={filesChanged() > 0}>
            <Button
              variant="outline"
              size="sm"
              tone="neutral"
              data-ui="acceptance-files-link"
              type="button"
              onClick={() => focusChangesPanel(undefined)}
            >
              {tc("acceptance.files_changed", filesChanged(), { count: filesChanged() })}
            </Button>
          </Show>
        </section>
      </Show>
    </Section>
  )
}

// ── TaskActionsPanel ──

interface TaskActionsPanelProps {
  overview: any
  onRetry?: () => void
  onReplan?: () => void
  onCancel?: () => void
}

export function TaskActionsPanel(props: TaskActionsPanelProps) {
  const controls = createMemo(() => props.overview?.controls || {})
  const hasButtons = createMemo(() => controls().canRetry || controls().canReplan || controls().canCancel)

  return (
    <Show when={hasButtons()}>
      <div class="task-actions-buttons">
        <Show when={controls().canRetry}>
          <Button
            type="button"
            variant="solid"
            size="md"
            tone="accent"
            data-task-action="retry"
            title={t("task.action.retry_title")}
            aria-label={t("task.action.retry_title")}
            onClick={() => props.onRetry?.()}
          >
            {t("task.action.retry")}
          </Button>
        </Show>
        <Show when={controls().canReplan}>
          <Button
            type="button"
            variant="ghost"
            size="md"
            tone="neutral"
            data-task-action="replan"
            title={t("task.action.replan_title")}
            aria-label={t("task.action.replan_title")}
            onClick={() => props.onReplan?.()}
          >
            {t("task.action.replan")}
          </Button>
        </Show>
        <Show when={controls().canCancel}>
          <Button
            type="button"
            variant="outline"
            size="md"
            tone="danger"
            data-task-action="cancel"
            title={t("task.action.cancel_title")}
            aria-label={t("task.action.cancel_title")}
            onClick={() => props.onCancel?.()}
          >
            {t("task.action.cancel")}
          </Button>
        </Show>
      </div>
    </Show>
  )
}

// Pending-interaction rendering is delegated to the shared <InteractionCard>
// component, which is also used inline in the conversation timeline. The
// component owns its own busy / error state and dispatches replies through
// the per-id-mutex'd interaction-reply service — Board no longer needs to
// pipe callbacks down for this surface.

// ── Right-toolbar task scope panels ──
// Requirements, Architect, and Goals are mounted as separate right toolbar
// panels. They share the boardStore projection; no panel owns its own copy of
// task-scope data.

interface BoardPanelProps {
  onRetry?: () => void
  onReplan?: () => void
  onCancel?: () => void
  onEditGoal?: (id: string, title: string, detail: string) => void
  onDeleteGoal?: (id: string) => void
}

type TaskScopePanelID = "requirements" | "architect" | "goals"

interface TaskScopePanelShellProps {
  panelID: TaskScopePanelID
  title: string
  icon: IconName
  badgeText?: string
  badgeTone?: string
  badgeVariant?: "status" | "metric"
  children: any
}

function TaskScopePanelShell(props: TaskScopePanelShellProps) {
  return (
    <div class="task-scope-panel" data-task-scope-panel={props.panelID}>
      <header class="task-scope-panel__header oc-surface-header">
        <div class="task-scope-panel__title-row oc-surface-header__main">
          <span class="task-scope-panel__icon" aria-hidden="true">
            <Icon name={props.icon} />
          </span>
          <span class="task-scope-panel__title oc-surface-header__title">{props.title}</span>
        </div>
        <Show when={props.badgeText}>
          <span
            class="task-scope-panel__badge"
            data-tone={props.badgeTone || undefined}
            data-variant={props.badgeVariant || "status"}
          >
            {props.badgeText}
          </span>
        </Show>
      </header>
      <div class="task-scope-panel__body right-activity-body" data-side-activity={props.panelID} data-active="true">
        <div class="sections-stack workflow-section-stack task-scope-panel__stack" data-ui="workflow-section-stack">
          {props.children}
        </div>
      </div>
    </div>
  )
}

interface SectionFrameProps {
  id: string
  title: string
  bodyId: string
  /** Section header icon. Identifier resolves through the Icon
   * primitive registry (components/Icon.tsx); inline innerHTML svg
   * strings were retired 2026-05-04 (flat-redesign Step 3). */
  icon?: IconName
  badgeId?: string
  badgeText?: string
  badgeTone?: string
  badgeVariant?: "status" | "metric"
  phaseState?: "active" | "related" | ""
  /** Initial open state at mount only; user toggle is preserved afterwards. */
  defaultOpen?: boolean
  children: any
}

function SectionFrame(props: SectionFrameProps) {
  let detailsEl: HTMLDetailsElement | undefined
  // First mount: open the section so the operator sees the data that just
  // became available (the section only renders when taskScopeSections marks
  // it visible — i.e. it has concrete state or data). Without this, the
  // pre-bug behaviour was "section appears collapsed after the agent already
  // ran" and operators had to click to see what the agent produced.
  onMount(() => {
    if (!detailsEl) return
    if (props.defaultOpen ?? true) detailsEl.open = true
  })
  // Re-open whenever the section transitions back to "active" (e.g. requirements
  // running again after a rewind, or architect being re-entered). The effect
  // never force-closes — once the user manually collapses, it stays collapsed
  // until phaseState flips away and back, matching the spirit of the original
  // "user toggle is preserved" comment.
  createEffect(() => {
    if (!detailsEl) return
    if (props.phaseState === "active") detailsEl.open = true
  })
  return (
    <Section
      ref={(el: HTMLDetailsElement) => {
        detailsEl = el
      }}
      id={props.id}
      bodyId={props.bodyId}
      title={props.title}
      icon={props.icon ? <Icon name={props.icon} /> : undefined}
      badge={props.badgeText || undefined}
      badgeId={props.badgeId}
      badgeTone={props.badgeTone}
      badgeVariant={props.badgeVariant || "status"}
      attr:data-phase-state={props.phaseState || undefined}
    >
      {props.children}
    </Section>
  )
}

function workflowStatusTone(status: string): "" | "accent" | "good" | "bad" {
  if (status === "failed") return "bad"
  if (status === "completed") return "good"
  if (status === "running") return "accent"
  return ""
}

function createTaskScopeProjection() {
  const board = () => boardStore.board

  const spec = () => board()?.spec
  const acceptance = () => acceptancePanelAcceptance(board())
  const overview = () => board()?.overview

  const workflow = () => board()?.workflow
  const requirements = () => board()?.requirements
  const architect = () => board()?.architect
  const goalWorkflows = () => board()?.goalWorkflows || []

  const workflowStepStatus = (stepID: string): string => {
    const wf = workflow()
    if (!wf || !Array.isArray(wf.steps)) return ""
    return String(wf.steps.find((s: any) => s.id === stepID)?.status || "")
  }

  const isRequirementsGenerating = createMemo(() => {
    return workflowStepStatus("requirements") === "running"
  })

  const isArchitectGenerating = createMemo(() => {
    return workflowStepStatus("architect") === "running"
  })

  const activeSection = createMemo<string>(() => {
    const wf = workflow()
    if (!wf || !Array.isArray(wf.steps)) return ""
    const running = wf.steps.find((s: any) => s.status === "running")
    if (running) return taskScopeWorkflowSectionID(running.id)
    if (hasActiveAcceptanceRun(board())) return "acceptance"
    let lastDone: any = null
    for (const s of wf.steps) {
      if (s.status === "completed" || s.status === "failed") lastDone = s
    }
    if (lastDone) return taskScopeWorkflowSectionID(lastDone.id)
    return ""
  })
  const phaseFor = (id: string): "active" | "" => (activeSection() === id ? "active" : "")

  return {
    spec,
    acceptance,
    overview,
    requirements,
    architect,
    goalWorkflows,
    workflowStepStatus,
    isRequirementsGenerating,
    isArchitectGenerating,
    phaseFor,
  }
}

export function RequirementsBoardPanel() {
  const scope = createTaskScopeProjection()
  const badgeText = createMemo(() => {
    const rs = scope.requirements() ?? []
    if (rs.length > 0) {
      const passed = rs.filter((r: any) => r.status === "passed").length
      return `${passed}/${rs.length}`
    }
    if (scope.isRequirementsGenerating()) return t("common.active")
    return ""
  })
  const badgeTone = createMemo(() => {
    const rs = scope.requirements() ?? []
    if (rs.length === 0) return activeTone(scope.isRequirementsGenerating())
    const passed = rs.filter((r: any) => r.status === "passed").length
    const failed = rs.filter((r: any) => r.status === "failed").length
    return verdictTone({ passed, failed, total: rs.length })
  })

  return (
    <TaskScopePanelShell
      panelID="requirements"
      title={t("workflow.requirements")}
      icon="spec"
      badgeText={badgeText()}
      badgeTone={badgeTone()}
    >
      <SectionFrame
        id="requirementsSection"
        title={t("workflow.requirements")}
        icon="spec"
        bodyId="requirementsBody"
        badgeId="requirementsBadge"
        phaseState={scope.phaseFor("requirements")}
        badgeText={badgeText()}
        badgeTone={badgeTone()}
      >
        <RequirementsPanel
          requirements={scope.requirements()}
          specContent={scope.spec()?.content}
          isGenerating={scope.isRequirementsGenerating()}
        />
      </SectionFrame>
    </TaskScopePanelShell>
  )
}

export function ArchitectBoardPanel() {
  const scope = createTaskScopeProjection()
  const architectStatus = createMemo(() => scope.workflowStepStatus("architect"))
  const badgeText = createMemo(() => {
    if (scope.architect()) return String(scope.architect()!.contractCount)
    if (scope.isArchitectGenerating()) return t("common.active")
    return ""
  })
  const badgeTone = createMemo(() => {
    const status = architectStatus()
    return workflowStatusTone(status) || activeTone(Boolean(scope.architect()))
  })

  return (
    <TaskScopePanelShell
      panelID="architect"
      title={t("workflow.architect")}
      icon="plan"
      badgeText={badgeText()}
      badgeTone={badgeTone()}
    >
      <SectionFrame
        id="architectSection"
        title={t("workflow.architect")}
        icon="plan"
        bodyId="architectBody"
        badgeId="architectBadge"
        phaseState={scope.phaseFor("architect")}
        badgeText={badgeText()}
        badgeTone={badgeTone()}
      >
        <ArchitectPanel architect={scope.architect()} isGenerating={scope.isArchitectGenerating()} />
      </SectionFrame>
    </TaskScopePanelShell>
  )
}

export function GoalsBoardPanel(props: BoardPanelProps) {
  const scope = createTaskScopeProjection()
  const badgeText = createMemo(() => {
    const gw = scope.goalWorkflows()
    const passed = gw.filter((g) => g.goalStatus === "passed").length
    return gw.length > 0 ? `${passed}/${gw.length}` : ""
  })
  const badgeTone = createMemo(() => {
    const gw = scope.goalWorkflows()
    if (gw.length === 0) return ""
    const passed = gw.filter((g) => g.goalStatus === "passed").length
    const failed = gw.filter((g) => g.goalStatus === "failed").length
    return verdictTone({ passed, failed, total: gw.length })
  })

  return (
    <TaskScopePanelShell
      panelID="goals"
      title={t("workflow.goals")}
      icon="goals"
      badgeText={badgeText()}
      badgeTone={badgeTone()}
      badgeVariant="metric"
    >
      <div id="taskActionsBar" class="task-scope-actions">
        <TaskActionsPanel
          overview={scope.overview()}
          onRetry={props.onRetry}
          onReplan={props.onReplan}
          onCancel={props.onCancel}
        />
      </div>

      <SectionFrame
        id="goalWorkflowsSection"
        title={t("workflow.goals")}
        icon="goals"
        bodyId="goalWorkflowsBody"
        badgeId="goalWorkflowsBadge"
        phaseState={scope.phaseFor("goalWorkflows")}
        badgeText={badgeText()}
        badgeVariant="metric"
        badgeTone={badgeTone()}
      >
        <Show
          when={scope.goalWorkflows().length > 0}
          fallback={<p class="empty-hint empty-hint--card">{t("workflow.goals_pending")}</p>}
        >
          <GoalWorkflowList
            goals={scope.goalWorkflows()}
            onEditGoal={props.onEditGoal}
            onDeleteGoal={props.onDeleteGoal}
          />
        </Show>
      </SectionFrame>

      <Show when={scope.acceptance()}>
        <AcceptancePanel acceptance={scope.acceptance()} phaseState={scope.phaseFor("acceptance")} />
      </Show>
    </TaskScopePanelShell>
  )
}
