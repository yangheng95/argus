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
// Behavioural equivalence goal: for the P0 fixture, the tree produced here
// must match the old-pipeline snapshot byte-for-byte. The equivalence test
// in `test/new-writer-equivalence.test.ts` enforces this.

import { batch, createEffect } from "solid-js";
import { produce } from "solid-js/store";
import {
  cardTreeStore,
  markCardTreeReplaced,
  markCardTreeVisibleChanged,
  setCardTreeStore,
  type CardNode,
  type CardStatus,
} from "../store/card-tree";
import { boardStore, setBoardProjectionHandler } from "../store/board";
import { agentStageLabel, normalizeAgentRole, roleLabel } from "../utils/message";
import { stageAccent } from "../utils/card-color";
import { t } from "../utils/i18n";
import { normalizeToolPartRecord } from "../utils/tool";

/** Raw i18n key for a role/stage, normalized so that backend variants
 *  ("design_analysis", "design_analyst", "design-analysis") all resolve
 *  to the same canonical key (`chat.role.design-analyst`). The key is
 *  stored on the card; CardHeader calls `t()` at render time, keeping
 *  titles reactive to locale switches. */
function roleTitleKey(name: string): string {
  return `chat.role.${normalizeAgentRole(name)}`;
}
import { interactionToCardSeeds, partitionInteractions } from "../utils/interaction";
import {
  isTreeWriterNoopEventType,
  isTreeWriterPassThroughEventType,
} from "./event-policy";
import { goalStagePhaseID } from "../utils/workflow-step";

// ── Internal indices ──

/** A part's exact display target: which card owns it and at which index in
 *  that card's `parts` array. Carrying the cardID (not just the index) is
 *  mandatory — a long-lived session has many turn cards, and a late delta
 *  for an older message must land on the card that owns the original part,
 *  not on whatever turn is currently active (spec §3.3 / §11.1). */
interface PartTarget {
  cardID: string;
  index: number;
}

interface SessionInfo {
  sessionID: string;
  stage: string;
  parentSessionID: string;
  goalID: string;
  /** ids of messages that landed in this session's bucket, preserved to derive status. */
  messageIDs: Set<string>;
  /** messageID → the display card that owns that message turn. For
   *  phase-absorbed sessions (build / planner under a goal) every entry
   *  points at the single phase card; for integrity it points at the
   *  dedicated integrity card; otherwise each entry is a distinct
   *  message-turn card (`<stage>:session:<sid>:message:<mid>`). */
  messageCardIDs: Map<string, string>;
  /** The message turn currently receiving session-level events
   *  (session.status / session.error / usage.updated). The newest
   *  `message.updated` for this session sets it. */
  activeMessageID?: string;
  /** Display card for `activeMessageID`. Session lifecycle/usage events
   *  mutate THIS card only — older turn cards are frozen history. */
  activeCardID?: string;
  /** part id → its exact {cardID,index} target — O(1) lookup for updates. */
  partIndex: Map<string, PartTarget>;
  /** Last known executor top-level visibility; gates expensive order rebuilds. */
  executorTopLevelVisible: boolean;
}

interface MessageInfo {
  id: string;
  sessionID: string;
  role: string;
  resolvedRole: string;
  agent: string;
  parentSessionID: string;
  goalID: string;
  time: number;
  completed: boolean;
}

const sessions = new Map<string, SessionInfo>();
const messages = new Map<string, MessageInfo>();
/** goalID → known. Goal cards themselves are driven by board.goalWorkflows,
 *  not by `goal.created` events — we just remember existence here so session
 *  bucket claiming is deterministic. */
const knownGoalIDs = new Set<string>();
/** goalID → the current attempt's goal_run id. Refreshed from
 *  board.goalWorkflows on every rebuild. Used to scope step/phase card
 *  ids so each attempt (retry / delivery_rework / modify_contract /
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
const goalCurrentRunID = new Map<string, string>();
/** Legacy integrity child-card ownership map. New integrity runs render on the
 *  session card itself, so this map stays empty for fresh data but remains
 *  wired for older protocol slices that still materialize kind="integrity"
 *  child cards. */
const integrityCardOwners = new Map<string, string>();

/** Integrity events that arrived before their owning session's first
 *  message.updated. Keyed by sessionID so ensureSessionCard can drain a
 *  single pending payload per session. Holding the raw payload here (NOT in
 *  cardTreeStore.cards) preserves the invariant "every entry in
 *  cardTreeStore.cards is reachable via order or some parent's childIDs" —
 *  an integrity event that never finds its session stays in this map until
 *  resetWriter() clears it, never materializing into an unreachable ghost. */
interface PendingIntegrityPayload {
  taskID: string;
  emittedAt: number;
  verdict: "pass" | "concerns" | "needs_correction";
  summary: string;
  dimensions: Array<{
    id: "requirement_fidelity" | "technical_feasibility" | "hallucination" | "solution_quality";
    verdict: "pass" | "concerns" | "needs_correction";
    issueCount: number;
    correctionCount: number;
    missingGoalCount: number;
  }>;
  issues: Array<{
    type: string;
    description: string;
    requirement_ids?: string[];
    spec_ids?: string[];
  }>;
  corrections: Array<{
    action: "modify" | "split" | "remove";
    goalID: string;
    reason: string;
    updatesTitle?: string;
    updatesObjective?: string;
  }>;
  missingGoals: Array<{ title: string; objective: string; reason?: string }>;
  attempts: number;
}
const pendingIntegrity = new Map<string, PendingIntegrityPayload>();

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
  cardStatus: CardStatus;
  terminalReason?: "completed" | "error" | "aborted";
  errorReason?: string;
  timeCompleted?: number;
}
const pendingSessionStatus = new Map<string, ProjectedSessionStatus>();
/** Latest conversation card opened by the writer. Consecutive messages from
 *  the same runtime session reuse that card; a message from another session,
 *  including a phase-absorbed session, updates this pointer and therefore
 *  splits the original session when it resumes later. */
let latestConversationCardID: string | undefined;

interface BufferedPartDelta {
  event: any;
  delta: string;
}

const bufferedPartDeltas = new Map<string, BufferedPartDelta>();
let bufferedPartDeltaFrame: number | null = null;

// ── Entry point ──

/** Reset all writer state + cardTreeStore. Called on task switch, hydrate,
 *  recovery, and in tests. The caller must stamp the replacement scroll
 *  intent explicitly so the conversation view does not guess whether this
 *  replacement should preserve the operator's viewport or jump to the tail. */
export function resetWriter(options: {
  scrollIntent?: "preserve" | "bottom";
  cause?: string;
} = {}): void {
  try {
    flushBufferedPartDeltas();
  } finally {
    cancelBufferedPartDeltaFrame();
    bufferedPartDeltas.clear();
  }
  sessions.clear();
  messages.clear();
  knownGoalIDs.clear();
  integrityCardOwners.clear();
  pendingIntegrity.clear();
  runningIntegrity.clear();
  pendingSessionStatus.clear();
  latestConversationCardID = undefined;
  // Drop every key explicitly — plain assignment on a store merges instead of
  // replacing (see setMessages's messagesBySession fix in store/messages.ts).
  setCardTreeStore("order", []);
  setCardTreeStore(
    "cards",
    produce((c: Record<string, CardNode>) => {
      for (const k of Object.keys(c)) delete c[k];
    }),
  );
  markCardTreeReplaced({
    scrollIntent: options.scrollIntent ?? "preserve",
    cause: options.cause ?? "writer-reset",
  });
  markCardTreeVisibleChanged();
}

function applyVisibleCardTreeEvent(handler: () => void): void {
  batch(() => {
    handler();
    markCardTreeVisibleChanged();
  });
}

function cancelBufferedPartDeltaFrame(): void {
  if (bufferedPartDeltaFrame === null) return;
  cancelAnimationFrame(bufferedPartDeltaFrame);
  bufferedPartDeltaFrame = null;
}

function validatePartDeltaTarget(event: any): {
  key: string;
  delta: string;
} {
  const p = propsOf(event);
  const partID = String(p.partID || "");
  const sessionID = String(p.sessionID || "");
  const field = String(p.field || "");
  if (!partID || !sessionID || !field) {
    throw new Error("message.part.delta missing partID/sessionID/field");
  }
  const session = sessions.get(sessionID);
  if (!session) throw new Error(`message.part.delta: unknown session ${sessionID}`);
  if (session.partIndex.get(partID) === undefined) {
    throw new Error(`message.part.delta: unknown part ${partID} in session ${sessionID}`);
  }
  return {
    key: `${sessionID}|${partID}|${field}`,
    delta: typeof p.delta === "string" ? p.delta : "",
  };
}

function mergedPartDeltaEvent(entry: BufferedPartDelta): any {
  const props = propsOf(entry.event);
  if (entry.event?.properties && typeof entry.event.properties === "object" && !Array.isArray(entry.event.properties)) {
    return { ...entry.event, properties: { ...props, delta: entry.delta } };
  }
  return { ...entry.event, payload: { ...props, delta: entry.delta } };
}

function queuePartDelta(event: any): void {
  const { key, delta } = validatePartDeltaTarget(event);
  const buffered = bufferedPartDeltas.get(key);
  if (buffered) {
    buffered.delta += delta;
  } else {
    bufferedPartDeltas.set(key, { event, delta });
  }
  if (bufferedPartDeltaFrame !== null) return;
  bufferedPartDeltaFrame = requestAnimationFrame(() => {
    bufferedPartDeltaFrame = null;
    flushBufferedPartDeltas();
  });
}

export function flushBufferedPartDeltas(): void {
  if (bufferedPartDeltas.size === 0) {
    cancelBufferedPartDeltaFrame();
    return;
  }
  cancelBufferedPartDeltaFrame();
  const entries = [...bufferedPartDeltas.entries()];
  batch(() => {
    for (const [key, entry] of entries) {
      bufferedPartDeltas.delete(key);
      handlePartDelta(mergedPartDeltaEvent(entry));
    }
    markCardTreeVisibleChanged();
  });
}

/** Top-level dispatcher. Unknown event types throw by design (rule 1:
 *  let-it-crash). Keeping the branches close together makes coverage
 *  auditable — every event type the overlay processes lives here. */
export function applyEvent(event: any): void {
  const type: string = String(event?.type || "");
  if (!type) throw new Error("tree-writer: event missing type");
  if (type === "message.part.delta") return queuePartDelta(event);
  flushBufferedPartDeltas();

  // ── Message stream ──
  if (type === "message.updated") return applyVisibleCardTreeEvent(() => handleMessageUpdated(event));
  if (type === "message.part.updated") return applyVisibleCardTreeEvent(() => handlePartUpdated(event));

  // ── Task / board ──
  if (type === "task.created" || type === "task.updated" || type === "task.completed") {
    return handleTaskChanged(event);
  }

  // ── Goal lifecycle ──
  if (type === "goal.created") {
    const gid = String(event?.properties?.goalID || event?.payload?.goalID || "");
    if (gid) knownGoalIDs.add(gid);
    return;
  }

  // ── Interactions ──
  if (type === "interaction.requested" || type === "interaction.resolved") {
    return handleInteraction(event);
  }

  // ── Integrity review lifecycle ──
  // started/progress put a running placeholder card under the requirements
  // session (kind="integrity", status="running"), so the operator sees the
  // non-streaming LLM review in flight during its 60–180s window. completed
  // upserts the same cardID with the parsed verdict / issues / corrections.
  // Identity is `integrity:<taskID>` (stable per task) so all three events
  // land on the same card.
  if (type === "integrity.review.started") {
    return applyVisibleCardTreeEvent(() => handleIntegrityStarted(event));
  }
  if (type === "integrity.review.progress") {
    return applyVisibleCardTreeEvent(() => handleIntegrityProgress(event));
  }
  if (type === "integrity.review.chunk") {
    return applyVisibleCardTreeEvent(() => handleIntegrityChunk(event));
  }
  if (type === "integrity.review.completed") {
    return applyVisibleCardTreeEvent(() => handleIntegrityCompleted(event));
  }

  // ── Session lifecycle (single source) ──
  // session.status from packages/opencorvus/src/session/status.ts is the
  // only signal that flips a session card out of `running`. Carries
  // `{sessionID, status:{type:"streaming"|"idle"|"retry"|"terminal", ...}}`.
  // Applies to every session — orchestrator root, requirements / architect /
  // design-analyst / integrity / build / deliver / refine / prosecute /
  // analyze_intent / modify_goal / publish_delivery, future phases. See
  // specs/new-arch/07-panel-reactivity.md §session 终态信号源.
  if (type === "session.status") {
    return applyVisibleCardTreeEvent(() => handleSessionStatus(event));
  }
  // session.error carries provider/stream failures that can precede a later
  // secondary lifecycle status. Show the original error on the card directly.
  if (type === "session.error") {
    return applyVisibleCardTreeEvent(() => handleSessionError(event));
  }
  // session.idle is published alongside session.status when status flips to
  // idle. We already handle the lifecycle via session.status, so it's noop
  // here.
  if (type === "session.idle") return;

  // ── Cumulative LLM usage for a session (token + cost). ──
  if (type === "usage.updated") {
    return applyVisibleCardTreeEvent(() => handleUsageUpdated(event));
  }

  // ── Interactive prompts that need operator response. ──
  // approval.request / input.request payloads carry { id, approval / questions }
  // — they DO need a UI surface (Round-4 work), but until that lands we
  // accept them silently rather than spamming console.error from the SSE
  // try/catch. Backend (executor/managed.ts) emits these for permission
  // gates and structured questions.
  if (type === "approval.request" || type === "input.request") return;
  // permission.* events fire alongside approval.request when an executor
  // gates on a tool call (executor/opencorvus.ts:260,267). Handled inline by
  // InteractionCard — tree-writer just acknowledges.
  if (type === "permission.asked" || type === "permission.replied") return;
  // diff.delta is a streaming preview from the executor — boardStore
  // already tracks the diff, the writer doesn't need to project it as a card.
  if (type === "diff.delta") return;

  // ── No-op events (control plane / telemetry). Listed explicitly so the
  //    final `throw` catches truly unknown types. ──
  if (isTreeWriterNoopEventType(type)) return;

  // Broad-prefix pass-through (no state change in the writer; boardStore
  // handles these on its own side, and rebuildBoardDerivedCards reads
  // boardStore lazily). Enumerated explicitly — unknown prefixes still throw.
  if (isTreeWriterPassThroughEventType(type)) return;

  throw new Error(`tree-writer: unhandled event type "${type}"`);
}

// ── Helpers ──

function propsOf(event: any): Record<string, any> {
  const p = event?.properties;
  if (p && typeof p === "object" && !Array.isArray(p)) return p;
  const q = event?.payload;
  if (q && typeof q === "object" && !Array.isArray(q)) return q;
  return {};
}

/** Dedicated, message-turn-less card id. Only the integrity review uses
 *  this form: integrity is a real session but its reasoning/verdict reach
 *  the overlay through `integrity.review.*` events (NOT `message.updated`),
 *  so there is no durable messageID to scope a turn card by. The card is
 *  single per integrity session, which is the desired display anyway. */
function sessionCardID(stage: string, sid: string): string {
  return `${stage}:session:${sid}`;
}

/** Per-message-turn card id. A long-lived session (orchestrator especially)
 *  produces a new real `message.updated` every time it resumes reasoning;
 *  each becomes its own top-level card so later turns sort AFTER the child
 *  agent cards that ran between them, instead of back-filling the earliest
 *  card. Keeps the old `<stage>:session:<sid>` prefix recognizable for
 *  diagnostics and appends `:message:<mid>`; sorting is still by
 *  `CardNode.time`, never by id. */
function messageTurnCardID(stage: string, sid: string, messageID: string): string {
  return `${stage}:session:${sid}:message:${messageID}`;
}

function isUserStage(stage: string): boolean {
  return normalizeAgentRole(stage) === "user";
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
  const userStage = isUserStage(stage);
  return {
    id: cardID,
    kind: userStage ? "message" : "agent",
    role: userStage ? "user" : undefined,
    sessionID,
    messageID,
    stage,
    accent: !userStage && stage ? stageAccent(stage) : undefined,
    status: "running",
    title: userStage
      ? roleTitleKey("user")
      : stage
        ? roleTitleKey(stage)
        : "chat.role.assistant",
    round: userStage ? undefined : 0,
    goalID: goalID || undefined,
    parts,
    childIDs,
    time,
  };
}

/** Per-goal executor step card. Each goal has exactly one goal-scope step
 *  per attempt (see workflow.ts — the `build` step, labelled "Executor",
 *  is the only `scope: "goal"` entry in the pipeline). Every new attempt
 *  (retry / delivery_rework / modify_contract / restart_stage) creates
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
  return `step:${goalID}:${stepID}`;
}

function goalPhaseCardID(goalID: string, goalRunID: string | undefined, stepID: string, phaseID: string): string {
  return `${goalStepCardID(goalID, goalRunID, stepID)}:phase:${phaseID}`;
}

/** A card ID is a top-level executor step iff it matches
 *  `step:<gid>:<stepID>` exactly — the phase variants add a `:phase:<pid>`
 *  suffix. Format reverted to attempt-invariant on 2026-04-26 because the
 *  `:<runID>:` form orphaned all parts written before the run artifact
 *  materialised on the overlay (the typical case for pipeline build). */
function isTopLevelStepCardID(id: string): boolean {
  return id.startsWith("step:") && !id.includes(":phase:");
}

/** Extract the goalID segment from a step card id (top-level or phase).
 *  Used by the GC pass to drop cards whose owning goal has been removed,
 *  while preserving historical-attempt cards (same goalID, different
 *  goalRunID) that the new alive-set no longer covers. */
function goalIDFromStepCardID(id: string): string | null {
  if (!id.startsWith("step:")) return null;
  const parts = id.split(":");
  // step:<goalID>:<runID>:<stepID>[...]
  return parts.length >= 3 ? parts[1] : null;
}

function interactionCardID(messageID: string): string {
  return `interaction-card:${messageID}`;
}

// ── Handlers ──

function handleMessageUpdated(event: any): void {
  const info = propsOf(event).info;
  if (!info || typeof info !== "object") throw new Error("message.updated missing info");

  const id = String(info.id || "");
  const sessionID = String(info.sessionID || "");
  if (!id || !sessionID) throw new Error("message.updated info missing id/sessionID");

  // No assistant-fallback (一个萝卜一个坑). Every event must arrive with role
  // + resolvedRole already populated by the server bridge (overlayMeta). If
  // either is missing, throw — silently routing role-less events into the
  // generic assistant card orphans the actual agent's stream.
  const rawRole = info.role;
  if (typeof rawRole !== "string" || rawRole.length === 0) {
    throw new Error(`message.updated info missing role for message ${info.id}; bridge must enrich it`);
  }
  const role = rawRole;
  const rawResolvedRole = info.resolvedRole || info.agent || role;
  if (typeof rawResolvedRole !== "string" || rawResolvedRole.length === 0) {
    throw new Error(`message.updated info missing resolvedRole/agent for message ${info.id}`);
  }
  const resolvedRole = String(rawResolvedRole);
  const agent = String(info.agent || "");
  const parentSessionID = String(info.parentSessionID || "");
  const goalID = String(info.goalID || "");
  const timeCreated = Number(info?.time?.created || 0);
  if (!(timeCreated > 0)) {
    throw new Error(`message.updated info.time.created must be positive (got ${info?.time?.created}); server emitter is the single source of truth`);
  }
  const completed = Number.isFinite(info?.time?.completed) && Number(info.time.completed) > 0;

  // Index the message.
  messages.set(id, {
    id,
    sessionID,
    role,
    resolvedRole,
    agent,
    parentSessionID,
    goalID,
    time: timeCreated,
    completed,
  });

  // Channel-driven stage. Bridge stamps it on every event; an absent
  // channel is a bridge bug, not a case we silently accommodate.
  const stage = deriveSessionStage(info);
  if (stage === "filtered") return;

  const session = ensureSession(sessionID, { stage, parentSessionID, goalID });
  session.messageIDs.add(id);

  const { cardID, isPhase, groupedIntoExistingCard } = ensureTurnCard(session, id, {
    stage,
    goalID,
    role: resolvedRole,
    time: timeCreated,
    stampServerTime: true,
  });

  // Phase cards always need in-card message boundaries. Non-phase cards only
  // need one when consecutive messages from the same session were grouped
  // into an existing card; a freshly split card is already the boundary.
  if (isPhase || groupedIntoExistingCard) {
    ensureBoundaryPart(session, cardID, id, resolvedRole, timeCreated);
  }

  drainPendingSessionStatus(sessionID);
  drainPendingIntegrity(sessionID);
}

function handlePartUpdated(event: any): void {
  const part = propsOf(event).part;
  if (!part || typeof part !== "object") throw new Error("message.part.updated missing part");
  const partID = String(part.id || "");
  const messageID = String(part.messageID || "");
  const sessionID = String(part.sessionID || "");
  if (!partID || !messageID || !sessionID) {
    throw new Error("message.part.updated part missing id/messageID/sessionID");
  }

  const existingSession = sessions.get(sessionID);
  let session = existingSession;
  let cardID = session?.messageCardIDs.get(messageID);

  if (!session || !cardID) {
    // Bridge stamps channel/goalID/parentSessionID onto the part. A part can
    // arrive before its message.updated (saveMessage is silent; updatePart
    // fires before updateMessage). Because messageID is already known, the
    // turn card's deterministic id is too — build it now at observation
    // time. The later message.updated overwrites `time` with the
    // authoritative server timestamp; no synthetic stub / rename.
    const stage = deriveSessionStage(part);
    if (stage === "filtered") return;
    session = ensureSession(sessionID, {
      stage,
      parentSessionID: String(part.parentSessionID || ""),
      goalID: String(part.goalID || ""),
    });
    cardID = session.messageCardIDs.get(messageID);
  }

  if (!cardID) {
    const ensured = ensureTurnCard(session, messageID, {
      stage: session.stage,
      goalID: session.goalID,
      role: String(part.resolvedRole || session.stage),
      time: Date.now(),
      stampServerTime: false,
    });
    cardID = ensured.cardID;
    if (ensured.isPhase || ensured.groupedIntoExistingCard) {
      ensureBoundaryPart(
        session,
        cardID,
        messageID,
        String(part.resolvedRole || session.stage),
        Date.now(),
      );
    }
    drainPendingSessionStatus(sessionID);
    drainPendingIntegrity(sessionID);
  }

  upsertPart(session, messageID, cardID, partID, { ...part });
  syncExecutorTopLevelVisibility(session);
}

function handlePartDelta(event: any): void {
  const p = propsOf(event);
  const partID = String(p.partID || "");
  const sessionID = String(p.sessionID || "");
  const field = String(p.field || "");
  const delta = typeof p.delta === "string" ? p.delta : "";
  if (!partID || !sessionID || !field) {
    throw new Error("message.part.delta missing partID/sessionID/field");
  }

  const session = sessions.get(sessionID);
  if (!session) throw new Error(`message.part.delta: unknown session ${sessionID}`);
  const target = session.partIndex.get(partID);
  if (target === undefined) {
    throw new Error(`message.part.delta: unknown part ${partID} in session ${sessionID}`);
  }

  // Resolve the EXACT card that owns this part. A late delta for an older
  // message turn must land on that turn's card, never on whatever turn is
  // currently active for the session (spec §3.3 — primary failure mode).
  const part = cardTreeStore.cards[target.cardID]?.parts?.[target.index];
  if (field === "raw" && part?.type === "tool") {
    setCardTreeStore(
      "cards",
      target.cardID,
      "parts",
      target.index,
      "state",
      "raw",
      (prev: any) => String(prev ?? "") + delta,
    );
  } else {
    setCardTreeStore(
      "cards",
      target.cardID,
      "parts",
      target.index,
      field as any,
      (prev: any) => String(prev ?? "") + delta,
    );
  }
  syncExecutorTopLevelVisibility(session);
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
  void event;
  rebuildBoardDerivedCards();
}

/** Map a SessionStatus.Info bus payload onto a CardStatus.
 *  streaming / retry → running (spinner ON, the card is actively working)
 *  idle              → idle (no spinner, "between turns / awaiting input")
 *  terminal.completed → completed
 *  terminal.error    → error
 *  terminal.aborted  → error + terminalReason=aborted (badge renders as
 *                      cancelled, while the card is still terminal) */
function mapSessionStatusToCardStatus(status: any): CardStatus | undefined {
  const t = String(status?.type || "");
  if (t === "streaming" || t === "retry") return "running";
  if (t === "idle") return "idle";
  if (t === "terminal") {
    const reason = String(status?.reason || "");
    if (reason === "completed") return "completed";
    if (reason === "error" || reason === "aborted") return "error";
  }
  return undefined;
}

function projectSessionStatus(event: any): ProjectedSessionStatus {
  const props = propsOf(event);
  const status = props.status;
  const cardStatus = mapSessionStatusToCardStatus(status);
  if (!cardStatus) {
    throw new Error(`session.status unknown status shape: ${JSON.stringify(status)}`);
  }
  const projected: ProjectedSessionStatus = { cardStatus };
  if (status?.type === "terminal") {
    const reason = String(status.reason || "");
    if (reason !== "completed" && reason !== "error" && reason !== "aborted") {
      throw new Error(`session.status unknown terminal reason: ${JSON.stringify(status)}`);
    }
    projected.terminalReason = reason;
    projected.timeCompleted = Number(event?.emittedAt || event?.emitted_at || Date.now());
    if (cardStatus === "error") {
      projected.errorReason =
        (typeof status.message === "string" && status.message) ||
        (typeof status.error === "string" && status.error) ||
        "";
    }
  }
  return projected;
}

function applyProjectedSessionStatus(cardID: string, projected: ProjectedSessionStatus): void {
  if (
    projected.cardStatus === "idle" &&
    cardTreeStore.cards[cardID]?.status === "error" &&
    cardTreeStore.cards[cardID]?.errorReason
  ) {
    return;
  }
  setCardTreeStore("cards", cardID, "status", projected.cardStatus);
  if (projected.terminalReason) {
    setCardTreeStore("cards", cardID, "terminalReason", projected.terminalReason);
  }
  if (
    (projected.cardStatus === "completed" || projected.cardStatus === "error") &&
    projected.timeCompleted &&
    !cardTreeStore.cards[cardID]?.timeCompleted
  ) {
    setCardTreeStore("cards", cardID, "timeCompleted", projected.timeCompleted);
  }
  if (projected.errorReason) {
    setCardTreeStore("cards", cardID, "errorReason", projected.errorReason);
  }
}

function streamErrorMessage(event: any): string {
  const props = propsOf(event);
  const error = props.error;
  if (error && typeof error === "object") {
    const dataMessage = (error as any).data?.message;
    if (typeof dataMessage === "string" && dataMessage.length > 0) return dataMessage;
    const message = (error as any).message;
    if (typeof message === "string" && message.length > 0) return message;
    const name = (error as any).name;
    if (typeof name === "string" && name.length > 0) return name;
  }
  const summary = props.summary ?? event?.summary;
  if (typeof summary === "string" && summary.length > 0) return summary;
  throw new Error("session.error missing error message");
}

function projectSessionError(event: any): ProjectedSessionStatus {
  return {
    cardStatus: "error",
    terminalReason: "error",
    errorReason: streamErrorMessage(event),
    timeCompleted: Number(event?.emittedAt || event?.emitted_at || Date.now()),
  };
}

function handleSessionStatus(event: any): void {
  const props = propsOf(event);
  const sessionID = String(props.sessionID || "");
  if (!sessionID) {
    throw new Error("session.status missing sessionID");
  }
  const projected = projectSessionStatus(event);
  const info = sessions.get(sessionID);
  const activeCardID = info?.activeCardID;
  if (!info || !activeCardID || !cardTreeStore.cards[activeCardID]) {
    // Active turn card not yet materialized — hold until one exists.
    pendingSessionStatus.set(sessionID, projected);
    return;
  }
  // Session lifecycle only touches the ACTIVE turn card. Older turn cards
  // are frozen history; a later terminal status must not retro-flip them.
  applyProjectedSessionStatus(activeCardID, projected);
}

function handleSessionError(event: any): void {
  const props = propsOf(event);
  const sessionID = String(props.sessionID || "");
  if (!sessionID) {
    throw new Error("session.error missing sessionID");
  }
  const projected = projectSessionError(event);
  const info = sessions.get(sessionID);
  const activeCardID = info?.activeCardID;
  if (!info || !activeCardID || !cardTreeStore.cards[activeCardID]) {
    pendingSessionStatus.set(sessionID, projected);
    return;
  }
  applyProjectedSessionStatus(activeCardID, projected);
}

// usage.updated — cumulative LLM token / cost totals from the executor for a
// session. Backend payload shape (executor/managed.ts:525-538):
//   { sessionID, queueTaskID, inputTokens?, outputTokens?, totalTokens?, costUSD? }
// Maps onto the session card's `usage` field; CardHeader renders a compact
// `↑in/↓out · $cost` strip next to the existing context-token hint.
function handleUsageUpdated(event: any): void {
  const props = propsOf(event);
  const sessionID = String(props.sessionID || "");
  if (!sessionID) return;
  const info = sessions.get(sessionID);
  const activeCardID = info?.activeCardID;
  if (!info || !activeCardID || !cardTreeStore.cards[activeCardID]) return;
  const usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number; costUSD?: number } = {};
  if (Number.isFinite(props.inputTokens)) usage.inputTokens = Number(props.inputTokens);
  if (Number.isFinite(props.outputTokens)) usage.outputTokens = Number(props.outputTokens);
  if (Number.isFinite(props.totalTokens)) usage.totalTokens = Number(props.totalTokens);
  if (Number.isFinite(props.costUSD)) usage.costUSD = Number(props.costUSD);
  if (Object.keys(usage).length === 0) return;
  // Usage is cumulative for the runtime session. P1 writes it onto the
  // active turn card only; a later usage event naturally moves the chip to
  // the newest turn (per-turn split would need backend per-message
  // accounting — out of scope, spec §3.5).
  setCardTreeStore("cards", activeCardID, "usage", usage);
}

/** Drain any session.status buffered for this session. Called from
 *  ensureSessionCard after the session is committed, parallel to
 *  drainPendingIntegrity. */
function drainPendingSessionStatus(sessionID: string): void {
  const projected = pendingSessionStatus.get(sessionID);
  if (!projected) return;
  const session = sessions.get(sessionID);
  const activeCardID = session?.activeCardID;
  if (!session || !activeCardID || !cardTreeStore.cards[activeCardID]) return;
  pendingSessionStatus.delete(sessionID);
  applyProjectedSessionStatus(activeCardID, projected);
}

function handleInteraction(event: any): void {
  // Interactions are sourced from boardStore.board.interactions, not the event
  // payload — the board routes handle the write, we reproject.
  rebuildBoardDerivedCards();
}

// ── Integrity review ──

function integrityCardID(sessionID: string): string {
  return sessionCardID("integrity", sessionID);
}

/** Buffered running-phase payload so `rebuildCardHierarchy` can re-attach a
 *  running card if its owning requirements session card disappears + reappears
 *  (task reselect / replay). Keyed by taskID. Separate from `pendingIntegrity`
 *  because that map is for COMPLETED payloads that predate their session. */
interface RunningIntegrityPayload {
  sessionID: string
  startedAt: number
  attempt: number
  elapsedMs: number
}
const runningIntegrity = new Map<string, RunningIntegrityPayload>()

function handleIntegrityStarted(event: any): void {
  const props = propsOf(event);
  const taskID = String(props.taskID || "");
  const sessionID = String(props.sessionID || "");
  if (!taskID) throw new Error("integrity.review.started missing taskID");
  if (!sessionID) {
    throw new Error(
      `integrity.review.started missing sessionID (taskID=${taskID})`,
    );
  }
  const emittedAt = Number(event?.emittedAt || event?.emitted_at || 0);
  const payload: RunningIntegrityPayload = {
    sessionID,
    startedAt: emittedAt > 0 ? emittedAt : Date.now(),
    attempt: 0,
    elapsedMs: 0,
  };
  runningIntegrity.set(sessionID, payload);
  materializeRunningIntegrity(payload);
}

function handleIntegrityProgress(event: any): void {
  const props = propsOf(event);
  const taskID = String(props.taskID || "");
  const sessionID = String(props.sessionID || "");
  if (!taskID) throw new Error("integrity.review.progress missing taskID");
  if (!sessionID) {
    throw new Error(
      `integrity.review.progress missing sessionID (taskID=${taskID})`,
    );
  }
  const attempt = Number(props.attempt || 0);
  const elapsedMs = Number(props.elapsedMs || props.elapsed_ms || 0);
  const existing = runningIntegrity.get(sessionID);
  const payload: RunningIntegrityPayload = {
    sessionID,
    startedAt: existing?.startedAt ?? (Date.now() - elapsedMs),
    attempt,
    elapsedMs,
  };
  runningIntegrity.set(sessionID, payload);
  materializeRunningIntegrity(payload);
}

/** Append a reasoning delta onto the running integrity card. The backend
 *  (`integrity/agent.ts` createIntegrityChunkForwarder) emits
 *  IntegrityReviewChunk at ~2 Hz with accumulated 500ms batches. One stable
 *  part per attempt — a Zod-retry boundary opens a fresh reasoning part,
 *  same-attempt chunks append to the existing part.
 *
 *  Only `kind: "reasoning"` is valid. tool-input deltas are intentionally
 *  NOT forwarded by the backend (they're protocol payload — the verdict
 *  lands structured via IntegrityReviewCompleted).
 *
 *  Silently skips when the card has already upgraded to the completed
 *  verdict state (card.integrity populated) — late chunks after Completed
 *  lands would otherwise pollute the verdict render. */
function handleIntegrityChunk(event: any): void {
  const props = propsOf(event);
  const taskID = String(props.taskID || "");
  const sessionID = String(props.sessionID || "");
  if (!taskID) throw new Error("integrity.review.chunk missing taskID");
  if (!sessionID) {
    throw new Error(
      `integrity.review.chunk missing sessionID (taskID=${taskID})`,
    );
  }
  const kind = String(props.kind || "");
  const delta = String(props.delta || "");
  const attempt = Number(props.attempt || 1);
  if (kind !== "reasoning") {
    throw new Error(`integrity.review.chunk unexpected kind: ${kind}`);
  }
  if (!delta) return;

  const cardID = integrityCardID(sessionID);
  const existing = cardTreeStore.cards[cardID];
  // Completed event already upserted the verdict — ignore trailing chunks.
  if (existing?.integrity) return;
  // Started must fire before Chunk. If the card is missing, this is a
  // backend ordering bug (chunk before started) — loud-fail per rule 1.
  if (!existing) {
    throw new Error(
      `integrity.review.chunk arrived before started (taskID=${taskID}, sessionID=${sessionID})`,
    );
  }

  const partID = `integrity:${sessionID}:reasoning:${attempt}`;

  setCardTreeStore(
    "cards",
    cardID,
    "parts",
    produce((parts: any[]) => {
      const idx = parts.findIndex((p) => p?.partID === partID);
      if (idx >= 0) {
        parts[idx].text = String(parts[idx].text || "") + delta;
      } else {
        parts.push({ type: "reasoning", partID, text: delta });
      }
    }),
  );
}

/** Integrity is a real session, but its reasoning/verdict reach the overlay
 *  through `integrity.review.*` events (NOT `message.updated`), so there is
 *  no durable messageID to scope a message-turn card by. It therefore keeps
 *  a single dedicated card id (`integrity:session:<sid>`). We still register
 *  a SessionInfo so session.status / usage routing (active turn card) works
 *  uniformly — `activeCardID` is pinned to the dedicated card. */
function ensureIntegritySession(sessionID: string, time: number): { session: SessionInfo; cardID: string } {
  const session = ensureSession(sessionID, { stage: "integrity", parentSessionID: "", goalID: "" });
  const cardID = sessionCardID("integrity", sessionID);
  const created = !cardTreeStore.cards[cardID];
  if (created) {
    setCardTreeStore(
      "cards",
      cardID,
      createSessionCardNode(cardID, "integrity", "", time, sessionID, ""),
    );
  }
  session.activeCardID = cardID;
  if (created) {
    rebuildCardHierarchy();
    drainPendingSessionStatus(sessionID);
    drainPendingIntegrity(sessionID);
  }
  return { session, cardID };
}

/** Upsert the running-phase integrity session card. Integrity is now a normal
 *  agent session, so lifecycle events target the session card directly. */
function materializeRunningIntegrity(p: RunningIntegrityPayload): void {
  const { cardID } = ensureIntegritySession(p.sessionID, p.startedAt);
  const existing = cardTreeStore.cards[cardID];
  // If the completed event has already landed, don't downgrade the verdict
  // card back to "running". `attempts` on a completed card is > 0 and the
  // `integrity` payload is populated — that's how we tell.
  if (existing && existing.integrity) return;
  // Subtitle carries only the retry attempt label (when applicable).
  // The live elapsed-time display is owned by CardHeader's
  // `.card__duration` chip, which subtracts `time` from a shared 1Hz
  // tick (services/clock.ts). `p.elapsedMs` stays on the payload
  // because it still reconstructs `startedAt` on SSE replay above.
  const subtitle =
    p.attempt > 0 ? t("integrity.attempt_label", { value: String(p.attempt) }) : undefined;
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
    });
    return;
  }
  throw new Error(`integrity session card missing after ensureIntegritySession (sessionID=${p.sessionID})`);
}

function handleIntegrityCompleted(event: any): void {
  const props = propsOf(event);
  const taskID = String(props.taskID || "");
  const sessionID = String(props.sessionID || "");
  if (!taskID) throw new Error("integrity.review.completed missing taskID");
  if (!sessionID) {
    // sessionID became required (engine/model.ts) — loud-fail rather than
    // allowing the card to escape or silently drop. The matching assertion
    // in opencorvus/integrity/agent.ts emitIntegrityEvent keeps the
    // backend honest.
    throw new Error(
      `integrity.review.completed missing sessionID (taskID=${taskID})`,
    );
  }

  const emittedAt = Number(event?.emittedAt || event?.emitted_at || 0);
  if (!(emittedAt > 0)) {
    throw new Error(`integrity.review.completed missing emittedAt (taskID=${taskID}); server emitter is the single source of truth`);
  }
  const issues = Array.isArray(props.issues) ? props.issues : [];
  const corrections = Array.isArray(props.corrections) ? props.corrections : [];
  const missingGoals = Array.isArray(props.missingGoals) ? props.missingGoals : [];
  const dimensionsRaw = Array.isArray(props.dimensions) ? props.dimensions : [];
  const attempts = Number(props.attempts || 0);
  const summary = typeof props.summary === "string" ? props.summary : "";
  const verdict: "pass" | "concerns" | "needs_correction" =
    props.verdict === "pass" ? "pass"
      : props.verdict === "concerns" ? "concerns"
      : "needs_correction";

  const dimensionIDs = ["requirement_fidelity", "technical_feasibility", "hallucination", "solution_quality"] as const;
  type DimensionID = typeof dimensionIDs[number];
  const isDimensionID = (s: string): s is DimensionID =>
    (dimensionIDs as readonly string[]).includes(s);

  const payload: PendingIntegrityPayload = {
    taskID,
    emittedAt,
    verdict,
    summary,
    dimensions: dimensionsRaw
      .filter((d: any) => isDimensionID(String(d?.id || "")))
      .map((d: any) => {
        const dverdict: "pass" | "concerns" | "needs_correction" =
          d?.verdict === "pass" ? "pass"
            : d?.verdict === "concerns" ? "concerns"
            : "needs_correction";
        return {
          id: String(d.id) as DimensionID,
          verdict: dverdict,
          issueCount: Number(d?.issueCount || 0),
          correctionCount: Number(d?.correctionCount || 0),
          missingGoalCount: Number(d?.missingGoalCount || 0),
        };
      }),
    issues: issues.map((i: any) => ({
      type: String(i?.type || "uncovered"),
      description: String(i?.description || ""),
      requirement_ids: Array.isArray(i?.requirement_ids)
        ? i.requirement_ids.filter((x: unknown): x is string => typeof x === "string")
        : undefined,
      spec_ids: Array.isArray(i?.spec_ids)
        ? i.spec_ids.filter((x: unknown): x is string => typeof x === "string")
        : undefined,
    })),
    corrections: corrections.map((c: any) => ({
      action: (c?.action === "split" || c?.action === "remove") ? c.action : "modify",
      goalID: String(c?.goalID || ""),
      reason: String(c?.reason || ""),
      updatesTitle: typeof c?.updatesTitle === "string" ? c.updatesTitle : undefined,
      updatesObjective: typeof c?.updatesObjective === "string" ? c.updatesObjective : undefined,
    })),
    missingGoals: missingGoals.map((g: any) => ({
      title: String(g?.title || ""),
      objective: String(g?.objective || ""),
      reason: typeof g?.reason === "string" ? g.reason : undefined,
    })),
    attempts,
  };

  const { session } = ensureIntegritySession(sessionID, emittedAt);

  materializeIntegrity(session, payload);
  // Running-card lifecycle: the completed upsert now owns this cardID; drop
  // the runningIntegrity entry so a late `progress` event for the same task
  // doesn't rewrite the verdict back to a running placeholder.
  runningIntegrity.delete(sessionID);
}

/** Atomically write the integrity verdict onto the session card itself. */
function materializeIntegrity(session: SessionInfo, p: PendingIntegrityPayload): void {
  const cardID = session.activeCardID;
  if (!cardID) {
    throw new Error(`integrity session card missing on completion (sessionID=${session.sessionID})`);
  }
  // pass = green/completed, concerns = warning (rendered as completed but the
  // verdict pill carries the warning colour), needs_correction = error.
  const status: CardStatus =
    p.verdict === "pass" ? "completed"
      : p.verdict === "concerns" ? "completed"
      : "error";
  const existing = cardTreeStore.cards[cardID];
  if (!existing) {
    throw new Error(`integrity session card missing on completion (sessionID=${session.sessionID})`);
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
      dimensions: p.dimensions,
      issues: p.issues,
      corrections: p.corrections,
      missingGoals: p.missingGoals,
      attempts: p.attempts,
    },
  });
}

/** Drain any integrity payload waiting for this session and materialize it.
 *  Called from ensureSessionCard immediately after the session is committed
 *  so an integrity event that arrived first is flushed in the same batch. */
function drainPendingIntegrity(sessionID: string): void {
  const payload = pendingIntegrity.get(sessionID);
  if (!payload) return;
  const session = sessions.get(sessionID);
  if (!session || !session.activeCardID || !cardTreeStore.cards[session.activeCardID]) return;
  pendingIntegrity.delete(sessionID);
  materializeIntegrity(session, payload);
}

// ── Session & part bookkeeping ──

function deriveSessionStage(info: any): string {
  // `channel` is the single authoritative signal stamped by the backend
  // bridge (task-message-protocol-bridge.overlayMeta). It is derived from
  // the session's DB `kind` plus the message role, so every semantically
  // distinct bubble already has a correct stage at the source.
  //
  // Reading this as a fallback chain (channel → agent → resolvedRole →
  // role) previously routed root-session user messages to stage="build"
  // because `info.agent` on user rows is `Agent.defaultAgent()` (="build"
  // under OpenCorvus config). That cascade turned a user bubble into an
  // orange 「构建」 card — a classic rule-1 fallback bug.
  //
  // Channel values:
  //   "main"      → root-session user bubble → stage "user"
  //   "filtered"  → backend asked overlay to hide → caller skips the event
  //   SessionKind → stage = kind (build / requirements / architect / ...)
  //   missing     → bridge bug — fail loud, do not guess
  const channel = String(info?.channel || "").trim();
  if (!channel) {
    throw new Error(
      `tree-writer: message info is missing channel — bridge enrichment contract broken. info=${JSON.stringify(info)}`,
    );
  }
  if (channel === "main") return "user";
  if (channel === "filtered") return "filtered";
  return channel;
}

interface EnsureSessionOpts {
  stage: string;
  parentSessionID: string;
  goalID: string;
}

/** Register / backfill the runtime session index. NEVER creates a display
 *  card — display identity is per message turn, not per session (spec
 *  §2.3). `ensureTurnCard` owns card creation. */
function ensureSession(sessionID: string, opts: EnsureSessionOpts): SessionInfo {
  const existing = sessions.get(sessionID);
  if (existing) {
    if (!existing.stage && opts.stage) existing.stage = opts.stage;
    if (!existing.parentSessionID && opts.parentSessionID) existing.parentSessionID = opts.parentSessionID;
    if (!existing.goalID && opts.goalID) existing.goalID = opts.goalID;
    return existing;
  }
  const info: SessionInfo = {
    sessionID,
    stage: opts.stage || "",
    parentSessionID: opts.parentSessionID || "",
    goalID: opts.goalID || "",
    messageIDs: new Set(),
    messageCardIDs: new Map(),
    partIndex: new Map(),
    executorTopLevelVisible: false,
  };
  sessions.set(sessionID, info);
  return info;
}

/** Is this session folded into a goal phase card (build / planner under a
 *  goal)? Phase-absorbed sessions do NOT get message-turn cards — their
 *  parts accumulate on the single phase card, unchanged from P0 (spec
 *  §3.7 — keep existing phase-absorbed build/planner behaviour). */
function isPhaseAbsorbedSession(stage: string, goalID: string): boolean {
  return Boolean(goalID && stage && goalStagePhaseID(stage));
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
  cardID: string;
  isPhase: boolean;
} {
  if (isPhaseAbsorbedSession(stage, goalID)) {
    const phase = goalStagePhaseID(stage)!;
    // Read the live run id so the stub lands on the current attempt's card.
    const runID = goalCurrentRunID.get(goalID);
    const phaseCardID = goalPhaseCardID(goalID, runID, phase.stepID, phase.phaseID);
    if (!cardTreeStore.cards[phaseCardID]) {
      setCardTreeStore("cards", phaseCardID, {
        id: phaseCardID,
        kind: "phase",
        stage,
        accent: stageAccent(stage),
        status: "running",
        title: phase.phaseID,
        parts: [],
        childIDs: [],
        phaseID: phase.phaseID,
        phaseSessionKind: stage,
        phaseSessionID: sessionID,
        time,
      });
    } else if (cardTreeStore.cards[phaseCardID]!.phaseSessionID !== sessionID) {
      // Absorbed session replaced (rewind / re-dispatch within the same
      // goal run). Track the latest so the reply box always targets the
      // session whose parts are currently streaming.
      setCardTreeStore("cards", phaseCardID, "phaseSessionID", sessionID);
    }
    return { cardID: phaseCardID, isPhase: true };
  }
  // stage is guaranteed non-empty by the deriveSessionStage invariant.
  return { cardID: messageTurnCardID(stage, sessionID, messageID), isPhase: false };
}

interface EnsureTurnCardOpts {
  stage: string;
  goalID: string;
  role: string;
  time: number;
  /** message.updated carries the authoritative server time; a
   *  part-before-message stamp is observation time only and must not
   *  overwrite a server time already on the card. */
  stampServerTime: boolean;
  /** Hydrate replays many turns then rebuilds once at the end. */
  deferHierarchy?: boolean;
}

/** Move an early non-phase turn card's parts onto the resolved target card
 *  and repoint this session's part targets. Only fires when goalID arrives
 *  AFTER a turn card was already opened for the message (rare: the bridge
 *  stamps goalID/channel consistently on every event for a message). Keeps
 *  a single display identity — no duplicate / orphan card (rule 8). */
function migrateTurnCard(
  session: SessionInfo,
  fromCardID: string,
  toCardID: string,
): void {
  if (fromCardID === toCardID) return;
  const from = cardTreeStore.cards[fromCardID];
  const movedParts = from ? (from.parts || []).slice() : [];
  setCardTreeStore(
    "cards",
    produce((cards: Record<string, CardNode>) => {
      const target = cards[toCardID];
      if (!target) return;
      const baseLen = target.parts.length;
      for (const p of movedParts) target.parts.push(p);
      for (const [pid, tgt] of session.partIndex) {
        if (tgt.cardID === fromCardID) {
          session.partIndex.set(pid, { cardID: toCardID, index: baseLen + tgt.index });
        }
      }
      if (fromCardID in cards) delete cards[fromCardID];
    }),
  );
  for (const [mid, cid] of session.messageCardIDs) {
    if (cid === fromCardID) session.messageCardIDs.set(mid, toCardID);
  }
  if (session.activeCardID === fromCardID) session.activeCardID = toCardID;
}

/** Create or refresh the display card for one message turn and point the
 *  session's active pointers at it. Returns the resolved card id + whether
 *  it is a phase card. */
function ensureTurnCard(
  session: SessionInfo,
  messageID: string,
  opts: EnsureTurnCardOpts,
): { cardID: string; isPhase: boolean; groupedIntoExistingCard: boolean } {
  const stage = opts.stage || session.stage || "";
  const goalID = opts.goalID || session.goalID || "";
  const resolved = resolveTurnCardID(
    session.sessionID, stage, goalID, messageID, opts.time,
  );
  let cardID = resolved.cardID;
  const isPhase = resolved.isPhase;

  const prior = session.messageCardIDs.get(messageID);
  let groupedIntoExistingCard = false;
  if (!prior && !isPhase && session.activeCardID && latestConversationCardID === session.activeCardID) {
    cardID = session.activeCardID;
    groupedIntoExistingCard = true;
  }

  if (prior && prior !== resolved.cardID && isPhase) {
    cardID = resolved.cardID;
    migrateTurnCard(session, prior, cardID);
  } else if (prior) {
    cardID = prior;
  }

  if (!isPhase) {
    const existing = cardTreeStore.cards[cardID];
    if (existing) {
      setCardTreeStore("cards", cardID, "sessionID", session.sessionID);
      if (!existing.messageID) setCardTreeStore("cards", cardID, "messageID", messageID);
      if (opts.stampServerTime && prior && existing.messageID === messageID) {
        setCardTreeStore("cards", cardID, "time", opts.time);
      }
      setCardTreeStore("cards", cardID, "status", "running");
    } else {
      setCardTreeStore(
        "cards",
        cardID,
        createSessionCardNode(cardID, stage, goalID, opts.time, session.sessionID, messageID),
      );
    }
    // Freeze the previous still-running turn: a newer real message in the
    // same session means the older turn is no longer the active stream.
    // Display projection invariant, not a synthetic lifecycle event
    // (spec §3.4).
    const prevCardID = session.activeCardID;
    if (
      prevCardID &&
      prevCardID !== cardID &&
      cardTreeStore.cards[prevCardID]?.status === "running"
    ) {
      setCardTreeStore("cards", prevCardID, "status", "completed");
    }
    latestConversationCardID = cardID;
  }
  if (isPhase) {
    latestConversationCardID = cardID;
  }

  session.messageCardIDs.set(messageID, cardID);
  session.activeMessageID = messageID;
  session.activeCardID = cardID;

  if (!opts.deferHierarchy) rebuildCardHierarchy();
  return { cardID, isPhase, groupedIntoExistingCard };
}

/** Replay a persisted task into the exact same visible card identity the
 *  live SSE stream would have built. Single render identity = `messageID`:
 *  turn cards are derived straight from the transcript in chronological
 *  order. `view.sessions` is metadata only (parentSessionID / goalID
 *  fallback) and MUST NOT regroup multiple messages into one session card
 *  (spec §6 — the highest replay-collapse risk). */
export function hydrateConversationView(view: any, transcript: any[]): void {
  const all = Array.isArray(transcript) ? transcript : [];
  if (all.length === 0) return;
  // Hydration runs immediately after setBoardData(); do not rely on the
  // detached boardStore effect having re-projected phase cards yet.
  rebuildBoardDerivedCards();
  const sessionMeta = new Map<string, any>();
  for (const s of Array.isArray(view?.sessions) ? view.sessions : []) {
    const sid = String(s?.sessionID || "");
    if (sid) sessionMeta.set(sid, s);
  }
  const ordered = all.slice().sort(
    (left, right) =>
      Number(left?.info?.time?.created || 0) - Number(right?.info?.time?.created || 0),
  );
  const touched = new Set<string>();
  for (const message of ordered) {
    const info = message?.info;
    if (!info || typeof info !== "object") {
      throw new Error("hydrateConversationView: transcript message missing info");
    }
    const messageID = String(info.id || "");
    const sessionID = String(info.sessionID || "");
    if (!messageID || !sessionID) {
      throw new Error("hydrateConversationView: transcript message missing id/sessionID");
    }
    // No assistant-fallback (一个萝卜一个坑) — replay must reflect the same
    // role attribution the live event stream carries.
    const rawRole = info.role;
    if (typeof rawRole !== "string" || rawRole.length === 0) {
      throw new Error(`hydrateConversationView: message ${messageID} missing info.role`);
    }
    const role = rawRole;
    const rawResolvedRole = info.resolvedRole || info.agent || role;
    if (typeof rawResolvedRole !== "string" || rawResolvedRole.length === 0) {
      throw new Error(`hydrateConversationView: message ${messageID} missing resolvedRole/agent`);
    }
    const resolvedRole = String(rawResolvedRole);
    const meta = sessionMeta.get(sessionID);
    const parentSessionID = String(info.parentSessionID || meta?.parentSessionID || "");
    const goalID = String(info.goalID || meta?.goalID || "");
    const timeCreated = Number(info?.time?.created || 0);
    if (!(timeCreated > 0)) {
      throw new Error(`hydrateConversationView: message ${messageID} missing info.time.created`);
    }
    const completed =
      Number.isFinite(info?.time?.completed) && Number(info.time.completed) > 0;
    const stage = deriveSessionStage(info);
    if (stage === "filtered") continue;
    messages.set(messageID, {
      id: messageID,
      sessionID,
      role,
      resolvedRole,
      agent: String(info.agent || ""),
      parentSessionID,
      goalID,
      time: timeCreated,
      completed,
    });
    const session = ensureSession(sessionID, { stage, parentSessionID, goalID });
    session.messageIDs.add(messageID);
  const { cardID, isPhase, groupedIntoExistingCard } = ensureTurnCard(session, messageID, {
    stage,
    goalID,
    role: resolvedRole,
      time: timeCreated,
    stampServerTime: true,
    deferHierarchy: true,
  });
    if (isPhase || groupedIntoExistingCard) {
      ensureBoundaryPart(session, cardID, messageID, resolvedRole, timeCreated);
    }
    const parts = Array.isArray(message?.parts) ? message.parts : [];
    for (const part of parts) {
      const partID = String(part?.id || "");
      if (!partID) {
        throw new Error(`hydrateConversationView: message ${messageID} contains part without id`);
      }
      upsertPart(session, messageID, cardID, partID, { ...part });
    }
    touched.add(sessionID);
  }
  rebuildCardHierarchy();
  for (const sessionID of touched) {
    drainPendingIntegrity(sessionID);
    drainPendingSessionStatus(sessionID);
  }
}

/** Per-message boundary part — only used by phase-absorbed cards, which
 *  fold multiple sub-sessions / turns into one phase card and still need a
 *  visible per-turn separator. Top-level message-turn cards do NOT get a
 *  boundary: the card itself is the boundary (spec §3.1). */
function ensureBoundaryPart(
  session: SessionInfo,
  cardID: string,
  messageID: string,
  role: string,
  time: number,
): void {
  if (isUserStage(session.stage || role)) return;
  const boundaryKey = `__boundary__:${session.sessionID}:${messageID}`;
  if (session.partIndex.has(boundaryKey)) return;
  const part: any = {
    type: "boundary",
    role,
    roleLabel: roleLabel(role),
    time: time > 0 ? time : undefined,
  };
  const newIdx = appendSessionPart(cardID, part);
  session.partIndex.set(boundaryKey, { cardID, index: newIdx });
}

function upsertPart(
  session: SessionInfo,
  _messageID: string,
  cardID: string,
  partID: string,
  part: any,
): void {
  const existing = session.partIndex.get(partID);
  const sameCard = existing !== undefined && existing.cardID === cardID;
  const previousPart = sameCard
    ? cardTreeStore.cards[cardID]?.parts?.[existing!.index]
    : undefined;
  const normalizedPart = normalizeToolPartRecord(part, previousPart);
  if (sameCard) {
    setCardTreeStore("cards", cardID, "parts", existing!.index, normalizedPart);
    return;
  }
  const newIdx = appendSessionPart(cardID, normalizedPart);
  session.partIndex.set(partID, { cardID, index: newIdx });
}

function appendSessionPart(cardID: string, part: any): number {
  const current = cardTreeStore.cards[cardID]?.parts;
  if (!Array.isArray(current)) {
    throw new Error(`appendSessionPart: card ${cardID} missing parts array`);
  }
  const next = [...current, part];
  setCardTreeStore("cards", cardID, "parts", next);
  return next.length - 1;
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
    const board = boardStore.board;
    // Task request bubble (ctx:user-request).
    rebuildTaskContextCard(board);
    // Per-goal executor step cards (top-level) + their phase children.
    rebuildGoalStepCards(board);
    // Session-to-goal claiming.
    rebuildCardHierarchy();
    markCardTreeVisibleChanged();
  });
}

function rebuildTaskContextCard(board: any): void {
  const task = board?.task;
  if (!task?.request) {
    // No request → remove the card if present.
    if (cardTreeStore.cards["ctx:user-request"]) {
      setCardTreeStore(
        "cards",
        produce((c: Record<string, CardNode>) => {
          delete c["ctx:user-request"];
        }),
      );
    }
    return;
  }
  const taskCreated = Number(task?.time?.created || 0);
  if (!(taskCreated > 0)) {
    throw new Error(`task.time.created must be positive (got ${task?.time?.created}); server emitter is the single source of truth`);
  }
  const parts: any[] = [
    { id: "ctx:user-request:text", type: "text", text: String(task.request) },
  ];
  const attachments = Array.isArray(task.attachments) ? task.attachments : [];
  for (let i = 0; i < attachments.length; i++) {
    const a = attachments[i];
    const keySuffix = typeof a?.url === "string" && a.url ? a.url : `idx:${i}`;
    parts.push({
      id: `ctx:user-request:file:${keySuffix}`,
      type: "file",
      url: a?.url,
      mime: a?.mime,
      filename: a?.filename,
    });
  }
  setCardTreeStore("cards", "ctx:user-request", {
    id: "ctx:user-request",
    kind: "message",
    role: "user",
    title: t("chat.role.user"),
    parts,
    childIDs: [],
    time: taskCreated - 2,
  });
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
  const steps = Array.isArray(board?.workflow?.steps) ? board.workflow.steps : [];
  for (const s of steps) {
    if (String(s?.id) === stepID) return s;
  }
  return null;
}

function rebuildGoalStepCards(board: any): void {
  const goalWorkflows: any[] = Array.isArray(board?.goalWorkflows) ? board.goalWorkflows : [];

  // Refresh the per-goal "current attempt" map so session routing reads
  // the authoritative goalRunID. A goal whose tip has no id yet (pre-
  // dispatch) is left un-mapped → `"pre"` sentinel is used by the id
  // helpers, and the card flips to the real run id on the next rebuild
  // after dispatch.
  goalCurrentRunID.clear();
  for (const gw of goalWorkflows) {
    const gid = String(gw?.goalID || "");
    if (!gid) continue;
    const rid = typeof gw?.goalRunID === "string" && gw.goalRunID.length > 0 ? gw.goalRunID : undefined;
    if (rid) goalCurrentRunID.set(gid, rid);
  }

  // GC policy (per-attempt isolation):
  //   Historical attempt cards (same goalID, older goalRunID) MUST survive
  //   across rebuilds — they are the frozen record of prior tries. The
  //   only step cards we drop are those whose owning GOAL no longer
  //   exists on the board (goal deleted by modify_goal / plan revision).
  //   The prior policy ("drop any step card not in the current-tip alive
  //   set") collapsed every retry onto the same card id and is what the
  //   per-attempt isolation work is designed to remove.
  const liveGoalIDs = new Set<string>();
  for (const gw of goalWorkflows) {
    const gid = String(gw?.goalID || "");
    if (gid) liveGoalIDs.add(gid);
  }
  setCardTreeStore(
    "cards",
    produce((c: Record<string, CardNode>) => {
      for (const id of Object.keys(c)) {
        if (!id.startsWith("step:")) continue;
        const owningGoal = goalIDFromStepCardID(id);
        if (!owningGoal) { delete c[id]; continue; }
        if (!liveGoalIDs.has(owningGoal)) delete c[id];
      }
    }),
  );

  for (let i = 0; i < goalWorkflows.length; i++) {
    const gw = goalWorkflows[i];
    const gid = String(gw.goalID);
    const gRunID: string | undefined = typeof gw.goalRunID === "string" && gw.goalRunID.length > 0
      ? gw.goalRunID
      : undefined;
    const steps = Array.isArray(gw.steps) ? gw.steps : [];
    // Decomposition sequence: prefer the backend-authoritative orderIndex
    // (stable across later goal removals); fall back to the array position
    // only when the payload predates the orderIndex field.
    const orderIndex: number =
      typeof gw.orderIndex === "number" ? gw.orderIndex : i;
    for (const step of steps) {
      const stepID = String(step.stepID);
      const stepStartedAt = Number(step.startedAt || 0);
      // Lazy materialization: a step card is born when the executor
      // actually picks it up (goal_run.time_started is written). Before
      // that, rendering it would advertise work that hasn't started.
      if (!(stepStartedAt > 0)) continue;
      const stepCardID = goalStepCardID(gid, gRunID, stepID);
      const stepStatus = normalizeStepStatus(step.status);
      const phaseEntries = step.phases && typeof step.phases === "object" && !Array.isArray(step.phases)
        ? (step.phases as Record<string, { status?: string; startedAt?: number; completedAt?: number }>)
        : null;

      // Create phase subcards. Phase cards ABSORB their claimed session's
      // parts: once `ensureSessionCard` routes a goal-scope phase-mapped
      // session to a phase card, subsequent `message.part.*` events
      // accumulate `parts` on THIS card. Rebuilds therefore must NOT
      // clobber parts — only overlay the metadata from the board
      // (status/title/phaseID/sessionKind).
      const phaseChildIDs: string[] = [];
      const writePhaseCard = (
        phaseCardID: string,
        pid: string,
        label: string,
        sessionKind: string,
        status: CardStatus,
        startedAt: number,
      ) => {
        setCardTreeStore(
          "cards",
          produce((cards: Record<string, CardNode>) => {
            const prev = cards[phaseCardID];
            if (prev) {
              prev.stage = sessionKind || pid;
              prev.accent = stageAccent(sessionKind || pid);
              prev.status = status;
              prev.title = label;
              prev.phaseID = pid;
              prev.phaseSessionKind = sessionKind;
              // startedAt > 0 is invariant (caller filters pending phases).
              prev.time = startedAt;
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
                time: startedAt,
              };
            }
          }),
        );
      };

      if (phaseEntries) {
        // Look up the workflow-level step definition to get phase id ORDER
        // and labels (the per-goal payload is a record, not ordered).
        const workflowStep = findWorkflowStepDefinition(board, stepID);
        const phaseDefs: Array<{ id: string; label: string; sessionKind: string }> =
          workflowStep && Array.isArray(workflowStep.phases) ? workflowStep.phases : [];
        for (const pdef of phaseDefs) {
          const pid = String(pdef.id);
          const entry = phaseEntries[pid];
          const phaseStartedAt = Number(entry?.startedAt || 0);
          // Lazy materialization: a phase surfaces only once the backend
          // records its goal_run.time_started. Pending phases have no
          // birth time and must not preview in the timeline.
          if (!(phaseStartedAt > 0)) continue;
          const phaseCardID = goalPhaseCardID(gid, gRunID, stepID, pid);
          const phaseStatus = normalizeStepStatus(entry?.status);
          writePhaseCard(
            phaseCardID,
            pid,
            String(pdef.label || pid),
            String(pdef.sessionKind || ""),
            phaseStatus,
            phaseStartedAt,
          );
          phaseChildIDs.push(phaseCardID);
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
      });
    }
  }
}

function interactionCardTime(cardID: string): number {
  return Number(cardTreeStore.cards[cardID]?.time || 0);
}

function upsertInteractionCard(seed: { info: { id: string; role: string; time: { created: number } }; parts: any[] }): string {
  const seedID = String(seed?.info?.id || "");
  if (!seedID) throw new Error("interaction card seed missing info.id");
  const cardID = interactionCardID(seedID);
  const role = String(seed?.info?.role || "system");
  const time = Number(seed?.info?.time?.created || 0);
  if (!(time > 0)) {
    throw new Error(`interaction card seed ${seedID} missing info.time.created; server emitter is the single source of truth`);
  }
  const parts = Array.isArray(seed?.parts) ? seed.parts.slice() : [];
  setCardTreeStore("cards", cardID, {
    id: cardID,
    kind: "message",
    role,
    title: roleTitleKey(role),
    parts,
    childIDs: [],
    time,
  });
  return cardID;
}

function sessionTurnCardAtOrBefore(session: SessionInfo | undefined, time: number): string | undefined {
  if (!session) return undefined;
  let selectedCardID = "";
  let selectedTime = 0;
  for (const cardID of new Set(session.messageCardIDs.values())) {
    const card = cardTreeStore.cards[cardID];
    const cardTime = Number(card?.time || 0);
    if (!(cardTime > 0) || cardTime > time) continue;
    if (!selectedCardID || cardTime >= selectedTime) {
      selectedCardID = cardID;
      selectedTime = cardTime;
    }
  }
  return selectedCardID || undefined;
}

function rebuildInteractionCards(board: any): {
  bySessionCardID: Map<string, string[]>;
  topLevel: string[];
} {
  const knownSessionIDs = new Set<string>(sessions.keys());
  const { bySession, orphan } = partitionInteractions(board?.interactions, knownSessionIDs);
  const aliveCardIDs = new Set<string>();
  const bySessionCardID = new Map<string, string[]>();
  const topLevel: string[] = [];

  const addMessages = (items: any[], sessionID?: string) => {
    const ordered = (Array.isArray(items) ? items : [])
      .flatMap((interaction) => interactionToCardSeeds(interaction))
      .sort(
        (left, right) =>
          Number(left?.info?.time?.created || 0) - Number(right?.info?.time?.created || 0),
      );
    for (const seed of ordered) {
      const cardID = upsertInteractionCard(seed);
      aliveCardIDs.add(cardID);
      if (sessionID) {
        const session = sessions.get(sessionID);
        const interactionTime = Number(seed?.info?.time?.created || 0);
        // Attach to the latest turn that existed at the interaction time.
        // Rebuilds can run after newer turns appear; using activeCardID here
        // would make old prompts drift onto the newest card.
        const ownerCardID = sessionTurnCardAtOrBefore(session, interactionTime);
        if (!ownerCardID) {
          topLevel.push(cardID);
          continue;
        }
        const bucket = bySessionCardID.get(ownerCardID);
        if (bucket) bucket.push(cardID);
        else bySessionCardID.set(ownerCardID, [cardID]);
      } else {
        topLevel.push(cardID);
      }
    }
  };

  for (const [sessionID, claimed] of bySession.entries()) {
    addMessages(claimed, sessionID);
  }
  addMessages(orphan);

  setCardTreeStore(
    "cards",
    produce((cards: Record<string, CardNode>) => {
      for (const cardID of Object.keys(cards)) {
        if (!cardID.startsWith("interaction-card:")) continue;
        if (!aliveCardIDs.has(cardID)) delete cards[cardID];
      }
    }),
  );

  topLevel.sort((a, b) => interactionCardTime(a) - interactionCardTime(b));
  for (const ids of bySessionCardID.values()) {
    ids.sort((a, b) => interactionCardTime(a) - interactionCardTime(b));
  }
  return { bySessionCardID, topLevel };
}

function sessionSortTime(cardID: string | undefined): number {
  if (!cardID) return 0;
  const time = Number(cardTreeStore.cards[cardID]?.time || 0);
  return Number.isFinite(time) ? time : 0;
}

/** Display cards this session owns for hierarchy / visibility. Phase-
 *  absorbed sessions own NONE here — their parts live on the phase card,
 *  which is managed as a step child by rebuildGoalStepCards. Integrity
 *  has no messageCardIDs but pins activeCardID to its dedicated card. */
function sessionOwnedCardIDs(info: SessionInfo): string[] {
  if (isPhaseAbsorbedSession(info.stage, info.goalID)) return [];
  const ids = new Set<string>();
  for (const cid of info.messageCardIDs.values()) ids.add(cid);
  if (info.activeCardID) ids.add(info.activeCardID);
  return [...ids];
}

function pushUniqueChild(target: string[], childID: string): void {
  if (!childID || target.includes(childID)) return;
  target.push(childID);
}

function cardHasDisplayPart(card: CardNode | undefined): boolean {
  if (!card) return false;
  for (const part of card.parts || []) {
    if (!part || part.type === "boundary") continue;
    if (part.type === "text" || part.type === "reasoning") {
      if (String(part.text || "").replace(/[\[\]\s]/g, "")) return true;
      continue;
    }
    return true;
  }
  return false;
}

function syncExecutorTopLevelVisibility(session: SessionInfo | undefined): void {
  if (!session || session.stage !== "executor") return;
  // Executor container session has no LLM of its own; surface only the
  // turn cards that actually received visible parts (spec §4.3).
  let visible = false;
  for (const cid of sessionOwnedCardIDs(session)) {
    if (cardHasDisplayPart(cardTreeStore.cards[cid])) { visible = true; break; }
  }
  if (session.executorTopLevelVisible === visible) return;
  session.executorTopLevelVisible = visible;
  rebuildTopLevelOrder();
}

function rebuildCardHierarchy(): void {
  // batch ensures that the interaction-card GC inside rebuildInteractionCards
  // and the final childIDs write at the bottom of this function are visible
  // atomically to downstream reactions. Otherwise a parent card can be
  // observed holding a `childIDs` entry whose corresponding child was just
  // deleted by the GC, causing visibleChildIDsForCard to throw
  // "references missing child …".
  batch(() => rebuildCardHierarchyImpl());
}

function rebuildCardHierarchyImpl(): void {
  const nextChildIDs = new Map<string, string[]>();
  const goalWorkflows: any[] = Array.isArray(boardStore.board?.goalWorkflows)
    ? boardStore.board.goalWorkflows
    : [];
  const interactions = rebuildInteractionCards(boardStore.board);

  for (const gw of goalWorkflows) {
    const gid = String(gw?.goalID || "");
    if (!gid) continue;
    const gRunID: string | undefined = typeof gw?.goalRunID === "string" && gw.goalRunID.length > 0
      ? gw.goalRunID
      : undefined;
    const steps = Array.isArray(gw?.steps) ? gw.steps : [];
    for (const step of steps) {
      const stepID = String(step?.stepID || "");
      if (!stepID) continue;
      const stepCard = goalStepCardID(gid, gRunID, stepID);
      if (!cardTreeStore.cards[stepCard]) continue;

      // Step's children = phase cards (in declared order) when the step
      // has phases; otherwise empty. Session claims append under phase
      // cards, NOT step cards — the 3-level hierarchy is step (top-level,
      // per-goal executor) → phase → session.
      const workflowStep = findWorkflowStepDefinition(boardStore.board, stepID);
      const phaseDefs: Array<{ id?: string }> = workflowStep && Array.isArray(workflowStep.phases)
        ? workflowStep.phases
        : [];
      const stepChildren: string[] = [];
      for (const pdef of phaseDefs) {
        const pid = String(pdef?.id || "");
        if (!pid) continue;
        const phaseCard = goalPhaseCardID(gid, gRunID, stepID, pid);
        if (!cardTreeStore.cards[phaseCard]) continue;
        pushUniqueChild(stepChildren, phaseCard);
        nextChildIDs.set(phaseCard, []);
      }
      nextChildIDs.set(stepCard, stepChildren);
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
  );
  for (const info of orderedSessions) {
    for (const cid of sessionOwnedCardIDs(info)) {
      if (cardTreeStore.cards[cid]) nextChildIDs.set(cid, nextChildIDs.get(cid) || []);
    }
  }
  for (const [sessionCardID, childIDs] of interactions.bySessionCardID.entries()) {
    const bucket = nextChildIDs.get(sessionCardID) || [];
    for (const childID of childIDs) {
      pushUniqueChild(bucket, childID);
      nextChildIDs.set(childID, nextChildIDs.get(childID) || []);
    }
    nextChildIDs.set(sessionCardID, bucket);
  }
  for (const childID of interactions.topLevel) {
    nextChildIDs.set(childID, nextChildIDs.get(childID) || []);
  }

  // Integrity verdict cards attach under their owning requirements session.
  // If the session hasn't arrived yet (unordered replay, or CLI dry-run with
  // no session), the card stays pending — it will NOT fall through to the
  // top level (card escape is forbidden).
  for (const [cardID, ownerSessionID] of integrityCardOwners.entries()) {
    if (!cardTreeStore.cards[cardID]) continue;
    const owner = sessions.get(ownerSessionID);
    const ownerCardID = owner?.activeCardID;
    if (!ownerCardID || !cardTreeStore.cards[ownerCardID]) continue;
    const bucket = nextChildIDs.get(ownerCardID) || [];
    pushUniqueChild(bucket, cardID);
    nextChildIDs.set(ownerCardID, bucket);
    nextChildIDs.set(cardID, nextChildIDs.get(cardID) || []);
  }

  setCardTreeStore(
    "cards",
    produce((cards: Record<string, CardNode>) => {
      // Reset every session-owned turn card's childIDs from nextChildIDs so
      // a removed interaction child is cleared, not left dangling.
      for (const info of sessions.values()) {
        for (const cid of sessionOwnedCardIDs(info)) {
          if (cards[cid]) cards[cid].childIDs = nextChildIDs.get(cid) || [];
        }
      }
      for (const [cardID, childIDs] of nextChildIDs.entries()) {
        if (cards[cardID]) cards[cardID].childIDs = childIDs;
      }
    }),
  );

  rebuildTopLevelOrder();
}

function normalizeStepStatus(raw: any): CardStatus {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "pending" || s === "running" || s === "completed" || s === "error" || s === "skipped") {
    return s as CardStatus;
  }
  if (s === "failed" || s === "fail") return "error";
  if (s === "passed" || s === "done" || s === "ok") return "completed";
  return "pending";
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
  const claimedChildIDs = new Set<string>();
  for (const node of Object.values(cardTreeStore.cards)) {
    for (const childID of node.childIDs || []) claimedChildIDs.add(childID);
  }

  // Hide path: only the executor container's empty turn cards. Phase-
  // absorbed sessions never produce a top-level turn card (their parts
  // accumulate on the phase card, a step child); goalID threading at the
  // source keeps build/planner parts off any orphan top-level card.
  const hiddenSessionCardIDs = new Set<string>();
  for (const info of sessions.values()) {
    if (info.stage !== "executor") continue;
    for (const cid of sessionOwnedCardIDs(info)) {
      if (!cardHasDisplayPart(cardTreeStore.cards[cid])) hiddenSessionCardIDs.add(cid);
    }
  }

  const order: string[] = [];
  for (const cardID of Object.keys(cardTreeStore.cards)) {
    if (claimedChildIDs.has(cardID)) continue;
    if (hiddenSessionCardIDs.has(cardID)) continue;
    const card = cardTreeStore.cards[cardID];
    if (!card) continue;
    // Phase / integrity / tool cards must never appear at top level. They
    // belong under their container; reaching here unclaimed means the
    // hierarchy is mid-rebuild, so we drop them rather than let them
    // "escape" (身份规则 §card-escape).
    if (card.kind === "phase" || card.kind === "integrity" || card.kind === "tool") continue;
    order.push(cardID);
  }

  order.sort((a, b) => {
    const ca = cardTreeStore.cards[a];
    const cb = cardTreeStore.cards[b];
    // Contract: every top-level card carries a numeric `time` (see
    // CardNode.time in store/card-tree.ts). An undefined here means a
    // creation path leaked through without stamping a birth time — that
    // is a bug in the writer, not a condition to paper over with an
    // end-of-list fallback.
    if (typeof ca?.time !== "number") throw new Error(`rebuildTopLevelOrder: card ${a} missing numeric time`);
    if (typeof cb?.time !== "number") throw new Error(`rebuildTopLevelOrder: card ${b} missing numeric time`);
    return ca.time - cb.time;
  });

  setCardTreeStore("order", order);
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
  rebuildBoardDerivedCards();
});
rebuildBoardDerivedCards();

// Synthetic-message projection removed: chat.ts no longer writes
// duplicate placeholders into messageStore.messages (the
// optimistic user bubble now comes through ingestPersistedMessage with
// the real server-issued message id). Interactions are projected directly
// into cardTreeStore via rebuildInteractionCards/upsertInteractionCard.
// One source per card; no parallel mirror to keep in sync.
