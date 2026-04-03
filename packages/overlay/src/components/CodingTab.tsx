// ── CodingTab Component ──
// Solid.js port of the Coding tab
// Covers: coding state, renderCodingMessages, codingMessageHTML,
// renderMarkdown, sendCodingMessage, handleCodingEvent, and the
// mode-toggle / form-submit intercept logic.

import {
  createSignal,
  onCleanup,
  For,
  Show,
  createMemo,
} from "solid-js";
import { setupAutoScroll } from "../utils/dom-utils";
import { apiUrl, apiHeaders } from "../services/api";

// ── Types ──

interface CodingTextPart {
  type: "text";
  text: string;
  /** Internal tracking ID — matches partID from delta events */
  _partID?: string;
}

interface CodingToolPart {
  type: "tool";
  tool: string;
  state?: {
    status?: "running" | "completed" | "error";
    title?: string;
    output?: string;
  };
  /** Internal tracking ID — matches part.id from part events */
  _partID?: string;
}

type CodingPart = CodingTextPart | CodingToolPart;

interface CodingUserMessage {
  role: "user";
  text: string;
}

interface CodingAssistantMessage {
  role: "assistant";
  parts: CodingPart[];
  streaming: boolean;
}

type CodingMessage = CodingUserMessage | CodingAssistantMessage;

// ── Helpers ──

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stripAnsi(text: string): string {
 // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, "");
}

// ── renderMarkdown (
// Minimal markdown: fenced code blocks, inline code, bold, newlines.
function renderMarkdown(text: string): string {
  return escapeHtml(text)
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      '<pre class="code-block"><code>$2</code></pre>',
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

// ── Component ──

export interface CodingTabProps {
  /**
 * Whether this tab is currently active (visible).
 * When false the scroll container is hidden.
 */
  active: boolean;
  /**
   * Called once on mount with the coding tab's API so the parent can wire
   * ChatComposer to route messages into this tab when in coding mode.
   */
  onReady?: (api: CodingTabAPI) => void;
}

export interface CodingTabAPI {
  send: (text: string) => void;
  stop: () => void;
  busy: () => boolean;
}

export function CodingTab(props: CodingTabProps) {
 // ── State ──

  const [sessionID, setSessionID] = createSignal<string | null>(null);
  const [messages, setMessages] = createSignal<CodingMessage[]>([]);
  const [busy, setBusy] = createSignal(false);

 // partID → accumulated text (mirrors coding.textBuffer)
  let textBuffer = new Map<string, string>();
  let abortController: AbortController | null = null;

  // Expose API to parent so ChatComposer can route messages here
  props.onReady?.({
    send: (text: string) => void sendCodingMessage(text),
    stop: () => abortController?.abort(),
    busy,
  });

 // ── handleCodingEvent (

  function handleCodingEvent(
    msgIndex: number,
    event: Record<string, any>,
  ) {
    if (event.type === "session") {
      setSessionID(event.sessionID ?? null);
      return;
    }
    if (event.type === "delta") {
      const current = textBuffer.get(event.partID) ?? "";
      const next = current + (event.delta ?? "");
      textBuffer.set(event.partID, next);
      setMessages((prev) => {
        const updated = prev.map((m, i) => {
          if (i !== msgIndex || m.role !== "assistant") return m;
          const parts = (m as CodingAssistantMessage).parts.map((p) => {
            if (p.type === "text" && p._partID === event.partID) {
              return { ...p, text: next } as CodingTextPart;
            }
            return p;
          });
          const hasPart = parts.some(
            (p) => p.type === "text" && p._partID === event.partID,
          );
          if (!hasPart) {
            parts.push({
              type: "text",
              text: next,
              _partID: event.partID,
            } as CodingTextPart);
          }
          return { ...m, parts } as CodingAssistantMessage;
        });
        return updated;
      });
      return;
    }
    if (event.type === "part") {
      const p = event.part;
      if (p?.type === "tool") {
        setMessages((prev) =>
          prev.map((m, i) => {
            if (i !== msgIndex || m.role !== "assistant") return m;
            const existing = (m as CodingAssistantMessage).parts.find(
              (x) => x.type === "tool" && x._partID === p.id,
            );
            if (!existing) {
              return {
                ...m,
                parts: [
                  ...(m as CodingAssistantMessage).parts,
                  {
                    type: "tool",
                    tool: p.tool,
                    state: p.state,
                    _partID: p.id,
                  } as CodingToolPart,
                ],
              } as CodingAssistantMessage;
            }
            return {
              ...m,
              parts: (m as CodingAssistantMessage).parts.map((x) =>
                x.type === "tool" && x._partID === p.id
                  ? { ...x, state: p.state, tool: p.tool }
                  : x,
              ),
            } as CodingAssistantMessage;
          }),
        );
      }
      return;
    }
    if (event.type === "error") {
      const errorText = event.error?.message ?? JSON.stringify(event.error);
      setMessages((prev) =>
        prev.map((m, i) => {
          if (i !== msgIndex || m.role !== "assistant") return m;
          return {
            ...m,
            parts: [
              ...(m as CodingAssistantMessage).parts,
              { type: "text", text: `Error: ${errorText}` } as CodingTextPart,
            ],
          } as CodingAssistantMessage;
        }),
      );
      return;
    }
    if (event.type === "done") {
      textBuffer.clear();
    }
  }

 // ── sendCodingMessage (

  async function sendCodingMessage(text: string) {
    if (busy() || !text.trim()) return;
    setBusy(true);
    textBuffer.clear();

 // Add user message + assistant placeholder
    setMessages((prev) => [
      ...prev,
      { role: "user", text } as CodingUserMessage,
      { role: "assistant", parts: [], streaming: true } as CodingAssistantMessage,
    ]);

    const assistantIndex = messages().length - 1;
    const controller = new AbortController();
    abortController = controller;

    try {
      const body = JSON.stringify({
        text,
        sessionID: sessionID() ?? undefined,
      });
      const res = await fetch(apiUrl("coding/message/stream"), {
        method: "POST",
        headers: { ...apiHeaders(), "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`Coding stream failed: ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          try {
            const event = JSON.parse(line.slice(5).trim());
            handleCodingEvent(assistantIndex, event);
          } catch {
 // malformed JSON — skip
          }
        }
      }
 // Process remaining buffer
      if (buffer.startsWith("data:")) {
        try {
          const event = JSON.parse(buffer.slice(5).trim());
          handleCodingEvent(assistantIndex, event);
        } catch {
 // malformed JSON — skip
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        const errText = err?.message ?? String(err);
        setMessages((prev) =>
          prev.map((m, i) => {
            if (i !== assistantIndex || m.role !== "assistant") return m;
            return {
              ...m,
              parts: [
                ...(m as CodingAssistantMessage).parts,
                { type: "text", text: `Error: ${errText}` } as CodingTextPart,
              ],
            } as CodingAssistantMessage;
          }),
        );
      }
    } finally {
 // Mark streaming complete
      setMessages((prev) =>
        prev.map((m, i) => {
          if (i !== assistantIndex || m.role !== "assistant") return m;
          return { ...m, streaming: false } as CodingAssistantMessage;
        }),
      );
      setBusy(false);
      abortController = null;
    }
  }

  onCleanup(() => {
    abortController?.abort();
  });

 // ── Tool-part rendering ──

  function ToolPartView(pProps: { part: CodingToolPart }) {
    const status = () => pProps.part.state?.status ?? "running";
    const icon = () => {
      const s = status();
      return s === "completed" ? "done" : s === "error" ? "err" : "run";
    };
    const title = () =>
      escapeHtml(pProps.part.state?.title ?? pProps.part.tool ?? "tool");
    const output = () => {
      const raw = pProps.part.state?.output;
      if (!raw) return "";
      return escapeHtml(stripAnsi(String(raw)).slice(0, 2000));
    };

    return (
      <details
        class={`tool-block tool-${status()}`}
        innerHTML={`<summary>[${icon()}] ${title()}</summary>${output() ? `<pre class="tool-output">${output()}</pre>` : ""}`}
      />
    );
  }

 // ── Message rendering ──

  function UserMessageView(mProps: { msg: CodingUserMessage }) {
    return (
      <div class="message message-user">
        <div class="message-body">
          <p>{mProps.msg.text}</p>
        </div>
      </div>
    );
  }

  function AssistantMessageView(mProps: { msg: CodingAssistantMessage }) {
    const hasParts = createMemo(() => mProps.msg.parts.length > 0);

    return (
      <div class="message message-assistant">
        <div class="message-body">
          <Show
            when={hasParts()}
            fallback={
              <Show when={mProps.msg.streaming}>
                <div class="message-text">
                  <span class="typing">……</span>
                </div>
              </Show>
            }
          >
            <For each={mProps.msg.parts}>
              {(part) => (
                <Show
                  when={part.type === "text"}
                  fallback={
                    <ToolPartView part={part as CodingToolPart} />
                  }
                >
                  <div
                    class="message-text"
                    innerHTML={renderMarkdown(
                      (part as CodingTextPart).text,
                    )}
                  />
                </Show>
              )}
            </For>
          </Show>
        </div>
      </div>
    );
  }

 // ── Render ──

  const isEmpty = createMemo(() => messages().length === 0);

  return (
    <div
      class="coding-tab-root"
      style={{ display: props.active ? "flex" : "none", "flex-direction": "column", height: "100%" }}
    >
      {/* Scroll area */}
      <div
        ref={(el) => onCleanup(setupAutoScroll(el))}
        class="chat-scroll coding-scroll"
        style={{ flex: "1 1 auto", overflow: "auto" }}
      >
        <Show
          when={!isEmpty()}
          fallback={
            <div class="chat-empty">
              Build agent — ask anything about the codebase
            </div>
          }
        >
          <For each={messages()}>
            {(msg) => (
              <Show
                when={msg.role === "user"}
                fallback={
                  <AssistantMessageView
                    msg={msg as CodingAssistantMessage}
                  />
                }
              >
                <UserMessageView msg={msg as CodingUserMessage} />
              </Show>
            )}
          </For>
        </Show>
      </div>

    </div>
  );
}
