// ── Card Tree Store ──
//
// Single reactive source of truth for the overlay's conversation view.
//
// Shape: flat `cards` dict keyed by stable id + an ordered list of top-level
// ids. Children are referenced by id (`childIDs: string[]`), NOT inlined,
// so adding/removing a child writes only to the parent's `childIDs` array.
// Part lists work the same way — `CardNode.parts` is the canonical array,
// targeted writes update `cardTreeStore.cards[id].parts[idx].<field>`.
//
// ID conventions (deterministic, construction-time):
//   ctx:user-request                                       — task request bubble
//   ctx:user-request:text                                  — the text part of that bubble
//   ctx:user-request:file:<url|idx>                        — an attachment part
//   <stage>:session:<sid>:message:<mid>                    — agent run-segment card
//                                                            (mid is the first message in the segment;
//                                                            consecutive messages from the same
//                                                            session reuse the card until another
//                                                            session interrupts)
//   part:<messageID>:<partID>                              — part inside a session card
//   step:<goalID>:<goalRunID|"pre">:<stepID>               — per-goal executor step (top-level),
//                                                            scoped to one attempt (goal_run)
//   step:<goalID>:<goalRunID|"pre">:<stepID>:phase:<phaseID>
//                                                          — phase row inside an executor step
//   interaction:<interactionID>                            — interaction card
//
// Note: the legacy `goal-group:*` container layer was removed in the
// 2026-04-19 flatten. Each goal now surfaces its single goal-scope step
// directly at the top level, with goal title / decomposition index
// (`#orderIndex+1`) / description stamped onto the step card.
//
// 2026-04-21 per-attempt isolation: step / phase card ids carry the
// current `goal_run.id` so each retry / acceptance_rework / modify_contract
// / restart_stage gets a fresh top-level card appended in time order.
// Prior attempts survive as frozen history — the renderer shows them in
// their original position; new activity lands on the new card. The
// `"pre"` sentinel is used when no goal_run exists yet (pre-dispatch
// stubs); it collapses into the real run id on the first rebuild after
// dispatch.
//
// The writer (services/tree-writer.ts) is the only module that mutates
// this store. Components read only. No memos, no derivations — components
// walk `cardTreeStore.cards[id]` through the Solid proxy, and Solid's
// fine-grained reactivity handles the rest.

import { createStore, produce, reconcile } from "solid-js/store"
import type { ScreenshotBrowserItem } from "../utils/screenshot-browser"
import type { UsageAggregate } from "../utils/format-usage"

export type CardKind =
  | "agent" // per-session agent card (orchestrator, build worker, planner, ...)
  | "step" // per-goal executor step card — top-level, carries goal metadata
  | "phase" // phase row inside a step (plan / build / evaluate inside pipeline.build)
  | "tool" // promoted tool call (nested card for task/subagent)
  | "message" // user / system message bubble
  | "review" // top-level running/completed review stream card
  | "integrity" // architecture integrity review verdict

export type CardStatus =
  | "pending"
  | "running" // LLM stream actively in flight (spinner ON)
  | "idle" // session alive but between turns, awaiting next user message / wake (no spinner)
  | "completed"
  | "error"
  | "skipped"

/** Synthetic "part" used by the renderer to emit a role separator between
 *  flattened messages. Carries the effective role and optional timestamp. */
export interface BoundaryPart {
  type: "boundary"
  role: string
  roleLabel: string
  time?: number
}

/** Structured step payload — only populated for kind="step" nodes. Mirrors
 *  `workbench/board.ts GoalStepPayload` since step rows show the same detail
 *  the sidebar Goals panel shows. */
export interface StepPayload {
  planNodes?: Array<{
    id: string
    title: string
    brief: string
    orderIndex: number
    fileActions?: Array<{ path: string; intent: string }>
    verificationCommands?: Array<{ command: string; purpose: string }>
  }>
  buildSessionID?: string
  commitRef?: string
  changedFiles?: string[]
  changedFileDiffs?: Array<{
    file: string
    additions?: number
    deletions?: number
    status?: "added" | "deleted" | "modified"
  }>
  diffStats?: { files?: number; additions?: number; deletions?: number }
  checks?: Array<{ name: string; status: string; evidence?: string; family?: string }>
  evalSummary?: string
  verdict?: string
}

/** Activity counts surfaced by collapsed bubble headers. Stored as a
 *  cached aggregate (`CardNode.subtreeCounts`) so the renderer reads
 *  `node.subtreeCounts` in O(1) instead of walking the subtree on every
 *  SSE event — see the stats kernel below. */
export interface ActivityCounts {
  messages: number
  tools: number
  agents: number
  skills: number
}

/** Cached "latest activity" hit used by `collectLatestActivityText`. The
 *  renderer wants the most recent text-or-tool moment in the subtree; we
 *  cache the (time,index)-tuple plus the rendered text so collapsed bubble
 *  reads are O(1). `text` is the already-formatted line (markdown for text
 *  parts, "icon Tool: detail" for tool parts) — see toolHitText / partText
 *  in utils/card-tree.ts. */
export interface LatestActivityHit {
  time: number
  index: number
  text: string
}

/** Cached todo-list hit (most-recent TODO tool call in the subtree). The
 *  renderer's `collectTodoSummary` derives counts from `todos`. */
export interface TodoActivityHit {
  time: number
  index: number
  todos: any[]
}

/** CardNode is the fundamental unit of the conversation tree. `children` is
 *  ALWAYS an array of ids (not inline objects); the renderer dereferences
 *  through `cardTreeStore.cards[id]`. This indirection is what makes targeted
 *  writes cheap — moving a card between parents is two `setCardTreeStore`
 *  calls (remove from old, add to new) rather than a full tree rebuild. */
export interface CardNode {
  id: string
  kind: CardKind
  /** Back-pointer maintained by `tree-writer.linkChildToParent` whenever a
   *  cardID is placed into another card's `childIDs`. Read only by the
   *  stats kernel (`bubbleStatsFromCard`) to walk ancestors in O(depth)
   *  without rescanning the whole `cards` dict. Components never read this
   *  field, so writing it does not trigger spurious re-renders. */
  parentID?: string
  /** Runtime session id that owns this card. Drives trace / reply / cancel /
   *  agent-workflow projection. Renderer and workflow utilities MUST read
   *  this explicit field — never parse the session id out of `id`. Phase
   *  cards intentionally leave this unset and use `phaseSessionID` instead
   *  (a phase card absorbs a goal-scoped runtime session, it is not a
   *  message-turn card). */
  sessionID?: string
  /** Durable message id that opened this display segment. Consecutive
   *  `message.updated` rows from the same session can share this card;
   *  once another session interrupts, the next message opens a new segment.
   *  Unset on phase / step / interaction / task-context cards. */
  messageID?: string
  /** Session kind / stage name (assistant / executor / build / planner / goal / ...). */
  stage?: string
  /** Resolved accent colour for this card's stage. */
  accent?: string
  status?: CardStatus
  role?: string
  title: string
  subtitle?: string
  /** Goal decomposition index + 1; shown as `#GN` when > 0. Stamped onto the
   *  executor step card from the backend `goalWorkflow.orderIndex` so the
   *  number matches the numbered breakdown operators see during requirements
   *  planning (and does NOT re-number when a goal is removed). */
  round?: number
  /** Goal attempt / retry index + 1; shown as `Vn` alongside `#GN` on the
   *  goal-scoped step card so retries are distinguishable in the timeline. */
  attempt?: number
  /** Goal this card belongs to. Set on executor step cards, goal-phase cards,
   *  and any session card that was routed to a goal phase. */
  goalID?: string
  /** Goal objective prose — rendered at the top of the step card body. Set
   *  only on executor step cards (kind="step"). */
  goalDescription?: string
  stepPayload?: StepPayload
  stepID?: string
  /** Phase identifier for kind="phase" nodes. Matches the phase.id declared
   *  on the backend workflow step (see
   *  packages/opencorvus/src/engine/workflow.ts PIPELINE.build.phases). */
  phaseID?: string
  /** Session kind this phase claims — the stage value used by
   *  resolveSessionContainerCardID to route incoming session cards. Only
   *  set for kind="phase" nodes. */
  phaseSessionKind?: string
  /** SessionID of the sub-agent session whose parts this phase card has
   *  absorbed. Set by `resolvePhaseOrSessionCardID` when the phase card
   *  is materialized — phase cards fold their session into themselves so
   *  no `kind="agent"` card exists, but the AgentSessionReplyBox still
   *  needs the sessionID for controls. Non-build phases use it for
   *  `/task/:taskID/session/:sessionID/reply`; build phases use it as
   *  visible target context for task-level operator guidance. */
  phaseSessionID?: string
  /** Inline leaves — text / reasoning / tool / patch / file / subtask / boundary /
   *  interaction-question / interaction-permission. Tool parts that are "promoted"
   *  become their own CardNode instead (with `toolPart` populated). */
  parts: any[]
  /** Child card ids (resolved by the renderer via `cardTreeStore.cards[id]`).
   *  Used by cards that live in `cardTreeStore` — the renderer dereferences
   *  each id through the store proxy, preserving fine-grained reactivity.
   *
   *  Optional: transient cards (tool promotion, legacy old-pipeline nodes)
   *  use the inline `children` field below instead. Store-backed cards
   *  always populate this field (writer guarantees `[]` default). */
  childIDs?: string[]
  /** Inline CardNode children — used only by TRANSIENT cards built on the fly
   *  by the renderer (e.g. `<CardParts>` promotes a tool `part` into its own
   *  card via `toolToCardNode`). Transient cards do not live in the store;
   *  their identity dies with the mount, so they can safely carry inline
   *  object references. Cards in `cardTreeStore` never set this field.
   *
   *  The renderer prefers `childIDs` when present — if a card has both,
   *  the store-backed children win. */
  children?: CardNode[]
  /** Chronological sort key in ms. Required: every card carries its birth
   *  timestamp. Upstream sources (message.info.time.created, task.time.created,
   *  goal_run.time_started) are all `Date.now()` on the server — this layer
   *  does not tolerate missing values. A card without a real time must fall
   *  back to `Date.now()` at observation (only the `pending:session:<sid>`
   *  SSE-race stub needs this, and that stub is hidden until the real
   *  `message.updated` overwrites `time`). If a consumer ever reads an
   *  undefined `time`, the rebuild sort throws — we surface the bug rather
   *  than silently park the card at an arbitrary position. */
  time: number
  defaultExpanded?: boolean
  /** Raw tool part for kind="tool" nodes — rendered by <Card> via
   *  InlineToolPart mode="body". Always undefined for non-tool kinds. */
  toolPart?: any
  contextTokens?: number
  contextTokensEstimated?: boolean
  /** Per-message LLM usage projected from `Message.Assistant.{tokens,cost}`
   *  in tree-writer's `handleMessageUpdated`. The engine writes
   *  cumulative-within-message tokens onto the message row
   *  (session/processor.ts step-finish + build/agent.ts case "usage")
   *  and message.updated carries them through unchanged — the single
   *  source. Renderer (CardHeader) prints `↑in / ↓out · $cost`. Stays
   *  undefined for non-assistant cards. */
  usage?: {
    inputTokens?: number
    outputTokens?: number
    totalTokens?: number
    costUSD?: number
  }
  /** Actual model observed on assistant message info. Projected from
   *  `Message.Assistant.{providerID,modelID}` by tree-writer when the
   *  backend emits or hydrates the message; renderers must not derive this
   *  from current config because config may have changed after the turn. */
  model?: {
    providerID: string
    modelID: string
    display: string
  }
  /** Timestamp (ms) when the session this card represents transitioned to
   *  a terminal state (idle / error / done). Stamped by tree-writer's
   *  `handleSessionStatus` on the terminal flip. CardHeader subtracts
   *  `time` to render the running-or-finished duration. */
  timeCompleted?: number
  /** Free-text error reason carried on `session.status` terminal events
   *  (status.message / status.error). Surfaced in CardHeader as a
   *  read-only chip when present so the operator sees WHY the card flipped
   *  red instead of just the badge color change. */
  errorReason?: string
  /** Raw terminal reason carried by `session.status` terminal events.
   *  Overlay keeps this separate from `status` because cancelled/aborted
   *  sessions intentionally use the terminal status channel while rendering
   *  differently from hard errors. */
  terminalReason?: "completed" | "error" | "aborted"
  /** Structured integrity review payload. Populated on the integrity
   *  supervisor session card (`kind="agent"`, `stage="integrity"`) when
   *  consensus completes; reviewer child session cards usually carry only
   *  reviewStream/parts. Mirrors `IntegrityReviewCompleted` event shape. */
  integrity?: {
    verdict: "pass" | "concerns" | "needs_correction"
    summary: string
    teamReportMarkdown: string
    reviewers: Array<{
      reviewerID: string
      scope: string
      verdict: "pass" | "concerns" | "needs_correction"
      summary: string
      evidence: string[]
      findings: unknown[]
      openQuestions: string[]
    }>
    findings: Array<{
      id: string
      severity: "blocking" | "advisory"
      verdictImpact: "pass" | "concerns" | "needs_correction"
      fingerprint?: string
      canonicalSymptom?: string
      title: string
      description: string
      evidence: string[]
      targetIDs: string[]
      requirementIDs: string[]
      specIDs: string[]
      filePaths: string[]
      affectedSymbols: string[]
      repair: string
      verify: string[]
      sourceFindingIDs: string[]
      priorAttemptRefs: string[]
      reviewers: string[]
      consensus: "agreed" | "disputed" | "unresolved"
    }>
    requiredRepairs: Array<{
      id: string
      fingerprint?: string
      severity?: "blocking" | "advisory"
      title?: string
      canonicalSymptom?: string
      description: string
      evidence: string[]
      targetIDs: string[]
      requirementIDs: string[]
      specIDs: string[]
      filePaths: string[]
      affectedSymbols: string[]
      repair?: string
      verify: string[]
      sourceFindingIDs: string[]
      priorAttemptRefs: string[]
    }>
    unresolvedDisagreements: Array<{
      id: string
      description: string
      reviewerIDs: string[]
      consequence: string
    }>
    attempts: number
  }
  reviewStream?: {
    phase: "integrity"
    currentStep?: "manifest" | "runtime" | "visual" | "specialist" | "agent" | "post_repair"
    activity?: string
    reviewerID?: string
    roundID?: string
    elapsedMs?: number
    summary?: string
  }
  /** Cached activity counts for this card's subtree (own parts/toolPart +
   *  all reachable descendants). Maintained by the stats kernel below,
   *  invalidated by tree-writer whenever a part/toolPart/childIDs write
   *  could change the result. Components read this field directly via
   *  `collectActivityCounts` to render collapsed bubble headers in O(1). */
  subtreeCounts?: ActivityCounts
  /** Cached "latest text-or-tool activity" hit for this card's subtree.
   *  Source of truth for the collapsed bubble preview line — components
   *  read this via `collectLatestActivityText`. */
  subtreeLatestHit?: LatestActivityHit
  /** Cached most-recent TODO-tool hit in this card's subtree. The renderer
   *  derives the user-facing `TodoSummary` from this via
   *  `collectTodoSummary`. */
  subtreeTodoHit?: TodoActivityHit
  /** Cached bounded screenshot items for this card's subtree. Maintained by
   *  the same stats kernel as subtreeCounts / subtreeLatestHit /
   *  subtreeTodoHit, so the screenshot browser can read top-level subtree
   *  aggregates without walking every child card on toolbar open. */
  subtreeScreenshotItems?: ScreenshotBrowserItem[]
  /** Cached usage aggregate for this card's subtree. Maintained by the same
   *  stats kernel so the always-mounted chat header usage strip never scans
   *  the entire card dictionary on SSE updates. */
  subtreeUsageAggregate?: UsageAggregate
}

export interface CardTreeStore {
  /** Top-level card ids in display order. */
  order: string[]
  /** Every card by id, flat. Includes cards referenced from any `childIDs`. */
  cards: Record<string, CardNode>
  /** Bounded newest screenshots for the visible top-level card tree.
   *  Maintained by `card-tree-stats.ts` from per-card
   *  `subtreeScreenshotItems`; UI surfaces read this directly so opening the
   *  screenshot browser does not scan top-level roots. */
  screenshotItems: ScreenshotBrowserItem[]
  /** Whole card-tree usage aggregate maintained by `card-tree-stats.ts`
   *  from each card's own usage payload. This preserves the historic
   *  chat-header semantics of aggregating every card in the dictionary,
   *  including message cards that already have usage but no visible parts. */
  usageAggregate: UsageAggregate
  /** Monotonic transcript-generation counter. Increments only when the whole
   *  visible tree is replaced, so scroll owners can drop follow-lock from the
   *  previous transcript instance without guessing from DOM emptiness. */
  treeEpoch: number
  /** Scroll intent stamped onto the most recent whole-tree replacement.
   *  `bottom` is used for explicit task switches where the operator should
   *  land on the latest content of the newly selected task. `preserve` is
   *  used for same-task hydrate/recovery so a user reading history does not
   *  get yanked to the tail. */
  treeReplacementScrollIntent: "preserve" | "bottom"
  /** Human-readable replacement cause for diagnostics / tests. */
  treeReplacementCause: string
  /** Monotonic visible-content version. The conversation scroll owner reads
   *  this single signal instead of observing rendered DOM mutations. */
  visibleVersion: number
  /** Rewind cursor (ms). When non-null, cards with time > cursor have been
   *  pruned from `order` + `cards` by pruneCardsAfterCursor(). The backend
   *  also filters its describe outputs, so any SSE event stream for this
   *  task will not re-deliver the pruned slice unless the cursor is cleared. */
  rewindCursor: number | null
}

export const [cardTreeStore, setCardTreeStore] = createStore<CardTreeStore>({
  order: [],
  cards: {},
  screenshotItems: [],
  usageAggregate: { tokens: 0, costUSD: 0, estimated: false },
  treeEpoch: 0,
  treeReplacementScrollIntent: "preserve",
  treeReplacementCause: "init",
  visibleVersion: 0,
  rewindCursor: null,
})

export function markCardTreeReplaced(
  options: {
    scrollIntent?: "preserve" | "bottom"
    cause?: string
  } = {},
): void {
  setCardTreeStore("treeReplacementScrollIntent", options.scrollIntent ?? "preserve")
  setCardTreeStore("treeReplacementCause", options.cause ?? "unspecified")
  setCardTreeStore("treeEpoch", (epoch) => epoch + 1)
}

export function markCardTreeVisibleChanged(): void {
  setCardTreeStore("visibleVersion", (version) => version + 1)
}

export function setHydratedRewindCursor(cursorTime: number | null): void {
  if (cursorTime !== null && (!Number.isFinite(cursorTime) || cursorTime <= 0)) {
    throw new Error(`setHydratedRewindCursor: cursorTime must be positive or null, got ${JSON.stringify(cursorTime)}`)
  }
  setCardTreeStore("rewindCursor", cursorTime)
  markCardTreeVisibleChanged()
}

let pruneStatsHandler: (() => void) | undefined
let orderStatsHandler: ((previousOrder: readonly string[], nextOrder: readonly string[]) => void) | undefined

export function registerCardTreePruneStatsHandler(handler: () => void): void {
  pruneStatsHandler = handler
}

export function registerCardTreeOrderStatsHandler(
  handler: (previousOrder: readonly string[], nextOrder: readonly string[]) => void,
): void {
  orderStatsHandler = handler
}

function flushPrunedCardTreeStats(): void {
  if (!pruneStatsHandler) {
    throw new Error("pruneCardsAfterCursor requires the card-tree stats kernel to be registered")
  }
  pruneStatsHandler()
}

function notifyCardTreeOrderStats(previousOrder: readonly string[], nextOrder: readonly string[]): void {
  if (!orderStatsHandler) {
    throw new Error("card tree order changes require the card-tree stats kernel to be registered")
  }
  orderStatsHandler(previousOrder, nextOrder)
}

function equalCardTreeOrder(a: readonly string[], b: readonly string[]): boolean {
  if (a === b) return true
  if (a.length !== b.length) return false
  for (let index = 0; index < b.length; index += 1) {
    if (a[index] !== b[index]) return false
  }
  return true
}

export function replaceCardTreeOrder(nextOrder: readonly string[] | ((order: readonly string[]) => readonly string[])): void {
  let changed = false
  let previousSnapshot: string[] = []
  let nextSnapshot: string[] = []
  setCardTreeStore("order", (current) => {
    previousSnapshot = Array.from(current)
    const next = typeof nextOrder === "function" ? Array.from(nextOrder(current)) : Array.from(nextOrder)
    nextSnapshot = next
    changed = !equalCardTreeOrder(current, next)
    return next
  })
  if (changed) notifyCardTreeOrderStats(previousSnapshot, nextSnapshot)
}

/**
 * Prune all top-level cards (and their orphaned children) whose `time` is
 * strictly greater than `cursorTime`. Called when the backend emits
 * `task.rewound` — we do NOT full-refresh the overlay; instead we walk the
 * store and remove the tail of the timeline that got filtered out on the
 * server side.
 *
 * Idempotent: re-calling with the same cursor is a no-op.
 */
export function pruneCardsAfterCursor(cursorTime: number) {
  setCardTreeStore("rewindCursor", cursorTime)
  replaceCardTreeOrder((order) =>
    order.filter((id) => {
      const card = cardTreeStore.cards[id]
      if (!card) return false
      return (card.time ?? 0) <= cursorTime
    }),
  )
  // Remove child cards whose time exceeds cursor as well. Keeping them
  // orphaned in `cards` wastes memory and risks stale references if the
  // renderer dereferences through childIDs.
  const survivors: Record<string, CardNode> = {}
  for (const [id, card] of Object.entries(cardTreeStore.cards)) {
    if ((card.time ?? 0) <= cursorTime) survivors[id] = card
  }
  setCardTreeStore("cards", reconcile(survivors, { merge: false }))
  const liveCardIDs = new Set(Object.keys(survivors))
  setCardTreeStore(
    "cards",
    produce((cards) => {
      for (const card of Object.values(cards)) {
        if (!card?.childIDs?.length) continue
        const nextChildIDs = card.childIDs.filter((childID) => liveCardIDs.has(childID))
        if (nextChildIDs.length !== card.childIDs.length) {
          card.childIDs = nextChildIDs
        }
      }
    }),
  )
  flushPrunedCardTreeStats()
  markCardTreeVisibleChanged()
}
