import { apiJson } from "./api";
import { replayTaskEventToTree } from "./events";
import { resetWriter } from "./tree-writer";
import {
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

export async function hydrateTaskConversation(taskID: string): Promise<number> {
  const data = await apiJson(`task/${encodeURIComponent(taskID)}/conversation`);
  const board = data?.board ?? null;
  const transcript = Array.isArray(data?.transcript) ? data.transcript : [];
  const timeline = Array.isArray(data?.timeline) ? data.timeline : [];
  const events = Array.isArray(data?.events) ? data.events : [];
  const lastSequence = Number(data?.lastSequence || board?.lastSequence || 0);

  resetWriter();
  setMessages(mergeLoadedConversationMessages(timeline, transcript));
  setBoardData(board);
  setSnapshotVersion(boardSnapshot(board));
  setTaskSequence(Number.isFinite(lastSequence) && lastSequence > 0 ? lastSequence : 0);
  setBoardUpdatedAt(Date.now());

  for (const event of events) {
    replayTaskEventToTree(event);
  }

  return Number.isFinite(lastSequence) && lastSequence > 0 ? lastSequence : 0;
}
