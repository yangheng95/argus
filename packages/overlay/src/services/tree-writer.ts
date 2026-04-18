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
import { isTreeWriterNoopEventType, isTreeWriterPassThroughEventType } from "./event-policy";

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

// ── Entry point ──

/** Reset all writer state + cardTreeStore. Called on task switch and in tests. */
export function resetWriter(): void {
  sessions.clear();
  messages.clear();
  knownGoalIDs.clear();
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
}

function handleInteraction(event: any): void {
  // Interactions are sourced from boardStore.board.interactions, not the event
  // payload — the board routes handle the write, we reproject.
  rebuildBoardDerivedCards();
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
    return existing;
  }

  const stage = opts.stage || "";
  const cardID = stage ? sessionCardID(stage, sessionID) : `pending:session:${sessionID}`;
  const node: CardNode = {
    id: cardID,
    kind: "agent",
    stage,
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
  if (info.goalID) {
    const parent = info.parentSessionID ? sessions.get(info.parentSessionID) : undefined;
    if (
      parent &&
      parent.goalID &&
      parent.goalID === info.goalID &&
      cardTreeStore.cards[parent.cardID]
    ) {
      return parent.cardID;
    }
    return resolveGoalContainerCardID(info.goalID, info.stage);
  }
  if (info.parentSessionID) {
    const parent = sessions.get(info.parentSessionID);
    if (parent && cardTreeStore.cards[parent.cardID]) return parent.cardID;
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
// Priority (matching old computeAgentCards): root orchestrator (stage=assistant)
// first, then goal groups (by round), then other root agent cards chronologically.
// ctx:user-request sorts before assistant by its synthetic negative time.

function rebuildTopLevelOrder(): void {
  const order: string[] = [];
  const claimedChildIDs = new Set<string>();
  for (const node of Object.values(cardTreeStore.cards)) {
    for (const childID of node.childIDs || []) claimedChildIDs.add(childID);
  }

  // Collect root session cards (not claimed by a parent session or goal card).
  const rootSessions: string[] = [];
  for (const info of sessions.values()) {
    if (resolveSessionContainerCardID(info)) continue;
    if (cardTreeStore.cards[info.cardID]) rootSessions.push(info.cardID);
  }
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

  // Assistant-stage root session sorts next (single root orchestrator).
  const assistantRoots = rootSessions.filter(
    (id) => cardTreeStore.cards[id]?.stage === "assistant",
  );
  for (const id of assistantRoots) order.push(id);

  // Goal groups.
  for (const id of goalCards) order.push(id);

  // Other root sessions chronologically.
  const others = rootSessions
    .filter((id) => cardTreeStore.cards[id]?.stage !== "assistant")
    .sort((a, b) => (cardTreeStore.cards[a]?.time || 0) - (cardTreeStore.cards[b]?.time || 0));
  for (const id of others) order.push(id);

  // Orphan interaction cards: task-level prompts with no live session container.
  for (const id of orphanInteractionCards) order.push(id);

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
