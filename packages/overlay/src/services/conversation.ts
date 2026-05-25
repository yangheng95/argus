import { apiJson } from "./api";
import { replayTaskEventToTree } from "./events";
import { hydrateConversationView, resetWriter } from "./tree-writer";
import {
  boardStore,
  setBoardData,
  setBoardUpdatedAt,
  setTaskSequence,
} from "../store/board";
import { cardTreeStore } from "../store/card-tree";
import {
  mergeLoadedConversationMessages,
} from "../store/messages";
import {
  hydrateConversationAgentView,
  resetConversationAgentView,
} from "../store/conversation-agents";
import { markSelectedMessageWatermark } from "./selected-stream-cursor";

type EventReplay = {
  cursor: number;
  latestSequence: number;
  complete: boolean;
  limit: number;
  sinceTimestamp: number | null;
};

type HistoryState = {
  oldestTimestamp: number | null;
  oldestMessageID: string | null;
  hasMore: boolean;
  limit: number;
};

const INITIAL_CONVERSATION_TAIL_LIMIT = 240;
const LIVE_MESSAGE_CHANGE_TAIL_LIMIT = 32;
const CONVERSATION_HISTORY_PAGE_LIMIT = 160;

let replayEpoch = 0;
let replayAbort: AbortController | null = null;
let historyEpoch = 0;
let historyAbort: AbortController | null = null;
let tailMergeEpoch = 0;
let tailMergeAbort: AbortController | null = null;
let historyTaskID = "";
let scheduledTailMergeTaskID = "";
let scheduledTailMergeRunning = false;
let scheduledTailMergeAgain = false;
let historyState: HistoryState = {
  oldestTimestamp: null,
  oldestMessageID: null,
  hasMore: false,
  limit: CONVERSATION_HISTORY_PAGE_LIMIT,
};
let historyLoading = false;

export function cancelConversationReplay(): void {
  replayEpoch += 1;
  historyEpoch += 1;
  tailMergeEpoch += 1;
  replayAbort?.abort(new DOMException("Conversation replay superseded", "AbortError"));
  historyAbort?.abort(new DOMException("Conversation history superseded", "AbortError"));
  tailMergeAbort?.abort(new DOMException("Conversation tail merge superseded", "AbortError"));
  replayAbort = null;
  historyAbort = null;
  tailMergeAbort = null;
  scheduledTailMergeTaskID = "";
  scheduledTailMergeRunning = false;
  scheduledTailMergeAgain = false;
  historyLoading = false;
  historyTaskID = "";
  historyState = {
    oldestTimestamp: null,
    oldestMessageID: null,
    hasMore: false,
    limit: CONVERSATION_HISTORY_PAGE_LIMIT,
  };
  resetConversationAgentView();
}

function parseEventReplay(raw: any): EventReplay {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("conversation hydrate missing eventReplay");
  }
  const replay = {
    cursor: Number(raw.cursor),
    latestSequence: Number(raw.latestSequence),
    complete: raw.complete === true,
    limit: Number(raw.limit),
    sinceTimestamp: raw.sinceTimestamp === null || raw.sinceTimestamp === undefined
      ? null
      : Number(raw.sinceTimestamp),
  };
  if (!Number.isInteger(replay.cursor) || replay.cursor < 0) {
    throw new Error(`conversation eventReplay.cursor invalid: ${JSON.stringify(raw)}`);
  }
  if (!Number.isInteger(replay.latestSequence) || replay.latestSequence < 0) {
    throw new Error(`conversation eventReplay.latestSequence invalid: ${JSON.stringify(raw)}`);
  }
  if (!Number.isInteger(replay.limit) || replay.limit <= 0) {
    throw new Error(`conversation eventReplay.limit invalid: ${JSON.stringify(raw)}`);
  }
  if (replay.sinceTimestamp !== null && !Number.isFinite(replay.sinceTimestamp)) {
    throw new Error(`conversation eventReplay.sinceTimestamp invalid: ${JSON.stringify(raw)}`);
  }
  return replay;
}

function parseHistoryState(raw: any, fallbackLimit = CONVERSATION_HISTORY_PAGE_LIMIT): HistoryState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      oldestTimestamp: null,
      oldestMessageID: null,
      hasMore: false,
      limit: fallbackLimit,
    };
  }
  const oldestRaw = raw.oldestTimestamp;
  const oldestTimestamp = oldestRaw === null || oldestRaw === undefined
    ? null
    : Number(oldestRaw);
  if (oldestTimestamp !== null && !Number.isFinite(oldestTimestamp)) {
    throw new Error(`conversation history oldestTimestamp invalid: ${JSON.stringify(raw)}`);
  }
  const limit = Number(raw.limit);
  return {
    oldestTimestamp,
    oldestMessageID: typeof raw.oldestMessageID === "string" && raw.oldestMessageID ? raw.oldestMessageID : null,
    hasMore: raw.hasMore === true,
    limit: Number.isInteger(limit) && limit > 0 ? limit : fallbackLimit,
  };
}

function requireArray(raw: any, name: string): any[] {
  if (!Array.isArray(raw)) throw new Error(`conversation payload ${name} must be an array`);
  return raw;
}

function requireObject(raw: any, name: string): Record<string, any> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`conversation payload ${name} must be an object`);
  }
  return raw;
}

function requireNonnegativeInteger(raw: any, name: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`conversation payload ${name} must be a nonnegative integer`);
  }
  return value;
}

function parseMessageWatermark(raw: any): number {
  const value = Number(raw ?? 0);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`conversation messageWatermark invalid: ${JSON.stringify(raw)}`);
  }
  return Math.floor(value);
}

function assertActiveReplay(taskID: string, epoch: number, signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("Conversation replay aborted", "AbortError");
  if (epoch !== replayEpoch) throw new DOMException("Conversation replay superseded", "AbortError");
  if (boardStore.selectedTaskID !== taskID) throw new DOMException("Conversation replay task changed", "AbortError");
}

function assertActiveHistory(taskID: string, epoch: number, signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("Conversation history aborted", "AbortError");
  if (epoch !== historyEpoch) throw new DOMException("Conversation history superseded", "AbortError");
  if (boardStore.selectedTaskID !== taskID || historyTaskID !== taskID) {
    throw new DOMException("Conversation history task changed", "AbortError");
  }
}

function assertActiveTailMerge(taskID: string, epoch: number, signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("Conversation tail merge aborted", "AbortError");
  if (epoch !== tailMergeEpoch) throw new DOMException("Conversation tail merge superseded", "AbortError");
  if (boardStore.selectedTaskID !== taskID) throw new DOMException("Conversation tail merge task changed", "AbortError");
}

function linkedReplayController(signal?: AbortSignal): AbortController {
  const controller = new AbortController();
  if (!signal) return controller;
  if (signal.aborted) {
    controller.abort(signal.reason ?? new DOMException("Conversation replay aborted", "AbortError"));
    return controller;
  }
  signal.addEventListener(
    "abort",
    () => {
      controller.abort(signal.reason ?? new DOMException("Conversation replay aborted", "AbortError"));
    },
    { once: true },
  );
  return controller;
}

function waitForReplayTurn(signal: AbortSignal): Promise<void> {
  if (signal.aborted) throw signal.reason ?? new DOMException("Conversation replay aborted", "AbortError");
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, 0);
    function done() {
      signal.removeEventListener("abort", abort);
      resolve();
    }
    function abort() {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      reject(signal.reason ?? new DOMException("Conversation replay aborted", "AbortError"));
    }
    signal.addEventListener("abort", abort, { once: true });
  });
}

async function continueConversationReplay(
  taskID: string,
  initialReplay: EventReplay,
  epoch: number,
  signal: AbortSignal,
): Promise<EventReplay> {
  let replay = initialReplay;
  while (!replay.complete) {
    assertActiveReplay(taskID, epoch, signal);
    await waitForReplayTurn(signal);
    const sinceQuery = replay.sinceTimestamp === null
      ? ""
      : `&since=${encodeURIComponent(String(replay.sinceTimestamp))}`;
    const page = await apiJson(
      `task/${encodeURIComponent(taskID)}/conversation/events?after=${encodeURIComponent(String(replay.cursor))}&until=${encodeURIComponent(String(replay.latestSequence))}&limit=${encodeURIComponent(String(replay.limit))}${sinceQuery}`,
      { signal },
    );
    const events = requireArray(page?.events, "events");
    const nextReplay = parseEventReplay(page?.eventReplay);
    if (!nextReplay.complete && nextReplay.cursor <= replay.cursor) {
      throw new Error(
        `conversation replay cursor did not advance: cursor=${replay.cursor}, next=${nextReplay.cursor}`,
      );
    }
    for (const event of events) {
      assertActiveReplay(taskID, epoch, signal);
      replayTaskEventToTree(event);
    }
    replay = nextReplay;
  }
  return replay;
}

export async function hydrateTaskConversation(
  taskID: string,
  options: {
    signal?: AbortSignal;
    scrollIntent?: "preserve" | "bottom";
    resetCause?: string;
    tailLimit?: number;
  } = {},
): Promise<number> {
  cancelConversationReplay();
  const controller = linkedReplayController(options.signal);
  replayAbort = controller;
  const epoch = replayEpoch;
  const signal = controller.signal;
  let backgroundReplay = false;
  try {
    const tailLimit = Math.max(1, Math.floor(Number(options.tailLimit ?? INITIAL_CONVERSATION_TAIL_LIMIT) || INITIAL_CONVERSATION_TAIL_LIMIT));
    const data = await apiJson(
      `task/${encodeURIComponent(taskID)}/conversation?tail_limit=${encodeURIComponent(String(tailLimit))}`,
      { signal },
    );
    assertActiveReplay(taskID, epoch, signal);
    const board = requireObject(data?.board, "board");
    const transcript = requireArray(data?.transcript, "transcript");
    const timeline = requireArray(data?.timeline, "timeline");
    const events = requireArray(data?.events, "events");
    const view = requireObject(data?.view, "view");
    const agentView = requireObject(data?.agentView ?? data?.view, "agentView");
    const replay = parseEventReplay(data?.eventReplay);
    const history = parseHistoryState(data?.history, CONVERSATION_HISTORY_PAGE_LIMIT);
    const messageWatermark = parseMessageWatermark(data?.messageWatermark);
    const mergedMessages = mergeLoadedConversationMessages(timeline, transcript);
    const lastSequence = requireNonnegativeInteger(data?.lastSequence, "lastSequence");

    resetWriter({
      scrollIntent: options.scrollIntent ?? "preserve",
      cause: options.resetCause ?? "conversation-hydrate",
    });
    setBoardData(board);
    setTaskSequence(Number.isFinite(lastSequence) && lastSequence > 0 ? lastSequence : 0);
    setBoardUpdatedAt(Date.now());
    hydrateConversationView(view, mergedMessages);
    hydrateConversationAgentView(taskID, agentView);
    markSelectedMessageWatermark(messageWatermark);
    historyTaskID = taskID;
    historyState = history;

    for (const event of events) {
      assertActiveReplay(taskID, epoch, signal);
      replayTaskEventToTree(event);
    }

    if (history.hasMore && !replay.complete) {
      backgroundReplay = true;
      void continueConversationReplay(taskID, replay, epoch, signal)
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          console.error("[conversation] background protocol replay failed", error);
        })
        .finally(() => {
          if (replayAbort === controller) replayAbort = null;
        });
      return Math.max(lastSequence, replay.latestSequence);
    }
    const finalReplay = await continueConversationReplay(taskID, replay, epoch, signal);
    return Math.max(lastSequence, finalReplay.latestSequence);
  } finally {
    if (replayAbort === controller && !backgroundReplay) replayAbort = null;
  }
}

export async function mergeLatestConversationTail(
  taskID: string,
  options: {
    signal?: AbortSignal;
    tailLimit?: number;
  } = {},
): Promise<void> {
  const selectedTaskID = String(taskID || "");
  if (!selectedTaskID) throw new Error("conversation tail merge requires a taskID");
  tailMergeAbort?.abort(new DOMException("Conversation tail merge superseded", "AbortError"));
  const controller = linkedReplayController(options.signal);
  tailMergeAbort = controller;
  const epoch = ++tailMergeEpoch;
  const signal = controller.signal;
  try {
    const tailLimit = Math.max(1, Math.floor(Number(options.tailLimit ?? INITIAL_CONVERSATION_TAIL_LIMIT) || INITIAL_CONVERSATION_TAIL_LIMIT));
    const data = await apiJson(
      `task/${encodeURIComponent(selectedTaskID)}/conversation?tail_limit=${encodeURIComponent(String(tailLimit))}`,
      { signal },
    );
    assertActiveTailMerge(selectedTaskID, epoch, signal);
    const board = requireObject(data?.board, "board");
    const transcript = requireArray(data?.transcript, "transcript");
    const timeline = requireArray(data?.timeline, "timeline");
    const view = requireObject(data?.view, "view");
    const agentView = requireObject(data?.agentView ?? data?.view, "agentView");
    const messageWatermark = parseMessageWatermark(data?.messageWatermark);
    requireNonnegativeInteger(data?.lastSequence, "lastSequence");

    setBoardData(board);
    setBoardUpdatedAt(Date.now());
    hydrateConversationView(view, mergeLoadedConversationMessages(timeline, transcript));
    hydrateConversationAgentView(selectedTaskID, agentView);
    markSelectedMessageWatermark(messageWatermark);
  } finally {
    if (tailMergeAbort === controller) tailMergeAbort = null;
  }
}

export function scheduleLatestConversationTailMerge(taskID: string): void {
  const selectedTaskID = String(taskID || "");
  if (!selectedTaskID) return;
  scheduledTailMergeTaskID = selectedTaskID;
  if (scheduledTailMergeRunning) {
    scheduledTailMergeAgain = true;
    return;
  }
  scheduledTailMergeRunning = true;
  const run = async (): Promise<void> => {
    while (scheduledTailMergeTaskID) {
      const nextTaskID = scheduledTailMergeTaskID;
      scheduledTailMergeTaskID = "";
      scheduledTailMergeAgain = false;
      try {
        await mergeLatestConversationTail(nextTaskID, {
          tailLimit: LIVE_MESSAGE_CHANGE_TAIL_LIMIT,
        });
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") continue;
        console.error("[conversation] scheduled tail merge failed", error);
      }
      if (!scheduledTailMergeAgain) break;
    }
    scheduledTailMergeRunning = false;
    if (scheduledTailMergeTaskID) scheduleLatestConversationTailMerge(scheduledTailMergeTaskID);
  };
  void run();
}

export function canLoadOlderConversationHistory(taskID = boardStore.selectedTaskID): boolean {
  return (
    !!taskID &&
    taskID === historyTaskID &&
    historyState.hasMore &&
    historyState.oldestTimestamp !== null &&
    !historyLoading
  );
}

export async function loadOlderConversationHistory(
  taskID = boardStore.selectedTaskID,
): Promise<boolean> {
  const selectedTaskID = String(taskID || "");
  if (!canLoadOlderConversationHistory(selectedTaskID)) return false;
  const before = historyState.oldestTimestamp;
  const beforeID = historyState.oldestMessageID;
  if (before === null) return false;
  historyLoading = true;
  historyAbort?.abort(new DOMException("Conversation history superseded", "AbortError"));
  const controller = new AbortController();
  historyAbort = controller;
  const epoch = ++historyEpoch;
  try {
    assertActiveHistory(selectedTaskID, epoch, controller.signal);
    const page = await apiJson(
      `task/${encodeURIComponent(selectedTaskID)}/conversation/history?before=${encodeURIComponent(String(before))}${beforeID ? `&before_id=${encodeURIComponent(beforeID)}` : ""}&limit=${encodeURIComponent(String(CONVERSATION_HISTORY_PAGE_LIMIT))}`,
      { signal: controller.signal },
    );
    assertActiveHistory(selectedTaskID, epoch, controller.signal);
    const transcript = requireArray(page?.transcript, "transcript");
    const timeline = requireArray(page?.timeline, "timeline");
    const view = requireObject(page?.view, "view");
    const nextHistory = parseHistoryState(page?.history, CONVERSATION_HISTORY_PAGE_LIMIT);
    if (transcript.length === 0 && timeline.length === 0) {
      historyState = nextHistory;
      return false;
    }
    hydrateConversationView(view, mergeLoadedConversationMessages(timeline, transcript));
    assertActiveHistory(selectedTaskID, epoch, controller.signal);
    historyState = nextHistory;
    return true;
  } finally {
    if (historyAbort === controller) historyAbort = null;
    historyLoading = false;
  }
}

export async function loadConversationHistoryUntilCard(
  cardID: string,
  taskID = boardStore.selectedTaskID,
): Promise<boolean> {
  const targetCardID = String(cardID || "");
  if (!targetCardID) return false;
  while (!cardTreeStore.cards[targetCardID] && canLoadOlderConversationHistory(taskID)) {
    const loaded = await loadOlderConversationHistory(taskID);
    if (!loaded) break;
  }
  return !!cardTreeStore.cards[targetCardID];
}
