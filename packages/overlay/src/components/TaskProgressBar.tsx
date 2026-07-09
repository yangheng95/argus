// ── TaskProgressBar ──
//
// Floating goal progress window rendered in an overlay layer above the
// Conversation message panel.
// Reads `boardStore.board.goalWorkflows` so it shows
// EVERY goal the architect emitted — including pending ones that haven't
// been dispatched yet. Operators no longer need to hunt the right pane
// or scroll the timeline to answer "how much of this task is done".
//
// The component intentionally renders no per-goal action buttons: it is
// a status overview, not a control surface. Per-goal actions remain on
// the right-pane GoalWorkflowList, and per-card rewind/copy stays on
// each card. Bottom-line "click goal pill -> scroll to its card" is the
// only per-goal interaction; the header exposes only a whole-strip fold.
//
// We do NOT mutate cardTreeStore here — spec 07 requires tree-writer
// to be the single writer. Historical materialization goes through
// services/conversation, which replays backend conversation view data into
// the tree-writer before this component requests a scroll target.

import { For, Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { boardStore } from "../store/board"
import { cardTreeStore } from "../store/card-tree"
import { conversationAgentRecordsForSource } from "../store/conversation-agents"
import { setCardExpanded } from "../store/conversation-ui"
import {
  conversationCardContainsMessage,
  loadConversationHistoryUntilCard,
  loadConversationSessionHistory,
} from "../services/conversation"
import { requestConversationCardScroll } from "../services/conversation-scroll"
import { formatErrorDetails, notifyWarning } from "../services/notify"
import { t } from "../utils/i18n"
import { goalCompactLabelFromIndexes } from "../utils/goal-label"
import { goalState, type GoalState } from "../utils/goal-state"
import { parentIDChainForCard } from "../utils/card-tree"
import { AppLog } from "../utils/log"
import type { AgentWorkflowRecord } from "../utils/agent-workflow"
import { Icon, type IconName } from "./Icon"
import { createAnimationFrameScheduler } from "../utils/animation-frame"
import { currentUIScale } from "../utils/layout-tokens"
import { Button } from "./ui/Button"
import {
  clampTaskProgressFloatingFrame,
  initialTaskProgressFloatingFrame,
  moveTaskProgressFloatingFrame,
  resizeTaskProgressFloatingFrame,
  taskProgressFloatingBounds,
  type TaskProgressFloatingFrame,
} from "./task-progress-floating-frame"

/** Visible pill rows before the strip collapses behind a "+N more" toggle.
 *  Operators scanning a long task want the goal list visible at a glance, not
 *  pushing the conversation down by 8+ rows. Three rows fits ~6–12 pills in a
 *  typical conversation column and keeps the sticky header light. */
const MAX_VISIBLE_PILL_ROWS = 3

const GOAL_STATE_ICON_NAMES: Record<GoalState, IconName> = {
  pending: "status-idle",
  running: "refresh",
  passed: "check",
  failed: "status-failed",
  blocked: "status-failed",
}

function goalStateIconName(state: GoalState): IconName {
  return GOAL_STATE_ICON_NAMES[state]
}

interface GoalPill {
  goalID: string
  index: number
  attempt: number
  title: string
  state: GoalState
}

function pillStateLabel(state: GoalState, title: string): string {
  // Static `t(\`progress.goal.${state}\`)` so the i18n linter sees
  // "progress.goal" as a referenced prefix (template-literal head + dot
  // matches its ancestor rule).
  return t(`progress.goal.${state}`, { title })
}

/** Find the on-screen card id that represents this goal's most recent
 *  attempt, so clicking the pill scrolls the timeline to it. We use
 *  cardTreeStore directly because the writer owns step-card projection. */
function findGoalCardID(goalID: string): string | undefined {
  const ids = cardTreeStore.order
  for (let i = ids.length - 1; i >= 0; i--) {
    const card = cardTreeStore.cards[ids[i]]
    if (!card) continue
    if (card.goalID === goalID) return card.id
  }
  return undefined
}

function goalWorkflowForID(goalID: string): any | undefined {
  const list = (boardStore.board as any)?.goalWorkflows
  if (!Array.isArray(list)) return undefined
  return list.find((goal: any) => String(goal?.goalID || "") === goalID)
}

function buildSessionIDForGoal(goalID: string): string {
  const goal = goalWorkflowForID(goalID)
  const steps = Array.isArray(goal?.steps) ? goal.steps : []
  for (const step of steps) {
    const sessionID = String(step?.payload?.buildSessionID || "").trim()
    if (sessionID) return sessionID
  }
  return ""
}

function goalTitleForID(goalID: string): string {
  const goal = goalWorkflowForID(goalID)
  return String(goal?.goalTitle || goalID).trim()
}

function recordForSession(sessionID: string): AgentWorkflowRecord | undefined {
  const targetSessionID = String(sessionID || "")
  if (!targetSessionID) return undefined
  return conversationAgentRecordsForSource(boardStore.selectedSource).find(
    (record) => record.sessionID === targetSessionID,
  )
}

function taskIDForGoalLocate(): string {
  return boardStore.selectedSource?.kind === "task" ? String(boardStore.selectedSource.id || "") : ""
}

function taskDirectoryForGoalLocate(): string {
  return String((boardStore.board as any)?.task?.directory || "").trim()
}

function describeGoalLocate(goalID: string, sessionID = "", cardID = "", messageID = ""): string {
  const lines = [`goalID: ${goalID}`, `goalTitle: ${goalTitleForID(goalID) || goalID}`]
  if (sessionID) lines.push(`buildSessionID: ${sessionID}`)
  if (cardID) lines.push(`renderedCardID: ${cardID}`)
  if (messageID) lines.push(`targetMessageID: ${messageID}`)
  return lines.join("\n")
}

function reportGoalLocateFailure(goalID: string, error: unknown, sessionID = "", cardID = "", messageID = ""): void {
  const details = `${describeGoalLocate(goalID, sessionID, cardID, messageID)}\n\n${formatErrorDetails(error)}`
  AppLog.error("ui", "Task progress goal locate failed", {
    goalID,
    sessionID,
    renderedCardID: cardID,
    targetMessageID: messageID,
    error: formatErrorDetails(error),
    notificationID: `task-progress:locate-failed:${goalID}`,
    notificationTitle: t("progress.card_unavailable_title"),
    notificationMessage: t("progress.locate_failed", { title: goalTitleForID(goalID) || goalID }),
    notificationDetails: details,
  })
  notifyWarning({
    id: `task-progress:locate-failed:${goalID}`,
    title: t("progress.card_unavailable_title"),
    message: t("progress.locate_failed", { title: goalTitleForID(goalID) || goalID }),
    details,
  })
}

async function materializeGoalCard(goalID: string): Promise<string> {
  const sessionID = buildSessionIDForGoal(goalID)
  if (!sessionID) throw new Error(`goal ${goalID} has no build session in board goal workflow`)
  const taskID = taskIDForGoalLocate()
  if (!taskID) throw new Error(`goal ${goalID} locate requires a selected task source`)
  const directory = taskDirectoryForGoalLocate()
  if (!directory) throw new Error(`task ${taskID} has no directory for goal history load`)

  const initialRecord = recordForSession(sessionID)
  const initialCardID = initialRecord?.renderedCardID || findGoalCardID(goalID) || ""
  const targetMessageID = String(initialRecord?.targetMessageID || "")
  const needsHistory =
    !initialCardID || !targetMessageID || !conversationCardContainsMessage(initialCardID, targetMessageID)
  if (needsHistory) {
    if (initialCardID && targetMessageID) {
      await loadConversationHistoryUntilCard(initialCardID, taskID, {
        messageID: targetMessageID,
        sessionID,
        directory,
      })
    } else {
      await loadConversationSessionHistory(sessionID, taskID, { directory })
    }
  }

  const currentRecord = recordForSession(sessionID)
  const currentCardID = currentRecord?.renderedCardID || findGoalCardID(goalID) || initialCardID
  if (!currentCardID || !cardTreeStore.cards[currentCardID]) {
    throw new Error(`goal ${goalID} has no rendered conversation card after session history load`)
  }
  const currentMessageID = String(currentRecord?.targetMessageID || targetMessageID || "")
  if (currentMessageID && !conversationCardContainsMessage(currentCardID, currentMessageID)) {
    throw new Error(`goal ${goalID} rendered card ${currentCardID} does not contain target message ${currentMessageID}`)
  }
  return currentCardID
}

function expandCardAndParents(cardID: string): void {
  const target = cardTreeStore.cards[cardID]
  setCardExpanded(cardID, true, target?.status)
  for (const parentID of parentIDChainForCard(cardID)) {
    const parent = cardTreeStore.cards[parentID]
    setCardExpanded(parentID, true, parent?.status)
  }
}

type FloatingPointerSession = {
  kind: "move" | "resize"
  pointerID: number
  startClientX: number
  startClientY: number
  startFrame: TaskProgressFloatingFrame
  captureElement: HTMLElement
}

interface TaskProgressBarProps {
  messagePanel: HTMLElement
  overlayMount: HTMLElement
}

export function TaskProgressBar(props: TaskProgressBarProps) {
  const goals = createMemo<GoalPill[]>(() => {
    const list = (boardStore.board as any)?.goalWorkflows
    if (!Array.isArray(list) || list.length === 0) return []
    return list.map(
      (g: any, i: number): GoalPill => ({
        goalID: String(g?.goalID || `goal-${i}`),
        index: typeof g?.orderIndex === "number" ? g.orderIndex : i,
        attempt: typeof g?.retryCount === "number" ? g.retryCount : 0,
        title: String(g?.goalTitle || "").trim() || `Goal ${i + 1}`,
        state: goalState(g),
      }),
    )
  })

  const counts = createMemo(() => {
    const all = goals()
    let passed = 0
    let failed = 0
    let running = 0
    let pending = 0
    let blocked = 0
    for (const g of all) {
      if (g.state === "passed") passed++
      else if (g.state === "failed") failed++
      else if (g.state === "running") running++
      else if (g.state === "pending") pending++
      else if (g.state === "blocked") blocked++
    }
    return { passed, failed, running, pending, blocked, total: all.length }
  })

  const hasGoals = () => goals().length > 0

  // ── Auto-collapse beyond MAX_VISIBLE_PILL_ROWS ──
  // A ResizeObserver on the pills container measures the offsetTop of each
  // pill to count visual rows (pill heights are not deterministic — they
  // depend on UI scale, font, and pill-title length when wrapped). When the
  // natural layout would exceed 3 rows we expose a `+N more` toggle; under
  // the limit the toggle stays hidden and the strip is unconstrained.
  const [progressEl, setProgressEl] = createSignal<HTMLDivElement | null>(null)
  const [pillsEl, setPillsEl] = createSignal<HTMLDivElement | null>(null)
  const [folded, setFolded] = createSignal(false)
  const [expanded, setExpanded] = createSignal(false)
  const [hiddenCount, setHiddenCount] = createSignal(0)
  const [collapsedMaxHeight, setCollapsedMaxHeight] = createSignal<number | null>(null)
  const [floatingFrame, setFloatingFrame] = createSignal<TaskProgressFloatingFrame | null>(null)
  const [windowState, setWindowState] = createSignal<"idle" | "dragging" | "resizing">("idle")
  const [hotGoalID, setHotGoalID] = createSignal("")
  let floatingPointerSession: FloatingPointerSession | null = null

  const remeasure = () => {
    const el = pillsEl()
    if (!el) return
    const pills = el.querySelectorAll<HTMLElement>('[data-ui="task-progress-pill"]')
    if (pills.length === 0) {
      setHiddenCount(0)
      setCollapsedMaxHeight(null)
      return
    }
    // Group pills by their offsetTop (rounded to the nearest pixel to absorb
    // sub-pixel layout drift). Even when the container is collapsed, each
    // pill's offsetTop still reports its natural position relative to the
    // flex container — only paint is clipped — so this measurement works in
    // both expanded and collapsed states.
    const rowTops: number[] = []
    let lastTop = Number.NEGATIVE_INFINITY
    for (let i = 0; i < pills.length; i++) {
      const top = Math.round(pills[i].offsetTop)
      if (top > lastTop + 1) {
        rowTops.push(top)
        lastTop = top
      }
    }
    if (rowTops.length <= MAX_VISIBLE_PILL_ROWS) {
      setHiddenCount(0)
      setCollapsedMaxHeight(null)
      return
    }
    const firstHiddenTop = rowTops[MAX_VISIBLE_PILL_ROWS]
    let firstHiddenIndex = pills.length
    for (let i = 0; i < pills.length; i++) {
      if (Math.round(pills[i].offsetTop) >= firstHiddenTop) {
        firstHiddenIndex = i
        break
      }
    }
    setHiddenCount(pills.length - firstHiddenIndex)
    // Clip the container exactly at the first-hidden-row top so the last
    // visible row never gets truncated mid-pill.
    setCollapsedMaxHeight(firstHiddenTop)
  }

  createEffect(() => {
    const el = pillsEl()
    if (!el) return
    const remeasureOnFrame = createAnimationFrameScheduler(remeasure)
    // Initial measure waits for the first paint so offsetTop values are stable.
    remeasureOnFrame.schedule()
    const ro = new ResizeObserver(remeasureOnFrame.schedule)
    ro.observe(el)
    // Pill children may resize independently of the container (i18n switch
    // changes label length; UI scale changes pill padding). Observe each pill
    // to catch those cases too.
    const observed = new WeakSet<Element>()
    const observePills = () => {
      const current = pillsEl()
      if (!current) return
      for (const pill of current.querySelectorAll<HTMLElement>('[data-ui="task-progress-pill"]')) {
        if (!observed.has(pill)) {
          ro.observe(pill)
          observed.add(pill)
        }
      }
    }
    observePills()
    const mo = new MutationObserver(() => {
      observePills()
      remeasureOnFrame.schedule()
    })
    mo.observe(el, { childList: true, subtree: false })
    onCleanup(() => {
      ro.disconnect()
      mo.disconnect()
      remeasureOnFrame.cancel()
    })
  })

  const currentFloatingBounds = () => {
    return taskProgressFloatingBounds(props.messagePanel.clientWidth, props.messagePanel.clientHeight, currentUIScale())
  }

  const syncFloatingFrame = () => {
    const bounds = currentFloatingBounds()
    setFloatingFrame((current) =>
      current ? clampTaskProgressFloatingFrame(current, bounds) : initialTaskProgressFloatingFrame(bounds),
    )
  }

  createEffect(() => {
    const current = progressEl()
    if (!current) return
    const syncOnFrame = createAnimationFrameScheduler(syncFloatingFrame)
    syncOnFrame.schedule()
    const ro = new ResizeObserver(syncOnFrame.schedule)
    ro.observe(props.messagePanel)
    ro.observe(props.overlayMount)
    window.addEventListener("resize", syncOnFrame.schedule)
    onCleanup(() => {
      window.removeEventListener("resize", syncOnFrame.schedule)
      ro.disconnect()
      syncOnFrame.cancel()
      floatingPointerSession = null
      setWindowState("idle")
    })
  })

  const floatingStyle = () => {
    const frame = floatingFrame()
    if (!frame) return undefined
    const panelRect = props.messagePanel.getBoundingClientRect()
    const mountRect = props.overlayMount.getBoundingClientRect()
    return {
      "--task-progress-left": `${Math.round(panelRect.left - mountRect.left + frame.x)}px`,
      "--task-progress-top": `${Math.round(panelRect.top - mountRect.top + frame.y)}px`,
      "--task-progress-width": `${frame.width}px`,
      "--task-progress-height": `${frame.height}px`,
    }
  }

  const beginFloatingPointerSession = (event: PointerEvent, kind: FloatingPointerSession["kind"]) => {
    if (event.button !== 0) return
    const frame = floatingFrame()
    if (!frame) throw new Error("TaskProgressBar floating pointer session requires an initialized frame.")
    const captureElement = event.currentTarget as HTMLElement
    captureElement.setPointerCapture(event.pointerId)
    floatingPointerSession = {
      kind,
      pointerID: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startFrame: frame,
      captureElement,
    }
    setWindowState(kind === "move" ? "dragging" : "resizing")
    event.preventDefault()
  }

  const onHeaderPointerDown = (event: PointerEvent) => {
    const target = event.target as HTMLElement | null
    if (target?.closest("button, a, input, textarea, select")) return
    beginFloatingPointerSession(event, "move")
  }

  const onResizePointerDown = (event: PointerEvent) => {
    beginFloatingPointerSession(event, "resize")
    event.stopPropagation()
  }

  const onFloatingPointerMove = (event: PointerEvent) => {
    const session = floatingPointerSession
    if (!session || session.pointerID !== event.pointerId) return
    const deltaX = event.clientX - session.startClientX
    const deltaY = event.clientY - session.startClientY
    const bounds = currentFloatingBounds()
    setFloatingFrame(
      session.kind === "move"
        ? moveTaskProgressFloatingFrame(session.startFrame, deltaX, deltaY, bounds)
        : resizeTaskProgressFloatingFrame(session.startFrame, deltaX, deltaY, bounds),
    )
    event.preventDefault()
  }

  const endFloatingPointerSession = (event: PointerEvent) => {
    const session = floatingPointerSession
    if (!session || session.pointerID !== event.pointerId) return
    if (session.captureElement.hasPointerCapture(event.pointerId)) {
      session.captureElement.releasePointerCapture(event.pointerId)
    }
    floatingPointerSession = null
    setWindowState("idle")
  }

  const [locatingGoalID, setLocatingGoalID] = createSignal("")

  const onPillClick = (goalID: string) => {
    void (async () => {
      const sessionID = buildSessionIDForGoal(goalID)
      const record = recordForSession(sessionID)
      const renderedCardID = record?.renderedCardID || findGoalCardID(goalID) || ""
      const targetMessageID = String(record?.targetMessageID || "")
      setLocatingGoalID(goalID)
      try {
        const cardID = await materializeGoalCard(goalID)
        expandCardAndParents(cardID)
        const found = await requestConversationCardScroll({
          cardID,
          behavior: "smooth",
          block: "start",
          focus: "card",
          highlight: true,
        })
        if (!found) {
          const selector = `[data-card-id="${CSS.escape(cardID)}"]`
          throw new Error(`rendered goal card missing from DOM: ${selector}`)
        }
      } catch (error) {
        reportGoalLocateFailure(goalID, error, sessionID, renderedCardID, targetMessageID)
      } finally {
        if (locatingGoalID() === goalID) setLocatingGoalID("")
      }
    })()
  }

  return (
    <Show when={hasGoals()} fallback={null}>
      <div
        ref={setProgressEl}
        class="task-progress"
        role="region"
        aria-label={t("progress.heading")}
        data-folded={folded() ? "true" : "false"}
        data-floating-ready={floatingFrame() ? "true" : "false"}
        data-running={counts().running > 0 ? "true" : undefined}
        data-window-state={windowState()}
        style={floatingStyle()}
        onPointerMove={onFloatingPointerMove}
        onPointerUp={endFloatingPointerSession}
        onPointerCancel={endFloatingPointerSession}
      >
        <div
          class="task-progress__header"
          data-ui="task-progress-drag-handle"
          title={t("progress.move_window")}
          onPointerDown={onHeaderPointerDown}
        >
          <span class="task-progress__heading">{t("progress.heading")}</span>
          <span class="task-progress__counts">
            <Show when={counts().passed > 0}>
              <span
                class="task-progress__count"
                data-state="passed"
                title={t("progress.count.passed", { count: String(counts().passed) })}
              >
                <span class="task-progress__count-dot" aria-hidden="true" />
                <span>{counts().passed}</span>
              </span>
            </Show>
            <Show when={counts().running > 0}>
              <span
                class="task-progress__count"
                data-state="running"
                title={t("progress.count.running", { count: String(counts().running) })}
              >
                <span class="task-progress__count-dot" aria-hidden="true" />
                <span>{counts().running}</span>
              </span>
            </Show>
            <Show when={counts().failed > 0}>
              <span
                class="task-progress__count"
                data-state="failed"
                title={t("progress.count.failed", { count: String(counts().failed) })}
              >
                <span class="task-progress__count-dot" aria-hidden="true" />
                <span>{counts().failed}</span>
              </span>
            </Show>
            <Show when={counts().pending > 0}>
              <span
                class="task-progress__count"
                data-state="pending"
                title={t("progress.count.pending", { count: String(counts().pending) })}
              >
                <span class="task-progress__count-dot" aria-hidden="true" />
                <span>{counts().pending}</span>
              </span>
            </Show>
          </span>
          <span
            class="task-progress__summary"
            title={t("progress.summary", {
              passed: String(counts().passed),
              failed: String(counts().failed),
              running: String(counts().running),
              total: String(counts().total),
            })}
          >
            {counts().passed}/{counts().total}
          </span>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            tone="neutral"
            data-ui="task-progress-fold"
            aria-expanded={folded() ? "false" : "true"}
            aria-controls="taskProgressPills"
            title={folded() ? t("progress.expand_card") : t("progress.collapse_card")}
            aria-label={folded() ? t("progress.expand_card") : t("progress.collapse_card")}
            onClick={() => setFolded((value) => !value)}
          >
            <Icon name={folded() ? "chevron-down" : "chevron-up"} size={12} />
          </Button>
        </div>
        <div class="task-progress__body">
          <div class="task-progress__bar" aria-hidden="true">
            <For each={goals()}>
              {(g) => (
                <span
                  class="task-progress__segment"
                  data-ui="task-progress-segment"
                  data-state={g.state}
                  data-goal-id={g.goalID}
                  data-hot={hotGoalID() === g.goalID ? "true" : undefined}
                  title={pillStateLabel(g.state, g.title)}
                  onMouseEnter={() => setHotGoalID(g.goalID)}
                  onMouseLeave={() => setHotGoalID("")}
                />
              )}
            </For>
          </div>
          <div
            id="taskProgressPills"
            ref={setPillsEl}
            class="task-progress__pills"
            data-collapsed={hiddenCount() > 0 && !expanded() ? "true" : "false"}
            style={
              hiddenCount() > 0 && !expanded() && collapsedMaxHeight() !== null
                ? { "max-height": `${collapsedMaxHeight()}px` }
                : undefined
            }
          >
            <For each={goals()}>
              {(g) => (
                <Button
                  type="button"
                  variant="outline"
                  size="mini"
                  tone="neutral"
                  data-ui="task-progress-pill"
                  data-goal-id={g.goalID}
                  data-state={g.state}
                  data-hot={hotGoalID() === g.goalID ? "true" : undefined}
                  data-loading={locatingGoalID() === g.goalID ? "true" : undefined}
                  title={pillStateLabel(g.state, g.title)}
                  aria-label={pillStateLabel(g.state, g.title)}
                  aria-busy={locatingGoalID() === g.goalID ? "true" : undefined}
                  onMouseEnter={() => setHotGoalID(g.goalID)}
                  onMouseLeave={() => setHotGoalID("")}
                  onClick={() => onPillClick(g.goalID)}
                >
                  <span class="task-progress__pill-icon" aria-hidden="true">
                    <Icon name={goalStateIconName(g.state)} size={12} />
                  </span>
                  <span class="task-progress__pill-id">{goalCompactLabelFromIndexes(g.index, g.attempt)}</span>
                  <span class="task-progress__pill-title">{g.title}</span>
                </Button>
              )}
            </For>
          </div>
          <Show when={hiddenCount() > 0}>
            <Button
              type="button"
              variant="ghost"
              size="mini"
              tone="neutral"
              data-ui="task-progress-toggle"
              aria-expanded={expanded() ? "true" : "false"}
              onClick={() => setExpanded((v) => !v)}
            >
              {expanded() ? t("progress.collapse") : t("progress.expand_more", { count: String(hiddenCount()) })}
            </Button>
          </Show>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tone="neutral"
          data-ui="task-progress-resize"
          title={t("progress.resize_window")}
          aria-label={t("progress.resize_window")}
          onPointerDown={onResizePointerDown}
        />
      </div>
    </Show>
  )
}
