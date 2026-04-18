// ── ConnectionBadge Component ──
// Displays the current connection status (online / connecting / offline) as a
// clickable badge. Double-clicking triggers a server restart then reloads the
// page, exactly mirroring lines 9394–9408 and setConnStatus (3817–3826).

import { Show, createMemo } from "solid-js";
import { messageStore } from "../store/messages";
import { appStore, setConnectionStatus } from "../store/app";
import { settingsStore } from "../store/settings";
import { t } from "../utils/i18n";
import { apiJson } from "../services/api";

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

  // ── Port display ──
  // The sidecar's port is dynamic (default 4096, falls back up to +32 and
  // then ephemeral — see overlay/src-tauri/build.rs + main.rs::next_server_port).
  // Surface the active port next to "online" so the operator can query the
  // server directly (curl / sqlite / etc) without hunting through netstat.
  // Parsed from settingsStore.serverUrl which connection.ts keeps synced with
  // the Tauri overlay_server_info command.
  const port = createMemo<string>(() => {
    const raw = settingsStore.serverUrl;
    if (!raw) return "";
    const parsed = URL.canParse?.(raw) ? new URL(raw) : null;
    return parsed?.port ?? "";
  });

  const title = createMemo(() => {
    const p = port();
    return status() === "online" && p ? `${label()} · :${p}` : label();
  });

  return (
    <span
      id="connBadge"
      class="conn-badge"
      data-status={status()}
      title={title()}
      aria-label={title()}
      aria-live="polite"
      onDblClick={() => {
        void handleRestart();
      }}
    >
      <span class="conn-badge__label">{label()}</span>
      <Show when={status() === "online" && port()}>
        <span class="conn-badge__port">:{port()}</span>
      </Show>
    </span>
  );
}
