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

import { createEffect, createRoot } from "solid-js";
import { produce } from "solid-js/store";
import { cardTreeStore, setCardTreeStore, type CardNode, type CardStatus } from "../store/card-tree";
import { boardStore } from "../store/board";
import { messageStore } from "../store/messages";
import { agentStageLabel, normalizeAgentRole, roleLabel } from "../utils/message";
import { stageAccent } from "../utils/card-color";
import { t } from "../utils/i18n";

/** Raw i18n key for a role/stage, normalized so that backend variants
 *  ("design_analysis", "design_analyst", "design-analysis") all resolve
 *  to the same canonical key (`chat.role.design-analyst`). The key is
 *  stored on the card; CardHeader calls `t()` at render time, keeping
 *  titles reactive to locale switches. */
function roleTitleKey(name: string): string {
  return `chat.role.${normalizeAgentRole(name)}`;
}
import { interactionToSyntheticMessages, partitionInteractions } from "../utils/interaction";
import {
  isSubagentPhaseCompletedEventType,
  isTreeWriterNoopEventType,
  isTreeWriterPassThroughEventType,
} from "./event-policy";
import { goalStagePhaseID } from "../utils/workflow-step";

// ── Internal indices ──

interface SessionInfo {
  sessionID: string;
  stage: string;
  parentSessionID: string;
  goalID: string;
  /** ids of messages that landed in this session's bucket, preserved to derive status. */
  messageIDs: Set<string>;
  /** part id → index into cardTreeStore.cards[cardID].parts — O(1) lookup for updates. */
  partIndex: Map<string, number>;
  /** Session-level card id (`<stage>:session:<sid>`). */
  cardID: string;
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
/** Fidelity cards that have been materialized into cardTreeStore → owning
 *  requirements session id. `rebuildCardHierarchy` reads this to attach the
 *  verdict card under the session card's childIDs. Entries are ONLY added
 *  from `materializeFidelity` (after the owning session is confirmed to
 *  exist), so every entry here has a reachable parent — eliminating the
 *  "written-to-store-but-unreachable" silent-drop path. */
const fidelityCardOwners = new Map<string, string>();

/** Fidelity events that arrived before their owning session's first
 *  message.updated. Keyed by sessionID so ensureSessionCard can drain a
 *  single pending payload per session. Holding the raw payload here (NOT in
 *  cardTreeStore.cards) preserves the invariant "every entry in
 *  cardTreeStore.cards is reachable via order or some parent's childIDs" —
 *  a fidelity event that never finds its session stays in this map until
 *  resetWriter() clears it, never materializing into an unreachable ghost. */
interface PendingFidelityPayload {
  taskID: string;
  emittedAt: number;
  verdict: "faithful" | "needs_correction";
  issues: Array<{ type: string; description: string }>;
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
const pendingFidelity = new Map<string, PendingFidelityPayload>();

/** Subagent terminal status buffered until the owning session materializes.
 *  Phase-completion events (requirements.completed, architect.completed,
 *  design_analysis.completed) arrive AFTER the subagent runs, but on a
 *  reconnect replay they may reach the writer before the session's first
 *  `message.updated` in the normalized stream order. Same pattern as
 *  `pendingFidelity` — held out-of-band, drained by `ensureSessionCard`. */
const pendingSubagentTerminal = new Map<string, "completed" | "error">();

// ── Entry point ──

/** Reset all writer state + cardTreeStore. Called on task switch and in tests. */
export function resetWriter(): void {
  sessions.clear();
  messages.clear();
  knownGoalIDs.clear();
  fidelityCardOwners.clear();
  pendingFidelity.clear();
  runningFidelity.clear();
  pendingSubagentTerminal.clear();
  // Drop every key explicitly — plain assignment on a store merges instead of
  // replacing (see setMessages's messagesBySession fix in store/messages.ts).
  setCardTreeStore("order", []);
  setCardTreeStore(
    "cards",
    produce((c: Record<string, CardNode>) => {
      for (const k of Object.keys(c)) delete c[k];
    }),
  );
}

/** Message ids we've already mirrored from messageStore → cardTreeStore so
 *  the synthetic-projection effect stays idempotent across re-runs. */
const syntheticMirrorIDs = new Set<string>();

function isSyntheticMessage(message: any): boolean {
  if (!message) return false;
  if (message._synthetic === true) return true;
  const id = typeof message?.info?.id === "string" ? message.info.id : "";
  return id.startsWith("pending-") || id.startsWith("ctx:");
}

function syntheticCardID(messageID: string): string {
  return `synthetic:${messageID}`;
}

function projectSyntheticMessages(allMessages: any[]): void {
  // Compute the new set of ids we should be mirroring.
  const alive = new Set<string>();
  for (const m of allMessages) {
    if (!isSyntheticMessage(m)) continue;
    const id = String(m?.info?.id || "");
    if (!id) continue;
    alive.add(id);
  }

  // Remove cards for messages that are no longer synthetic / present.
  const removedIDs: string[] = [];
  for (const id of syntheticMirrorIDs) {
    if (alive.has(id)) continue;
    const cardID = syntheticCardID(id);
    if (cardTreeStore.cards[cardID]) {
      setCardTreeStore(
        "cards",
        produce((c: Record<string, CardNode>) => {
          delete c[cardID];
        }),
      );
      removedIDs.push(cardID);
    }
    syntheticMirrorIDs.delete(id);
  }

  // Upsert cards for currently-synthetic messages.
  for (const m of allMessages) {
    if (!isSyntheticMessage(m)) continue;
    const id = String(m?.info?.id || "");
    if (!id) continue;
    const cardID = syntheticCardID(id);
    const role = String(m?.info?.role || "assistant");
    const time = Number(m?.info?.time?.created || 0);
    const parts = Array.isArray(m.parts) ? m.parts.slice() : [];
    setCardTreeStore("cards", cardID, {
      id: cardID,
      kind: "message",
      role,
      title: roleTitleKey(role),
      parts,
      childIDs: [],
      time: time > 0 ? time : undefined,
    });
    syntheticMirrorIDs.add(id);
  }

  // Re-emit order so synthetic cards surface (or disappear) alongside
  // structured cards. They sort chronologically among top-level entries.
  rebuildTopLevelOrder();
}

/** Top-level dispatcher. Unknown event types throw by design (rule 1:
 *  let-it-crash). Keeping the branches close together makes coverage
 *  auditable — every event type the overlay processes lives here. */
export function applyEvent(event: any): void {
  const type: string = String(event?.type || "");
  if (!type) throw new Error("tree-writer: event missing type");

  // ── Message stream ──
  if (type === "message.updated") return handleMessageUpdated(event);
  if (type === "message.part.updated") return handlePartUpdated(event);
  if (type === "message.part.delta") return handlePartDelta(event);

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
  if (type === "interaction.created" || type === "interaction.resolved") {
    return handleInteraction(event);
  }

  // ── Fidelity review lifecycle ──
  // started/progress put a running placeholder card under the requirements
  // session (kind="fidelity", status="running"), so the operator sees the
  // non-streaming LLM review in flight during its 60–180s window. completed
  // upserts the same cardID with the parsed verdict / issues / corrections.
  // Identity is `fidelity:<taskID>` (stable per task) so all three events
  // land on the same card.
  if (type === "fidelity.review.started") {
    return handleFidelityStarted(event);
  }
  if (type === "fidelity.review.progress") {
    return handleFidelityProgress(event);
  }
  if (type === "fidelity.review.chunk") {
    return handleFidelityChunk(event);
  }
  if (type === "fidelity.review.completed") {
    return handleFidelityCompleted(event);
  }

  // ── Subagent phase completion ──
  // requirements / architect / design_analysis emit a phase-completed event
  // with `sessionID` + `status` at the exact moment their subagent returns.
  // The writer flips the owning session card out of `running` — without this
  // every subagent card spins forever (session cards have no other terminal
  // signal; see specs/new-arch/07-panel-reactivity.md §session 终态).
  if (isSubagentPhaseCompletedEventType(type)) {
    return handleSubagentPhaseCompleted(event);
  }

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

function sessionCardID(stage: string, sid: string): string {
  return `${stage}:session:${sid}`;
}

/** Per-goal executor step card. Each goal has exactly one goal-scope step
 *  (see workflow.ts — the `build` step, labelled "Executor", is the only
 *  `scope: "goal"` entry in the pipeline). The step card surfaces at the
 *  top level of the conversation — there is no intermediate goal-group
 *  container. Goal title, decomposition index (#N), and description all
 *  live on this card. */
function goalStepCardID(goalID: string, stepID: string): string {
  return `step:${goalID}:${stepID}`;
}

function goalPhaseCardID(goalID: string, stepID: string, phaseID: string): string {
  return `${goalStepCardID(goalID, stepID)}:phase:${phaseID}`;
}

/** A card ID is a top-level executor step iff it matches `step:<gid>:<stepID>`
 *  exactly — the phase variants add a `:phase:<pid>` suffix, and old
 *  `goal-group:` ids were removed entirely in the 2026-04-19 flatten. */
function isTopLevelStepCardID(id: string): boolean {
  return id.startsWith("step:") && !id.includes(":phase:");
}

function interactionCardID(messageID: string): string {
  return `interaction-card:${messageID}`;
}

function partCardPath(sid: string, idx: number): ["cards", string, "parts", number] {
  const info = sessions.get(sid);
  if (!info) throw new Error(`tree-writer: no session info for ${sid}`);
  return ["cards", info.cardID, "parts", idx] as any;
}

// ── Handlers ──

function handleMessageUpdated(event: any): void {
  const info = propsOf(event).info;
  if (!info || typeof info !== "object") throw new Error("message.updated missing info");

  const id = String(info.id || "");
  const sessionID = String(info.sessionID || "");
  if (!id || !sessionID) throw new Error("message.updated info missing id/sessionID");

  const role = String(info.role || "");
  const resolvedRole = String(info.resolvedRole || info.agent || role || "assistant");
  const agent = String(info.agent || "");
  const parentSessionID = String(info.parentSessionID || "");
  const goalID = String(info.goalID || "");
  const timeCreated = Number(info?.time?.created || 0);
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

  // Ensure the session's card exists.
  ensureSessionCard(sessionID, {
    stage: deriveSessionStage(info, resolvedRole, agent, role),
    parentSessionID,
    goalID,
    time: timeCreated,
  });

  // Register the message under the session so status derivation sees it.
  const session = sessions.get(sessionID)!;
  session.messageIDs.add(id);
  if (parentSessionID && !session.parentSessionID) session.parentSessionID = parentSessionID;
  if (goalID && !session.goalID) session.goalID = goalID;

  // Insert a boundary part for THIS message so the renderer's CardParts
  // draws a timeline separator between successive agent invocations. The
  // orchestrator session is long-lived: every re-invocation (trigger=
  // goal_completed / delivery_rejected / ...) writes a new assistant
  // message into the SAME session. Prior impl deduped by sessionID, which
  // meant the card had one boundary at the very top and all N turns' parts
  // piled in afterwards with no visible split — the whole card read as
  // "one big blob". Deduping by messageID gives one boundary per agent
  // turn (stamped with the message's creation time), so the timeline is
  // legible. Single-message sub-agent sessions (requirements / architect /
  // design-analyst / delivery) still show exactly one boundary, unchanged.
  ensureBoundaryPart(sessionID, id, resolvedRole, timeCreated);
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

  // Session card may not yet exist if the message.updated for this part
  // hasn't been processed; create it defensively based on sessionID alone.
  if (!sessions.has(sessionID)) {
    ensureSessionCard(sessionID, {
      stage: "", // unknown until message.updated arrives; will be backfilled
      parentSessionID: "",
      goalID: "",
      time: 0,
    });
  }

  upsertPart(sessionID, partID, { ...part });
}

function handlePartDelta(event: any): void {
  const p = propsOf(event);
  const partID = String(p.partID || "");
  const messageID = String(p.messageID || "");
  const sessionID = String(p.sessionID || "");
  const field = String(p.field || "");
  const delta = typeof p.delta === "string" ? p.delta : "";
  if (!partID || !sessionID || !field) {
    throw new Error("message.part.delta missing partID/sessionID/field");
  }

  const session = sessions.get(sessionID);
  if (!session) throw new Error(`message.part.delta: unknown session ${sessionID}`);
  const idx = session.partIndex.get(partID);
  if (idx === undefined) {
    throw new Error(`message.part.delta: unknown part ${partID} in session ${sessionID}`);
  }

  // Append delta to the named field in-place.
  setCardTreeStore(
    "cards",
    session.cardID,
    "parts",
    idx,
    field as any,
    (prev: any) => String(prev ?? "") + delta,
  );
}

function handleTaskChanged(event: any): void {
  // Source of truth for task.request + goalWorkflows is boardStore.board — the
  // live overlay writes to it via applyBoardDelta / loadBoard, tests write via
  // the replay harness. Tree-writer just projects the current boardStore view
  // into cardTreeStore; it does NOT read the event payload directly.
  rebuildBoardDerivedCards();
  applyOrchestratorRootTerminal();
}

/** Orchestrator root sessions (no parentSessionID, no goalID) don't have a
 *  phase-completion event — they can accumulate tool rounds for the whole
 *  task lifetime. Their terminal signal is the task itself going terminal.
 *  We read `boardStore.board.task.status` rather than the event payload so
 *  late-arriving reconnect replays and HTTP refetches of the board both
 *  trigger the same convergence. Idempotent: only writes when the card is
 *  still `running`. */
function applyOrchestratorRootTerminal(): void {
  const task = (boardStore.board as any)?.task;
  if (!task) return;
  const raw = String(task?.status || "").toLowerCase();
  const isTerminal = raw === "completed" || raw === "failed" || raw === "cancelled";
  if (!isTerminal) return;
  const target: CardStatus = raw === "completed" ? "completed" : "error";
  setCardTreeStore(
    "cards",
    produce((cards: Record<string, CardNode>) => {
      for (const info of sessions.values()) {
        if (info.parentSessionID) continue;
        if (info.goalID) continue;
        const card = cards[info.cardID];
        if (!card || card.status !== "running") continue;
        card.status = target;
      }
    }),
  );
}

function handleSubagentPhaseCompleted(event: any): void {
  const type = String(event?.type || "");
  const props = propsOf(event);
  const sessionID = String(props.sessionID || "");
  const status = String(props.status || "");
  if (!sessionID) {
    throw new Error(`${type} missing sessionID`);
  }
  if (status !== "completed" && status !== "error") {
    throw new Error(`${type} invalid status "${status}"`);
  }
  const info = sessions.get(sessionID);
  if (!info || !cardTreeStore.cards[info.cardID]) {
    // Session card not yet materialized — hold until ensureSessionCard runs.
    // Mirrors the pendingFidelity pattern; drained in ensureSessionCard.
    pendingSubagentTerminal.set(sessionID, status);
    return;
  }
  writeSessionTerminalStatus(info.cardID, status);
}

function writeSessionTerminalStatus(cardID: string, status: "completed" | "error"): void {
  setCardTreeStore("cards", cardID, "status", status);
}

/** Drain any terminal status buffered for this session. Called from
 *  ensureSessionCard after the session is committed, parallel to
 *  drainPendingFidelity. */
function drainPendingSubagentTerminal(sessionID: string): void {
  const status = pendingSubagentTerminal.get(sessionID);
  if (!status) return;
  const session = sessions.get(sessionID);
  if (!session || !cardTreeStore.cards[session.cardID]) return;
  pendingSubagentTerminal.delete(sessionID);
  writeSessionTerminalStatus(session.cardID, status);
}

function handleInteraction(event: any): void {
  // Interactions are sourced from boardStore.board.interactions, not the event
  // payload — the board routes handle the write, we reproject.
  rebuildBoardDerivedCards();
}

// ── Fidelity review ──

function fidelityCardID(taskID: string): string {
  // Stable per-task id — fidelity runs once per requirements cycle; re-emits
  // (parse retries, reconnect replays) must upsert the same card, not stack
  // new ones. The previous `fidelity:<taskID>:<emittedAt>` scheme produced
  // duplicates whenever event.emittedAt was absent and we fell back to
  // Date.now(), which happened on every SSE redelivery.
  return `fidelity:${taskID}`;
}

/** Buffered running-phase payload so `rebuildCardHierarchy` can re-attach a
 *  running card if its owning requirements session card disappears + reappears
 *  (task reselect / replay). Keyed by taskID. Separate from `pendingFidelity`
 *  because that map is for COMPLETED payloads that predate their session. */
interface RunningFidelityPayload {
  taskID: string
  sessionID: string
  startedAt: number
  attempt: number
  elapsedMs: number
}
const runningFidelity = new Map<string, RunningFidelityPayload>()

function handleFidelityStarted(event: any): void {
  const props = propsOf(event);
  const taskID = String(props.taskID || "");
  const sessionID = String(props.sessionID || "");
  if (!taskID) throw new Error("fidelity.review.started missing taskID");
  if (!sessionID) {
    throw new Error(
      `fidelity.review.started missing sessionID (taskID=${taskID})`,
    );
  }
  const emittedAt = Number(event?.emittedAt || event?.emitted_at || 0);
  const payload: RunningFidelityPayload = {
    taskID,
    sessionID,
    startedAt: emittedAt > 0 ? emittedAt : Date.now(),
    attempt: 0,
    elapsedMs: 0,
  };
  runningFidelity.set(taskID, payload);
  materializeRunningFidelity(payload);
}

function handleFidelityProgress(event: any): void {
  const props = propsOf(event);
  const taskID = String(props.taskID || "");
  const sessionID = String(props.sessionID || "");
  if (!taskID) throw new Error("fidelity.review.progress missing taskID");
  if (!sessionID) {
    throw new Error(
      `fidelity.review.progress missing sessionID (taskID=${taskID})`,
    );
  }
  const attempt = Number(props.attempt || 0);
  const elapsedMs = Number(props.elapsedMs || props.elapsed_ms || 0);
  const existing = runningFidelity.get(taskID);
  const payload: RunningFidelityPayload = {
    taskID,
    sessionID,
    startedAt: existing?.startedAt ?? (Date.now() - elapsedMs),
    attempt,
    elapsedMs,
  };
  runningFidelity.set(taskID, payload);
  materializeRunningFidelity(payload);
}

/** Append a reasoning delta onto the running fidelity card. The backend
 *  (`requirements/fidelity.ts` createFidelityChunkForwarder) emits
 *  FidelityReviewChunk at ~2 Hz with accumulated 500ms batches. One stable
 *  part per attempt — a Zod-retry boundary opens a fresh reasoning part,
 *  same-attempt chunks append to the existing part.
 *
 *  Only `kind: "reasoning"` is valid. tool-input deltas are intentionally
 *  NOT forwarded by the backend (they're protocol payload — the verdict
 *  lands structured via FidelityReviewCompleted).
 *
 *  Silently skips when the card has already upgraded to the completed
 *  verdict state (card.fidelity populated) — late chunks after Completed
 *  lands would otherwise pollute the verdict render. */
function handleFidelityChunk(event: any): void {
  const props = propsOf(event);
  const taskID = String(props.taskID || "");
  const sessionID = String(props.sessionID || "");
  if (!taskID) throw new Error("fidelity.review.chunk missing taskID");
  if (!sessionID) {
    throw new Error(
      `fidelity.review.chunk missing sessionID (taskID=${taskID})`,
    );
  }
  const kind = String(props.kind || "");
  const delta = String(props.delta || "");
  const attempt = Number(props.attempt || 1);
  if (kind !== "reasoning") {
    throw new Error(`fidelity.review.chunk unexpected kind: ${kind}`);
  }
  if (!delta) return;

  const cardID = fidelityCardID(taskID);
  const existing = cardTreeStore.cards[cardID];
  // Completed event already upserted the verdict — ignore trailing chunks.
  if (existing?.fidelity) return;
  // Started must fire before Chunk. If the card is missing, this is a
  // backend ordering bug (chunk before started) — loud-fail per rule 1.
  if (!existing) {
    throw new Error(
      `fidelity.review.chunk arrived before started (taskID=${taskID})`,
    );
  }

  const partID = `fidelity:${taskID}:reasoning:${attempt}`;

  setCardTreeStore(
    "cards",
    cardID,
    "parts",
    produce((parts: any[]) => {
      const idx = parts.findIndex((p) => p?.partID === partID);
      if (idx >= 0) {
        parts[idx] = { ...parts[idx], text: (parts[idx].text || "") + delta };
      } else {
        parts.push({ type: "reasoning", partID, text: delta });
      }
    }),
  );
}

/** Upsert the running-phase fidelity card. If the owning requirements session
 *  isn't in `sessions` yet (SSE reorder / replay), we still write the card
 *  WITHOUT an owner — `rebuildCardHierarchy` will place it under the session
 *  once it materialises via the `fidelityCardOwners` map. This matches how
 *  the completed path handles the same race, just inverted (we always have a
 *  card, possibly orphaned momentarily, vs. completed's out-of-band hold). */
function materializeRunningFidelity(p: RunningFidelityPayload): void {
  const cardID = fidelityCardID(p.taskID);
  const existing = cardTreeStore.cards[cardID];
  // If the completed event has already landed, don't downgrade the verdict
  // card back to "running". `attempts` on a completed card is > 0 and the
  // `fidelity` payload is populated — that's how we tell.
  if (existing && existing.fidelity) return;
  const elapsedSec = Math.max(0, Math.round(p.elapsedMs / 1000));
  const subtitle = p.attempt > 0
    ? `attempt ${p.attempt} · ${formatElapsed(elapsedSec)}`
    : formatElapsed(elapsedSec);
  // Progress ticks every 20s. If the card already exists, patch only the
  // volatile fields (status + subtitle) — writing a fresh card with
  // `parts: []` would wipe any reasoning/tool_input chunks that have
  // streamed in between two Progress events.
  if (existing) {
    setCardTreeStore("cards", cardID, {
      status: "running",
      subtitle,
    });
    fidelityCardOwners.set(cardID, p.sessionID);
    return;
  }
  setCardTreeStore("cards", cardID, {
    id: cardID,
    kind: "fidelity",
    stage: "fidelity",
    accent: stageAccent("fidelity"),
    status: "running",
    title: roleTitleKey("fidelity"),
    subtitle,
    parts: [],
    childIDs: [],
    time: p.startedAt,
  });
  fidelityCardOwners.set(cardID, p.sessionID);
  rebuildCardHierarchy();
}

function formatElapsed(sec: number): string {
  if (sec < 60) return `${sec}s elapsed`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return s === 0 ? `${m}m elapsed` : `${m}m ${s}s elapsed`;
}

function handleFidelityCompleted(event: any): void {
  const props = propsOf(event);
  const taskID = String(props.taskID || "");
  const sessionID = String(props.sessionID || "");
  if (!taskID) throw new Error("fidelity.review.completed missing taskID");
  if (!sessionID) {
    // sessionID became required (engine/model.ts) — loud-fail rather than
    // allowing the card to escape or silently drop. The matching assertion
    // in opencorvus/requirements/fidelity.ts emitFidelityEvent keeps the
    // backend honest.
    throw new Error(
      `fidelity.review.completed missing sessionID (taskID=${taskID})`,
    );
  }

  const emittedAt = Number(event?.emittedAt || event?.emitted_at || 0);
  const issues = Array.isArray(props.issues) ? props.issues : [];
  const corrections = Array.isArray(props.corrections) ? props.corrections : [];
  const missingGoals = Array.isArray(props.missingGoals) ? props.missingGoals : [];
  const attempts = Number(props.attempts || 0);
  const verdict: "faithful" | "needs_correction" =
    props.verdict === "faithful" ? "faithful" : "needs_correction";

  const payload: PendingFidelityPayload = {
    taskID,
    emittedAt,
    verdict,
    issues: issues.map((i: any) => ({
      type: String(i?.type || "uncovered"),
      description: String(i?.description || ""),
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

  const session = sessions.get(sessionID);
  if (!session || !cardTreeStore.cards[session.cardID]) {
    // Session hasn't materialized yet — hold the payload out-of-band. This
    // keeps cardTreeStore.cards free of unreachable entries. Drained by
    // ensureSessionCard once the session arrives (see drainPendingFidelity).
    pendingFidelity.set(sessionID, payload);
    return;
  }

  materializeFidelity(session, payload);
  // Running-card lifecycle: the completed upsert now owns this cardID; drop
  // the runningFidelity entry so a late `progress` event for the same task
  // doesn't rewrite the verdict back to a running placeholder.
  runningFidelity.delete(taskID);
}

/** Atomically write the fidelity card into cardTreeStore and register its
 *  owning session. Only called when the owning session card already exists
 *  — callers MUST NOT skip the session guard. `rebuildCardHierarchy()` is
 *  invoked so the new card becomes a child of its session in the same tick. */
function materializeFidelity(session: SessionInfo, p: PendingFidelityPayload): void {
  const cardID = fidelityCardID(p.taskID);
  const status: CardStatus = p.verdict === "faithful" ? "completed" : "error";
  // FidelityBody renders the structured verdict block from `fidelity`;
  // the parts array stays empty.
  setCardTreeStore("cards", cardID, {
    id: cardID,
    kind: "fidelity",
    stage: "fidelity",
    accent: stageAccent("fidelity"),
    status,
    title: roleTitleKey("fidelity"),
    subtitle: undefined,
    parts: [],
    childIDs: [],
    time: p.emittedAt > 0 ? p.emittedAt : undefined,
    fidelity: {
      verdict: p.verdict,
      issues: p.issues,
      corrections: p.corrections,
      missingGoals: p.missingGoals,
      attempts: p.attempts,
    },
  });
  fidelityCardOwners.set(cardID, session.sessionID);
  rebuildCardHierarchy();
}

/** Drain any fidelity payload waiting for this session and materialize it.
 *  Called from ensureSessionCard immediately after the session is committed
 *  so a fidelity event that arrived first is flushed in the same batch. */
function drainPendingFidelity(sessionID: string): void {
  const payload = pendingFidelity.get(sessionID);
  if (!payload) return;
  const session = sessions.get(sessionID);
  if (!session || !cardTreeStore.cards[session.cardID]) return;
  pendingFidelity.delete(sessionID);
  materializeFidelity(session, payload);
}

// ── Session & part bookkeeping ──

function deriveSessionStage(info: any, resolvedRole: string, agent: string, role: string): string {
  // Mirrors the old-pipeline choice order in `buildSessionBucketCard` —
  // `info.channel` wins when set (bridge-stamped), then agent/resolvedRole.
  // Root orchestrator sessions use the "assistant" stage fall-through.
  const stage = String(info?.channel || "").trim();
  if (stage && stage !== "main" && stage !== "filtered") return stage;
  if (agent) return agent.trim();
  if (resolvedRole && resolvedRole !== "user" && resolvedRole !== "system") {
    return resolvedRole.trim();
  }
  return role.trim() || "assistant";
}

interface EnsureSessionOpts {
  stage: string;
  parentSessionID: string;
  goalID: string;
  time: number;
}

/** Resolve the cardID a session should write its parts to. For goal-scope
 *  sessions whose stage maps to a declared phase (planner → plan,
 *  build → build, evaluator → evaluate), this IS the phase card — the
 *  session does NOT get its own card. Parts accumulate directly on the
 *  phase card, which eliminates the parent-child label mirror (phase
 *  "Build" + nested session "构建") that confused users.
 *
 *  Non-phase sessions (assistant orchestrator, requirements, architect,
 *  design-analyst, delivery, and the executor container) fall through to
 *  the standard `<stage>:session:<sid>` id. The executor container still
 *  gets its own id but is filtered out of rendering in rebuildTopLevelOrder.
 *
 *  When the phase card doesn't yet exist (reconnect replay arriving
 *  before the board's goalWorkflows lands), a minimal stub is created
 *  here so part writes don't throw; `rebuildGoalStepCards` later
 *  overlays the real title / status / phase metadata without clobbering
 *  the accumulated parts. */
function resolvePhaseOrSessionCardID(
  sessionID: string,
  stage: string,
  goalID: string,
  time: number,
): {
  cardID: string;
  isPhase: boolean;
} {
  if (goalID && stage) {
    const phase = goalStagePhaseID(stage);
    if (phase) {
      const phaseCardID = goalPhaseCardID(goalID, phase.stepID, phase.phaseID);
      // Stub the phase card if it hasn't been materialized yet (SSE
      // ordering: message.updated can arrive before the board refetch
      // that carries goalWorkflows[].steps[].phases). The stub's
      // fields get overlaid by rebuildGoalStepCards on the next
      // board tick — including an authoritative `time` from
      // goal_run.time_started, which replaces the session-derived
      // birth time we stamp here.
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
          time: time > 0 ? time : undefined,
        });
      }
      return { cardID: phaseCardID, isPhase: true };
    }
  }
  if (stage) return { cardID: sessionCardID(stage, sessionID), isPhase: false };
  return { cardID: `pending:session:${sessionID}`, isPhase: false };
}

function ensureSessionCard(sessionID: string, opts: EnsureSessionOpts): SessionInfo {
  const existing = sessions.get(sessionID);
  if (existing) {
    // Backfill stage on first real message.updated (defensive path-updated-first path).
    if (!existing.stage && opts.stage) {
      const { cardID: newCardID, isPhase } = resolvePhaseOrSessionCardID(
        sessionID, opts.stage, opts.goalID || existing.goalID, opts.time,
      );
      if (newCardID !== existing.cardID) {
        if (isPhase) {
          // Session graduates to a phase card. Move any parts accumulated
          // on the placeholder card onto the phase card, then drop the
          // placeholder. Phase card header is managed by rebuildGoalStepCards.
          setCardTreeStore(
            "cards",
            produce((cards: Record<string, CardNode>) => {
              const placeholder = cards[existing.cardID];
              const phase = cards[newCardID];
              if (placeholder && phase) {
                for (const p of placeholder.parts || []) phase.parts.push(p);
                delete cards[existing.cardID];
              }
            }),
          );
        } else {
          setCardTreeStore(
            "cards",
            produce((cards: Record<string, CardNode>) => {
              const node = cards[existing.cardID];
              if (node) {
                cards[newCardID] = {
                  ...node,
                  id: newCardID,
                  stage: opts.stage,
                  accent: stageAccent(opts.stage),
                  title: roleTitleKey(opts.stage),
                };
                delete cards[existing.cardID];
              }
            }),
          );
        }
        existing.cardID = newCardID;
      }
      existing.stage = opts.stage;
    }
    if (opts.parentSessionID && !existing.parentSessionID) {
      existing.parentSessionID = opts.parentSessionID;
    }
    if (opts.goalID && !existing.goalID) {
      existing.goalID = opts.goalID;
    }
    rebuildCardHierarchy();
    // A fidelity event may have arrived before this session's first
    // message.updated (reconnect replay, SSE interleaving). Drain any held
    // payload now that the session card exists under its real stage id.
    drainPendingFidelity(sessionID);
    drainPendingSubagentTerminal(sessionID);
    return existing;
  }

  const stage = opts.stage || "";
  const { cardID, isPhase } = resolvePhaseOrSessionCardID(sessionID, stage, opts.goalID || "", opts.time);

  // Only non-phase sessions create their own card. For phase-absorbed
  // sessions the phase card already exists (resolvePhaseOrSessionCardID
  // stubbed it if necessary) and we route all subsequent parts to it.
  if (!isPhase) {
    const node: CardNode = {
      id: cardID,
      kind: "agent",
      stage,
      accent: stage ? stageAccent(stage) : undefined,
      status: "running",
      title: stage ? roleTitleKey(stage) : "chat.role.assistant",
      round: 0,
      goalID: opts.goalID || undefined,
      parts: [],
      childIDs: [],
      time: opts.time > 0 ? opts.time : undefined,
    };
    setCardTreeStore("cards", cardID, node);
  }

  // Top-level placement is decided by rebuildTopLevelOrder() which is called
  // lazily; for now we register the session and let order rebuild handle it.
  const info: SessionInfo = {
    sessionID,
    stage,
    parentSessionID: opts.parentSessionID,
    goalID: opts.goalID,
    messageIDs: new Set(),
    partIndex: new Map(),
    cardID,
  };
  sessions.set(sessionID, info);

  rebuildCardHierarchy();
  drainPendingFidelity(sessionID);
  drainPendingSubagentTerminal(sessionID);
  return info;
}

function ensureBoundaryPart(sessionID: string, messageID: string, role: string, time: number): void {
  const session = sessions.get(sessionID);
  if (!session) return;
  // Per-message key so each agent invocation in a long-lived session gets
  // its own timeline separator. See handleMessageUpdated for the semantic
  // rationale.
  const boundaryKey = `__boundary__:${sessionID}:${messageID}`;
  if (session.partIndex.has(boundaryKey)) return;
  const part: any = {
    type: "boundary",
    role,
    roleLabel: roleLabel(role),
    time: time > 0 ? time : undefined,
  };
  setCardTreeStore(
    "cards",
    session.cardID,
    "parts",
    produce((parts: any[]) => {
      parts.push(part);
    }),
  );
  session.partIndex.set(boundaryKey, cardTreeStore.cards[session.cardID].parts.length - 1);
}

function upsertPart(sessionID: string, partID: string, part: any): void {
  const session = sessions.get(sessionID);
  if (!session) throw new Error(`upsertPart: unknown session ${sessionID}`);
  const existingIdx = session.partIndex.get(partID);
  if (existingIdx !== undefined) {
    setCardTreeStore("cards", session.cardID, "parts", existingIdx, part);
    return;
  }
  setCardTreeStore(
    "cards",
    session.cardID,
    "parts",
    produce((parts: any[]) => {
      parts.push(part);
    }),
  );
  const newIdx = cardTreeStore.cards[session.cardID].parts.length - 1;
  session.partIndex.set(partID, newIdx);
}

// ── Board-derived projections (task request, goal groups, interactions) ──

function rebuildBoardDerivedCards(): void {
  const board = boardStore.board;
  // Task request bubble (ctx:user-request).
  rebuildTaskContextCard(board);
  // Per-goal executor step cards (top-level) + their phase children.
  rebuildGoalStepCards(board);
  // Session-to-goal claiming.
  rebuildCardHierarchy();
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
    time: taskCreated > 0 ? taskCreated - 2 : undefined,
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

  // Compute the alive set of executor step card ids across every goal. A
  // step is alive only once the backend records its goal_run.time_started:
  // pending steps are deliberately not materialized so the overlay never
  // previews a pipeline that hasn't begun. Keeping the alive set in lock-
  // step with the creation rule below means any stale card from a prior
  // session (reconnect replay) gets GC'd the moment its step reverts to
  // pending, instead of lingering as a ghost.
  const aliveStepCardIDs = new Set<string>();
  for (const gw of goalWorkflows) {
    const gid = String(gw.goalID);
    const steps: any[] = Array.isArray(gw.steps) ? gw.steps : [];
    for (const step of steps) {
      if (!(Number(step.startedAt) > 0)) continue;
      aliveStepCardIDs.add(goalStepCardID(gid, String(step.stepID)));
    }
  }
  setCardTreeStore(
    "cards",
    produce((c: Record<string, CardNode>) => {
      for (const id of Object.keys(c)) {
        if (!id.startsWith("step:")) continue;
        // Top-level executor step — drop if its goal is gone.
        if (isTopLevelStepCardID(id)) {
          if (aliveStepCardIDs.has(id)) continue;
          for (const childID of Object.keys(c)) {
            if (childID.startsWith(id + ":phase:")) delete c[childID];
          }
          delete c[id];
          continue;
        }
        // Phase card — drop if its parent step is gone.
        const parentEnd = id.indexOf(":phase:");
        if (parentEnd > 0) {
          const parentID = id.slice(0, parentEnd);
          if (!aliveStepCardIDs.has(parentID)) delete c[id];
        }
      }
    }),
  );

  for (let i = 0; i < goalWorkflows.length; i++) {
    const gw = goalWorkflows[i];
    const gid = String(gw.goalID);
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
      const stepCardID = goalStepCardID(gid, stepID);
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
              if (startedAt > 0) prev.time = startedAt;
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
                time: startedAt > 0 ? startedAt : undefined,
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
          const phaseCardID = goalPhaseCardID(gid, stepID, pid);
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
      // so we stamp every goal field onto the step card. The header reads
      // `#N  <goal title>  <goalID tail> · <step summary>`; the body (see
      // Card.tsx `kind === "step"`) renders the goal description.
      const gidTail = gid.length > 8 ? gid.slice(-8) : gid;
      const subtitle = [gidTail, step.summary]
        .map((s) => (s ? String(s).trim() : ""))
        .filter((s) => s.length > 0)
        .join(" · ") || undefined;
      setCardTreeStore("cards", stepCardID, {
        id: stepCardID,
        kind: "step",
        stage: stepID,
        accent: stageAccent(stepID),
        status: stepStatus,
        title: String(gw.goalTitle || step.label || agentStageLabel(stepID) || stepID),
        subtitle,
        round: orderIndex + 1,
        parts: [],
        childIDs: phaseChildIDs,
        stepPayload: step.payload && typeof step.payload === "object" ? step.payload : undefined,
        stepID,
        goalID: gid,
        goalDescription: gw.goalDescription || undefined,
        time: stepStartedAt,
      });
    }
  }
}

function interactionCardTime(cardID: string): number {
  return Number(cardTreeStore.cards[cardID]?.time || 0);
}

function upsertInteractionCard(message: any): string {
  const messageID = String(message?.info?.id || "");
  if (!messageID) throw new Error("interaction message missing id");
  const cardID = interactionCardID(messageID);
  const role = String(message?.info?.role || "system");
  const time = Number(message?.info?.time?.created || 0);
  const parts = Array.isArray(message?.parts) ? message.parts.slice() : [];
  setCardTreeStore("cards", cardID, {
    id: cardID,
    kind: "message",
    role,
    title: roleTitleKey(role),
    parts,
    childIDs: [],
    time: time > 0 ? time : undefined,
  });
  return cardID;
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
      .flatMap((interaction) => interactionToSyntheticMessages(interaction))
      .sort(
        (left, right) =>
          Number(left?.info?.time?.created || 0) - Number(right?.info?.time?.created || 0),
      );
    for (const message of ordered) {
      const cardID = upsertInteractionCard(message);
      aliveCardIDs.add(cardID);
      if (sessionID) {
        const session = sessions.get(sessionID);
        if (!session) continue;
        const bucket = bySessionCardID.get(session.cardID);
        if (bucket) bucket.push(cardID);
        else bySessionCardID.set(session.cardID, [cardID]);
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

function sessionSortTime(cardID: string): number {
  const time = Number(cardTreeStore.cards[cardID]?.time || 0);
  return Number.isFinite(time) ? time : 0;
}

function pushUniqueChild(target: string[], childID: string): void {
  if (!childID || target.includes(childID)) return;
  target.push(childID);
}

function resolveGoalContainerCardID(goalID: string, stage: string): string | null {
  if (!goalID) return null;
  const phase = goalStagePhaseID(stage);
  if (!phase) return null;
  const phaseCardID = goalPhaseCardID(goalID, phase.stepID, phase.phaseID);
  return cardTreeStore.cards[phaseCardID] ? phaseCardID : null;
}

function resolveSessionContainerCardID(info: SessionInfo): string | null {
  // Only goal phase cards (step:<gid>:<stepID>:phase:<phaseID>)
  // are allowed session containers. Every other sub-agent session is
  // top-level, by design (see specs/new-arch/07-panel-reactivity §身份规则).
  //
  // The executor container session (session.kind="executor") does NOT
  // render as its own card and is not nested anywhere — its only role is
  // to be a parentID anchor for planner / build worker / evaluator child
  // sessions. The step card in the overlay represents it visually.
  // goalStagePhaseID("executor") returns null, so ensureSessionCard
  // creates the card but rebuildCardHierarchy leaves it unclaimed, and
  // rebuildTopLevelOrder excludes it via the same phase-match check.
  if (info.goalID) {
    return resolveGoalContainerCardID(info.goalID, info.stage);
  }
  return null;
}

function rebuildCardHierarchy(): void {
  const nextChildIDs = new Map<string, string[]>();
  const goalWorkflows: any[] = Array.isArray(boardStore.board?.goalWorkflows)
    ? boardStore.board.goalWorkflows
    : [];
  const interactions = rebuildInteractionCards(boardStore.board);

  for (const gw of goalWorkflows) {
    const gid = String(gw?.goalID || "");
    if (!gid) continue;
    const steps = Array.isArray(gw?.steps) ? gw.steps : [];
    for (const step of steps) {
      const stepID = String(step?.stepID || "");
      if (!stepID) continue;
      const stepCard = goalStepCardID(gid, stepID);
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
        const phaseCard = goalPhaseCardID(gid, stepID, pid);
        if (!cardTreeStore.cards[phaseCard]) continue;
        pushUniqueChild(stepChildren, phaseCard);
        nextChildIDs.set(phaseCard, []);
      }
      nextChildIDs.set(stepCard, stepChildren);
    }
  }

  const orderedSessions = [...sessions.values()].sort(
    (a, b) => sessionSortTime(a.cardID) - sessionSortTime(b.cardID),
  );
  for (const info of orderedSessions) {
    if (!cardTreeStore.cards[info.cardID]) continue;
    nextChildIDs.set(info.cardID, nextChildIDs.get(info.cardID) || []);
    const containerID = resolveSessionContainerCardID(info);
    if (!containerID) continue;
    // Phase-absorbed session: info.cardID IS the phase card (ensureSessionCard
    // routed the session directly onto it). No claim needed — adding the
    // phase card as its own child would cycle.
    if (containerID === info.cardID) continue;
    const bucket = nextChildIDs.get(containerID) || [];
    pushUniqueChild(bucket, info.cardID);
    nextChildIDs.set(containerID, bucket);
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

  // Fidelity verdict cards attach under their owning requirements session.
  // If the session hasn't arrived yet (unordered replay, or CLI dry-run with
  // no session), the card stays pending — it will NOT fall through to the
  // top level (card escape is forbidden).
  for (const [cardID, ownerSessionID] of fidelityCardOwners.entries()) {
    if (!cardTreeStore.cards[cardID]) continue;
    const owner = sessions.get(ownerSessionID);
    if (!owner || !cardTreeStore.cards[owner.cardID]) continue;
    const bucket = nextChildIDs.get(owner.cardID) || [];
    pushUniqueChild(bucket, cardID);
    nextChildIDs.set(owner.cardID, bucket);
    nextChildIDs.set(cardID, nextChildIDs.get(cardID) || []);
  }

  setCardTreeStore(
    "cards",
    produce((cards: Record<string, CardNode>) => {
      for (const info of sessions.values()) {
        if (cards[info.cardID]) cards[info.cardID].childIDs = nextChildIDs.get(info.cardID) || [];
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
// interactions (question / permission), and synthetic optimistic bubbles
// all interleave on a single chronological axis. Card identity rules
// (see specs/new-arch/07-panel-reactivity.md §身份规则) still decide
// *whether* a card surfaces at the top level — not where.
//
// Invariants this function relies on, enforced by the writer elsewhere:
//   • Every surfacing card carries `time` — session cards from
//     `message.info.time.created`, step/phase from goal_run.time_started,
//     interactions from their message time, synthetic from the optimistic
//     message's time, user-request from `task.time.created - 2` (the -2ms
//     is what pins it ahead of any message that shares the exact task
//     timestamp; no special-case needed here).
//   • Phase and fidelity cards are always claimed as childIDs of their
//     parent (step / requirements session) before this runs, so they drop
//     out via the `claimedChildIDs` filter instead of needing kind logic.
//   • `stage === ""` session cards are `pending:session:<sid>` stubs whose
//     id mutates the moment the real stage arrives — surfacing them would
//     render an identity that changes mid-frame.
//   • `stage === "executor"` sessions are the goal's executor container
//     (empty, parentID anchor only); the step card is their visual proxy.
//   • `resolveSessionContainerCardID(info)` sessions are goal-phase-routed;
//     their parts live on the phase card, not a duplicate top-level card.

function rebuildTopLevelOrder(): void {
  const claimedChildIDs = new Set<string>();
  for (const node of Object.values(cardTreeStore.cards)) {
    for (const childID of node.childIDs || []) claimedChildIDs.add(childID);
  }

  const hiddenSessionCardIDs = new Set<string>();
  for (const info of sessions.values()) {
    if (info.stage === "" || info.stage === "executor" || resolveSessionContainerCardID(info)) {
      if (info.cardID) hiddenSessionCardIDs.add(info.cardID);
    }
  }

  const order: string[] = [];
  for (const cardID of Object.keys(cardTreeStore.cards)) {
    if (claimedChildIDs.has(cardID)) continue;
    if (hiddenSessionCardIDs.has(cardID)) continue;
    const card = cardTreeStore.cards[cardID];
    if (!card) continue;
    // Phase / fidelity / tool cards must never appear at top level. They
    // belong under their container; reaching here unclaimed means the
    // hierarchy is mid-rebuild, so we drop them rather than let them
    // "escape" (身份规则 §card-escape).
    if (card.kind === "phase" || card.kind === "fidelity" || card.kind === "tool") continue;
    order.push(cardID);
  }

  order.sort((a, b) => {
    const ta = cardTreeStore.cards[a]?.time;
    const tb = cardTreeStore.cards[b]?.time;
    const na = typeof ta === "number" ? ta : Number.POSITIVE_INFINITY;
    const nb = typeof tb === "number" ? tb : Number.POSITIVE_INFINITY;
    return na - nb;
  });

  setCardTreeStore("order", order);
}

// ── Reactive link to boardStore ──
//
// The writer pulls task.request / goalWorkflows / interactions from
// `boardStore.board`. That store is updated out-of-band by loadBoard() HTTP
// fetches in production, not only by the SSE events we see here. To keep the
// cardTreeStore in sync without polling, subscribe to boardStore.board as a
// Solid effect and reproject on every change.
//
// Placed at the END of the module so that every module-level `const` /
// `function` / `Set` (`syntheticMirrorIDs`, `sessions`, `knownGoalIDs`,
// `rebuildBoardDerivedCards`, `rebuildTopLevelOrder`, etc.) is fully
// initialized before the effect fires. Placing the `createRoot` above these
// declarations triggered a TDZ (`Cannot access 'syntheticMirrorIDs' before
// initialization`) the first time `rebuildTopLevelOrder` ran inside the
// first tick of the effect, because Solid `createEffect` evaluates
// synchronously on creation.
//
// The effect is created once in a detached root (`createRoot`) so it outlives
// any caller's reactive scope. Reset by `resetWriter()` is orthogonal —
// clearing writer state then leaving the effect to repopulate on the next
// board read is correct.
createRoot(() => {
  createEffect(() => {
    // Read boardStore.board to establish the dependency, then project.
    void boardStore.board;
    rebuildBoardDerivedCards();
  });
  // Pending / synthetic messages (see services/chat.ts) land in
  // `messageStore.messages` via `setMessages` — NOT through the SSE routing
  // that `applyEvent` consumes. Mirror them into `cardTreeStore` as
  // synthetic top-level cards so optimistic-update bubbles survive the
  // renderer's switch to cardTreeStore. Real SSE messages do NOT pass through
  // this effect (they have real `info.sessionID` values and live in session
  // cards already built by `handleMessageUpdated`).
  createEffect(() => {
    projectSyntheticMessages(messageStore.messages);
  });
});
