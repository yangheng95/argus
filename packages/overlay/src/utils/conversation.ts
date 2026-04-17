// ── Conversation utilities ──
// Assembles the conversation view from the message store.
// All data is read from Solid stores (messageStore / boardStore) for reactivity.

import { messageStore, messageById, computeAgentCards } from "../store/messages";

/** Resolve an agent card message to its live store proxy when available.
 *  Agent card `messages` snapshots live in a separate SolidJS store path;
 *  part status updates (running→completed) don't propagate to those copies.
 *  Looking up by ID from store.messages returns the canonical proxy where
 *  fine-grained reactivity works correctly. Synthetic messages (from live
 *  agent events, not in store.messages) are returned as-is. */
function resolveMessage(m: any): any {
  const id = m?.info?.id;
  if (typeof id === "string" && id) {
    const live = messageById(id);
    if (live) return live;
  }
  return m;
}
import { boardStore, rootTaskSessionID } from "../store/board";
import { classifyMessage } from "./message";
import {
  interactionToSyntheticMessages,
  partitionInteractions,
} from "./interaction";

const UNTIMED_CONVERSATION_ORDER = Number.MAX_SAFE_INTEGER;

function conversationTime(item: any): number {
  // AgentCardData carries `time` directly; raw Message uses info.time.created.
  if (Number.isFinite(item?.time)) return Number(item.time);
  const created = item?.info?.time?.created;
  if (Number.isFinite(created)) return Number(created);
  const updated = item?.info?.time?.updated;
  if (Number.isFinite(updated)) return Number(updated);
  return UNTIMED_CONVERSATION_ORDER;
}

// ── Internal: build user request + interaction messages ──
//
// Reactive: re-runs from `userContextMessages` whenever `boardStore.board.task`
// or `boardStore.board.interactions` changes (and only those — `applyBoardDelta`
// in store/board.ts ensures unrelated fields don't invalidate this slice).
//
// All timestamp invariants (task.time.created > 0, interaction.time.created > 0,
// resolved/rejected interactions have valid time.resolved) are enforced at
// the boundary in `assertBoardInvariants` (store/board.ts). This function
// trusts those invariants and reads timestamps directly — any malformed
// timestamp here would already have failed the boundary check.

function buildUserContextMessages(): any[] {
  const board = boardStore.board;
  if (!board) return [];
  const msgs: any[] = [];
  const { task } = board;

  // 1. User's original task request
  // task.request + task.attachments are the authoritative representation of
  // the user's input. Render both into a single synthetic bubble — never
  // duplicate by also writing a session message on the backend.
  if (task?.request) {
    const taskCreated = Number(task.time.created);
    const parts: any[] = [{ type: "text", text: task.request }];
    const attachments = Array.isArray((task as any).attachments) ? (task as any).attachments : [];
    for (const a of attachments) {
      parts.push({
        type: "file",
        url: a?.url,
        mime: a?.mime,
        filename: a?.filename,
      });
    }
    msgs.push({
      _synthetic: true,
      info: { id: "ctx:user-request", role: "user", resolvedRole: "user", channel: "main", time: { created: taskCreated - 2 } },
      parts,
    });
  }

  // 2. Orphan interactions (permissions, questions, clarifications).
  //
  // Interactions whose `sessionID` points to a known agent card are claimed
  // by that card in computeAgentCards() and surface INSIDE that card's
  // timeline. Only the remaining ones — no sessionID, or a sessionID the
  // overlay hasn't materialised into a card — fall through here as
  // top-level synthetic bubbles, so nothing is ever silently dropped.
  const knownSessionIDs = new Set(Object.keys(messageStore.messagesBySession));
  const { orphan } = partitionInteractions(board.interactions, knownSessionIDs);
  for (const interaction of orphan) {
    for (const m of interactionToSyntheticMessages(interaction)) msgs.push(m);
  }

  return msgs;
}

// ── Public: split conversation slices ──
//
// The conversation view is the merge of three independent data sources:
//   1. mainMessages()        — message stream (messageStore + board.task.sessionID)
//   2. userContextMessages() — synthetic user/system bubbles from board state
//   3. agentCardItems()      — agent / goal cards built by computeAgentCards
//
// Splitting them lets each one drive its own createMemo in <Conversation>,
// so a board-only delta (e.g. goalWorkflows status flip) doesn't force the
// message stream to be re-filtered, and a new chat message doesn't force
// agent cards to be re-resolved. Combined with the per-field `applyBoardDelta`
// in store/board.ts, this restores SolidJS fine-grained reactivity end-to-end:
// each slice only fires when the data it actually reads has changed.

/** Slice 1 — message-stream filter.
 *  Reads `messageStore.messages` + `messageStore.showTranscriptDetails` plus
 *  `boardStore.board.task.sessionID` (via rootTaskSessionID). Independent of
 *  goalWorkflows, interactions, etc. */
export function mainMessages(): any[] {
  const allMessages = messageStore.messages || [];
  const rootSID = rootTaskSessionID();
  const showTranscriptDetails = messageStore.showTranscriptDetails;

  const mains: any[] = [];
  for (const msg of allMessages) {
    const channel = msg.info?.channel || classifyMessage(msg, rootSID);
    if (channel === "main") mains.push(msg);
  }

  if (!showTranscriptDetails && mains.length > 0) {
    return mains.filter((message: any) => {
      // Backend already filters child session user messages via channel="filtered",
      // but for messages without _overlay (e.g. synthetic), apply legacy filters.
      const text = (message.parts || [])
        .map((part: any) => part.text || "")
        .join("");
      if (
        text.includes("<assistant-brief>") ||
        text.includes("You are executing a headless coding task")
      )
        return false;
      return true;
    });
  }
  return mains;
}

/** Slice 2 — user request + interaction synthetic bubbles.
 *  Reads `boardStore.board.task` and `boardStore.board.interactions` only.
 *  Independent of messageStore and goalWorkflows. */
export function userContextMessages(): any[] {
  return buildUserContextMessages();
}

// Agent card tree — walk recursively so nested sub-agent cards (e.g. build
// under executor) get the same live-proxy resolution and chronological sort
// as top-level cards. Messages come directly from the reactive store;
// resolveMessage() is a no-op for anything already in messageIndex and only
// matters for synthetic live-event messages.
function resolveCardTree(card: any): any {
  if (!card) return card;
  if (card.kind === "goal" && Array.isArray(card.internalCards)) {
    const children = card.internalCards.map((c: any) => resolveCardTree(c));
    return { ...card, internalCards: children };
  }
  if (card.kind === "agent") {
    const msgs = Array.isArray(card.messages)
      ? card.messages.map((m: any) => resolveMessage(m))
      : [];
    msgs.sort((a: any, b: any) => conversationTime(a) - conversationTime(b));
    const children = Array.isArray(card.children)
      ? card.children.map((c: any) => resolveCardTree(c))
      : [];
    return { ...card, messages: msgs, children };
  }
  return card;
}

/** Slice 3 — agent / goal cards.
 *  Reads `messageStore.messagesBySession` + `messageStore.agentEvents` (via
 *  computeAgentCards) and `boardStore.board.goalWorkflows`. Independent of
 *  the message stream and interactions. */
export function agentCardItems(): any[] {
  const items: any[] = [];
  const computed = computeAgentCards();
  for (const id of computed.order) {
    const card = computed.cards[id];
    if (!card) continue;
    if (card.kind === "agent") {
      const hasMessages =
        Array.isArray(card.messages) && card.messages.length > 0;
      const hasChildren =
        Array.isArray((card as any).children) &&
        (card as any).children.length > 0;
      if (!hasMessages && !hasChildren) continue;
    }
    items.push(resolveCardTree(card));
  }
  return items;
}

/** Pure merger — combines pre-computed slices into the final ordered list.
 *  Called from <Conversation>'s top-level memo; cheap because all expensive
 *  work happened in the per-slice memos. */
export function combineConversation(
  main: any[],
  ctx: any[],
  cards: any[],
): any[] {
  const _t0 = performance.now();
  const result = [...main, ...ctx, ...cards].sort(
    (a: any, b: any) => conversationTime(a) - conversationTime(b),
  );

  // Runtime invariant: IDs must be unique. If this ever fires, something
  // upstream is emitting the same item twice and <For> will render it twice.
  const _ids = result.map((r: any) => r.info?.id || r.id || "?");
  const _dupes = _ids.filter(
    (id: string, i: number) => _ids.indexOf(id) !== i,
  );
  if (_dupes.length > 0) {
    console.error(
      "[overlay] duplicate items in combineConversation:",
      _dupes,
    );
  }

  const _dt = performance.now() - _t0;
  if (_dt > 5) {
    console.warn(
      `[perf] combineConversation: ${_dt.toFixed(1)}ms, ${result.length} items`,
    );
  }
  return result;
}

