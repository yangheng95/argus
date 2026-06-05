import { boardStore, activeTaskID } from "../store/board";
import { cancelConversationReplay, mergeLatestConversationTail } from "./conversation";
import { resetSelectedLiveCursor } from "./selected-stream-cursor";
import {
  recordConversationRecoveryAborted,
  recordConversationRecoveryFailed,
  recordConversationRecoveryStarted,
  recordConversationRecoverySucceeded,
} from "./refresh-diagnostics";
import { startSSE } from "./sse";

let recoveryGeneration = 0;
let recoveryAbort: AbortController | null = null;
let recoveryInFlight: { taskID: string; promise: Promise<number> } | null = null;

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

function assertCurrentRecovery(taskID: string, generation: number, signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? abortError("Selected task recovery aborted");
  if (generation !== recoveryGeneration) throw abortError("Selected task recovery superseded");
  if (activeTaskID() !== taskID) throw abortError("Selected task recovery task changed");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error || "");
}

function isAbortLike(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function resumeSequence(): number {
  return Math.max(0, Math.floor(Number(boardStore.taskSequence) || 0));
}

function cannotReplayWithoutFullRefresh(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  return (
    normalized === "task.replay_expired" ||
    (normalized.includes("replay expired") && !isLiveReplayExpiredReason(reason))
  );
}

function isLiveReplayExpiredReason(reason: string): boolean {
  const normalized = reason.trim().toLowerCase();
  return (
    normalized === "task.live_replay_expired" ||
    normalized.includes("live replay expired")
  );
}

export async function recoverSelectedTaskConversation(
  reason: string,
  requestedTaskID = activeTaskID(),
): Promise<number> {
  const taskID = String(requestedTaskID || "");
  if (!taskID) throw new Error(`selected-task recovery requires a taskID: ${reason}`);
  if (activeTaskID() !== taskID) {
    throw abortError("Selected task recovery task changed");
  }
  if (recoveryInFlight?.taskID === taskID) return recoveryInFlight.promise;

  const promise = recoverSelectedTaskConversationOnce(reason, taskID);
  recoveryInFlight = { taskID, promise };
  try {
    return await promise;
  } finally {
    if (recoveryInFlight?.promise === promise) recoveryInFlight = null;
  }
}

async function recoverSelectedTaskConversationOnce(
  reason: string,
  taskID: string,
): Promise<number> {
  recoveryAbort?.abort(abortError("Selected task recovery superseded"));
  const controller = new AbortController();
  recoveryAbort = controller;
  const generation = ++recoveryGeneration;
  const startedAt = Date.now();

  recordConversationRecoveryStarted({
    channel: "selected-task-recovery",
    reason,
    taskID,
    source: "selected-task-recovery",
  });

  try {
    assertCurrentRecovery(taskID, generation, controller.signal);
    const sequence = resumeSequence();
    if (cannotReplayWithoutFullRefresh(reason)) {
      throw new Error(
        `Selected task recovery refused full conversation refresh after load: ${reason}`,
      );
    }
    const replayLive = !isLiveReplayExpiredReason(reason);
    if (!replayLive) resetSelectedLiveCursor();
    if (replayLive) cancelConversationReplay();
    startSSE({ kind: "task", id: taskID }, sequence, { replayLive });
    if (!replayLive) {
      void mergeLatestConversationTail(taskID).catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        console.error("[selected-task-recovery] live replay gap tail merge failed", error);
      });
    }
    recordConversationRecoverySucceeded({
      channel: "selected-task-recovery",
      reason,
      taskID,
      source: "selected-task-recovery",
      durationMs: Date.now() - startedAt,
      resumeSequence: sequence,
    });
    return sequence;
  } catch (error) {
    const input = {
      channel: "selected-task-recovery",
      reason,
      taskID,
      source: "selected-task-recovery",
      durationMs: Date.now() - startedAt,
      error: errorMessage(error),
    };
    if (isAbortLike(error)) {
      recordConversationRecoveryAborted(input);
    } else {
      recordConversationRecoveryFailed(input);
    }
    throw error;
  } finally {
    if (recoveryAbort === controller) recoveryAbort = null;
  }
}
