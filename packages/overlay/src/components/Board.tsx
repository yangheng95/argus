// ── Board Panel Components ──
// Solid.js components that mirror the board rendering logic
// renderBoard, renderSpec, renderPlan, renderGoals, renderBudget,
// renderAcceptanceSection, renderTaskActions, statusIcon.
// Data is read from boardStore (store/board.ts); no direct DOM manipulation.

import { createEffect, createMemo, createSignal, For, Show, onMount } from "solid-js"
import { useDisclosure } from "../solid/disclosure"
import { boardStore } from "../store/board"
import { cardTreeStore, type CardNode } from "../store/card-tree"
import { t, tc } from "../utils/i18n"
import { renderMarkdown } from "../utils/markdown"
import { orderedReachableCardIDs, cardMessageSegments } from "../utils/card-tree"
import { statusIconName } from "../utils/status-mapping"
import { taskLifecycleStatusOrIdleLabel, workflowStepStatusLabelFromString } from "../utils/status-labels"
import { activeTone, verdictTone } from "../utils/verdict-tone"
import { GoalWorkflowList } from "./GoalWorkflowGroup"
import { RequirementsPanel } from "./RequirementsPanel"
import { FrontendResearchPanel } from "./FrontendResearchPanel"
import { ArchitectPanel } from "./ArchitectPanel"
import { taskScopeSectionVisibility, taskScopeWorkflowSectionID } from "../utils/task-scope-sections"
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

// ── Board (top-level) ──
// Main board panel that orchestrates all sub-panels.
// Reads from boardStore; action callbacks are passed via props so that
// the parent (or ) can wire up the actual API calls.
// Interaction reply/reject is self-contained inside <InteractionCard> and
// no longer takes parent-supplied callbacks.

interface BoardProps {
  onRetry?: () => void
  onReplan?: () => void
  onCancel?: () => void
  onEditGoal?: (id: string, title: string, detail: string) => void
  onDeleteGoal?: (id: string) => void
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

export function Board(props: BoardProps) {
  const board = () => boardStore.board

  const spec = () => board()?.spec
  const acceptance = () => acceptancePanelAcceptance(board())
  const overview = () => board()?.overview

  // ── Workflow-structured data (new) ──
  const workflow = () => board()?.workflow
  const requirements = () => board()?.requirements
  const architect = () => board()?.architect
  const goalWorkflows = () => board()?.goalWorkflows || []

  // Derive streaming state from workflow step statuses
  const isRequirementsGenerating = createMemo(() => {
    const wf = workflow()
    if (!wf) return false
    const reqStep = wf.steps.find((s: any) => s.id === "requirements")
    return reqStep?.status === "running"
  })
  const frontendResearchStatus = createMemo(() => {
    const wf = workflow()
    if (!wf) return ""
    const step = wf.steps.find((s: any) => s.id === "frontend_research")
    return String(step?.status || "")
  })
  const isArchitectGenerating = createMemo(() => {
    const wf = workflow()
    if (!wf) return false
    const archStep = wf.steps.find((s: any) => s.id === "architect")
    return archStep?.status === "running"
  })
  const taskScopeSections = createMemo(() =>
    taskScopeSectionVisibility({
      workflow: workflow(),
      requirements: requirements(),
      architect: architect(),
    }),
  )

  // ── Active section tracking ──
  // Map the workflow's current (running) step to a right-pane section id so
  // the section gets `data-phase-state="active"` highlighting. Falls back to
  // the most recently completed/failed step when nothing is running.
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
  const workflowStatusTone = (status: string): "" | "accent" | "good" | "bad" => {
    if (status === "failed") return "bad"
    if (status === "completed") return "good"
    if (status === "running") return "accent"
    return ""
  }

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
    // Single source for the boundary split lives in utils/card-tree
    // (cardMessageSegments) — shared with the ConversationAgentRail
    // latest-message preview. Board additionally requires a role on every
    // segment for attribution: no assistant-fallback (一个萝卜一个坑). A
    // missing role means the emitter is wrong — surface it.
    return cardMessageSegments(card).map((segment) => {
      if (segment.role.length === 0) {
        throw new Error(
          `Board grouping: card ${card.id} parts have no role boundary; emitter must mark role transitions explicitly`,
        )
      }
      return {
        info: {
          id: segment.id,
          role: segment.role,
          time: { created: segment.time },
        },
        parts: segment.parts,
      }
    })
  }

  /** Agent cards for a given stage, in chronological order. */
  function agentCardsForStage(stage: string): CardNode[] {
    const ids = orderedReachableCardIDs()
    const matched: CardNode[] = []
    for (const id of ids) {
      const card = cardTreeStore.cards[id]
      if (!card || card.kind !== "agent") continue
      if (card.stage !== stage) continue
      matched.push(card)
    }
    return matched.sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
  }

  // Requirements surface reads the actual requirements stage plus legacy
  // spec/goal cards created by older task snapshots.
  const requirementsMessages = createMemo(() => {
    const out: any[] = []
    for (const stage of ["requirements", "spec", "goal"]) {
      for (const card of agentCardsForStage(stage)) {
        out.push(...cardToMessageSegments(card))
      }
    }
    return out
  })
  const frontendResearchMessages = createMemo(() => {
    const out: any[] = []
    for (const stage of ["frontend-research"]) {
      for (const card of agentCardsForStage(stage)) {
        out.push(...cardToMessageSegments(card))
      }
    }
    return out
  })

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

      {/* Trace surface 2026-04-26: only the per-card trace button (Card.tsx)
          mounts <TracePanel sessionID={...} directory={...}>. Both the
          right-panel and the conversation-level "Show all session trace"
          toggle were removed because task-trace was a slow whole-task disk
          read with frequent path-mismatch failure modes. Operators wanting
          cross-session context now use the per-session Copy button on each
          TracePanel to dump the JSON into a log viewer or LLM. */}

      <div class="workflow-section-stack" data-ui="workflow-section-stack">
        <Show when={taskScopeSections().frontendResearch}>
          <SectionFrame
            id="frontendResearchSection"
            title={t("workflow.frontend_research")}
            icon="spec"
            bodyId="frontendResearchBody"
            badgeId="frontendResearchBadge"
            phaseState={phaseFor("frontendResearch")}
            badgeText={frontendResearchStatus() ? workflowStepStatusLabelFromString(frontendResearchStatus()) : ""}
            badgeTone={workflowStatusTone(frontendResearchStatus())}
          >
            <FrontendResearchPanel status={frontendResearchStatus()} streamingMessages={frontendResearchMessages()} />
          </SectionFrame>
        </Show>

        <Show when={taskScopeSections().requirements}>
          <SectionFrame
            id="requirementsSection"
            title={t("workflow.requirements")}
            icon="spec"
            bodyId="requirementsBody"
            badgeId="requirementsBadge"
            phaseState={phaseFor("requirements")}
            badgeText={(() => {
              const rs = requirements() ?? []
              if (rs.length > 0) {
                const passed = rs.filter((r: any) => r.status === "passed").length
                return `${passed}/${rs.length}`
              }
              if (isRequirementsGenerating()) return t("common.active")
              return goalWorkflows().length > 0 ? "—" : ""
            })()}
            badgeTone={(() => {
              const rs = requirements() ?? []
              if (rs.length === 0) return activeTone(isRequirementsGenerating())
              const passed = rs.filter((r: any) => r.status === "passed").length
              const failed = rs.filter((r: any) => r.status === "failed").length
              return verdictTone({ passed, failed, total: rs.length })
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
            icon="plan"
            bodyId="architectBody"
            badgeId="architectBadge"
            phaseState={phaseFor("architect")}
            badgeText={architect() ? String(architect()!.contractCount) : ""}
            badgeTone={activeTone(Boolean(architect()))}
          >
            <ArchitectPanel architect={architect()} isGenerating={isArchitectGenerating()} />
          </SectionFrame>
        </Show>

        <SectionFrame
          id="goalWorkflowsSection"
          title={t("workflow.goals")}
          icon="goals"
          bodyId="goalWorkflowsBody"
          badgeId="goalWorkflowsBadge"
          phaseState={phaseFor("goalWorkflows")}
          badgeText={(() => {
            const gw = goalWorkflows()
            const passed = gw.filter((g) => g.goalStatus === "passed").length
            return gw.length > 0 ? `${passed}/${gw.length}` : ""
          })()}
          badgeVariant="metric"
          badgeTone={(() => {
            const gw = goalWorkflows()
            if (gw.length === 0) return ""
            const passed = gw.filter((g) => g.goalStatus === "passed").length
            const failed = gw.filter((g) => g.goalStatus === "failed").length
            return verdictTone({ passed, failed, total: gw.length })
          })()}
        >
          <GoalWorkflowList goals={goalWorkflows()} onEditGoal={props.onEditGoal} onDeleteGoal={props.onDeleteGoal} />
        </SectionFrame>

        <Show when={acceptance()}>
          <AcceptancePanel acceptance={acceptance()} phaseState={phaseFor("acceptance")} />
        </Show>
      </div>
    </>
  )
}
