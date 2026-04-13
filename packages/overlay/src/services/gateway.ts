// ── Gateway service ──
// Thin client for the Gateway dispatch API + reactive hook for the gateway
// session message stream.
//
// Backend: src/server/routes/gateway.ts (POST /gateway/message) and the
// existing /session/:id/message endpoints.

import { createSignal, type Accessor } from "solid-js";
import { apiJson, apiUrl, apiHeaders } from "./api";

// Identifier the local user uses to scope their gateway session. The backend
// derives a per-(local, userID) singleton via channelKey({ local, userID }).
// For Phase 6 we hard-code "overlay" — a future enhancement may use the
// authenticated username when multi-user overlays land.
const LOCAL_USER_ID = "overlay";

export interface GatewayResponse {
  sessionID: string;
  text: string;
  toolCalls: number;
}

/** Send a user message through the Gateway dispatcher. Returns the response
 *  metadata; the actual messages are persisted server-side and surface via
 *  the gateway session stream (loadGatewayMessages / subscribeMessages). */
export async function sendGatewayMessage(text: string): Promise<GatewayResponse> {
  return apiJson("/gateway/message", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, userID: LOCAL_USER_ID }),
  });
}

export interface GatewayMessage {
  info: {
    id: string;
    role: "user" | "assistant";
    sessionID: string;
    time: { created: number; completed?: number };
  };
  parts: Array<{
    id: string;
    type: string;
    text?: string;
    metadata?: Record<string, unknown>;
  }>;
}

/** Fetch all messages currently persisted in the given session. */
export async function loadGatewayMessages(sessionID: string): Promise<GatewayMessage[]> {
  return apiJson(`/session/${sessionID}/message`);
}

/**
 * Subscribe to live updates for `sessionID` via the existing event stream.
 * Returns an unsubscribe function. The callback fires whenever a message in
 * the session is created/updated/deleted; the consumer should re-fetch.
 *
 * We piggyback on the orchestrator event stream (same SSE the Board panel
 * uses) and filter by session — there's no Gateway-specific stream because
 * the underlying writes go through Session.updateMessage / updatePart, the
 * same ones that publish to the bus today.
 */
export function subscribeGatewaySession(
  sessionID: string,
  onChange: () => void,
): () => void {
  const url = apiUrl(`/event?session=${encodeURIComponent(sessionID)}`);
  const headers = apiHeaders();
  // EventSource doesn't support custom headers cross-browser; if Basic auth
  // is required (rare in dev), fall back to long-poll. For dev/Tauri overlay
  // the server is unauthenticated so the simple path suffices.
  if (headers.Authorization) {
    let stop = false;
    const tick = async () => {
      while (!stop) {
        try {
          await new Promise((r) => setTimeout(r, 1500));
          if (stop) return;
          onChange();
        } catch {}
      }
    };
    void tick();
    return () => {
      stop = true;
    };
  }
  const es = new EventSource(url);
  const trigger = () => onChange();
  es.addEventListener("message.updated", trigger);
  es.addEventListener("message.part.updated", trigger);
  es.addEventListener("message.part.delta", trigger);
  return () => es.close();
}

// ── Module-level singleton state ──
// The Gateway is one daemon shared across the whole overlay, so its
// messages, busy flag, and SSE subscription live at module scope. Both the
// side panel (which reads the stream) and the chat composer (which now
// routes user input here per layout B) reference the same signals so
// everyone updates together.

const [gwMessages, setGwMessages] = createSignal<GatewayMessage[]>([]);
const [gwSessionID, setGwSessionID] = createSignal<string | undefined>(undefined);
const [gwBusy, setGwBusy] = createSignal(false);
let gwUnsub: (() => void) | undefined;

async function refreshShared() {
  const sid = gwSessionID();
  if (!sid) return;
  try {
    const list = await loadGatewayMessages(sid);
    setGwMessages(list);
  } catch (err) {
    console.warn("[gateway] refresh failed", err);
  }
}

async function sendShared(text: string): Promise<void> {
  if (!text.trim() || gwBusy()) return;
  setGwBusy(true);
  try {
    const resp = await sendGatewayMessage(text);
    if (gwSessionID() !== resp.sessionID) {
      // First send establishes the session — subscribe + initial load.
      setGwSessionID(resp.sessionID);
      if (gwUnsub) gwUnsub();
      gwUnsub = subscribeGatewaySession(resp.sessionID, () => {
        void refreshShared();
      });
    }
    await refreshShared();
  } finally {
    setGwBusy(false);
  }
}

/**
 * Hook returning accessors backed by the module-level singleton above.
 * Multiple callers (side panel, composer) share the same state.
 *
 * `onCleanup` is intentionally omitted — the daemon outlives any single
 * component, and the SSE subscription is reused across mount/unmount.
 */
export function useGatewaySession(): {
  messages: Accessor<GatewayMessage[]>;
  sessionID: Accessor<string | undefined>;
  busy: Accessor<boolean>;
  send: (text: string) => Promise<void>;
  refresh: () => Promise<void>;
} {
  return {
    messages: gwMessages,
    sessionID: gwSessionID,
    busy: gwBusy,
    send: sendShared,
    refresh: refreshShared,
  };
}
