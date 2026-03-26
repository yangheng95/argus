// ── ConnectionBadge Component ──
// Displays the current connection status (online / connecting / offline) as a
// clickable badge. Double-clicking triggers a server restart then reloads the
// page, exactly mirroring lines 9394–9408 and setConnStatus (3817–3826).

import { createMemo } from "solid-js";
import { messageStore } from "../store/messages";
import { appStore, setConnectionStatus } from "../store/app";
import { t } from "../utils/i18n";

// ── Types ──

/** Connection status values mirroring app.js setConnStatus / checkConnection. */
export type ConnectionStatus = "online" | "connecting" | "offline";

// ── Helpers ──

function statusLabel(status: ConnectionStatus): string {
  if (status === "online") return t("titlebar.connection.online");
  if (status === "connecting") return t("titlebar.connection.connecting");
  return t("titlebar.connection.offline");
}

/** Attempt to restart the backend via the REST API and reload the page.
 */
async function handleRestart(): Promise<void> {
  setConnectionStatus("connecting");

 // Import apiJson lazily to avoid a circular dependency at module init time.
  const { apiJson } = await import("../services/api");

  try {
    await apiJson("restart", {
      method: "POST",
      signal: AbortSignal.timeout(3000),
    });
  } catch {
 // Restart request may fail if the server is down; that is expected.
  }

 // Give the server a moment to come back up, then reload the overlay UI.
  setTimeout(() => {
    if (typeof location !== "undefined") location.reload();
  }, 2000);
}

// ── Component ──

export interface ConnectionBadgeProps {
  /** Override the displayed status. Falls back to appStore.connectionStatus. */
  status?: ConnectionStatus;
}

export function ConnectionBadge(props: ConnectionBadgeProps) {
 // Derive status: prefer explicit prop, otherwise use the app store which is
 // kept in sync by the ( setConnectionStatus).
  const status = createMemo<ConnectionStatus>(() => {
    if (props.status) return props.status;
 // Also reflect sseConnected from messageStore: if SSE is live, we are online.
    if (messageStore.sseConnected) return "online";
    return appStore.connectionStatus as ConnectionStatus;
  });

  const label = createMemo(() => statusLabel(status()));

  return (
    <span
      id="connBadge"
      class="conn-badge"
      data-status={status()}
      title={label()}
      aria-label={label()}
      aria-live="polite"
      onDblClick={() => {
        void handleRestart();
      }}
    >
      {label()}
    </span>
  );
}
