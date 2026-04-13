// ── Gateway service ──
// Thin client for the Gateway dispatch API + reactive hook for the gateway
// session message stream.
//
// Backend: src/server/routes/gateway.ts (POST /gateway/message) and the
// existing /session/:id/message endpoints.

import { createSignal, onCleanup, type Accessor } from "solid-js";
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

/**
 * Reactive hook: returns an Accessor that reflects the current gateway
 * session messages, plus helpers to send a turn / refresh manually.
 *
 * Intended use inside a Solid component:
 *
 *     const { messages, sessionID, send, refresh } = useGatewaySession();
 *     <For each={messages()}>{(m) => <MessageBubble msg={m} />}</For>
 */
export function useGatewaySession(): {
  messages: Accessor<GatewayMessage[]>;
  sessionID: Accessor<string | undefined>;
  busy: Accessor<boolean>;
  send: (text: string) => Promise<void>;
  refresh: () => Promise<void>;
} {
  const [messages, setMessages] = createSignal<GatewayMessage[]>([]);
  const [sessionID, setSessionID] = createSignal<string | undefined>(undefined);
  const [busy, setBusy] = createSignal(false);
  let unsub: (() => void) | undefined;

  async function refresh() {
    const sid = sessionID();
    if (!sid) return;
    try {
      const list = await loadGatewayMessages(sid);
      setMessages(list);
    } catch (err) {
      console.warn("[gateway] refresh failed", err);
    }
  }

  async function send(text: string) {
    if (!text.trim() || busy()) return;
    setBusy(true);
    try {
      const resp = await sendGatewayMessage(text);
      if (sessionID() !== resp.sessionID) {
        // First send establishes the session — subscribe + initial load.
        setSessionID(resp.sessionID);
        if (unsub) unsub();
        unsub = subscribeGatewaySession(resp.sessionID, () => {
          void refresh();
        });
      }
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  onCleanup(() => {
    if (unsub) unsub();
  });

  return { messages, sessionID, busy, send, refresh };
}
