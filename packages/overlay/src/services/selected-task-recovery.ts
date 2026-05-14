import { boardStore } from "../store/board";
import { cancelConversationReplay, hydrateTaskConversation } from "./conversation";
import { startSSE, stopSSE } from "./sse";

let recoveryGeneration = 0;
let recoveryAbort: AbortController | null = null;

function abortError(message: string): DOMException {
  return new DOMException(message, "AbortError");
}

function assertCurrentRecovery(taskID: string, generation: number, signal: AbortSignal): void {
  if (signal.aborted) throw signal.reason ?? abortError("Selected task recovery aborted");
  if (generation !== recoveryGeneration) throw abortError("Selected task recovery superseded");
  if (boardStore.selectedTaskID !== taskID) throw abortError("Selected task recovery task changed");
}

export async function recoverSelectedTaskConversation(
  reason: string,
  requestedTaskID = boardStore.selectedTaskID,
): Promise<number> {
  const taskID = String(requestedTaskID || "");
  if (!taskID) throw new Error(`selected-task recovery requires a taskID: ${reason}`);
  if (boardStore.selectedTaskID !== taskID) {
    throw abortError("Selected task recovery task changed");
  }

  recoveryAbort?.abort(abortError("Selected task recovery superseded"));
  const controller = new AbortController();
  recoveryAbort = controller;
  const generation = ++recoveryGeneration;

  stopSSE();
  cancelConversationReplay();

  try {
    assertCurrentRecovery(taskID, generation, controller.signal);
    const sequence = await hydrateTaskConversation(taskID, { signal: controller.signal });
    assertCurrentRecovery(taskID, generation, controller.signal);
    startSSE(taskID, sequence);
    return sequence;
  } finally {
    if (recoveryAbort === controller) recoveryAbort = null;
  }
}
