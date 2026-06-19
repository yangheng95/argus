// ── Tree Writer ──
//
// SSE events → precise writes into cardTreeStore.
// The single mutation entry point: `applyEvent(event)`. No other module
// writes to cardTreeStore.
//
// Design:
//   - Internal bookkeeping maps (plain JS, not reactive) index sessions,
//     goals, interactions, and part positions by stable ids.
//   - Each handler updates the internal index, then writes the affected
//     path(s) of cardTreeStore via `setCardTreeStore(path, value)`.
//   - The CardNode shape stored IS the final renderable tree: `childIDs`
//     is string[] so moving a child between parents is two targeted writes.
//   - Unknown event types throw. No fallback per project rule 1.
//
// Behavioural fixture: for the P0 trace, the tree produced here must match the
// checked-in snapshot byte-for-byte. The equivalence test in
// `test/new-writer-equivalence.test.ts` enforces this.

import { batch, createEffect } from "solid-js"
import { produce } from "solid-js/store"
import {
  cardTreeStore,
  markCardTreeReplaced,
  markCardTreeVisibleChanged,
  setCardTreeStore,
  type CardNode,
  type CardStatus,
} from "../store/card-tree"
import { flushCardStats, linkChildToParent, markCardStatsDirty, unlinkChildFromParent } from "../store/card-tree-stats"
import { boardStore, setBoardProjectionHandler } from "../store/board"
import { agentStageLabel, normalizeAgentRole, roleLabel } from "../utils/message"
import { stageAccent } from "../utils/card-color"
import { t } from "../utils/i18n"
import { normalizeToolPartRecord } from "../utils/tool"

/** Raw i18n key for a role/stage, normalized so that backend variants
 *  ("frontend_design", "frontend_design", "frontend-design") all resolve
 *  to the same canonical key (`chat.role.frontend-design`). The key is
 *  stored on the card; CardHeader calls `t()` at render time, keeping
 *  titles reactive to locale switches. */
function roleTitleKey(name: string): string {
  return `chat.role.${normalizeAgentRole(name)}`
}
import { interactionToCardSeeds, partitionInteractions } from "../utils/interaction"
import { isTreeWriterNoopEventType, isTreeWriterPassThroughEventType } from "./event-policy"
import { goalStagePhaseID } from "../utils/workflow-step"

// ── Internal indices ──

function finitePositiveNumber(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) && n > 0 ? n : 0
}

function usageProjectionFromInfo(info: any): MessageUsageProjection | undefined {
  if (String(info?.role || "") !== "assistant") return undefined
  const tokens = info?.tokens
  const cost = info?.cost
  if (!tokens && typeof cost !== "number") return undefined
  const inputTokens = finitePositiveNumber(tokens?.input)
  const outputTokens = finitePositiveNumber(tokens?.output)
  const totalTokens = finitePositiveNumber(tokens?.total) || inputTokens + outputTokens
  const cacheReadTokens = finitePositiveNumber(tokens?.cache?.read)
  const cacheWriteTokens = finitePositiveNumber(tokens?.cache?.write)
  const costUSD = Number.isFinite(Number(cost)) ? Number(cost) : 0
  const providerID = String(info?.providerID || "").toLowerCase()
  const modelID = String(info?.modelID || "").toLowerCase()
  const externalCumulativeUsage =
    providerID === "claude-agent" ||
    modelID === "claude-agent" ||
    providerID === "codex-app-server" ||
    modelID === "codex-app-server"
  const contextTokens = externalCumulativeUsage ? 0 : inputTokens + cacheReadTokens + cacheWriteTokens
  if (inputTokens <= 0 && outputTokens <= 0 && totalTokens <= 0 && costUSD <= 0 && contextTokens <= 0) {
    return undefined
  }
  return { inputTokens, outputTokens, totalTokens, costUSD, contextTokens }
}

function messageInfoIsAssistant(info: any): boolean {
  return String(info?.role || "") === "assistant"
}

function modelProjectionFromInfo(info: any): MessageModelProjection | undefined {
  if (!messageInfoIsAssistant(info)) return undefined
  const providerID = typeof info?.providerID === "string" ? info.providerID.trim() : ""
  const modelID = typeof info?.modelID === "string" ? info.modelID.trim() : ""
  if (!providerID || !modelID) return undefined
  return {
    providerID,
    modelID,
    display: `${providerID}/${modelID}`,
  }
}

function projectModelOntoCard(
  session: SessionInfo,
  messageID: string,
  fallbackCardID: string,
  model: MessageModelProjection | undefined,
): void {
  session.messageModels.set(messageID, model)
  const targetCardID = session.messageCardIDs.get(messageID) ?? fallbackCardID
  if (!cardTreeStore.cards[targetCardID]) return
  let latestModel: MessageModelProjection | undefined
  let latestTime = Number.NEGATIVE_INFINITY
  for (const [mid, projected] of session.messageModels) {
    if (session.messageCardIDs.get(mid) !== targetCardID) continue
    const time = messages.get(mid)?.time ?? 0
    if (time >= latestTime) {
      latestModel = projected
      latestTime = time
    }
  }
  setCardTreeStore("cards", targetCardID, "model", latestModel)
}

function projectUsageOntoCard(
  session: SessionInfo,
  messageID: string,
  fallbackCardID: string,
  usage: MessageUsageProjection,
): void {
  session.messageUsage.set(messageID, usage)
  const targetCardID = session.messageCardIDs.get(messageID) ?? fallbackCardID
  if (!cardTreeStore.cards[targetCardID]) return
  let sumInput = 0
  let sumOutput = 0
  let sumTotal = 0
  let sumCost = 0
  let latestContext = 0
  let latestContextTime = Number.NEGATIVE_INFINITY
  for (const [mid, u] of session.messageUsage) {
    if (session.messageCardIDs.get(mid) !== targetCardID) continue
    sumInput += u.inputTokens
    sumOutput += u.outputTokens
    sumTotal += u.totalTokens
    sumCost += u.costUSD
    const time = messages.get(mid)?.time ?? 0
    if (u.contextTokens > 0 && time >= latestContextTime) {
      latestContext = u.contextTokens
      latestContextTime = time
    }
  }
  setCardTreeStore("cards", targetCardID, "usage", {
    inputTokens: sumInput,
    outputTokens: sumOutput,
    totalTokens: sumTotal,
    costUSD: sumCost,
  })
  if (latestContext > 0) {
    setCardTreeStore("cards", targetCardID, "contextTokens", latestContext)
    setCardTreeStore("cards", targetCardID, "contextTokensEstimated", false)
  }
}

/** A part's exact display target: which card owns it and at which index in
 *  that card's `parts` array. Carrying the cardID (not just the index) is
 *  mandatory — a long-lived session has many turn cards, and a late delta
 *  for an older message must land on the card that owns the original part,
 *  not on whatever turn is currently active (spec §3.3 / §11.1). */
interface PartTarget {
  cardID: string
  index: number
}

interface SessionInfo {
  sessionID: string
  stage: string
  parentSessionID: string
  goalID: string
  /** ids of messages that landed in this session's bucket, preserved to derive status. */
  messageIDs: Set<string>
  /** messageID → the display card that owns that message turn. For
   *  phase-absorbed sessions (build / planner under a goal) every entry
   *  points at the single phase card; for integrity it points at the
   *  dedicated integrity card; otherwise each entry is a distinct
   *  message-turn card (`<stage>:session:<sid>:message:<mid>`). */
  messageCardIDs: Map<string, string>
  /** The message turn currently receiving session-level events
   *  (session.status / session.error). The newest `message.updated` for
   *  this session sets it. */
  activeMessageID?: string
  /** Display card for `activeMessageID`. Session lifecycle events
   *  mutate THIS card only — older turn cards are frozen history. */
  activeCardID?: string
  /** Per-message cumulative usage observed for assistant messages in
   *  this session. `regroupTimelineSegments` can collapse multiple
   *  messages from the same semantic run into one display card (each
   *  later message becomes a boundary + parts inside that card), so a
   *  raw setCardTreeStore("cards", cardID, "usage", ...) would
   *  overwrite earlier messages' tokens. Instead we record per-message
   *  totals here and write the SUM onto the owning card whenever a
   *  message.updated arrives. */
  messageUsage: Map<string, MessageUsageProjection>
  /** Per-message actual model observed from assistant Message info. A
   *  grouped card displays the latest message's model, not the current
   *  project config and not a guessed provider. */
  messageModels: Map<string, MessageModelProjection | undefined>
  /** part id → its exact {cardID,index} target — O(1) lookup for updates. */
  partIndex: Map<string, PartTarget>
  /** Last known top-level visibility; avoids rebuilding order when content
   *  changes do not alter whether this session has a visible turn card. */
  topLevelVisible: boolean
}

interface MessageInfo {
  id: string
  sessionID: string
  stage: string
  role: string
  resolvedRole: string
  agent: string
  parentSessionID: string
  goalID: string
  time: number
  completed: boolean
}

interface MessageUsageProjection {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUSD: number
  contextTokens: number
}

interface MessageModelProjection {
  providerID: string
  modelID: string
  display: string
}

const sessions = new Map<string, SessionInfo>()
const messages = new Map<string, MessageInfo>()
/** goalID → known. Goal cards themselves are driven by board.goalWorkflows,
 *  not by `goal.created` events — we just remember existence here so session
 *  bucket claiming is deterministic. */
const knownGoalIDs = new Set<string>()
/** goalID → the current attempt's goal_run id. Refreshed from
 *  board.goalWorkflows on every rebuild. Used to scope step/phase card
 *  ids so each attempt (retry / acceptance_rework / modify_contract /
 *  restart_stage) gets its own cards instead of mutating the prior
 *  attempt's cards in-place. A missing entry means the goal has no
 *  dispatched run yet — we fall back to the pseudo-id `"pre"` so the
 *  pre-dispatch stub cards (none today, but future-proof) still have a
 *  stable home that collapses into the first real run once it starts.
 *
 *  The map is the single source of truth for "what's the live attempt?"
 *  — session-side `resolveGoalContainerCardID` reads it when routing a
 *  newly-arrived session's parts to the right phase card, so a session
 *  created under attempt N never leaks its parts onto the attempt N+1
 *  card after rebuild. */
const goalCurrentRunID = new Map<string, string>()
/** Legacy integrity child-card ownership map. New integrity runs render on the
 *  session card itself, so this map stays empty for fresh data but remains
 *  wired for older protocol slices that still materialize kind="integrity"
 *  child cards. */
const integrityCardOwners = new Map<string, string>()

/** Integrity events that arrived before their owning session's first
 *  message.updated. Keyed by sessionID so ensureSessionCard can drain a
 *  single pending payload per session. Holding the raw payload here (NOT in
 *  cardTreeStore.cards) preserves the invariant "every entry in
 *  cardTreeStore.cards is reachable via order or some parent's childIDs" —
 *  an integrity event that never finds its session stays in this map until
 *  resetWriter() clears it, never materializing into an unreachable ghost. */
interface PendingIntegrityPayload {
  taskID: string
  emittedAt: number
  verdict: "pass" | "concerns" | "needs_correction"
  summary: string
  teamReportMarkdown: string
  reviewers: NonNullable<CardNode["integrity"]>["reviewers"]
  findings: NonNullable<CardNode["integrity"]>["findings"]
  requiredRepairs: NonNullable<CardNode["integrity"]>["requiredRepairs"]
  unresolvedDisagreements: NonNullable<CardNode["integrity"]>["unresolvedDisagreements"]
  attempts: number
}
const pendingIntegrity = new Map<string, PendingIntegrityPayload>()

/** Session lifecycle status buffered until the owning session card materializes.
 *  `session.status` events from packages/opencorvus/src/session/status.ts may
 *  reach the writer before the session's first `message.updated` in the
 *  normalized SSE stream order (especially on reconnect replay). Same pattern
 *  as `pendingIntegrity` — held out-of-band, drained by `ensureSessionCard`.
 *
 *  Replaces the per-phase `pendingSubagentTerminal` buffer. Single source of
 *  truth for every session's lifecycle (orchestrator root, all subagent
 *  phases, future phases) — see specs/new-arch/07-panel-reactivity.md. */
interface ProjectedSessionStatus {
  cardStatus: CardStatus
  terminalReason?: "completed" | "error" | "aborted"
  errorReason?: string
  timeCompleted?: number
}
const pendingSessionStatus = new Map<string, ProjectedSessionStatus>()
/** Raw Question.ask interactions for standalone session conversations such as
 *  Mission. Engine task questions are normalized by the backend into
 *  board.interactions and must not be duplicated here. */
const standaloneQuestionInteractions = new Map<string, any>()
interface BufferedPartDelta {
  event: any
  delta: string
}

const PART_DELTA_FLUSH_INTERVAL_MS = 50
var bufferedPartDeltas = new Map<string, BufferedPartDelta>()
var bufferedPartDeltaTimer: ReturnType<typeof setTimeout> | null = null

// ── Entry point ──

/** Reset all writer state + cardTreeStore. Called on task switch, hydrate,
 *  recovery, and in tests. The caller must stamp the replacement scroll
 *  intent explicitly so the conversation view does not guess whether this
 *  replacement should preserve the operator's viewport or jump to the tail. */
export function resetWriter(
  options: {
    scrollIntent?: "preserve" | "bottom"
    cause?: string
  } = {},
): void {
  try {
    flushBufferedPartDeltas()
  } finally {
    cancelBufferedPartDeltaTimer()
    bufferedPartDeltas.clear()
  }
  sessions.clear()
  messages.clear()
  knownGoalIDs.clear()
  integrityCardOwners.clear()
  pendingIntegrity.clear()
  runningReviews.clear()
  pendingSessionStatus.clear()
  standaloneQuestionInteractions.clear()
  // Drop every key explicitly — plain assignment on a store merges instead of
  // replacing (see setMessages's messagesBySession fix in store/messages.ts).
  setCardTreeStore("order", [])
  setCardTreeStore(
    "cards",
    produce((c: Record<string, CardNode>) => {
      for (const k of Object.keys(c)) delete c[k]
    }),
  )
  setCardTreeStore("rewindCursor", null)
  markCardTreeReplaced({
    scrollIntent: options.scrollIntent ?? "preserve",
    cause: options.cause ?? "writer-reset",
  })
  markCardTreeVisibleChanged()
}

function applyVisibleCardTreeEvent(handler: () => void): void {
  batch(() => {
    handler()
    // Drain the subtree-stats dirty queue inside the same batch so the
    // ancestor cache updates land in one render frame alongside the event's
    // primary writes. See store/card-tree-stats.ts for the bubble-up walk.
    flushCardStats()
    markCardTreeVisibleChanged()
  })
}

function cancelBufferedPartDeltaTimer(): void {
  if (bufferedPartDeltaTimer === null) return
  clearTimeout(bufferedPartDeltaTimer)
  bufferedPartDeltaTimer = null
}

export function hasProjectedPart(sessionID: string, partID: string): boolean {
  return sessions.get(sessionID)?.partIndex.has(partID) === true
}

function requireSessionProjection(sessionID: string, eventType: string): SessionInfo {
  const session = sessions.get(sessionID)
  if (!session) throw new Error(`${eventType}: unknown session ${sessionID}`)
  return session
}

function requirePartProjection(session: SessionInfo, partID: string, eventType: string): PartTarget {
  const target = session.partIndex.get(partID)
  if (!target) throw new Error(`${eventType}: unknown part ${partID} in session ${session.sessionID}`)
  return target
}

function requireMessageCardProjection(session: SessionInfo, messageID: string, eventType: string): string {
  const cardID = session.messageCardIDs.get(messageID)
  if (!cardID) throw new Error(`${eventType}: unknown message ${messageID} in session ${session.sessionID}`)
  return cardID
}

function validatePartDeltaTarget(event: any): {
  key: string
  delta: string
} {
  const p = propsOf(event)
  const partID = String(p.partID || "")
  const sessionID = String(p.sessionID || "")
  const field = String(p.field || "")
  if (!partID || !sessionID || !field) {
    throw new Error("message.part.delta missing partID/sessionID/field")
  }
  const session = requireSessionProjection(sessionID, "message.part.delta")
  requirePartProjection(session, partID, "message.part.delta")
  return {
    key: `${sessionID}|${partID}|${field}`,
    delta: typeof p.delta === "string" ? p.delta : "",
  }
}

function mergedPartDeltaEvent(entry: BufferedPartDelta): any {
  const props = propsOf(entry.event)
  if (entry.event?.properties && typeof entry.event.properties === "object" && !Array.isArray(entry.event.properties)) {
    return { ...entry.event, properties: { ...props, delta: entry.delta } }
  }
  return { ...entry.event, payload: { ...props, delta: entry.delta } }
}

function queuePartDelta(event: any): void {
  const { key, delta } = validatePartDeltaTarget(event)
  const buffered = bufferedPartDeltas.get(key)
  if (buffered) {
    buffered.delta += delta
  } else {
    bufferedPartDeltas.set(key, { event, delta })
  }
  if (bufferedPartDeltaTimer !== null) return
  bufferedPartDeltaTimer = setTimeout(() => {
    bufferedPartDeltaTimer = null
    flushBufferedPartDeltas()
  }, PART_DELTA_FLUSH_INTERVAL_MS)
}

export function flushBufferedPartDeltas(): void {
  if (bufferedPartDeltas.size === 0) {
    cancelBufferedPartDeltaTimer()
    return
  }
  cancelBufferedPartDeltaTimer()
  const entries = [...bufferedPartDeltas.entries()]
  batch(() => {
    for (const [key, entry] of entries) {
      bufferedPartDeltas.delete(key)
      handlePartDelta(mergedPartDeltaEvent(entry))
    }
    flushCardStats()
    markCardTreeVisibleChanged()
  })
}

/** Top-level dispatcher. Unknown event types throw by design (rule 1:
 *  let-it-crash). Keeping the branches close together makes coverage
 *  auditable — every event type the overlay processes lives here. */
export function applyEvent(event: any): void {
  const type: string = String(event?.type || "")
  if (!type) throw new Error("tree-writer: event missing type")
  if (type === "message.part.delta") return queuePartDelta(event)

  // Exact board/interaction events must be handled before prefix pass-through
  // checks. Prefixes such as `task.`, `goal.`, and `interaction.` cover many
  // router-level events, but these concrete event types mutate the visible
  // tree and would otherwise be swallowed.
  if (type === "task.created" || type === "task.updated" || type === "task.completed") {
    flushBufferedPartDeltas()
    return handleTaskChanged(event)
  }
  if (type === "goal.created") {
    flushBufferedPartDeltas()
    const gid = String(event?.properties?.goalID || event?.payload?.goalID || "")
    if (gid) knownGoalIDs.add(gid)
    return
  }
  if (type === "interaction.requested" || type === "interaction.resolved") {
    flushBufferedPartDeltas()
    return handleInteraction(event)
  }
  if (type === "question.asked" || type === "question.replied" || type === "question.rejected") {
    flushBufferedPartDeltas()
    return applyVisibleCardTreeEvent(() => handleStandaloneQuestion(event))
  }

  if (
    type === "session.idle" ||
    type === "approval.request" ||
    type === "input.request" ||
    type === "permission.asked" ||
    type === "permission.replied" ||
    type === "diff.delta" ||
    isTreeWriterNoopEventType(type) ||
    isTreeWriterPassThroughEventType(type)
  ) {
    return
  }
  flushBufferedPartDeltas()

  // ── Message stream ──
  if (type === "message.updated") return applyVisibleCardTreeEvent(() => handleMessageUpdated(event))
  if (type === "message.part.updated") return applyVisibleCardTreeEvent(() => handlePartUpdated(event))
  if (type === "message.removed") return applyVisibleCardTreeEvent(() => handleMessageRemoved(event))
  if (type === "message.part.removed") return applyVisibleCardTreeEvent(() => handlePartRemoved(event))

  if (type === "review.stream.started") {
    return applyVisibleCardTreeEvent(() => handleReviewStreamStarted(event))
  }
  if (type === "review.stream.progress") {
    return applyVisibleCardTreeEvent(() => handleReviewStreamProgress(event))
  }
  if (type === "review.stream.chunk") {
    return applyVisibleCardTreeEvent(() => handleReviewStreamChunk(event))
  }
  if (type === "integrity.review.completed") {
    return applyVisibleCardTreeEvent(() => handleIntegrityCompleted(event))
  }

  // ── Session lifecycle (single source) ──
  // session.status from packages/opencorvus/src/session/status.ts is the
  // only signal that flips a session card out of `running`. Carries
  // `{sessionID, status:{type:"streaming"|"idle"|"retry"|"terminal", ...}}`.
  // Applies to every session — orchestrator root, requirements / architect /
  // frontend-design / frontend-research / workload_analysis / visual_qa /
  // integrity / build / refine / analyze_intent / modify_goal, future phases. See
  // specs/new-arch/07-panel-reactivity.md §session 终态信号源.
  if (type === "session.status") {
    return applyVisibleCardTreeEvent(() => handleSessionStatus(event))
  }
  // session.error carries provider/stream failures that can precede a later
  // secondary lifecycle status. Show the original error on the card directly.
  if (type === "session.error") {
    return applyVisibleCardTreeEvent(() => handleSessionError(event))
  }
  // session.idle is published alongside session.status when status flips to
  // idle. We already handle the lifecycle via session.status, so it's noop
  // here.
  if (type === "session.idle") return

  // ── Interactive prompts that need operator response. ──
  // approval.request / input.request payloads carry { id, approval / questions }
  // — they DO need a UI surface (Round-4 work), but until that lands we
  // accept them silently rather than spamming console.error from the SSE
  // try/catch. Backend (executor/managed.ts) emits these for permission
  // gates and structured questions.
  if (type === "approval.request" || type === "input.request") return
  // permission.* events fire alongside approval.request when an executor
  // gates on a tool call (executor/opencorvus.ts:260,267). Handled inline by
  // InteractionCard — tree-writer just acknowledges.
  if (type === "permission.asked" || type === "permission.replied") return
  // diff.delta is a streaming preview from the executor — boardStore
  // already tracks the diff, the writer doesn't need to project it as a card.
  if (type === "diff.delta") return

  // ── No-op events (control plane / telemetry). Listed explicitly so the
  //    final `throw` catches truly unknown types. ──
  if (isTreeWriterNoopEventType(type)) return

  // Broad-prefix pass-through (no state change in the writer; boardStore
  // handles these on its own side, and rebuildBoardDerivedCards reads
  // boardStore lazily). Enumerated explicitly — unknown prefixes still throw.
  if (isTreeWriterPassThroughEventType(type)) return

  throw new Error(`tree-writer: unhandled event type "${type}"`)
}

export function ingestPersistedConversationMessage(input: { info: any; parts: any[] }): void {
  if (!input?.info?.id) {
    throw new Error("ingestPersistedConversationMessage: persisted message missing info.id")
  }
  if (!Array.isArray(input.parts)) {
    throw new Error(`ingestPersistedConversationMessage: message ${input.info.id} missing parts array`)
  }
  batch(() => {
    applyEvent({
      type: "message.updated",
      properties: { info: input.info },
    })
    for (const part of input.parts) {
      if (!part) continue
      applyEvent({
        type: "message.part.updated",
        properties: { part },
      })
    }
  })
}

// ── Helpers ──

function propsOf(event: any): Record<string, any> {
  const p = event?.properties
  if (p && typeof p === "object" && !Array.isArray(p)) return p
  const q = event?.payload
  if (q && typeof q === "object" && !Array.isArray(q)) return q
  return {}
}

/** Dedicated, message-turn-less card id. Only the integrity review uses
 *  this form: integrity is a real session but its reasoning/verdict reach
 *  the overlay through `integrity.review.*` events (NOT `message.updated`),
 *  so there is no durable messageID to scope a turn card by. The card is
 *  single per integrity session, which is the desired display anyway. */
function sessionCardID(stage: string, sid: string): string {
  return `${stage}:session:${sid}`
}

/** Stable semantic-run card id seeded by the first visible message. A
 *  runtime session can produce many real `message.updated` rows; messages
 *  from the same current semantic run share one complete card so parallel
 *  child sessions do not visually split their parent. The first message id
 *  stays in the id for deterministic hydration and diagnostics; sorting is
 *  still by `CardNode.time`, never by id. */
function messageTurnCardID(stage: string, sid: string, messageID: string): string {
  return `${stage}:session:${sid}:message:${messageID}`
}

function isUserStage(stage: string): boolean {
  return normalizeAgentRole(stage) === "user"
}

function conversationPartHasDisplay(part: any): boolean {
  const type = String(part?.type || "")
  if (!type || type === "step-start" || type === "step-finish" || type === "boundary") return false
  if (type === "text" || type === "reasoning") return Boolean(String(part?.text || "").trim())
  return true
}

function transcriptMessageHasDisplay(message: any): boolean {
  return Array.isArray(message?.parts) && message.parts.some(conversationPartHasDisplay)
}

function projectedMessageHasDisplayPart(messageID: string): boolean {
  for (const card of Object.values(cardTreeStore.cards)) {
    for (const part of card?.parts || []) {
      if (String(part?.messageID || "") === messageID && conversationPartHasDisplay(part)) return true
    }
  }
  return false
}

function createSessionCardNode(
  cardID: string,
  stage: string,
  goalID: string,
  time: number,
  sessionID: string,
  messageID: string,
  parts: any[] = [],
  childIDs: string[] = [],
): CardNode {
  const userStage = isUserStage(stage)
  return {
    id: cardID,
    kind: userStage ? "message" : "agent",
    role: userStage ? "user" : undefined,
    sessionID,
    ...(messageID ? { messageID } : {}),
    stage,
    accent: !userStage && stage ? stageAccent(stage) : undefined,
    status: "running",
    title: userStage ? roleTitleKey("user") : stage ? roleTitleKey(stage) : "chat.role.assistant",
    round: userStage ? undefined : 0,
    goalID: goalID || undefined,
    parts,
    childIDs,
    time,
  }
}

/** Per-goal executor step card. Each goal has exactly one goal-scope step
 *  per attempt (see workflow.ts — the `build` step, labelled "Executor",
 *  is the only `scope: "goal"` entry in the pipeline). Every new attempt
 *  (retry / acceptance_rework / modify_contract / restart_stage) creates
 *  a fresh goal_run; the run id is baked into the card id so the prior
 *  attempt's cards survive as frozen history rather than being mutated
 *  by new messages. Goal title, decomposition index (#N), and description
 *  all live on this card.
 *
 *  Format: `step:<goalID>:<goalRunID | "pre">:<stepID>`.
 *  The `"pre"` sentinel is used before the first dispatch (no goal_run
 *  exists yet); it collapses into the real run id on the first rebuild
 *  after the board emits a goalRunID. */
function goalStepCardID(goalID: string, _goalRunID: string | undefined, stepID: string): string {
  // Attempt-invariant card ID (rule 22 / rule 23). Build agent parts arrive
  // BEFORE the goal_run artifact lands on the overlay (SSE ordering — the
  // server now lazy-creates the coordinator run inside `build`, and parts
  // start streaming the moment the build session opens). With a runID-keyed
  // ID those early parts wrote to `:pre:`, then `goalCurrentRunID` flipped
  // to the real runID and `rebuildGoalStepCards` started looking up an
  // empty `:<runID>:` card under the goal — visible symptom: goal card
  // shows a "Build" sub-card with green check but empty body. Removing
  // runID from the card id keeps both observers pointed at the same card
  // and merges retry attempts into one rolling timeline (per-attempt
  // separation was a 2026-04-21 addition that broke this invariant).
  return `step:${goalID}:${stepID}`
}

function goalPhaseCardID(goalID: string, goalRunID: string | undefined, stepID: string, phaseID: string): string {
  return `${goalStepCardID(goalID, goalRunID, stepID)}:phase:${phaseID}`
}

/** A card ID is a top-level executor step iff it matches
 *  `step:<gid>:<stepID>` exactly — the phase variants add a `:phase:<pid>`
 *  suffix. Format reverted to attempt-invariant on 2026-04-26 because the
 *  `:<runID>:` form orphaned all parts written before the run artifact
 *  materialised on the overlay (the typical case for pipeline build). */
function isTopLevelStepCardID(id: string): boolean {
  return id.startsWith("step:") && !id.includes(":phase:")
}

/** Extract the goalID segment from a step card id (top-level or phase).
 *  Used by the GC pass to drop cards whose owning goal has been removed,
 *  while preserving historical-attempt cards (same goalID, different
 *  goalRunID) that the new alive-set no longer covers. */
function goalIDFromStepCardID(id: string): string | null {
  if (!id.startsWith("step:")) return null
  const parts = id.split(":")
  // step:<goalID>:<runID>:<stepID>[...]
  return parts.length >= 3 ? parts[1] : null
}

function interactionCardID(messageID: string): string {
  return `interaction-card:${messageID}`
}

// ── Handlers ──

function handleMessageUpdated(event: any): void {
  const info = propsOf(event).info
  if (!info || typeof info !== "object") throw new Error("message.updated missing info")

  const id = String(info.id || "")
  const sessionID = String(info.sessionID || "")
  if (!id || !sessionID) throw new Error("message.updated info missing id/sessionID")

  // No assistant-fallback (一个萝卜一个坑). Every event must arrive with role
  // + resolvedRole already populated by the server bridge (overlayMeta). If
  // either is missing, throw — silently routing role-less events into the
  // generic assistant card orphans the actual agent's stream.
  const rawRole = info.role
  if (typeof rawRole !== "string" || rawRole.length === 0) {
    throw new Error(`message.updated info missing role for message ${info.id}; bridge must enrich it`)
  }
  const role = rawRole
  const rawResolvedRole = info.resolvedRole || info.agent || role
  if (typeof rawResolvedRole !== "string" || rawResolvedRole.length === 0) {
    throw new Error(`message.updated info missing resolvedRole/agent for message ${info.id}`)
  }
  const agent = String(info.agent || "")
  const parentSessionID = String(info.parentSessionID || "")
  const goalID = String(info.goalID || "")
  const incomingTimeCreated = Number(info?.time?.created || 0)
  if (!(incomingTimeCreated > 0)) {
    throw new Error(
      `message.updated info.time.created must be positive (got ${info?.time?.created}); server emitter is the single source of truth`,
    )
  }
  const existingMessage = messages.get(id)
  const timeCreated = existingMessage?.time && existingMessage.time > 0 ? existingMessage.time : incomingTimeCreated
  const completed = Number.isFinite(info?.time?.completed) && Number(info.time.completed) > 0

  // Channel-driven stage. Bridge stamps it on every event; an absent
  // channel is a bridge bug, not a case we silently accommodate.
  const stage = deriveSessionStage(info)
  if (stage === "filtered") return
  const displayRole = displayRoleForResolvedRole(rawResolvedRole)

  // Index the message.
  messages.set(id, {
    id,
    sessionID,
    stage,
    role,
    resolvedRole: displayRole,
    agent,
    parentSessionID,
    goalID,
    time: timeCreated,
    completed,
  })

  const session = ensureSessionProjection(sessionID, { stage, parentSessionID, goalID })
  const priorMessageCount = session.messageIDs.size
  session.messageIDs.add(id)

  const { cardID, isPhase } = ensureMessageTurnProjection(session, id, {
    stage,
    goalID,
    role: displayRole,
    time: timeCreated,
    stampServerTime: true,
    deferHierarchy: !isPhaseAbsorbedSession(stage, goalID),
  })

  // Phase cards always need in-card message boundaries. Non-phase cards are
  // regrouped by the authoritative message timeline below; doing that from
  // live arrival order is the regression this path avoids.
  if (isPhase && projectedMessageHasDisplayPart(id)) {
    ensureBoundaryPart(session, cardID, id, displayRole, timeCreated)
    reorderPhaseCardParts(cardID)
  } else if (priorMessageCount > 0) {
    regroupTimelineSegments()
  } else if (
    (Array.isArray(boardStore.board?.interactions) && boardStore.board.interactions.length > 0) ||
    standaloneQuestionInteractions.size > 0
  ) {
    rebuildCardHierarchy()
  } else {
    rebuildTopLevelOrder()
  }

  // Project per-message LLM usage (tokens + cost) onto this turn's card.
  // The engine writes cumulative-within-message tokens onto
  // `Message.Assistant.tokens` (session/processor.ts step-finish) and
  // `cost` likewise; external executors do the same via
  // `build/agent.ts:case "usage"`. message.updated is the single source —
  // there is no parallel usage.updated event.
  //
  // Non-phase semantic runs can collapse multiple assistant messages into
  // one display card via `regroupTimelineSegments`, so we store per-message
  // usage in `session.messageUsage` and write the SUM onto the (possibly
  // newly resolved) card. A later message.updated for the same message
  // overwrites that message's slot rather than double-counting.
  const usageProjection = usageProjectionFromInfo(info)
  if (usageProjection) projectUsageOntoCard(session, id, cardID, usageProjection)
  if (messageInfoIsAssistant(info)) {
    projectModelOntoCard(session, id, cardID, modelProjectionFromInfo(info))
  }

  drainPendingSessionStatus(sessionID)
  drainPendingIntegrity(sessionID)
}

interface EnsuredPartProjection {
  session: SessionInfo
  cardID: string
  partID: string
  messageID: string
  sessionID: string
  displayRole: string
}

type PartEventRouteMeta = {
  channel?: unknown
  resolvedRole?: unknown
  parentSessionID?: unknown
  goalID?: unknown
}

function requirePartEventRouteMeta(meta: PartEventRouteMeta | undefined, messageID: string): {
  channel: string
  resolvedRole: string
  parentSessionID: string
  goalID: string
} {
  const channel = String(meta?.channel || "").trim()
  const resolvedRole = String(meta?.resolvedRole || "").trim()
  if (!channel || !resolvedRole) {
    throw new Error(
      `message.part.updated for ${messageID} missing top-level channel/resolvedRole; backend bridge must stamp routing metadata outside part`,
    )
  }
  return {
    channel,
    resolvedRole,
    parentSessionID: String(meta?.parentSessionID || ""),
    goalID: String(meta?.goalID || ""),
  }
}

function ensurePartProjection(
  part: any,
  opts: { observationTime?: number; routeMeta?: PartEventRouteMeta } = {},
): EnsuredPartProjection | null {
  if (!part || typeof part !== "object") throw new Error("message.part.updated missing part")
  const partID = String(part.id || "")
  const messageID = String(part.messageID || "")
  const sessionID = String(part.sessionID || "")
  if (!partID || !messageID || !sessionID) {
    throw new Error("message.part.updated part missing id/messageID/sessionID")
  }

  const existingSession = sessions.get(sessionID)
  let session = existingSession
  let cardID = session?.messageCardIDs.get(messageID)
  let displayRole = messages.get(messageID)?.resolvedRole || ""
  const eventResolvedRole = String(opts.routeMeta?.resolvedRole || "").trim()
  if (!displayRole && eventResolvedRole) displayRole = displayRoleForResolvedRole(eventResolvedRole)

  if (!session || !cardID) {
    // Bridge stamps channel/goalID/parentSessionID onto the event payload.
    // A part can arrive before its message.updated (saveMessage is silent;
    // updatePart fires before updateMessage). Because messageID is already
    // known, the turn card's deterministic id is too — build it now at
    // observation time. The later message.updated overwrites `time` with the
    // authoritative server timestamp; no synthetic stub / rename.
    const route = requirePartEventRouteMeta(opts.routeMeta, messageID)
    const stage = deriveSessionStage(route)
    if (stage === "filtered") return null
    displayRole = displayRoleForResolvedRole(route.resolvedRole)
    session = ensureSessionProjection(sessionID, {
      stage,
      parentSessionID: route.parentSessionID,
      goalID: route.goalID,
    })
    cardID = session.messageCardIDs.get(messageID)
  }

  if (!session) {
    throw new Error(`message.part.updated could not ensure session ${sessionID}`)
  }
  if (!cardID) {
    if (!conversationPartHasDisplay(part)) return null
    if (!displayRole) {
      throw new Error(`message.part.updated for ${messageID} missing resolved display role`)
    }
    const observationTime = opts.observationTime ?? Date.now()
    const message = messages.get(messageID)
    const ensured = ensureMessageTurnProjection(session, messageID, {
      stage: session.stage,
      goalID: session.goalID,
      role: displayRole,
      time: message?.time || observationTime,
      stampServerTime: Boolean(message?.time),
    })
    cardID = ensured.cardID
    if (ensured.isPhase) {
      ensureBoundaryPart(
        session,
        cardID,
        messageID,
        displayRole,
        message?.time || observationTime,
      )
    }
    drainPendingSessionStatus(sessionID)
    drainPendingIntegrity(sessionID)
  }

  upsertPart(session, messageID, cardID, partID, { ...part })
  if (!displayRole) {
    throw new Error(`message.part.updated for ${messageID} could not resolve display role from message or event metadata`)
  }
  return { session, cardID, partID, messageID, sessionID, displayRole }
}

function handlePartUpdated(event: any): void {
  const props = propsOf(event)
  const part = props.part
  const projection = ensurePartProjection(part, { routeMeta: props })
  if (!projection) return
  const { session, cardID, messageID, displayRole } = projection
  if (isPhaseAbsorbedSession(session.stage, session.goalID) && conversationPartHasDisplay(part)) {
    const message = messages.get(messageID)
    ensureBoundaryPart(
      session,
      cardID,
      messageID,
      displayRole,
      message?.time || Date.now(),
    )
    reorderPhaseCardParts(cardID)
  }
  if (conversationPartHasDisplay(part)) {
    rebuildTopLevelOrder()
  }
  syncSessionTopLevelVisibility(session)
}

function handlePartDelta(event: any): void {
  const p = propsOf(event)
  const partID = String(p.partID || "")
  const sessionID = String(p.sessionID || "")
  const field = String(p.field || "")
  const delta = typeof p.delta === "string" ? p.delta : ""
  if (!partID || !sessionID || !field) {
    throw new Error("message.part.delta missing partID/sessionID/field")
  }

  const session = requireSessionProjection(sessionID, "message.part.delta")
  const target = requirePartProjection(session, partID, "message.part.delta")

  // Resolve the EXACT card that owns this part. A late delta for an older
  // message turn must land on that turn's card, never on whatever turn is
  // currently active for the session (spec §3.3 — primary failure mode).
  const part = cardTreeStore.cards[target.cardID]?.parts?.[target.index]
  if (field === "raw" && part?.type === "tool") {
    setCardTreeStore(
      "cards",
      target.cardID,
      "parts",
      target.index,
      "state",
      "raw",
      (prev: any) => String(prev ?? "") + delta,
    )
  } else {
    setCardTreeStore(
      "cards",
      target.cardID,
      "parts",
      target.index,
      field as any,
      (prev: any) => String(prev ?? "") + delta,
    )
  }
  markCardStatsDirty(target.cardID)
  if (conversationPartHasDisplay(cardTreeStore.cards[target.cardID]?.parts?.[target.index])) {
    reorderPhaseCardParts(target.cardID)
    rebuildTopLevelOrder()
  }
  syncSessionTopLevelVisibility(session)
}

function removeCardReferences(cardID: string): void {
  if (cardTreeStore.order.includes(cardID)) {
    setCardTreeStore(
      "order",
      cardTreeStore.order.filter((id) => id !== cardID),
    )
  }
  const affectedParents: string[] = []
  setCardTreeStore(
    "cards",
    produce((cards: Record<string, CardNode>) => {
      for (const card of Object.values(cards)) {
        if (!Array.isArray(card.childIDs) || !card.childIDs.includes(cardID)) continue
        card.childIDs = card.childIDs.filter((id) => id !== cardID)
        affectedParents.push(card.id)
      }
      delete cards[cardID]
    }),
  )
  // The deleted card's contribution to ancestor aggregates has to be
  // subtracted — mark each parent that just lost this child so the next
  // flushCardStats bubbles the new totals upward.
  for (const parentID of affectedParents) markCardStatsDirty(parentID)
}

function removeIndexedParts(
  session: SessionInfo,
  cardID: string,
  shouldRemove: (part: any, index: number) => boolean,
): number {
  const card = cardTreeStore.cards[cardID]
  const parts = Array.isArray(card?.parts) ? card.parts : []
  const nextParts: any[] = []
  const indexMap = new Map<number, number>()
  let removed = 0
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (shouldRemove(part, i)) {
      removed += 1
      continue
    }
    indexMap.set(i, nextParts.length)
    nextParts.push(part)
  }
  if (removed === 0) return 0
  setCardTreeStore("cards", cardID, "parts", nextParts)
  markCardStatsDirty(cardID)
  for (const [partID, target] of [...session.partIndex]) {
    if (target.cardID !== cardID) continue
    const nextIndex = indexMap.get(target.index)
    if (nextIndex === undefined) {
      session.partIndex.delete(partID)
    } else {
      session.partIndex.set(partID, { cardID, index: nextIndex })
    }
  }
  return removed
}

function cardStillOwnsSessionMessage(session: SessionInfo, cardID: string): boolean {
  for (const mappedCardID of session.messageCardIDs.values()) {
    if (mappedCardID === cardID) return true
  }
  return false
}

function handleMessageRemoved(event: any): void {
  const p = propsOf(event)
  const sessionID = String(p.sessionID || "")
  const messageID = String(p.messageID || "")
  if (!sessionID || !messageID) throw new Error("message.removed missing sessionID/messageID")

  const session = requireSessionProjection(sessionID, "message.removed")
  const cardID = requireMessageCardProjection(session, messageID, "message.removed")

  session.messageIDs.delete(messageID)
  session.messageCardIDs.delete(messageID)
  messages.delete(messageID)

  removeIndexedParts(session, cardID, (part) => String(part?.messageID || "") === messageID)

  if (!cardStillOwnsSessionMessage(session, cardID)) {
    removeCardReferences(cardID)
    if (session.activeCardID === cardID) session.activeCardID = undefined
  }
  regroupTimelineSegments()
  syncSessionTopLevelVisibility(session)
}

function handlePartRemoved(event: any): void {
  const p = propsOf(event)
  const sessionID = String(p.sessionID || "")
  const partID = String(p.partID || "")
  if (!sessionID || !partID) throw new Error("message.part.removed missing sessionID/partID")

  const session = requireSessionProjection(sessionID, "message.part.removed")
  const target = requirePartProjection(session, partID, "message.part.removed")

  removeIndexedParts(session, target.cardID, (_part, index) => index === target.index)
  syncSessionTopLevelVisibility(session)
}

function handleTaskChanged(event: any): void {
  // Source of truth for task.request + goalWorkflows is boardStore.board — the
  // live overlay writes to it via applyBoardDelta / loadBoard, tests write via
  // the replay harness. Tree-writer just projects the current boardStore view
  // into cardTreeStore; it does NOT read the event payload directly.
  //
  // Note: orchestrator root session terminal is no longer derived from
  // task.status — every session (including the root) emits its own
  // session.status terminal when its actor closes.
  void event
  rebuildBoardDerivedCards()
}

/** Map a SessionStatus.Info bus payload onto a CardStatus.
 *  streaming / retry → running (spinner ON, the card is actively working)
 *  idle              → idle (no spinner, "between turns / awaiting input")
 *  terminal.completed → completed
 *  terminal.error    → error
 *  terminal.aborted  → completed + terminalReason=aborted (badge renders as
 *                      cancelled, while the card is still non-error terminal) */
function mapSessionStatusToCardStatus(status: any): CardStatus | undefined {
  const t = String(status?.type || "")
  if (t === "streaming" || t === "retry") return "running"
  if (t === "idle") return "idle"
  if (t === "terminal") {
    const reason = String(status?.reason || "")
    if (reason === "completed") return "completed"
    if (reason === "aborted") return "completed"
    if (reason === "error") return "error"
  }
  return undefined
}

function projectSessionStatus(event: any): ProjectedSessionStatus {
  const props = propsOf(event)
  const status = props.status
  const cardStatus = mapSessionStatusToCardStatus(status)
  if (!cardStatus) {
    throw new Error(`session.status unknown status shape: ${JSON.stringify(status)}`)
  }
  const projected: ProjectedSessionStatus = { cardStatus }
  if (status?.type === "terminal") {
    const reason = String(status.reason || "")
    if (reason !== "completed" && reason !== "error" && reason !== "aborted") {
      throw new Error(`session.status unknown terminal reason: ${JSON.stringify(status)}`)
    }
    projected.terminalReason = reason
    projected.timeCompleted = Number(event?.emittedAt || event?.emitted_at || Date.now())
    if (cardStatus === "error") {
      projected.errorReason =
        (typeof status.message === "string" && status.message) ||
        (typeof status.error === "string" && status.error) ||
        ""
    }
  }
  return projected
}

function applyProjectedSessionStatus(cardID: string, projected: ProjectedSessionStatus): void {
  if (
    projected.cardStatus === "idle" &&
    cardTreeStore.cards[cardID]?.status === "error" &&
    cardTreeStore.cards[cardID]?.errorReason
  ) {
    return
  }
  setCardTreeStore("cards", cardID, "status", projected.cardStatus)
  if (projected.terminalReason) {
    setCardTreeStore("cards", cardID, "terminalReason", projected.terminalReason)
  }
  if (
    (projected.cardStatus === "completed" || projected.cardStatus === "error") &&
    projected.timeCompleted &&
    !cardTreeStore.cards[cardID]?.timeCompleted
  ) {
    setCardTreeStore("cards", cardID, "timeCompleted", projected.timeCompleted)
  }
  if (projected.errorReason) {
    setCardTreeStore("cards", cardID, "errorReason", projected.errorReason)
  }
}

function streamErrorMessage(event: any): string {
  const props = propsOf(event)
  const error = props.error
  if (error && typeof error === "object") {
    const dataMessage = (error as any).data?.message
    if (typeof dataMessage === "string" && dataMessage.length > 0) return dataMessage
    const message = (error as any).message
    if (typeof message === "string" && message.length > 0) return message
    const name = (error as any).name
    if (typeof name === "string" && name.length > 0) return name
  }
  const summary = props.summary ?? event?.summary
  if (typeof summary === "string" && summary.length > 0) return summary
  throw new Error("session.error missing error message")
}

function projectSessionError(event: any): ProjectedSessionStatus {
  return {
    cardStatus: "error",
    terminalReason: "error",
    errorReason: streamErrorMessage(event),
    timeCompleted: Number(event?.emittedAt || event?.emitted_at || Date.now()),
  }
}

function handleSessionStatus(event: any): void {
  const props = propsOf(event)
  const sessionID = String(props.sessionID || "")
  if (!sessionID) {
    throw new Error("session.status missing sessionID")
  }
  const projected = projectSessionStatus(event)
  const info = ensureLifecycleSessionProjection(event, sessionID)
  const activeCardID = info?.activeCardID
  if (!info || !activeCardID || !cardTreeStore.cards[activeCardID]) {
    // Active turn card not yet materialized and this status did not carry
    // enough lifecycle metadata to create one. Hold until a message or a
    // later enriched lifecycle event provides the session's stage.
    pendingSessionStatus.set(sessionID, projected)
    return
  }
  // Session lifecycle only touches the ACTIVE turn card. Older turn cards
  // are frozen history; a later terminal status must not retro-flip them.
  applyProjectedSessionStatus(activeCardID, projected)
}

function handleSessionError(event: any): void {
  const props = propsOf(event)
  const sessionID = String(props.sessionID || "")
  if (!sessionID) {
    throw new Error("session.error missing sessionID")
  }
  const projected = projectSessionError(event)
  const info = ensureLifecycleSessionProjection(event, sessionID)
  const activeCardID = info?.activeCardID
  if (!info || !activeCardID || !cardTreeStore.cards[activeCardID]) {
    pendingSessionStatus.set(sessionID, projected)
    return
  }
  applyProjectedSessionStatus(activeCardID, projected)
}

/** Drain any session.status buffered for this session. Called from
 *  ensureSessionCard after the session is committed, parallel to
 *  drainPendingIntegrity. */
function drainPendingSessionStatus(sessionID: string): void {
  const projected = pendingSessionStatus.get(sessionID)
  if (!projected) return
  const session = sessions.get(sessionID)
  const activeCardID = session?.activeCardID
  if (!session || !activeCardID || !cardTreeStore.cards[activeCardID]) return
  pendingSessionStatus.delete(sessionID)
  applyProjectedSessionStatus(activeCardID, projected)
}

function lifecycleStageFromProps(props: Record<string, any>, existing?: SessionInfo): string {
  const channel = String(props.channel || "").trim()
  if (channel === "main") return "user"
  if (channel) return channel
  return existing?.stage || ""
}

/** Index lifecycle metadata without creating display cards. Session cards are
 *  message-turn projections; lifecycle-only events stay buffered until a real
 *  message/part materializes the session card. */
function ensureLifecycleSessionProjection(event: any, sessionID: string): SessionInfo | undefined {
  const props = propsOf(event)
  const existing = sessions.get(sessionID)
  const stage = lifecycleStageFromProps(props, existing)
  if (stage === "filtered") return undefined
  if (!stage) return existing

  return ensureSessionProjection(sessionID, {
    stage,
    parentSessionID: String(props.parentSessionID || existing?.parentSessionID || ""),
    goalID: String(props.goalID || existing?.goalID || ""),
  })
}

function handleInteraction(event: any): void {
  // Interactions are sourced from boardStore.board.interactions, not the event
  // payload — the board routes handle the write, we reproject.
  rebuildBoardDerivedCards()
}

function isSelectedStandaloneSession(sessionID: string): boolean {
  const selected = boardStore.selectedSource
  if (selected?.kind === "session") return selected.id === sessionID
  const board = boardStore.board
  if (board?.kind === "session") return String(board?.sessionID || "") === sessionID
  return false
}

function questionTitle(questions: any[]): string {
  const headers = questions.map((item) => (typeof item?.header === "string" ? item.header.trim() : "")).filter(Boolean)
  return headers.join(" / ") || "Question"
}

function questionBody(questions: any[]): string {
  return questions
    .map((item) => (typeof item?.question === "string" ? item.question.trim() : ""))
    .filter(Boolean)
    .join("\n\n")
}

function handleStandaloneQuestion(event: any): void {
  const type = String(event?.type || "")
  const props = propsOf(event)
  const requestID = String(props.id || props.requestID || "")
  const sessionID = String(props.sessionID || props.session_id || "")
  if (!requestID || !sessionID) {
    throw new Error(`${type} missing requestID/sessionID`)
  }
  const session = sessions.get(sessionID)
  const isKnownMissionSession = session?.stage === "mission"
  if (
    !isSelectedStandaloneSession(sessionID) &&
    !isKnownMissionSession &&
    !standaloneQuestionInteractions.has(requestID)
  ) {
    return
  }

  if (type === "question.asked") {
    const questions = Array.isArray(props.questions) ? props.questions : []
    if (questions.length === 0) throw new Error(`question.asked ${requestID} missing questions`)
    const created = eventEmittedAt(event)
    standaloneQuestionInteractions.set(requestID, {
      id: requestID,
      sessionID,
      type: "question",
      status: "pending",
      title: questionTitle(questions),
      body: questionBody(questions),
      payload: {
        questions,
        ...(props.tool ? { tool: props.tool } : {}),
      },
      replyEndpoint: "question",
      time: { created },
    })
    rebuildCardHierarchy()
    return
  }

  const existing = standaloneQuestionInteractions.get(requestID)
  if (!existing) return
  const resolved = eventEmittedAt(event)
  standaloneQuestionInteractions.set(requestID, {
    ...existing,
    status: type === "question.rejected" ? "rejected" : "answered",
    response: type === "question.replied" ? { answers: Array.isArray(props.answers) ? props.answers : [] } : {},
    time: {
      ...(existing.time || {}),
      resolved,
    },
  })
  rebuildCardHierarchy()
}

// ── Shared review stream + completed review bodies ──

function integrityCardID(sessionID: string): string {
  return sessionCardID("integrity", sessionID)
}

type ReviewStreamPhase = "integrity"
type ReviewStreamStep = "manifest" | "runtime" | "visual" | "specialist" | "agent" | "post_repair"

interface RunningReviewPayload {
  taskID: string
  reviewID: string
  phase: ReviewStreamPhase
  sessionID?: string
  startedAt: number
  attempt: number
  elapsedMs: number
  currentStep?: ReviewStreamStep
  activity?: string
  reviewerID?: string
  roundID?: string
  summary?: string
}
const runningReviews = new Map<string, RunningReviewPayload>()

function normalizeReviewPhase(raw: string): ReviewStreamPhase {
  if (raw === "integrity") return raw
  throw new Error(`review.stream phase unsupported: ${raw}`)
}

function normalizeReviewStep(raw: string): ReviewStreamStep | undefined {
  if (!raw) return undefined
  if (
    raw === "manifest" ||
    raw === "runtime" ||
    raw === "visual" ||
    raw === "specialist" ||
    raw === "agent" ||
    raw === "post_repair"
  )
    return raw
  throw new Error(`review.stream progress currentStep unsupported: ${raw}`)
}

function reviewCardID(p: Pick<RunningReviewPayload, "phase" | "reviewID" | "sessionID">): string {
  if (!p.sessionID) throw new Error(`review.stream.${p.phase} missing sessionID (reviewID=${p.reviewID})`)
  return integrityCardID(p.sessionID)
}

function eventEmittedAt(event: any): number {
  const emittedAt = Number(event?.emittedAt || event?.emitted_at || event?.timestamp || 0)
  return Number.isFinite(emittedAt) && emittedAt > 0 ? emittedAt : Date.now()
}

function integritySessionIDFromReviewID(reviewID: string): string | undefined {
  const prefix = "integrity:"
  if (!reviewID.startsWith(prefix)) return undefined
  const sessionID = reviewID.slice(prefix.length)
  return sessionID.startsWith("ses") ? sessionID : undefined
}

function completedIntegrityCardForReviewID(reviewID: string): CardNode | undefined {
  const sessionID = integritySessionIDFromReviewID(reviewID)
  return sessionID ? cardTreeStore.cards[integrityCardID(sessionID)] : undefined
}

function reconstructRunningIntegrityReview(input: {
  taskID: string
  reviewID: string
  phase: ReviewStreamPhase
  event: any
  attempt: number
  elapsedMs?: number
}): RunningReviewPayload | undefined {
  if (input.phase !== "integrity") return undefined
  const sessionID = integritySessionIDFromReviewID(input.reviewID)
  if (!sessionID) return undefined
  const elapsedMs = Math.max(0, Number(input.elapsedMs || 0))
  const payload: RunningReviewPayload = {
    taskID: input.taskID,
    reviewID: input.reviewID,
    phase: input.phase,
    sessionID,
    startedAt: Math.max(1, eventEmittedAt(input.event) - elapsedMs),
    attempt: input.attempt,
    elapsedMs,
  }
  runningReviews.set(input.reviewID, payload)
  materializeRunningReview(payload)
  return payload
}

function ensureIntegrityReviewProjection(input: {
  taskID: string
  reviewID: string
  phase: ReviewStreamPhase
  event: any
  attempt: number
  elapsedMs?: number
}): RunningReviewPayload | undefined {
  return runningReviews.get(input.reviewID) ?? reconstructRunningIntegrityReview(input)
}

function handleReviewStreamStarted(event: any): void {
  const props = propsOf(event)
  const taskID = String(props.taskID || "")
  const reviewID = String(props.reviewID || "")
  const phase = normalizeReviewPhase(String(props.phase || ""))
  const sessionID = typeof props.sessionID === "string" ? props.sessionID : undefined
  if (!taskID) throw new Error("review.stream.started missing taskID")
  if (!reviewID) throw new Error(`review.stream.started missing reviewID (taskID=${taskID})`)
  if (phase === "integrity" && !sessionID)
    throw new Error(`review.stream.started integrity missing sessionID (taskID=${taskID})`)
  const emittedAt = Number(event?.emittedAt || event?.emitted_at || 0)
  const payload: RunningReviewPayload = {
    taskID,
    reviewID,
    phase,
    sessionID,
    startedAt: emittedAt > 0 ? emittedAt : Date.now(),
    attempt: 0,
    elapsedMs: 0,
  }
  runningReviews.set(reviewID, payload)
  materializeRunningReview(payload)
}

function handleReviewStreamProgress(event: any): void {
  const props = propsOf(event)
  const taskID = String(props.taskID || "")
  const reviewID = String(props.reviewID || "")
  const phase = normalizeReviewPhase(String(props.phase || ""))
  if (!taskID) throw new Error("review.stream.progress missing taskID")
  if (!reviewID) throw new Error(`review.stream.progress missing reviewID (taskID=${taskID})`)
  const attempt = Number(props.attempt || 0)
  const elapsedMs = Number(props.elapsedMs || props.elapsed_ms || 0)
  if (completedIntegrityCardForReviewID(reviewID)?.integrity) return
  const existing = ensureIntegrityReviewProjection({
    taskID,
    reviewID,
    phase,
    event,
    attempt,
    elapsedMs,
  })
  if (!existing) {
    throw new Error(`review.stream.progress arrived before started (taskID=${taskID}, reviewID=${reviewID})`)
  }
  const payload: RunningReviewPayload = {
    ...existing,
    taskID,
    reviewID,
    phase,
    startedAt: existing?.startedAt ?? Date.now() - elapsedMs,
    attempt,
    elapsedMs,
    currentStep: normalizeReviewStep(String(props.currentStep || props.current_step || "")),
    activity: typeof props.activity === "string" ? props.activity : undefined,
    reviewerID: typeof props.reviewerID === "string" ? props.reviewerID : undefined,
    roundID: typeof props.roundID === "string" ? props.roundID : undefined,
    summary: typeof props.summary === "string" ? props.summary : undefined,
  }
  runningReviews.set(reviewID, payload)
  materializeRunningReview(payload)
}

function handleReviewStreamChunk(event: any): void {
  const props = propsOf(event)
  const taskID = String(props.taskID || "")
  const reviewID = String(props.reviewID || "")
  const phase = normalizeReviewPhase(String(props.phase || ""))
  if (!taskID) throw new Error("review.stream.chunk missing taskID")
  if (!reviewID) throw new Error(`review.stream.chunk missing reviewID (taskID=${taskID})`)
  const kind = String(props.kind || "")
  const delta = String(props.delta || "")
  const attempt = Number(props.attempt || 1)
  if (kind !== "reasoning") {
    throw new Error(`review.stream.chunk unexpected kind: ${kind}`)
  }
  if (!delta) return

  const completedCard = completedIntegrityCardForReviewID(reviewID)
  if (completedCard?.integrity) return
  const running = ensureIntegrityReviewProjection({
    taskID,
    reviewID,
    phase,
    event,
    attempt,
  })
  if (!running) {
    throw new Error(`review.stream.chunk arrived before started (taskID=${taskID}, reviewID=${reviewID})`)
  }
  const cardID = reviewCardID({ ...running, phase })
  const existing = cardTreeStore.cards[cardID]
  // Completed event already upserted the verdict — ignore trailing chunks.
  if (existing?.integrity) return
  if (!existing) {
    throw new Error(`review.stream.chunk missing materialized card (taskID=${taskID}, reviewID=${reviewID})`)
  }

  const partID = `review:${reviewID}:reasoning:${attempt}`

  setCardTreeStore(
    "cards",
    cardID,
    "parts",
    produce((parts: any[]) => {
      const idx = parts.findIndex((p) => p?.partID === partID)
      if (idx >= 0) {
        parts[idx].text = String(parts[idx].text || "") + delta
      } else {
        parts.push({ type: "reasoning", partID, text: delta })
      }
    }),
  )
  markCardStatsDirty(cardID)
}

/** Integrity is a real session, but its reasoning/verdict reach the overlay
 *  through `integrity.review.*` events (NOT `message.updated`), so there is
 *  no durable messageID to scope a message-turn card by. It therefore keeps
 *  a single dedicated card id (`integrity:session:<sid>`). We still register
 *  a SessionInfo so session.status / usage routing (active turn card) works
 *  uniformly — `activeCardID` is pinned to the dedicated card. */
function ensureIntegritySession(sessionID: string, time: number): { session: SessionInfo; cardID: string } {
  const session = ensureSessionProjection(sessionID, { stage: "integrity", parentSessionID: "", goalID: "" })
  const cardID = sessionCardID("integrity", sessionID)
  const created = !cardTreeStore.cards[cardID]
  if (created) {
    setCardTreeStore("cards", cardID, createSessionCardNode(cardID, "integrity", "", time, sessionID, ""))
  }
  session.activeCardID = cardID
  if (created) {
    rebuildCardHierarchy()
    drainPendingSessionStatus(sessionID)
    drainPendingIntegrity(sessionID)
  }
  return { session, cardID }
}

/** Upsert the running-phase integrity session card. Integrity is now a normal
 *  agent session, so lifecycle events target the session card directly. */
function materializeRunningReview(p: RunningReviewPayload): void {
  if (!p.sessionID) throw new Error(`review.stream integrity missing sessionID (reviewID=${p.reviewID})`)
  materializeRunningIntegrity({
    taskID: p.taskID,
    reviewID: p.reviewID,
    sessionID: p.sessionID,
    startedAt: p.startedAt,
    attempt: p.attempt,
    elapsedMs: p.elapsedMs,
    phase: p.phase,
    currentStep: p.currentStep,
    activity: p.activity,
    reviewerID: p.reviewerID,
    roundID: p.roundID,
    summary: p.summary,
  })
}

function materializeRunningIntegrity(p: RunningReviewPayload & { sessionID: string }): void {
  const { cardID } = ensureIntegritySession(p.sessionID, p.startedAt)
  const existing = cardTreeStore.cards[cardID]
  // If the completed event has already landed, don't downgrade the verdict
  // card back to "running". `attempts` on a completed card is > 0 and the
  // `integrity` payload is populated — that's how we tell.
  if (existing && existing.integrity) return
  // Subtitle carries only the retry attempt label (when applicable).
  // The live elapsed-time display is owned by CardHeader's
  // `.card__duration` chip, which subtracts `time` from a shared 1Hz
  // tick (services/clock.ts). `p.elapsedMs` stays on the payload
  // because it still reconstructs `startedAt` on SSE replay above.
  const subtitle = p.attempt > 0 ? t("integrity.attempt_label", { value: String(p.attempt) }) : undefined
  // Progress ticks every 20s. If the card already exists, patch only the
  // volatile fields (status + subtitle) — writing a fresh card with
  // `parts: []` would wipe any reasoning/tool_input chunks that have
  // streamed in between two Progress events.
  if (existing) {
    setCardTreeStore("cards", cardID, {
      ...existing,
      status: "running",
      subtitle,
      stage: "integrity",
      accent: stageAccent("integrity"),
      title: roleTitleKey("integrity"),
      reviewStream: {
        phase: "integrity",
        currentStep: p.currentStep,
        activity: p.activity,
        reviewerID: p.reviewerID,
        roundID: p.roundID,
        elapsedMs: p.elapsedMs,
        summary: p.summary,
      },
    })
    return
  }
  throw new Error(`integrity session card missing after ensureIntegritySession (sessionID=${p.sessionID})`)
}

function handleIntegrityCompleted(event: any): void {
  const props = propsOf(event)
  const taskID = String(props.taskID || "")
  const sessionID = String(props.sessionID || "")
  if (!taskID) throw new Error("integrity.review.completed missing taskID")
  if (!sessionID) {
    // sessionID became required (engine/model.ts) — loud-fail rather than
    // allowing the card to escape or silently drop. The matching assertion
    // in opencorvus/integrity/team-agent.ts emitIntegrityEvent keeps the
    // backend honest.
    throw new Error(`integrity.review.completed missing sessionID (taskID=${taskID})`)
  }

  const emittedAt = Number(event?.emittedAt || event?.emitted_at || 0)
  if (!(emittedAt > 0)) {
    throw new Error(
      `integrity.review.completed missing emittedAt (taskID=${taskID}); server emitter is the single source of truth`,
    )
  }
  const attempts = Number(props.attempts || 0)
  const summary = typeof props.summary === "string" ? props.summary : ""
  if (false) {
    // acceptance is a required field on integrity.review.completed — the
    // opencorvus integrity agent cannot finalize without an acceptance
    // verdict (agent.ts submit guards), so a missing one is a backend
    // contract breach, not a renderable state. Loud-fail like the
    // sessionID/emittedAt guards above (backend emitter is the single
    // source of truth) instead of silently dropping the acceptance section.
    throw new Error(`integrity.review.completed missing acceptance verdict (taskID=${taskID})`)
  }
  const acceptanceRaw = props.acceptance as Record<string, any>
  const acceptance = acceptanceRaw
    ? {
        verdict: acceptanceRaw.verdict === "accepted" ? ("accepted" as const) : ("rejected" as const),
        summary: String(acceptanceRaw.summary || ""),
        startup_verification:
          acceptanceRaw.startup_verification && typeof acceptanceRaw.startup_verification === "object"
            ? {
                attempted: acceptanceRaw.startup_verification.attempted === true,
                command:
                  typeof acceptanceRaw.startup_verification.command === "string"
                    ? acceptanceRaw.startup_verification.command
                    : undefined,
                success: acceptanceRaw.startup_verification.success === true,
                output:
                  typeof acceptanceRaw.startup_verification.output === "string"
                    ? acceptanceRaw.startup_verification.output
                    : undefined,
              }
            : undefined,
        frontend_check:
          acceptanceRaw.frontend_check && typeof acceptanceRaw.frontend_check === "object"
            ? {
                attempted: acceptanceRaw.frontend_check.attempted === true,
                renders_correctly:
                  typeof acceptanceRaw.frontend_check.renders_correctly === "boolean"
                    ? acceptanceRaw.frontend_check.renders_correctly
                    : undefined,
                issues: Array.isArray(acceptanceRaw.frontend_check.issues)
                  ? acceptanceRaw.frontend_check.issues.filter(
                      (item: unknown): item is string => typeof item === "string",
                    )
                  : undefined,
              }
            : undefined,
        deferred_checks: Array.isArray(acceptanceRaw.deferred_checks)
          ? acceptanceRaw.deferred_checks.map((item: any) => ({
              name: String(item?.name || ""),
              result: String(item?.result || ""),
              evidence: String(item?.evidence || ""),
            }))
          : [],
        tool_call_evidence: Array.isArray(acceptanceRaw.tool_call_evidence)
          ? acceptanceRaw.tool_call_evidence.map((item: any) => ({
              tool: String(item?.tool || ""),
              passed: item?.passed === true,
              detail: String(item?.detail || ""),
            }))
          : [],
        rejection_details: Array.isArray(acceptanceRaw.rejection_details)
          ? acceptanceRaw.rejection_details.map((item: any) => ({
              goal_id: typeof item?.goal_id === "string" ? item.goal_id : undefined,
              category: String(item?.category || ""),
              check_id: typeof item?.check_id === "string" ? item.check_id : undefined,
              file: typeof item?.file === "string" ? item.file : undefined,
              error: String(item?.error || ""),
              suggestion: typeof item?.suggestion === "string" ? item.suggestion : undefined,
              visual_spec_id: typeof item?.visual_spec_id === "string" ? item.visual_spec_id : undefined,
            }))
          : [],
        launch_command: typeof acceptanceRaw.launch_command === "string" ? acceptanceRaw.launch_command : undefined,
      }
    : undefined
  const verdict: "pass" | "concerns" | "needs_correction" =
    props.verdict === "pass" ? "pass" : props.verdict === "concerns" ? "concerns" : "needs_correction"
  const reviewers = Array.isArray(props.reviewers) ? props.reviewers : []
  const findings = Array.isArray(props.findings) ? props.findings : []
  const requiredRepairs = Array.isArray(props.requiredRepairs) ? props.requiredRepairs : []
  const unresolvedDisagreements = Array.isArray(props.unresolvedDisagreements) ? props.unresolvedDisagreements : []
  const stringArray = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item: unknown): item is string => typeof item === "string") : []

  const payload: PendingIntegrityPayload = {
    taskID,
    emittedAt,
    verdict,
    summary,
    teamReportMarkdown: typeof props.teamReportMarkdown === "string" ? props.teamReportMarkdown : "",
    reviewers: reviewers.map((item: any) => ({
      reviewerID: String(item?.reviewerID || ""),
      scope: String(item?.scope || ""),
      verdict: item?.verdict === "pass" ? "pass" : item?.verdict === "concerns" ? "concerns" : "needs_correction",
      summary: String(item?.summary || ""),
      evidence: stringArray(item?.evidence),
      findings: Array.isArray(item?.findings) ? item.findings : [],
      openQuestions: stringArray(item?.openQuestions),
    })),
    findings: findings.map((item: any) => ({
      id: String(item?.id || ""),
      severity: item?.severity === "advisory" ? "advisory" : "blocking",
      verdictImpact:
        item?.verdictImpact === "pass" ? "pass" : item?.verdictImpact === "concerns" ? "concerns" : "needs_correction",
      fingerprint: typeof item?.fingerprint === "string" ? item.fingerprint : undefined,
      canonicalSymptom: typeof item?.canonicalSymptom === "string" ? item.canonicalSymptom : undefined,
      title: String(item?.title || ""),
      description: String(item?.description || ""),
      evidence: stringArray(item?.evidence),
      targetIDs: stringArray(item?.targetIDs),
      requirementIDs: stringArray(item?.requirementIDs),
      specIDs: stringArray(item?.specIDs),
      filePaths: stringArray(item?.filePaths),
      affectedSymbols: stringArray(item?.affectedSymbols),
      repair: String(item?.repair || ""),
      verify: stringArray(item?.verify),
      sourceFindingIDs: stringArray(item?.sourceFindingIDs),
      priorAttemptRefs: stringArray(item?.priorAttemptRefs),
      reviewers: stringArray(item?.reviewers),
      consensus:
        item?.consensus === "disputed" ? "disputed" : item?.consensus === "unresolved" ? "unresolved" : "agreed",
    })),
    requiredRepairs: requiredRepairs.map((item: any) => ({
      id: String(item?.id || ""),
      fingerprint: typeof item?.fingerprint === "string" ? item.fingerprint : undefined,
      severity: item?.severity === "advisory" ? "advisory" : item?.severity === "blocking" ? "blocking" : undefined,
      title: typeof item?.title === "string" ? item.title : undefined,
      canonicalSymptom: typeof item?.canonicalSymptom === "string" ? item.canonicalSymptom : undefined,
      description: String(item?.description || ""),
      evidence: stringArray(item?.evidence),
      targetIDs: stringArray(item?.targetIDs),
      requirementIDs: stringArray(item?.requirementIDs),
      specIDs: stringArray(item?.specIDs),
      filePaths: stringArray(item?.filePaths),
      affectedSymbols: stringArray(item?.affectedSymbols),
      repair: typeof item?.repair === "string" ? item.repair : undefined,
      verify: stringArray(item?.verify),
      sourceFindingIDs: stringArray(item?.sourceFindingIDs),
      priorAttemptRefs: stringArray(item?.priorAttemptRefs),
    })),
    unresolvedDisagreements: unresolvedDisagreements.map((item: any) => ({
      id: String(item?.id || ""),
      description: String(item?.description || ""),
      reviewerIDs: stringArray(item?.reviewerIDs),
      consequence: String(item?.consequence || ""),
    })),
    attempts,
  }

  const { session } = ensureIntegritySession(sessionID, emittedAt)

  materializeIntegrity(session, payload)
  // Running-card lifecycle: the completed upsert now owns this cardID; drop
  // the running review entry so a late `progress` event for the same task
  // doesn't rewrite the verdict back to a running placeholder.
  runningReviews.delete(`integrity:${sessionID}`)
}

/** Atomically write the integrity verdict onto the session card itself. */
function materializeIntegrity(session: SessionInfo, p: PendingIntegrityPayload): void {
  const cardID = session.activeCardID
  if (!cardID) {
    throw new Error(`integrity session card missing on completion (sessionID=${session.sessionID})`)
  }
  // pass = green/completed, concerns = warning (rendered as completed but the
  // verdict pill carries the warning colour), needs_correction = error.
  const status: CardStatus = p.verdict === "pass" ? "completed" : p.verdict === "concerns" ? "completed" : "error"
  const existing = cardTreeStore.cards[cardID]
  if (!existing) {
    throw new Error(`integrity session card missing on completion (sessionID=${session.sessionID})`)
  }
  setCardTreeStore("cards", cardID, {
    ...existing,
    stage: "integrity",
    accent: stageAccent("integrity"),
    status,
    title: roleTitleKey("integrity"),
    subtitle: undefined,
    integrity: {
      verdict: p.verdict,
      summary: p.summary,
      teamReportMarkdown: p.teamReportMarkdown,
      reviewers: p.reviewers,
      findings: p.findings,
      requiredRepairs: p.requiredRepairs,
      unresolvedDisagreements: p.unresolvedDisagreements,
      attempts: p.attempts,
    },
  })
}

/** Drain any integrity payload waiting for this session and materialize it.
 *  Called from ensureSessionCard immediately after the session is committed
 *  so an integrity event that arrived first is flushed in the same batch. */
function drainPendingIntegrity(sessionID: string): void {
  const payload = pendingIntegrity.get(sessionID)
  if (!payload) return
  const session = sessions.get(sessionID)
  if (!session || !session.activeCardID || !cardTreeStore.cards[session.activeCardID]) return
  pendingIntegrity.delete(sessionID)
  materializeIntegrity(session, payload)
}

// ── Session & part bookkeeping ──

function deriveSessionStage(info: any): string {
  // `channel` is the single authoritative signal stamped by the backend
  // bridge (task-message-protocol-bridge.overlayMeta). It is derived from
  // the session's DB `kind` plus the message role, so every semantically
  // distinct bubble already has a correct stage at the source.
  //
  // Reading this as a cascading derivation (channel → agent → resolvedRole →
  // role) previously routed root-session user messages to stage="build"
  // because `info.agent` on user rows is `Agent.defaultAgent()` (="build"
  // under OpenCorvus config). That cascade turned a user bubble into an
  // orange 「构建」 card — a classic rule-1 hidden-derivation bug.
  //
  // Channel values:
  //   "main"      → root-session user bubble → stage "user"
  //   "filtered"  → backend asked overlay to hide → caller skips the event
  //   SessionKind → stage = kind (build / requirements / architect / ...)
  //   missing     → bridge bug — fail loud, do not guess
  const channel = String(info?.channel || "").trim()
  if (!channel) {
    throw new Error(
      `tree-writer: message info is missing channel — bridge enrichment contract broken. info=${JSON.stringify(info)}`,
    )
  }
  if (channel === "main") return "user"
  if (channel === "filtered") return "filtered"
  return channel
}

function displayRoleForResolvedRole(resolvedRole: string): string {
  if (resolvedRole === "filtered") return "filtered"
  return normalizeAgentRole(resolvedRole)
}

interface EnsureSessionOpts {
  stage: string
  parentSessionID: string
  goalID: string
}

/** Register / backfill the runtime session index. NEVER creates a display
 *  card — display identity is per message turn, not per session (spec
 *  §2.3). `ensureMessageTurnProjection` owns card creation. */
function ensureSessionProjection(sessionID: string, opts: EnsureSessionOpts): SessionInfo {
  const existing = sessions.get(sessionID)
  if (existing) {
    if (!existing.stage && opts.stage) existing.stage = opts.stage
    if (!existing.parentSessionID && opts.parentSessionID) {
      existing.parentSessionID = opts.parentSessionID
      rebuildCardHierarchy()
    }
    if (!existing.goalID && opts.goalID) existing.goalID = opts.goalID
    return existing
  }
  const info: SessionInfo = {
    sessionID,
    stage: opts.stage || "",
    parentSessionID: opts.parentSessionID || "",
    goalID: opts.goalID || "",
    messageIDs: new Set(),
    messageCardIDs: new Map(),
    partIndex: new Map(),
    topLevelVisible: false,
    messageUsage: new Map(),
    messageModels: new Map(),
  }
  sessions.set(sessionID, info)
  return info
}

/** Is this session folded into a goal phase card (build / planner under a
 *  goal)? Phase-absorbed sessions do NOT get message-turn cards — their
 *  parts accumulate on the single phase card, unchanged from P0 (spec
 *  §3.7 — keep existing phase-absorbed build/planner behaviour). */
function isPhaseAbsorbedSession(stage: string, goalID: string): boolean {
  return Boolean(goalID && stage && goalStagePhaseID(stage))
}

/** Resolve the display card id for ONE message turn of a session.
 *
 *  - Phase-absorbed (goal-scope build/planner): the goal phase card. The
 *    phase card is stubbed here if SSE ordering put message/part events
 *    before the board's goalWorkflows arrived; rebuildGoalStepCards later
 *    overlays its real metadata without clobbering accumulated parts.
 *  - Otherwise: a deterministic per-message-turn card id. messageID is
 *    durable, so a pending turn card (part-before-message) and the final
 *    turn card share the same id — no stub/rename needed. */
function resolveTurnCardID(
  sessionID: string,
  stage: string,
  goalID: string,
  messageID: string,
  time: number,
): {
  cardID: string
  isPhase: boolean
} {
  if (stage === "integrity" && !goalID) {
    const cardID = integrityCardID(sessionID)
    if (!cardTreeStore.cards[cardID]) {
      setCardTreeStore("cards", cardID, createSessionCardNode(cardID, "integrity", "", time, sessionID, ""))
    }
    return { cardID, isPhase: false }
  }
  if (isPhaseAbsorbedSession(stage, goalID)) {
    const phase = goalStagePhaseID(stage)!
    // Read the live run id so the stub lands on the current attempt's card.
    const runID = goalCurrentRunID.get(goalID)
    const phaseCardID = goalPhaseCardID(goalID, runID, phase.stepID, phase.phaseID)
    if (!cardTreeStore.cards[phaseCardID]) {
      setCardTreeStore("cards", phaseCardID, {
        id: phaseCardID,
        kind: "phase",
        stage,
        accent: stageAccent(stage),
        status: "running",
        title: roleTitleKey(stage),
        parts: [],
        childIDs: [],
        phaseID: phase.phaseID,
        phaseSessionKind: stage,
        phaseSessionID: sessionID,
        time,
      })
    } else if (cardTreeStore.cards[phaseCardID]!.phaseSessionID !== sessionID) {
      // Absorbed session replaced (rewind / re-dispatch within the same
      // goal run). Track the latest so the reply box always targets the
      // session whose parts are currently streaming.
      setCardTreeStore("cards", phaseCardID, "phaseSessionID", sessionID)
    }
    return { cardID: phaseCardID, isPhase: true }
  }
  // stage is guaranteed non-empty by the deriveSessionStage invariant.
  return { cardID: messageTurnCardID(stage, sessionID, messageID), isPhase: false }
}

interface EnsureTurnCardOpts {
  stage: string
  goalID: string
  role: string
  time: number
  /** message.updated carries the authoritative server time; a
   *  part-before-message stamp is observation time only and must not
   *  overwrite a server time already on the card. */
  stampServerTime: boolean
  /** Hydrate replays many turns then rebuilds once at the end. */
  deferHierarchy?: boolean
}

/** Move an early non-phase turn card's parts onto the resolved target card
 *  and repoint this session's part targets. Only fires when goalID arrives
 *  AFTER a turn card was already opened for the message (rare: the bridge
 *  stamps goalID/channel consistently on every event for a message). Keeps
 *  a single display identity — no duplicate / orphan card (rule 8). */
function migrateTurnCard(session: SessionInfo, fromCardID: string, toCardID: string): void {
  if (fromCardID === toCardID) return
  const from = cardTreeStore.cards[fromCardID]
  const movedParts = from ? (from.parts || []).slice() : []
  setCardTreeStore(
    "cards",
    produce((cards: Record<string, CardNode>) => {
      const target = cards[toCardID]
      if (!target) return
      const baseLen = target.parts.length
      for (const p of movedParts) target.parts.push(p)
      for (const [pid, tgt] of session.partIndex) {
        if (tgt.cardID === fromCardID) {
          session.partIndex.set(pid, { cardID: toCardID, index: baseLen + tgt.index })
        }
      }
      if (fromCardID in cards) delete cards[fromCardID]
    }),
  )
  for (const [mid, cid] of session.messageCardIDs) {
    if (cid === fromCardID) session.messageCardIDs.set(mid, toCardID)
  }
  if (session.activeCardID === fromCardID) session.activeCardID = toCardID
}

function migrateLifecycleCardToTurnCard(
  session: SessionInfo,
  fromCardID: string,
  toCardID: string,
  messageID: string,
  time: number,
): void {
  if (fromCardID === toCardID || !cardTreeStore.cards[fromCardID] || cardTreeStore.cards[toCardID]) return
  setCardTreeStore(
    "cards",
    produce((cards: Record<string, CardNode>) => {
      const from = cards[fromCardID]
      if (!from) return
      cards[toCardID] = {
        ...from,
        id: toCardID,
        messageID,
        time,
      }
      delete cards[fromCardID]
    }),
  )
  if (session.activeCardID === fromCardID) session.activeCardID = toCardID
}

/** Create or refresh the display card for one message turn and point the
 *  session's active pointers at it. Returns the resolved card id + whether
 *  it is a phase card. */
function ensureMessageTurnProjection(
  session: SessionInfo,
  messageID: string,
  opts: EnsureTurnCardOpts,
): { cardID: string; isPhase: boolean } {
  const stage = opts.stage || session.stage || ""
  const goalID = opts.goalID || session.goalID || ""
  const resolved = resolveTurnCardID(session.sessionID, stage, goalID, messageID, opts.time)
  let cardID = resolved.cardID
  const isPhase = resolved.isPhase

  const prior = session.messageCardIDs.get(messageID)
  if (prior && prior !== resolved.cardID && isPhase) {
    cardID = resolved.cardID
    migrateTurnCard(session, prior, cardID)
  } else if (prior) {
    cardID = prior
  }

  if (!isPhase) {
    const lifecycleCardID = sessionCardID(stage, session.sessionID)
    if (!prior && lifecycleCardID !== cardID && cardTreeStore.cards[lifecycleCardID]) {
      migrateLifecycleCardToTurnCard(session, lifecycleCardID, cardID, messageID, opts.time)
    }
    const existing = cardTreeStore.cards[cardID]
    if (existing) {
      setCardTreeStore("cards", cardID, "sessionID", session.sessionID)
      if (!existing.messageID) setCardTreeStore("cards", cardID, "messageID", messageID)
      if (opts.stampServerTime && prior && existing.messageID === messageID) {
        setCardTreeStore("cards", cardID, "time", opts.time)
      }
      if (
        existing.terminalReason !== "completed" &&
        existing.terminalReason !== "error" &&
        existing.terminalReason !== "aborted"
      ) {
        setCardTreeStore("cards", cardID, "status", "running")
      }
    } else {
      setCardTreeStore(
        "cards",
        cardID,
        createSessionCardNode(cardID, stage, goalID, opts.time, session.sessionID, messageID),
      )
    }
    // Freeze the previous still-running turn: a newer real message in the
    // same session means the older turn is no longer the active stream.
    // Display projection invariant, not a synthetic lifecycle event
    // (spec §3.4).
    const prevCardID = session.activeCardID
    if (prevCardID && prevCardID !== cardID && cardTreeStore.cards[prevCardID]?.status === "running") {
      setCardTreeStore("cards", prevCardID, "status", "completed")
    }
  }

  session.messageCardIDs.set(messageID, cardID)
  session.activeMessageID = messageID
  session.activeCardID = cardID

  if (!opts.deferHierarchy) rebuildCardHierarchy()
  return { cardID, isPhase }
}

interface TimelineSegment {
  cardID: string
  session: SessionInfo
  stage: string
  goalID: string
  messages: MessageInfo[]
}

function messageTimeOrder(left: MessageInfo, right: MessageInfo): number {
  const byTime = left.time - right.time
  if (byTime !== 0) return byTime
  return left.id.localeCompare(right.id)
}

function nonPhaseMessageTurnCardID(cardID: string): boolean {
  return cardID.includes(":session:") && cardID.includes(":message:")
}

function timelineCardID(stage: string, sessionID: string, messageID: string): string {
  return stage === "integrity" ? integrityCardID(sessionID) : messageTurnCardID(stage, sessionID, messageID)
}

function isReviewStreamPart(part: any): boolean {
  return String(part?.partID || "").startsWith("review:integrity:")
}

function collectTimelineParts(messageIDs: Set<string>): Map<string, any[]> {
  const byMessage = new Map<string, any[]>()
  const seenPartIDs = new Set<string>()
  for (const card of Object.values(cardTreeStore.cards)) {
    for (const part of card?.parts || []) {
      if (!part || part.type === "boundary") continue
      const messageID = String(part.messageID || "")
      if (!messageIDs.has(messageID)) continue
      const partID = String(part.id || "")
      if (partID && seenPartIDs.has(partID)) continue
      if (partID) seenPartIDs.add(partID)
      const list = byMessage.get(messageID)
      if (list) list.push(part)
      else byMessage.set(messageID, [part])
    }
  }
  return byMessage
}

function clearTimelinePartIndexes(messageIDs: Set<string>): void {
  for (const session of sessions.values()) {
    for (const [partID, target] of [...session.partIndex]) {
      const part = cardTreeStore.cards[target.cardID]?.parts?.[target.index]
      const indexedMessageID =
        part?.messageID || (partID.startsWith("__boundary__:") ? partID.slice(partID.lastIndexOf(":") + 1) : "")
      if (messageIDs.has(String(indexedMessageID || ""))) {
        session.partIndex.delete(partID)
      }
    }
  }
}

function clearMessageCardOwnershipForCard(cardID: string): void {
  for (const session of sessions.values()) {
    for (const [messageID, mappedCardID] of [...session.messageCardIDs]) {
      if (mappedCardID === cardID) session.messageCardIDs.delete(messageID)
    }
    if (session.activeCardID === cardID) {
      session.activeCardID = undefined
      session.activeMessageID = undefined
    }
  }
}

function phaseMessagesForCard(cardID: string): MessageInfo[] {
  const seen = new Set<string>()
  const out: MessageInfo[] = []
  for (const session of sessions.values()) {
    for (const [messageID, mappedCardID] of session.messageCardIDs) {
      if (mappedCardID !== cardID || seen.has(messageID)) continue
      const message = messages.get(messageID)
      if (!message) continue
      seen.add(messageID)
      out.push(message)
    }
  }
  return out.sort(messageTimeOrder)
}

function clearPartIndexesForCard(cardID: string): void {
  for (const session of sessions.values()) {
    for (const [partID, target] of [...session.partIndex]) {
      if (target.cardID === cardID) session.partIndex.delete(partID)
    }
  }
}

function indexPhasePart(part: any, cardID: string, index: number): void {
  const sessionID = String(part?.sessionID || "")
  const partID = String(part?.id || "")
  if (!sessionID || !partID) return
  const session = sessions.get(sessionID)
  if (!session) return
  session.partIndex.set(partID, { cardID, index })
}

function indexPhaseBoundary(part: any, cardID: string, index: number): void {
  const messageID = String(part?.messageID || "")
  if (!messageID) return
  for (const session of sessions.values()) {
    if (session.messageCardIDs.get(messageID) !== cardID) continue
    session.partIndex.set(`__boundary__:${session.sessionID}:${messageID}`, { cardID, index })
    return
  }
}

function reorderPhaseCardParts(cardID: string): void {
  const card = cardTreeStore.cards[cardID]
  if (!card || card.kind !== "phase") return
  const current = Array.isArray(card.parts) ? card.parts : []
  if (current.length === 0) return

  const orderedMessages = phaseMessagesForCard(cardID)
  if (orderedMessages.length === 0) return
  const knownMessageIDs = new Set(orderedMessages.map((message) => message.id))
  const partsByMessage = new Map<string, any[]>()
  const pendingPartFirst: any[] = []

  for (const part of current) {
    if (!part) continue
    const messageID = String(part.messageID || "")
    if (part.type === "boundary") {
      if (!messageID || !knownMessageIDs.has(messageID)) pendingPartFirst.push(part)
      continue
    }
    if (messageID && knownMessageIDs.has(messageID)) {
      const list = partsByMessage.get(messageID)
      if (list) list.push(part)
      else partsByMessage.set(messageID, [part])
    } else {
      // A display part may arrive before its message row. There is no
      // authoritative timestamp yet, so keep it after timestamped groups
      // until message.updated lets this function place it precisely.
      pendingPartFirst.push(part)
    }
  }

  clearPartIndexesForCard(cardID)
  const rebuilt: any[] = []
  for (const message of orderedMessages) {
    const parts = partsByMessage.get(message.id) ?? []
    if (parts.some(conversationPartHasDisplay)) {
      const session = sessions.get(message.sessionID)
      const boundaryKey = `__boundary__:${message.sessionID}:${message.id}`
      const boundary = {
        type: "boundary",
        messageID: message.id,
        role: message.resolvedRole,
        roleLabel: roleLabel(message.resolvedRole),
        time: message.time > 0 ? message.time : undefined,
      }
      if (session) session.partIndex.set(boundaryKey, { cardID, index: rebuilt.length })
      rebuilt.push(boundary)
    }
    for (const part of parts) {
      indexPhasePart(part, cardID, rebuilt.length)
      rebuilt.push(part)
    }
  }
  for (const part of pendingPartFirst) {
    if (part?.type === "boundary") indexPhaseBoundary(part, cardID, rebuilt.length)
    else indexPhasePart(part, cardID, rebuilt.length)
    rebuilt.push(part)
  }

  setCardTreeStore("cards", cardID, "parts", rebuilt)
  markCardStatsDirty(cardID)
}

/** Rebuild non-phase message-turn card ownership from the authoritative
 *  message timeline. Live `message.*` events are ephemeral and can arrive
 *  out of chronological order. Runtime sessions keep their own current
 *  semantic run: a user/assistant stage switch inside the same shared
 *  session opens a new card, while a different child session streaming in
 *  between does not split the parent session's complete card. */
function regroupTimelineSegments(opts: { deferHierarchy?: boolean } = {}): void {
  const ordered = [...messages.values()].filter((message) => sessions.has(message.sessionID)).sort(messageTimeOrder)
  if (ordered.length === 0) return

  const segments: TimelineSegment[] = []
  const desiredCardByMessage = new Map<string, string>()
  const targetMessageIDs = new Set<string>()
  const currentSegmentBySession = new Map<string, TimelineSegment>()

  for (const message of ordered) {
    const session = sessions.get(message.sessionID)
    if (!session) continue
    const stage = message.stage || session.stage
    const goalID = message.goalID || session.goalID
    if (isPhaseAbsorbedSession(stage, goalID)) {
      continue
    }

    const currentSegment = currentSegmentBySession.get(message.sessionID)
    let segment = currentSegment?.stage === stage && currentSegment.goalID === goalID ? currentSegment : undefined
    if (!segment) {
      const cardID = timelineCardID(stage, message.sessionID, message.id)
      segment = { cardID, session, stage, goalID, messages: [] }
      segments.push(segment)
    }
    currentSegmentBySession.set(message.sessionID, segment)
    segment.messages.push(message)
    desiredCardByMessage.set(message.id, segment.cardID)
    targetMessageIDs.add(message.id)
  }
  if (segments.length === 0) return

  const oldOwnedCardIDs = new Set<string>()
  const pendingPartFirstCardIDs = new Set<string>()
  for (const session of sessions.values()) {
    for (const [messageID, cardID] of session.messageCardIDs) {
      if (nonPhaseMessageTurnCardID(cardID)) oldOwnedCardIDs.add(cardID)
      if (!messages.has(messageID) && nonPhaseMessageTurnCardID(cardID) && cardTreeStore.cards[cardID]) {
        pendingPartFirstCardIDs.add(cardID)
      }
    }
  }

  const partsByMessage = collectTimelineParts(targetMessageIDs)
  clearTimelinePartIndexes(targetMessageIDs)

  const activeBySession = new Map<string, { messageID: string; cardID: string; time: number }>()
  for (const message of ordered) {
    const cardID = desiredCardByMessage.get(message.id)
    if (!cardID) continue
    const current = activeBySession.get(message.sessionID)
    if (!current || message.time >= current.time) {
      activeBySession.set(message.sessionID, { messageID: message.id, cardID, time: message.time })
    }
  }

  for (const [messageID, cardID] of desiredCardByMessage) {
    const message = messages.get(messageID)
    const session = message ? sessions.get(message.sessionID) : undefined
    if (session) session.messageCardIDs.set(messageID, cardID)
  }

  for (const segment of segments) {
    const first = segment.messages[0]
    if (!first) continue
    const existing = cardTreeStore.cards[segment.cardID]
    const active = activeBySession.get(first.sessionID)?.cardID === segment.cardID
    const status = (() => {
      if (active) {
        if (existing?.status === "error") return "error"
        if (existing?.terminalReason) return existing.status ?? "completed"
        return "running"
      }
      return existing?.status === "error" ? "error" : "completed"
    })()
    const base =
      existing ??
      createSessionCardNode(segment.cardID, segment.stage, segment.goalID, first.time, first.sessionID, first.id)
    setCardTreeStore("cards", segment.cardID, {
      ...base,
      sessionID: first.sessionID,
      messageID: first.id,
      stage: segment.stage,
      accent: !isUserStage(segment.stage) && segment.stage ? stageAccent(segment.stage) : undefined,
      title: roleTitleKey(segment.stage),
      time: first.time,
      status,
      parts: [],
    })

    const rebuiltParts: any[] = existing?.parts?.filter(isReviewStreamPart) ?? []
    for (const [index, message] of segment.messages.entries()) {
      if (index > 0 && !isUserStage(segment.stage)) {
        const boundaryKey = `__boundary__:${segment.session.sessionID}:${message.id}`
        const boundary = {
          type: "boundary",
          messageID: message.id,
          role: message.resolvedRole,
          roleLabel: roleLabel(message.resolvedRole),
          time: message.time > 0 ? message.time : undefined,
        }
        segment.session.partIndex.set(boundaryKey, {
          cardID: segment.cardID,
          index: rebuiltParts.length,
        })
        rebuiltParts.push(boundary)
      }
      for (const part of partsByMessage.get(message.id) || []) {
        const partID = String(part.id || "")
        if (partID) {
          segment.session.partIndex.set(partID, {
            cardID: segment.cardID,
            index: rebuiltParts.length,
          })
        }
        rebuiltParts.push(part)
      }
    }
    setCardTreeStore("cards", segment.cardID, "parts", rebuiltParts)
    markCardStatsDirty(segment.cardID)
  }

  const targetCardIDs = new Set(segments.map((segment) => segment.cardID))
  for (const cardID of oldOwnedCardIDs) {
    if (targetCardIDs.has(cardID) || pendingPartFirstCardIDs.has(cardID)) continue
    clearMessageCardOwnershipForCard(cardID)
    removeCardReferences(cardID)
  }

  for (const [sessionID, active] of activeBySession) {
    const session = sessions.get(sessionID)
    if (!session) continue
    session.activeMessageID = active.messageID
    session.activeCardID = active.cardID
  }

  if (!opts.deferHierarchy) rebuildCardHierarchy()
}

/** Replay a persisted task into the exact same visible card identity the
 *  live SSE stream would have built. Single render identity = semantic run:
 *  the first visible message in a runtime session's current stage/goal run
 *  seeds the durable card id, then later messages from that run fold into the
 *  same card in chronological order.
 *  `view.sessions` is metadata only (parentSessionID / goalID
 *  fallback) and MUST NOT regroup multiple messages into one session card
 *  (spec §6 — the highest replay-collapse risk). */
export function hydrateConversationView(view: any, transcript: any[]): void {
  const all = Array.isArray(transcript) ? transcript : []
  if (all.length === 0) return
  // Hydration runs immediately after setBoardData(); do not rely on the
  // detached boardStore effect having re-projected phase cards yet.
  rebuildBoardDerivedCards()
  const sessionMeta = new Map<string, any>()
  for (const s of Array.isArray(view?.sessions) ? view.sessions : []) {
    const sid = String(s?.sessionID || "")
    if (sid) sessionMeta.set(sid, s)
  }
  const ordered = all
    .slice()
    .sort((left, right) => Number(left?.info?.time?.created || 0) - Number(right?.info?.time?.created || 0))
  const touched = new Set<string>()
  for (const message of ordered) {
    const info = message?.info
    if (!info || typeof info !== "object") {
      throw new Error("hydrateConversationView: transcript message missing info")
    }
    const messageID = String(info.id || "")
    const sessionID = String(info.sessionID || "")
    if (!messageID || !sessionID) {
      throw new Error("hydrateConversationView: transcript message missing id/sessionID")
    }
    // No assistant-fallback (一个萝卜一个坑) — replay must reflect the same
    // role attribution the live event stream carries.
    const rawRole = info.role
    if (typeof rawRole !== "string" || rawRole.length === 0) {
      throw new Error(`hydrateConversationView: message ${messageID} missing info.role`)
    }
    const role = rawRole
    const rawResolvedRole = info.resolvedRole || info.agent || role
    if (typeof rawResolvedRole !== "string" || rawResolvedRole.length === 0) {
      throw new Error(`hydrateConversationView: message ${messageID} missing resolvedRole/agent`)
    }
    const meta = sessionMeta.get(sessionID)
    const parentSessionID = String(info.parentSessionID || meta?.parentSessionID || "")
    const goalID = String(info.goalID || meta?.goalID || "")
    const timeCreated = Number(info?.time?.created || 0)
    if (!(timeCreated > 0)) {
      throw new Error(`hydrateConversationView: message ${messageID} missing info.time.created`)
    }
    const completed = Number.isFinite(info?.time?.completed) && Number(info.time.completed) > 0
    const stage = deriveSessionStage(info)
    if (stage === "filtered") continue
    if (!transcriptMessageHasDisplay(message)) continue
    const displayRole = displayRoleForResolvedRole(rawResolvedRole)
    messages.set(messageID, {
      id: messageID,
      sessionID,
      stage,
      role,
      resolvedRole: displayRole,
      agent: String(info.agent || ""),
      parentSessionID,
      goalID,
      time: timeCreated,
      completed,
    })
    const session = ensureSessionProjection(sessionID, { stage, parentSessionID, goalID })
    session.messageIDs.add(messageID)
    const { cardID, isPhase } = ensureMessageTurnProjection(session, messageID, {
      stage,
      goalID,
      role: displayRole,
      time: timeCreated,
      stampServerTime: true,
      deferHierarchy: true,
    })
    if (isPhase) {
      ensureBoundaryPart(session, cardID, messageID, displayRole, timeCreated)
    }
    const parts = Array.isArray(message?.parts) ? message.parts : []
    for (const part of parts) {
      const partID = String(part?.id || "")
      if (!partID) {
        throw new Error(`hydrateConversationView: message ${messageID} contains part without id`)
      }
      upsertPart(session, messageID, cardID, partID, {
        ...part,
        messageID,
        sessionID,
      })
    }
    if (isPhase) reorderPhaseCardParts(cardID)
    touched.add(sessionID)
  }
  regroupTimelineSegments({ deferHierarchy: true })
  for (const message of ordered) {
    const info = message?.info
    const messageID = String(info?.id || "")
    const sessionID = String(info?.sessionID || "")
    const session = sessions.get(sessionID)
    const cardID = session?.messageCardIDs.get(messageID)
    const usageProjection = usageProjectionFromInfo(info)
    if (session && cardID && usageProjection) {
      projectUsageOntoCard(session, messageID, cardID, usageProjection)
    }
    if (session && cardID && messageInfoIsAssistant(info)) {
      projectModelOntoCard(session, messageID, cardID, modelProjectionFromInfo(info))
    }
  }
  rebuildCardHierarchy()
  for (const sessionID of touched) {
    drainPendingIntegrity(sessionID)
    drainPendingSessionStatus(sessionID)
  }
  flushCardStats()
  markCardTreeVisibleChanged()
}

/** Per-message boundary part — only used by phase-absorbed cards, which
 *  fold multiple sub-sessions / turns into one phase card and still need a
 *  visible per-turn separator. Top-level message-turn cards do NOT get a
 *  boundary: the card itself is the boundary (spec §3.1). */
function ensureBoundaryPart(session: SessionInfo, cardID: string, messageID: string, role: string, time: number): void {
  if (isUserStage(session.stage || role)) return
  const boundaryKey = `__boundary__:${session.sessionID}:${messageID}`
  if (session.partIndex.has(boundaryKey)) return
  const part: any = {
    type: "boundary",
    messageID,
    role,
    roleLabel: roleLabel(role),
    time: time > 0 ? time : undefined,
  }
  const newIdx = appendSessionPart(cardID, part)
  session.partIndex.set(boundaryKey, { cardID, index: newIdx })
}

function upsertPart(session: SessionInfo, _messageID: string, cardID: string, partID: string, part: any): void {
  const existing = session.partIndex.get(partID)
  const sameCard = existing !== undefined && existing.cardID === cardID
  const previousPart = sameCard ? cardTreeStore.cards[cardID]?.parts?.[existing!.index] : undefined
  const normalizedPart = normalizeToolPartRecord(part, previousPart)
  if (sameCard) {
    setCardTreeStore("cards", cardID, "parts", existing!.index, normalizedPart)
    markCardStatsDirty(cardID)
    return
  }
  const newIdx = appendSessionPart(cardID, normalizedPart)
  session.partIndex.set(partID, { cardID, index: newIdx })
}

function appendSessionPart(cardID: string, part: any): number {
  const current = cardTreeStore.cards[cardID]?.parts
  if (!Array.isArray(current)) {
    throw new Error(`appendSessionPart: card ${cardID} missing parts array`)
  }
  const next = [...current, part]
  setCardTreeStore("cards", cardID, "parts", next)
  markCardStatsDirty(cardID)
  return next.length - 1
}

// ── Board-derived projections (task request, goal groups, interactions) ──

function rebuildBoardDerivedCards(): void {
  // batch coalesces every setCardTreeStore inside the three rebuilders into a
  // single reactivity round. Without it, downstream memos (e.g. Card.tsx's
  // visibleChildIDsForCard) re-evaluate between sub-rebuild writes and observe
  // intermediate states like "step card holds a phase childID before the phase
  // card itself was created" — which throws "card-tree: card X references
  // missing child Y" and surfaces in console as `loadBoard failed`.
  batch(() => {
    const board = boardStore.board
    // Task request bubble (ctx:user-request).
    rebuildTaskContextCard(board)
    // Per-goal executor step cards (top-level) + their phase children.
    rebuildGoalStepCards(board)
    // Session-to-goal claiming.
    rebuildCardHierarchy()
    // Drain the stats dirty queue inside the same batch as the structural
    // rewrites so collapsed bubble caches reflect the new hierarchy before
    // any subscriber observes the visible-version bump.
    flushCardStats()
    markCardTreeVisibleChanged()
  })
}

function rebuildTaskContextCard(board: any): void {
  const task = board?.task
  if (!task?.request) {
    // No request → remove the card if present.
    if (cardTreeStore.cards["ctx:user-request"]) {
      setCardTreeStore(
        "cards",
        produce((c: Record<string, CardNode>) => {
          delete c["ctx:user-request"]
        }),
      )
    }
    return
  }
  const taskCreated = Number(task?.time?.created || 0)
  if (!(taskCreated > 0)) {
    throw new Error(
      `task.time.created must be positive (got ${task?.time?.created}); server emitter is the single source of truth`,
    )
  }
  const parts: any[] = [{ id: "ctx:user-request:text", type: "text", text: String(task.request) }]
  const attachments = Array.isArray(task.attachments) ? task.attachments : []
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i]
    const keySuffix = typeof a?.url === "string" && a.url ? a.url : `idx:${i}`
    parts.push({
      id: `ctx:user-request:file:${keySuffix}`,
      type: "file",
      url: a?.url,
      mime: a?.mime,
      filename: a?.filename,
    })
  }
  setCardTreeStore("cards", "ctx:user-request", {
    id: "ctx:user-request",
    kind: "message",
    role: "user",
    title: t("chat.role.user"),
    parts,
    childIDs: [],
    time: taskCreated - 2,
  })
  markCardStatsDirty("ctx:user-request")
}

/** Look up the workflow-level step definition (the `steps[]` array on
 *  `board.workflow`) so we can read the ORDERED phase list + phase labels
 *  declared at the workflow layer. The per-goal step payload carries
 *  phase *status* as an unordered record; only the workflow payload has
 *  the canonical order and sessionKind mapping. */
function findWorkflowStepDefinition(
  board: any,
  stepID: string,
): { id: string; phases?: Array<{ id: string; label: string; sessionKind: string }> } | null {
  const steps = Array.isArray(board?.workflow?.steps) ? board.workflow.steps : []
  for (const s of steps) {
    if (String(s?.id) === stepID) return s
  }
  return null
}

function rebuildGoalStepCards(board: any): void {
  const goalWorkflows: any[] = Array.isArray(board?.goalWorkflows) ? board.goalWorkflows : []

  // Refresh the per-goal "current attempt" map so session routing reads
  // the authoritative goalRunID. A goal whose tip has no id yet (pre-
  // dispatch) is left un-mapped → `"pre"` sentinel is used by the id
  // helpers, and the card flips to the real run id on the next rebuild
  // after dispatch.
  goalCurrentRunID.clear()
  for (const gw of goalWorkflows) {
    const gid = String(gw?.goalID || "")
    if (!gid) continue
    const rid = typeof gw?.goalRunID === "string" && gw.goalRunID.length > 0 ? gw.goalRunID : undefined
    if (rid) goalCurrentRunID.set(gid, rid)
  }

  // GC policy (per-attempt isolation):
  //   Historical attempt cards (same goalID, older goalRunID) MUST survive
  //   across rebuilds — they are the frozen record of prior tries. The
  //   only step cards we drop are those whose owning GOAL no longer
  //   exists on the board (goal deleted by modify_goal / plan revision).
  //   The prior policy ("drop any step card not in the current-tip alive
  //   set") collapsed every retry onto the same card id and is what the
  //   per-attempt isolation work is designed to remove.
  const liveGoalIDs = new Set<string>()
  for (const gw of goalWorkflows) {
    const gid = String(gw?.goalID || "")
    if (gid) liveGoalIDs.add(gid)
  }
  setCardTreeStore(
    "cards",
    produce((c: Record<string, CardNode>) => {
      for (const id of Object.keys(c)) {
        if (!id.startsWith("step:")) continue
        const owningGoal = goalIDFromStepCardID(id)
        if (!owningGoal) {
          delete c[id]
          continue
        }
        if (!liveGoalIDs.has(owningGoal)) delete c[id]
      }
    }),
  )

  for (let i = 0; i < goalWorkflows.length; i++) {
    const gw = goalWorkflows[i]
    const gid = String(gw.goalID)
    const gRunID: string | undefined =
      typeof gw.goalRunID === "string" && gw.goalRunID.length > 0 ? gw.goalRunID : undefined
    const steps = Array.isArray(gw.steps) ? gw.steps : []
    // Decomposition sequence: prefer the backend-authoritative orderIndex
    // (stable across later goal removals); fall back to the array position
    // only when the payload predates the orderIndex field.
    const orderIndex: number = typeof gw.orderIndex === "number" ? gw.orderIndex : i
    for (const step of steps) {
      const stepID = String(step.stepID)
      const stepStartedAt = Number(step.startedAt || 0)
      // Lazy materialization: a step card is born when the executor
      // actually picks it up (goal_run.time_started is written). Before
      // that, rendering it would advertise work that hasn't started.
      if (!(stepStartedAt > 0)) continue
      const stepCardID = goalStepCardID(gid, gRunID, stepID)
      const stepStatus = normalizeStepStatus(step.status)
      const phaseEntries =
        step.phases && typeof step.phases === "object" && !Array.isArray(step.phases)
          ? (step.phases as Record<string, { status?: string; startedAt?: number; completedAt?: number }>)
          : null

      // Create phase subcards. Phase cards ABSORB their claimed session's
      // parts: once `ensureSessionCard` routes a goal-scope phase-mapped
      // session to a phase card, subsequent `message.part.*` events
      // accumulate `parts` on THIS card. Rebuilds therefore must NOT
      // clobber parts — only overlay the metadata from the board
      // (status/title/phaseID/sessionKind).
      const phaseChildIDs: string[] = []
      const writePhaseCard = (
        phaseCardID: string,
        pid: string,
        label: string,
        sessionKind: string,
        status: CardStatus,
        startedAt: number,
        phaseSessionID?: string,
      ) => {
        setCardTreeStore(
          "cards",
          produce((cards: Record<string, CardNode>) => {
            const prev = cards[phaseCardID]
            if (prev) {
              prev.stage = sessionKind || pid
              prev.accent = stageAccent(sessionKind || pid)
              prev.status = status
              prev.title = label
              prev.phaseID = pid
              prev.phaseSessionKind = sessionKind
              if (phaseSessionID) prev.phaseSessionID = phaseSessionID
              // startedAt > 0 is invariant (caller filters pending phases).
              prev.time = startedAt
              // parts / childIDs intentionally preserved.
            } else {
              cards[phaseCardID] = {
                id: phaseCardID,
                kind: "phase",
                stage: sessionKind || pid,
                accent: stageAccent(sessionKind || pid),
                status,
                title: label,
                parts: [],
                childIDs: [],
                phaseID: pid,
                phaseSessionKind: sessionKind,
                ...(phaseSessionID ? { phaseSessionID } : {}),
                time: startedAt,
              }
            }
          }),
        )
      }

      if (phaseEntries) {
        // Look up the workflow-level step definition to get phase id ORDER
        // and labels (the per-goal payload is a record, not ordered).
        const workflowStep = findWorkflowStepDefinition(board, stepID)
        const phaseDefs: Array<{ id: string; label: string; sessionKind: string }> =
          workflowStep && Array.isArray(workflowStep.phases) ? workflowStep.phases : []
        for (const pdef of phaseDefs) {
          const pid = String(pdef.id)
          const entry = phaseEntries[pid]
          const phaseStartedAt = Number(entry?.startedAt || 0)
          // Lazy materialization: a phase surfaces only once the backend
          // records its goal_run.time_started. Pending phases have no
          // birth time and must not preview in the timeline.
          if (!(phaseStartedAt > 0)) continue
          const phaseCardID = goalPhaseCardID(gid, gRunID, stepID, pid)
          const phaseStatus = normalizeStepStatus(entry?.status)
          writePhaseCard(
            phaseCardID,
            pid,
            String(pdef.label || pid),
            String(pdef.sessionKind || ""),
            phaseStatus,
            phaseStartedAt,
            pid === "build" ? String(step?.payload?.buildSessionID || "") || undefined : undefined,
          )
          phaseChildIDs.push(phaseCardID)
        }
      }

      // The executor step card IS the goal card — there is exactly one
      // goal-scope step per goal (workflow.ts: `build` with scope="goal"),
      // so we stamp every goal field onto the step card. The header keeps
      // only the goal title plus the shared #G/V revision label; file-level
      // details live in the dedicated Changes panel instead of duplicating
      // them inside the conversation card.
      setCardTreeStore("cards", stepCardID, {
        id: stepCardID,
        kind: "step",
        stage: stepID,
        accent: stageAccent(stepID),
        status: stepStatus,
        title: String(gw.goalTitle || step.label || agentStageLabel(stepID) || stepID),
        subtitle: undefined,
        round: orderIndex + 1,
        attempt: typeof gw.retryCount === "number" ? gw.retryCount + 1 : 1,
        parts: [],
        childIDs: phaseChildIDs,
        stepPayload: step.payload && typeof step.payload === "object" ? step.payload : undefined,
        stepID,
        goalID: gid,
        goalDescription: gw.goalObjective || undefined,
        time: stepStartedAt,
      })
    }
  }
}

function interactionCardTime(cardID: string): number {
  return Number(cardTreeStore.cards[cardID]?.time || 0)
}

function upsertInteractionCard(seed: {
  info: { id: string; role: string; time: { created: number } }
  parts: any[]
}): string {
  const seedID = String(seed?.info?.id || "")
  if (!seedID) throw new Error("interaction card seed missing info.id")
  const cardID = interactionCardID(seedID)
  const role = String(seed?.info?.role || "system")
  const time = Number(seed?.info?.time?.created || 0)
  if (!(time > 0)) {
    throw new Error(
      `interaction card seed ${seedID} missing info.time.created; server emitter is the single source of truth`,
    )
  }
  const parts = Array.isArray(seed?.parts) ? seed.parts.slice() : []
  setCardTreeStore("cards", cardID, {
    id: cardID,
    kind: "message",
    role,
    title: roleTitleKey(role),
    parts,
    childIDs: [],
    time,
  })
  markCardStatsDirty(cardID)
  return cardID
}

function sessionTurnCardAtOrBefore(session: SessionInfo | undefined, time: number): string | undefined {
  if (!session) return undefined
  let selectedCardID = ""
  let selectedTime = 0
  for (const cardID of new Set(session.messageCardIDs.values())) {
    const card = cardTreeStore.cards[cardID]
    const cardTime = Number(card?.time || 0)
    if (!(cardTime > 0) || cardTime > time) continue
    if (!selectedCardID || cardTime >= selectedTime) {
      selectedCardID = cardID
      selectedTime = cardTime
    }
  }
  return selectedCardID || undefined
}

function rebuildInteractionCards(board: any): {
  bySessionCardID: Map<string, string[]>
  topLevel: string[]
} {
  const knownSessionIDs = new Set<string>(sessions.keys())
  const boardInteractions = Array.isArray(board?.interactions) ? board.interactions : []
  const interactions = [...boardInteractions, ...standaloneQuestionInteractions.values()]
  const { bySession, orphan } = partitionInteractions(interactions, knownSessionIDs)
  const aliveCardIDs = new Set<string>()
  const bySessionCardID = new Map<string, string[]>()
  const topLevel: string[] = []

  const addMessages = (items: any[], sessionID?: string) => {
    const ordered = (Array.isArray(items) ? items : [])
      .flatMap((interaction) => interactionToCardSeeds(interaction))
      .sort((left, right) => Number(left?.info?.time?.created || 0) - Number(right?.info?.time?.created || 0))
    for (const seed of ordered) {
      const cardID = upsertInteractionCard(seed)
      aliveCardIDs.add(cardID)
      if (sessionID) {
        const session = sessions.get(sessionID)
        const interactionTime = Number(seed?.info?.time?.created || 0)
        // Attach to the latest turn that existed at the interaction time.
        // Rebuilds can run after newer turns appear; using activeCardID here
        // would make old prompts drift onto the newest card.
        const ownerCardID = sessionTurnCardAtOrBefore(session, interactionTime)
        if (!ownerCardID) {
          topLevel.push(cardID)
          continue
        }
        const bucket = bySessionCardID.get(ownerCardID)
        if (bucket) bucket.push(cardID)
        else bySessionCardID.set(ownerCardID, [cardID])
      } else {
        topLevel.push(cardID)
      }
    }
  }

  for (const [sessionID, claimed] of bySession.entries()) {
    addMessages(claimed, sessionID)
  }
  addMessages(orphan)

  setCardTreeStore(
    "cards",
    produce((cards: Record<string, CardNode>) => {
      for (const cardID of Object.keys(cards)) {
        if (!cardID.startsWith("interaction-card:")) continue
        if (!aliveCardIDs.has(cardID)) delete cards[cardID]
      }
    }),
  )

  topLevel.sort((a, b) => interactionCardTime(a) - interactionCardTime(b))
  for (const ids of bySessionCardID.values()) {
    ids.sort((a, b) => interactionCardTime(a) - interactionCardTime(b))
  }
  return { bySessionCardID, topLevel }
}

function sessionSortTime(cardID: string | undefined): number {
  if (!cardID) return 0
  const time = Number(cardTreeStore.cards[cardID]?.time || 0)
  return Number.isFinite(time) ? time : 0
}

/** Display cards this session owns for hierarchy / visibility. Phase-
 *  absorbed sessions own NONE here — their parts live on the phase card,
 *  which is managed as a step child by rebuildGoalStepCards. Integrity
 *  has no messageCardIDs but pins activeCardID to its dedicated card. */
function sessionOwnedCardIDs(info: SessionInfo): string[] {
  if (isPhaseAbsorbedSession(info.stage, info.goalID)) return []
  const ids = new Set<string>()
  for (const cid of info.messageCardIDs.values()) ids.add(cid)
  if (info.activeCardID) ids.add(info.activeCardID)
  return [...ids]
}

function pushUniqueChild(target: string[], childID: string): void {
  if (!childID || target.includes(childID)) return
  target.push(childID)
}

function cardHasDisplayPart(card: CardNode | undefined): boolean {
  if (!card) return false
  for (const part of card.parts || []) {
    if (!part || part.type === "boundary") continue
    if (part.type === "text" || part.type === "reasoning") {
      if (String(part.text || "").replace(/[\[\]\s]/g, "")) return true
      continue
    }
    return true
  }
  return false
}

function shouldHideSessionCard(card: CardNode | undefined): boolean {
  return Boolean(card?.messageID && !cardHasDisplayPart(card))
}

function syncSessionTopLevelVisibility(session: SessionInfo | undefined): void {
  if (!session) return
  let visible = false
  for (const cid of sessionOwnedCardIDs(session)) {
    const card = cardTreeStore.cards[cid]
    if (card && !shouldHideSessionCard(card)) {
      visible = true
      break
    }
  }
  if (session.topLevelVisible === visible) return
  session.topLevelVisible = visible
  rebuildTopLevelOrder()
}

function rebuildCardHierarchy(): void {
  // batch ensures that the interaction-card GC inside rebuildInteractionCards
  // and the final childIDs write at the bottom of this function are visible
  // atomically to downstream reactions. Otherwise a parent card can be
  // observed holding a `childIDs` entry whose corresponding child was just
  // deleted by the GC, causing visibleChildIDsForCard to throw
  // "references missing child …".
  batch(() => rebuildCardHierarchyImpl())
}

function rebuildCardHierarchyImpl(): void {
  const nextChildIDs = new Map<string, string[]>()
  const goalWorkflows: any[] = Array.isArray(boardStore.board?.goalWorkflows) ? boardStore.board.goalWorkflows : []
  const interactions = rebuildInteractionCards(boardStore.board)

  for (const gw of goalWorkflows) {
    const gid = String(gw?.goalID || "")
    if (!gid) continue
    const gRunID: string | undefined =
      typeof gw?.goalRunID === "string" && gw.goalRunID.length > 0 ? gw.goalRunID : undefined
    const steps = Array.isArray(gw?.steps) ? gw.steps : []
    for (const step of steps) {
      const stepID = String(step?.stepID || "")
      if (!stepID) continue
      const stepCard = goalStepCardID(gid, gRunID, stepID)
      if (!cardTreeStore.cards[stepCard]) continue

      // Step's children = phase cards (in declared order) when the step
      // has phases; otherwise empty. Session claims append under phase
      // cards, NOT step cards — the 3-level hierarchy is step (top-level,
      // per-goal executor) → phase → session.
      const workflowStep = findWorkflowStepDefinition(boardStore.board, stepID)
      const phaseDefs: Array<{ id?: string }> =
        workflowStep && Array.isArray(workflowStep.phases) ? workflowStep.phases : []
      const stepChildren: string[] = []
      for (const pdef of phaseDefs) {
        const pid = String(pdef?.id || "")
        if (!pid) continue
        const phaseCard = goalPhaseCardID(gid, gRunID, stepID, pid)
        if (!cardTreeStore.cards[phaseCard]) continue
        pushUniqueChild(stepChildren, phaseCard)
        nextChildIDs.set(phaseCard, [])
      }
      nextChildIDs.set(stepCard, stepChildren)
    }
  }

  // Non-phase message-turn cards are all top-level by design — they sort
  // chronologically by `time` in rebuildTopLevelOrder, so an orchestrator
  // turn that ran after a child agent naturally falls AFTER that child's
  // card. No parent claim, no "move parent after child" logic (spec §4).
  // Phase-absorbed sessions own no separate cards (parts live on the phase
  // card, claimed as a step child above).
  const orderedSessions = [...sessions.values()].sort(
    (a, b) => sessionSortTime(a.activeCardID) - sessionSortTime(b.activeCardID),
  )
  for (const info of orderedSessions) {
    for (const cid of sessionOwnedCardIDs(info)) {
      if (cardTreeStore.cards[cid]) nextChildIDs.set(cid, nextChildIDs.get(cid) || [])
    }
  }
  for (const [sessionCardID, childIDs] of interactions.bySessionCardID.entries()) {
    const bucket = nextChildIDs.get(sessionCardID) || []
    for (const childID of childIDs) {
      pushUniqueChild(bucket, childID)
      nextChildIDs.set(childID, nextChildIDs.get(childID) || [])
    }
    nextChildIDs.set(sessionCardID, bucket)
  }
  for (const childID of interactions.topLevel) {
    nextChildIDs.set(childID, nextChildIDs.get(childID) || [])
  }

  // Integrity team sessions form a supervisor -> reviewer tree. The
  // reviewer streams still need independent cards so their reasoning parts
  // cannot collide, but those cards belong under the supervisor integrity
  // card instead of surfacing as top-level siblings.
  for (const info of orderedSessions) {
    if (info.stage !== "integrity" || !info.parentSessionID) continue
    const parent = sessions.get(info.parentSessionID)
    if (!parent || parent.stage !== "integrity") continue
    const parentCardID = parent.activeCardID
    if (!parentCardID || !cardTreeStore.cards[parentCardID]) continue
    const bucket = nextChildIDs.get(parentCardID) || []
    for (const childID of sessionOwnedCardIDs(info)) {
      if (childID === parentCardID || !cardTreeStore.cards[childID]) continue
      pushUniqueChild(bucket, childID)
      nextChildIDs.set(childID, nextChildIDs.get(childID) || [])
    }
    nextChildIDs.set(parentCardID, bucket)
  }

  // Integrity verdict cards attach under their owning requirements session.
  // If the session hasn't arrived yet (unordered replay, or CLI dry-run with
  // no session), the card stays pending — it will NOT fall through to the
  // top level (card escape is forbidden).
  for (const [cardID, ownerSessionID] of integrityCardOwners.entries()) {
    if (!cardTreeStore.cards[cardID]) continue
    const owner = sessions.get(ownerSessionID)
    const ownerCardID = owner?.activeCardID
    if (!ownerCardID || !cardTreeStore.cards[ownerCardID]) continue
    const bucket = nextChildIDs.get(ownerCardID) || []
    pushUniqueChild(bucket, cardID)
    nextChildIDs.set(ownerCardID, bucket)
    nextChildIDs.set(cardID, nextChildIDs.get(cardID) || [])
  }

  // Snapshot every affected parent's childIDs BEFORE the produce so we can
  // diff: which children got newly attached (need parentID link + dirty
  // parent), which got detached from a parent without landing in any other
  // (need parentID unlink), and which parents lost or gained any child
  // (need their cached aggregates recomputed). Without this snapshot, an
  // old parent whose child moves to a different step's phase card keeps the
  // stale child's contributions baked into its cached counts forever.
  const affectedParents = new Set<string>()
  for (const info of sessions.values()) {
    for (const cid of sessionOwnedCardIDs(info)) affectedParents.add(cid)
  }
  for (const parentID of nextChildIDs.keys()) affectedParents.add(parentID)

  const childIDsBefore = new Map<string, string[]>()
  for (const parentID of affectedParents) {
    const existing = cardTreeStore.cards[parentID]?.childIDs
    childIDsBefore.set(parentID, Array.isArray(existing) ? [...existing] : [])
  }

  setCardTreeStore(
    "cards",
    produce((cards: Record<string, CardNode>) => {
      // Reset every session-owned turn card's childIDs from nextChildIDs so
      // a removed interaction child is cleared, not left dangling.
      for (const info of sessions.values()) {
        for (const cid of sessionOwnedCardIDs(info)) {
          if (cards[cid]) cards[cid].childIDs = nextChildIDs.get(cid) || []
        }
      }
      for (const [cardID, childIDs] of nextChildIDs.entries()) {
        if (cards[cardID]) cards[cardID].childIDs = childIDs
      }
    }),
  )

  // Build the parent-after map across every affected parent so we can tell
  // whether a child that disappeared from one parent's childIDs landed in
  // ANOTHER parent's (move — handled by linkChildToParent below) or in
  // none (orphan — needs unlinkChildFromParent so the bubble-up walk does
  // not keep climbing through a parent that no longer reaches it).
  const parentAfterByChild = new Map<string, string>()
  for (const parentID of affectedParents) {
    const after = cardTreeStore.cards[parentID]?.childIDs ?? []
    for (const childID of after) parentAfterByChild.set(childID, parentID)
  }

  for (const parentID of affectedParents) {
    const before = childIDsBefore.get(parentID) ?? []
    for (const childID of before) {
      // Detached from this parent. If another affected parent claimed it,
      // the link below repoints the back-pointer; otherwise it is an orphan
      // and we explicitly clear parentID so bubble-up stops here.
      if (!parentAfterByChild.has(childID)) unlinkChildFromParent(childID)
    }
    markCardStatsDirty(parentID)
  }
  // Link every (new) parent→child edge. Idempotent when the link already
  // matched the prior parent; overwrites stale links from a previous attempt.
  for (const [childID, parentID] of parentAfterByChild.entries()) {
    linkChildToParent(parentID, childID)
  }

  rebuildTopLevelOrder()
}

function normalizeStepStatus(raw: any): CardStatus {
  const s = String(raw || "")
    .trim()
    .toLowerCase()
  if (s === "pending" || s === "running" || s === "completed" || s === "error" || s === "skipped") {
    return s as CardStatus
  }
  if (s === "failed" || s === "fail") return "error"
  if (s === "passed" || s === "done" || s === "ok") return "completed"
  return "pending"
}

// ── Top-level ordering ──
//
// One rule: every top-level card sorts by its birth `time`. No grouping,
// no per-kind priority lanes. User-request, session cards (orchestrator,
// requirements, architect, planner, build, ...), goal-step cards, orphan
// interactions (question / permission), and optimistic bubbles
// all interleave on a single chronological axis. Card identity rules
// (see specs/new-arch/07-panel-reactivity.md §身份规则) still decide
// *whether* a card surfaces at the top level — not where.
//
// Invariants this function relies on, enforced by the writer elsewhere:
//   • Every surfacing card carries `time` — session cards from
//     `message.info.time.created`, step/phase from goal_run.time_started,
//     interactions from their message time, optimistic from the local
//     message's time, user-request from `task.time.created - 2` (the -2ms
//     is what pins it ahead of any message that shares the exact task
//     timestamp; no special-case needed here).
//   • Phase and integrity cards are always claimed as childIDs of their
//     parent (step / requirements session) before this runs, so they drop
//     out via the `claimedChildIDs` filter instead of needing kind logic.
//   • Empty `stage === "executor"` sessions are the goal's executor container
//     (parentID anchor only); the step card is their visual proxy. If an
//     executor turn card does receive visible parts, surface it rather
//     than hiding real reasoning/text/tool output.
//   • Phase-absorbed sessions (build/planner under a goal) own no top-level
//     turn card — their parts live on the phase card (a step child), so
//     `sessionOwnedCardIDs` returns nothing for them here.

function rebuildTopLevelOrder(): void {
  const claimedChildIDs = new Set<string>()
  for (const node of Object.values(cardTreeStore.cards)) {
    for (const childID of node.childIDs || []) claimedChildIDs.add(childID)
  }

  // Hide message-backed agent turn cards until they have displayable content.
  // `message.updated` may arrive before the first visible part; it may create
  // the stable card id for later part routing, but that routing shell is not
  // a conversation item yet.
  const hiddenSessionCardIDs = new Set<string>()
  for (const info of sessions.values()) {
    for (const cid of sessionOwnedCardIDs(info)) {
      if (shouldHideSessionCard(cardTreeStore.cards[cid])) hiddenSessionCardIDs.add(cid)
    }
  }

  const order: string[] = []
  for (const cardID of Object.keys(cardTreeStore.cards)) {
    if (claimedChildIDs.has(cardID)) continue
    if (hiddenSessionCardIDs.has(cardID)) continue
    const card = cardTreeStore.cards[cardID]
    if (!card) continue
    // Phase / integrity / tool cards must never appear at top level. They
    // belong under their container; reaching here unclaimed means the
    // hierarchy is mid-rebuild, so we drop them rather than let them
    // "escape" (身份规则 §card-escape).
    if (card.kind === "phase" || card.kind === "integrity" || card.kind === "tool") continue
    order.push(cardID)
  }

  order.sort((a, b) => {
    const ca = cardTreeStore.cards[a]
    const cb = cardTreeStore.cards[b]
    // Contract: every top-level card carries a numeric `time` (see
    // CardNode.time in store/card-tree.ts). An undefined here means a
    // creation path leaked through without stamping a birth time — that
    // is a bug in the writer, not a condition to paper over with an
    // end-of-list fallback.
    if (typeof ca?.time !== "number") throw new Error(`rebuildTopLevelOrder: card ${a} missing numeric time`)
    if (typeof cb?.time !== "number") throw new Error(`rebuildTopLevelOrder: card ${b} missing numeric time`)
    return ca.time - cb.time
  })

  setCardTreeStore("order", order)
}

// ── Board projection hook ──
//
// `loadBoard()` applies board snapshots via fine-grained `setBoardStore`
// writes (`setBoardStore("board", key, value)`). A detached effect that reads
// only `boardStore.board` does not reliably rerun for those nested writes, so
// step / phase / interaction cards can stay stale until an unrelated task event
// happens to force a rebuild. Register an explicit post-delta hook at the
// store boundary instead: every successful board apply triggers exactly one
// re-projection with the fully-updated snapshot.
setBoardProjectionHandler(() => {
  rebuildBoardDerivedCards()
})
rebuildBoardDerivedCards()

// Synthetic-message projection removed: chat.ts no longer writes
// duplicate placeholders into messageStore.messages (the
// optimistic user bubble now comes through ingestPersistedMessage with
// the real server-issued message id). Interactions are projected directly
// into cardTreeStore via rebuildInteractionCards/upsertInteractionCard.
// One source per card; no parallel mirror to keep in sync.
