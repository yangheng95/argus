// ── PermissionAutoResolver ──
// Headless driver for experimental.auto_permission. Watches the first
// pending `type: "permission"` interaction and replies with "always"
// when auto-approval is enabled. Renders nothing — permission cards are
// rendered inline in the conversation via InteractionPermissionPart.
//
// Rationale for a single driver (vs per-card effects): multiple inline
// cards mounting simultaneously would race on the reply endpoint; one
// driver keyed off the first pending interaction serializes the flow.

import { createMemo } from "solid-js";
import { boardStore } from "../store/board";
import { appStore } from "../store/app";
import { replyInteraction } from "../services/interaction-reply";

interface PendingPermission {
  id: string;
  type: string;
  status: string;
}

export function PermissionAutoResolver() {
  const COOLDOWN_MS = 10_000;
  const failedAt = new Map<string, number>();
  let inflightId = "";
  let lastTriggeredId = "";

  const firstPending = createMemo<PendingPermission | null>(() => {
    const raw = boardStore.board?.interactions;
    if (!Array.isArray(raw)) return null;
    const hit = raw.find(
      (item: any) =>
        item?.type === "permission" && item?.status === "pending",
    );
    return hit ?? null;
  });

  createMemo(() => {
    const interaction = firstPending();
    if (!interaction) {
      lastTriggeredId = "";
      return;
    }
    if (!appStore.config?.experimental?.auto_permission) return;
    if (interaction.id === lastTriggeredId) return;
    if (inflightId) return;
    const lastFail = failedAt.get(interaction.id);
    if (lastFail && Date.now() - lastFail < COOLDOWN_MS) return;
    lastTriggeredId = interaction.id;
    inflightId = interaction.id;
    queueMicrotask(async () => {
      try {
        await replyInteraction(interaction.id, "always");
      } catch (error) {
        console.error("[PermissionAutoResolver] auto-reply failed", error);
        failedAt.set(interaction.id, Date.now());
      } finally {
        inflightId = "";
      }
    });
  });

  return null;
}
