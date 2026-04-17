// ── PermissionAutoResolver ──
// Headless driver for experimental.auto_permission. Watches the first
// pending `type: "permission"` interaction and replies with "always"
// when auto-approval is enabled. Renders nothing — permission cards are
// rendered inline in the conversation via InteractionCard.
//
// Rationale for a single driver (vs per-card effects): multiple inline
// cards mounting simultaneously would race on the reply endpoint; one
// driver keyed off the first pending interaction serializes the flow.
// (interaction-reply.ts also has a per-id mutex as defense-in-depth.)
//
// taskID guard: when the user switches tasks, board.interactions briefly
// reflects the previous task before clearBoard() runs. We capture the
// selected taskID at trigger time and re-verify in the async tail to avoid
// firing a reply for a task the user has already navigated away from.

import { createEffect, onCleanup } from "solid-js";
import { boardStore } from "../store/board";
import { appStore } from "../store/app";
import { replyInteraction } from "../services/interaction-reply";

export function PermissionAutoResolver() {
  const COOLDOWN_MS = 10_000;
  const failedAt = new Map<string, number>();
  let inflightId = "";
  let lastTriggeredId = "";
  let disposed = false;

  onCleanup(() => {
    disposed = true;
    failedAt.clear();
    inflightId = "";
    lastTriggeredId = "";
  });

  createEffect(() => {
    const taskID = boardStore.selectedTaskID;
    const interactions = boardStore.board?.interactions;
    if (!taskID) {
      lastTriggeredId = "";
      return;
    }
    const pending = Array.isArray(interactions)
      ? interactions.find(
          (item: any) =>
            item?.type === "permission" && item?.status === "pending",
        )
      : null;
    if (!pending) {
      lastTriggeredId = "";
      return;
    }
    if (!appStore.config?.experimental?.auto_permission) return;
    if (pending.id === lastTriggeredId) return;
    if (inflightId) return;
    const lastFail = failedAt.get(pending.id);
    if (lastFail && Date.now() - lastFail < COOLDOWN_MS) return;

    const capturedTaskID = taskID;
    const capturedID = String(pending.id);
    lastTriggeredId = capturedID;
    inflightId = capturedID;

    queueMicrotask(async () => {
      try {
        if (disposed) return;
        if (boardStore.selectedTaskID !== capturedTaskID) {
          // User switched tasks before the microtask fired — abandon.
          return;
        }
        await replyInteraction(capturedID, "always", true);
      } catch (error) {
        console.error("[PermissionAutoResolver] auto-reply failed", error);
        if (!disposed) failedAt.set(capturedID, Date.now());
      } finally {
        if (inflightId === capturedID) inflightId = "";
      }
    });
  });

  return null;
}
