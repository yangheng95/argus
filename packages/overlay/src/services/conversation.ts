import { apiJson } from "./api";
import { replayTaskEventToTree } from "./events";
import { hydrateConversationView, resetWriter } from "./tree-writer";
import {
  boardStore,
  setBoardData,
  setBoardUpdatedAt,
  setSnapshotVersion,
  setTaskSequence,
} from "../store/board";
import {
  mergeLoadedConversationMessages,
  setMessages,
} from "../store/messages";

function boardSnapshot(board: any): string {
  return typeof board?.snapshotVersion === "string" ? board.snapshotVersion : "";
}

type EventReplay = {
  cursor: number;
  latestSequence: number;
  complete: boolean;
  limit: number;
};

let replayEpoch = 0;
let replayAbort: AbortController | null = null;

export function cancelConversationReplay(): void {
  replayEpoch += 1;
  replayAbort?.abort(new DOMException("Conversation replay superseded", "AbortError"));
  replayAbort = null;
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
  return replay;
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

function assertActiveReplay(taskID: string, epoch: number, signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? new DOMException("Conversation replay aborted", "AbortError");
  if (epoch !== replayEpoch) throw new DOMException("Conversation replay superseded", "AbortError");
  if (boardStore.selectedTaskID !== taskID) throw new DOMException("Conversation replay task changed", "AbortError");
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
): Promise<void> {
  let replay = initialReplay;
  while (!replay.complete) {
    assertActiveReplay(taskID, epoch, signal);
    await waitForReplayTurn(signal);
    const page = await apiJson(
      `task/${encodeURIComponent(taskID)}/conversation/events?after=${encodeURIComponent(String(replay.cursor))}&until=${encodeURIComponent(String(replay.latestSequence))}&limit=${encodeURIComponent(String(replay.limit))}`,
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
}

export async function hydrateTaskConversation(taskID: string): Promise<number> {
  cancelConversationReplay();
  const data = await apiJson(`task/${encodeURIComponent(taskID)}/conversation`);
  const board = requireObject(data?.board, "board");
  const transcript = requireArray(data?.transcript, "transcript");
  const timeline = requireArray(data?.timeline, "timeline");
  const events = requireArray(data?.events, "events");
  const view = requireObject(data?.view, "view");
  const replay = parseEventReplay(data?.eventReplay);
  const mergedMessages = mergeLoadedConversationMessages(timeline, transcript);
  const lastSequence = requireNonnegativeInteger(data?.lastSequence, "lastSequence");

  resetWriter();
  setMessages(mergedMessages);
  setBoardData(board);
  setSnapshotVersion(boardSnapshot(board));
  setTaskSequence(Number.isFinite(lastSequence) && lastSequence > 0 ? lastSequence : 0);
  setBoardUpdatedAt(Date.now());
  hydrateConversationView(view, mergedMessages);

  for (const event of events) {
    replayTaskEventToTree(event);
  }

  const controller = new AbortController();
  replayAbort = controller;
  const epoch = replayEpoch;
  void continueConversationReplay(taskID, replay, epoch, controller.signal).catch((error) => {
    if (error instanceof DOMException && error.name === "AbortError") return;
    console.error("[conversation] replay failed", error);
  });

  return lastSequence;
}
