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
import { goalStageStepID } from "../utils/workflow-step";
import {
  isSubagentPhaseCompletedEventType,
  isTreeWriterNoopEventType,
  isTreeWriterPassThroughEventType,
} from "./event-policy";

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

  // ── Fidelity review verdict ──
  // The fidelity LLM produces a JSON contract (verdict/issues/corrections/
  // missing_goals). Rendering raw JSON tokens in a reasoning block was the
  // old behaviour — this branch turns the parsed result into a structured
  // card so the operator sees a verdict badge + diff list instead.
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

function goalCardID(goalID: string): string {
  return `goal-group:${goalID}`;
}

function goalStepCardID(goalID: string, stepID: string): string {
  return `${goalCardID(goalID)}:step:${stepID}`;
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

  // If the session card doesn't yet have a boundary part, prepend one so the
  // renderer's CardParts can emit a role separator. The old pipeline inserts
  // boundaries at `flattenMessages` time; we write them eagerly here so the
  // shape matches byte-for-byte.
  ensureBoundaryPart(sessionID, resolvedRole, timeCreated);
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
}

/** Atomically write the fidelity card into cardTreeStore and register its
 *  owning session. Only called when the owning session card already exists
 *  — callers MUST NOT skip the session guard. `rebuildCardHierarchy()` is
 *  invoked so the new card becomes a child of its session in the same tick. */
function materializeFidelity(session: SessionInfo, p: PendingFidelityPayload): void {
  const cardID = fidelityCardID(p.taskID);
  const status: CardStatus = p.verdict === "faithful" ? "completed" : "error";
  setCardTreeStore("cards", cardID, {
    id: cardID,
    kind: "fidelity",
    stage: "fidelity",
    accent: stageAccent("fidelity"),
    status,
    title: roleTitleKey("fidelity"),
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

function ensureSessionCard(sessionID: string, opts: EnsureSessionOpts): SessionInfo {
  const existing = sessions.get(sessionID);
  if (existing) {
    // Backfill stage on first real message.updated (defensive path-updated-first path).
    if (!existing.stage && opts.stage) {
      const newCardID = sessionCardID(opts.stage, sessionID);
      if (newCardID !== existing.cardID) {
        // Rename the card: move from placeholder to real id.
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
  const cardID = stage ? sessionCardID(stage, sessionID) : `pending:session:${sessionID}`;
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

function ensureBoundaryPart(sessionID: string, role: string, time: number): void {
  const session = sessions.get(sessionID);
  if (!session) return;
  const boundaryKey = `__boundary__:${sessionID}`;
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
  // Goal group cards + their step children.
  rebuildGoalGroupCards(board);
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

function rebuildGoalGroupCards(board: any): void {
  const goalWorkflows: any[] = Array.isArray(board?.goalWorkflows) ? board.goalWorkflows : [];

  // Drop stale goal cards first (goals removed from board).
  const aliveGoalCardIDs = new Set<string>();
  for (let i = 0; i < goalWorkflows.length; i++) {
    aliveGoalCardIDs.add(`goal-group:${goalWorkflows[i].goalID}`);
  }
  setCardTreeStore(
    "cards",
    produce((c: Record<string, CardNode>) => {
      for (const id of Object.keys(c)) {
        if (!id.startsWith("goal-group:")) continue;
        if (aliveGoalCardIDs.has(id)) continue;
        // Also drop any step children of this goal.
        for (const childID of Object.keys(c)) {
          if (childID.startsWith(id + ":step:")) delete c[childID];
        }
        delete c[id];
      }
    }),
  );

  for (let i = 0; i < goalWorkflows.length; i++) {
    const gw = goalWorkflows[i];
    const gid = String(gw.goalID);
    const cardID = `goal-group:${gid}`;
    const steps = Array.isArray(gw.steps) ? gw.steps : [];
    const stepChildIDs: string[] = [];
    for (const step of steps) {
      const stepID = String(step.stepID);
      const childID = `${cardID}:step:${stepID}`;
      const stepStatus = normalizeStepStatus(step.status);
      setCardTreeStore("cards", childID, {
        id: childID,
        kind: "step",
        stage: stepID,
        accent: stageAccent(stepID),
        status: stepStatus,
        title: step.label || agentStageLabel(stepID) || stepID,
        subtitle: step.summary || undefined,
        parts: [],
        childIDs: [],
        stepPayload: step.payload && typeof step.payload === "object" ? step.payload : undefined,
        stepID,
      });
      stepChildIDs.push(childID);
    }
    const goalStatus = normalizeGoalStatus(gw.goalStatus);
    const node: CardNode = {
      id: cardID,
      kind: "goal",
      stage: "goal",
      accent: stageAccent("goal"),
      status: goalStatus,
      title: String(gw.goalTitle || "Goal"),
      subtitle: gid.length > 8 ? gid.slice(-8) : undefined,
      round: i + 1,
      goalID: gid,
      goalStatus: gw.goalStatus,
      goalDescription: gw.goalDescription || undefined,
      contracts: Array.isArray(gw.contracts) ? gw.contracts : undefined,
      steps: steps.map((s: any) => ({
        stepID: String(s.stepID),
        label: String(s.label || ""),
        status: String(s.status || ""),
        summary: s.summary,
      })),
      parts: [],
      childIDs: stepChildIDs,
    };
    setCardTreeStore("cards", cardID, node);
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
  const stepID = goalStageStepID(stage);
  if (!stepID) return null;
  const cardID = goalStepCardID(goalID, stepID);
  return cardTreeStore.cards[cardID] ? cardID : null;
}

function resolveSessionContainerCardID(info: SessionInfo): string | null {
  // Only goal-step cards are allowed session containers — every sub-agent
  // session is otherwise a top-level card, as designed. The previous
  // "parent session claim" branch (landed with the tree-writer rewrite in
  // 93f8cf8de) silently nested design-analyst / requirements / build /
  // architect under the orchestrator assistant card, which collapsed the
  // visible hierarchy into a single tree. Removed — one session = one
  // top-level card, with goal-group as the sole exception for goal-scoped
  // agent sessions (executor / build inside a goal are claimed under their
  // goal-step so the goal-group card can collect them into one block).
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
    const goalID = goalCardID(gid);
    const baseChildren: string[] = [];
    const steps = Array.isArray(gw?.steps) ? gw.steps : [];
    for (const step of steps) {
      const stepID = String(step?.stepID || "");
      if (!stepID) continue;
      const childID = goalStepCardID(gid, stepID);
      if (cardTreeStore.cards[childID]) {
        pushUniqueChild(baseChildren, childID);
        nextChildIDs.set(childID, []);
      }
    }
    if (cardTreeStore.cards[goalID]) nextChildIDs.set(goalID, baseChildren);
  }

  const orderedSessions = [...sessions.values()].sort(
    (a, b) => sessionSortTime(a.cardID) - sessionSortTime(b.cardID),
  );
  for (const info of orderedSessions) {
    if (!cardTreeStore.cards[info.cardID]) continue;
    nextChildIDs.set(info.cardID, nextChildIDs.get(info.cardID) || []);
    const containerID = resolveSessionContainerCardID(info);
    if (!containerID) continue;
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

function normalizeGoalStatus(raw: any): CardStatus {
  const s = String(raw || "").trim().toLowerCase();
  if (s === "passed") return "completed";
  if (s === "failed") return "error";
  return normalizeStepStatus(raw);
}

// ── Top-level ordering ──
//
// Every session that isn't claimed by a goal-step is a top-level card:
// assistant orchestrator, design-analyst, requirements, architect, planner,
// build, etc. are siblings in the main order (sorted chronologically by
// `time`). Goal-group cards are interleaved in their own board-defined
// order. Session ↔ session nesting was removed in the fix that restored
// the original design (see specs/new-arch/07-panel-reactivity.md §身份规则).

function rebuildTopLevelOrder(): void {
  const order: string[] = [];
  const claimedChildIDs = new Set<string>();
  for (const node of Object.values(cardTreeStore.cards)) {
    for (const childID of node.childIDs || []) claimedChildIDs.add(childID);
  }

  // Collect every session card that isn't claimed by a goal-step. Two filters:
  //   1. stage === "" → `pending:session:<sid>` placeholders created when a
  //      message.part.updated arrives before its message.updated. They will
  //      be renamed + surfaced once the real stage lands; showing them now
  //      would render an identity that mutates mid-frame.
  //   2. resolveSessionContainerCardID(info) → session has a goalID whose
  //      goal-step card exists. In that case rebuildCardHierarchy will nest
  //      it under the goal-step; skip here to avoid duplicating.
  const rootSessions: string[] = [];
  for (const info of sessions.values()) {
    if (info.stage === "") continue;
    if (resolveSessionContainerCardID(info)) continue;
    if (!cardTreeStore.cards[info.cardID]) continue;
    rootSessions.push(info.cardID);
  }
  rootSessions.sort(
    (a, b) => (cardTreeStore.cards[a]?.time || 0) - (cardTreeStore.cards[b]?.time || 0),
  );

  // Goal groups in board order.
  const goalCards: string[] = [];
  const goalWorkflows: any[] = Array.isArray(boardStore.board?.goalWorkflows)
    ? boardStore.board.goalWorkflows
    : [];
  for (const gw of goalWorkflows) {
    const cardID = `goal-group:${gw.goalID}`;
    if (cardTreeStore.cards[cardID]) goalCards.push(cardID);
  }

  // Synthetic cards (chat.ts pending / optimistic bubbles) mirrored from
  // messageStore.messages — sorted chronologically by their time field.
  const syntheticCards: string[] = [];
  for (const id of syntheticMirrorIDs) {
    const cardID = syntheticCardID(id);
    if (cardTreeStore.cards[cardID]) syntheticCards.push(cardID);
  }
  syntheticCards.sort(
    (a, b) => (cardTreeStore.cards[a]?.time || 0) - (cardTreeStore.cards[b]?.time || 0),
  );
  const orphanInteractionCards = Object.keys(cardTreeStore.cards)
    .filter((id) => id.startsWith("interaction-card:") && !claimedChildIDs.has(id))
    .sort((a, b) => (cardTreeStore.cards[a]?.time || 0) - (cardTreeStore.cards[b]?.time || 0));

  // ctx:user-request if present.
  if (cardTreeStore.cards["ctx:user-request"]) {
    order.push("ctx:user-request");
  }

  // All session cards (assistant + sub-agents), chronological.
  for (const id of rootSessions) order.push(id);

  // Goal groups in board order — surfaced after sessions. (If a goal-group
  // is active at the same time an independent sub-agent session is
  // running, the goal-group still reads as a structured container so it
  // belongs after the free-form session stream.)
  for (const id of goalCards) order.push(id);

  // Orphan interaction cards: task-level prompts with no live session container.
  for (const id of orphanInteractionCards) order.push(id);

  // Fidelity verdict cards are NOT placed at the top level — they attach
  // under their requirements session via rebuildCardHierarchy. Card escape
  // (a non-root card appearing at top level) is explicitly forbidden.

  // Synthetic pending / optimistic bubbles append at the end — they carry
  // `Date.now()` timestamps so chronological sort places them after all
  // server-driven cards.
  for (const id of syntheticCards) order.push(id);

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
