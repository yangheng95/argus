// ── CodingMessages Component ──
// Solid.js port of renderCodingMessages / codingMessageHTML / renderMarkdown /
// sendCodingMessage / handleCodingEvent from app.js.
// Renders the build-agent chat panel with user and assistant messages,
// streaming support, and tool-call blocks.

import {
  createSignal,
  createEffect,
  For,
  Show,
  onCleanup,
} from "solid-js";
import { apiUrl, apiHeaders } from "../services/api";

// ── Types ──

interface TextPart {
  type: "text";
  text: string;
  _partID?: string;
}

interface ToolPart {
  type: "tool";
  tool: string;
  state: {
    status?: "running" | "completed" | "error";
    title?: string;
    output?: string;
  };
  _partID?: string;
}

type AssistantPart = TextPart | ToolPart;

interface UserMessage {
  role: "user";
  text: string;
}

interface AssistantMessage {
  role: "assistant";
  parts: AssistantPart[];
  streaming: boolean;
}

type CodingMessage = UserMessage | AssistantMessage;

// ── stripAnsi helper (port of app.js stripAnsi) ──

function stripAnsi(str: string): string {
  if (!str) return "";
  // eslint-disable-next-line no-control-regex
  return str.replace(
    /[\u001B\u009B][[\]()#;?]*(?:(?:(?:(?:;[-a-zA-Z\d\/#&.:=?%@~_]+)*|[a-zA-Z\d]+(?:;[-a-zA-Z\d\/#&.:=?%@~_]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))/g,
    "",
  );
}

// ── Minimal markdown renderer (port of app.js renderMarkdown) ──
// Returns an HTML string; used via innerHTML in MarkdownText below.
function renderMarkdown(text: string): string {
  // Escape HTML first, then apply markdown rules
  const escaped = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return escaped
    .replace(
      /```(\w*)\n([\s\S]*?)```/g,
      '<pre class="code-block"><code>$2</code></pre>',
    )
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

// ── MarkdownText sub-component ──

function MarkdownText(props: { text: string }) {
  return (
    // eslint-disable-next-line solid/no-innerhtml
    <div
      class="message-text"
      // biome-ignore lint: innerHTML is intentional for rendered markdown
      innerHTML={renderMarkdown(props.text)}
    />
  );
}

// ── ToolBlock sub-component ──

function ToolBlock(props: { part: ToolPart }) {
  const status = () => props.part.state?.status ?? "running";
  const icon = () =>
    status() === "completed" ? "done" : status() === "error" ? "err" : "run";
  const title = () => props.part.state?.title ?? props.part.tool ?? "tool";
  const output = () => {
    const raw = props.part.state?.output;
    if (!raw) return "";
    return stripAnsi(String(raw)).slice(0, 2000);
  };

  return (
    <details class={`tool-block tool-${status()}`}>
      <summary>
        [{icon()}] {title()}
      </summary>
      <Show when={!!output()}>
        <pre class="tool-output">{output()}</pre>
      </Show>
    </details>
  );
}

// ── AssistantMessage sub-component ──

function AssistantMessageView(props: { msg: AssistantMessage }) {
  const hasParts = () => props.msg.parts.length > 0;

  return (
    <div class="message message-assistant">
      <div class="message-body">
        <Show
          when={hasParts()}
          fallback={
            <Show when={props.msg.streaming}>
              <div class="message-text">
                <span class="typing">……</span>
              </div>
            </Show>
          }
        >
          <For each={props.msg.parts}>
            {(part) => (
              <Show
                when={part.type === "tool"}
                fallback={
                  <Show when={(part as TextPart).text}>
                    <MarkdownText text={(part as TextPart).text} />
                  </Show>
                }
              >
                <ToolBlock part={part as ToolPart} />
              </Show>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}

// ── CodingMessages ──

export function CodingMessages() {
  const [messages, setMessages] = createSignal<CodingMessage[]>([]);
  const [busy, setBusy] = createSignal(false);
  const [sessionID, setSessionID] = createSignal<string>("");

  let scrollRef: HTMLDivElement | undefined;
  let controller: AbortController | null = null;

  // Cleanup on unmount
  onCleanup(() => controller?.abort());

  // Auto-scroll to bottom when streaming
  createEffect(() => {
    const msgs = messages();
    if (!scrollRef) return;
    const atBottom =
      scrollRef.scrollHeight - scrollRef.scrollTop - scrollRef.clientHeight <
      80;
    if (atBottom) {
      // defer to after DOM update
      requestAnimationFrame(() => {
        if (scrollRef)
          scrollRef.scrollTop = scrollRef.scrollHeight;
      });
    }
  });

  // ── Event handler (port of app.js handleCodingEvent) ──

  function handleCodingEvent(
    assistantMsg: AssistantMessage,
    event: any,
    textBuffer: Map<string, string>,
  ) {
    if (event.type === "session") {
      setSessionID(event.sessionID ?? "");
      return;
    }
    if (event.type === "delta") {
      const current = textBuffer.get(event.partID) ?? "";
      const next = current + (event.delta ?? "");
      textBuffer.set(event.partID, next);
      let part = assistantMsg.parts.find(
        (p): p is TextPart =>
          p.type === "text" && p._partID === event.partID,
      );
      if (!part) {
        part = { type: "text", text: "", _partID: event.partID };
        assistantMsg.parts.push(part);
      }
      part.text = next;
      setMessages((prev) => [...prev]); // trigger reactivity
      return;
    }
    if (event.type === "part") {
      const p = event.part;
      if (p.type === "tool") {
        let existing = assistantMsg.parts.find(
          (x): x is ToolPart =>
            x.type === "tool" && x._partID === p.id,
        );
        if (!existing) {
          existing = {
            type: "tool",
            tool: p.tool,
            state: p.state,
            _partID: p.id,
          };
          assistantMsg.parts.push(existing);
        } else {
          existing.state = p.state;
          existing.tool = p.tool;
        }
        setMessages((prev) => [...prev]);
      }
      return;
    }
    if (event.type === "error") {
      assistantMsg.parts.push({
        type: "text",
        text: `Error: ${event.error?.message ?? JSON.stringify(event.error)}`,
      });
      setMessages((prev) => [...prev]);
      return;
    }
    if (event.type === "done") {
      textBuffer.clear();
    }
  }

  // ── Send message (port of app.js sendCodingMessage) ──

  async function sendMessage(text: string) {
    if (busy() || !text.trim()) return;
    setBusy(true);

    const userMsg: UserMessage = { role: "user", text };
    const assistantMsg: AssistantMessage = {
      role: "assistant",
      parts: [],
      streaming: true,
    };

    setMessages((prev) => [...prev, userMsg, assistantMsg]);

    const textBuffer = new Map<string, string>();
    const abortCtrl = new AbortController();
    controller = abortCtrl;

    try {
      const res = await fetch(apiUrl("coding/message/stream"), {
        method: "POST",
        headers: {
          ...apiHeaders(),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          text,
          sessionID: sessionID() || undefined,
        }),
        signal: abortCtrl.signal,
      });
      if (!res.ok || !res.body)
        throw new Error(`Coding stream failed: ${res.status}`);

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
            handleCodingEvent(assistantMsg, event, textBuffer);
          } catch {
            // ignore malformed SSE lines
          }
        }
      }
      if (buffer.startsWith("data:")) {
        try {
          const event = JSON.parse(buffer.slice(5).trim());
          handleCodingEvent(assistantMsg, event, textBuffer);
        } catch {
          // ignore
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        const errText = err?.message ?? String(err);
        assistantMsg.parts.push({ type: "text", text: `Error: ${errText}` });
      }
    } finally {
      assistantMsg.streaming = false;
      setBusy(false);
      controller = null;
      setMessages((prev) => [...prev]);
    }
  }

  // ── Input handler ──

  let inputRef: HTMLTextAreaElement | undefined;

  function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    const text = inputRef?.value?.trim() ?? "";
    if (!text) return;
    if (inputRef) inputRef.value = "";
    void sendMessage(text);
  }

  return (
    <div class="coding-panel">
      {/* Scrollable message area */}
      <div class="coding-scroll chat-scroll" ref={scrollRef}>
        <Show
          when={messages().length > 0}
          fallback={
            <div class="chat-empty">
              Build agent — ask anything about the codebase
            </div>
          }
        >
          <For each={messages()}>
            {(msg) => (
              <Show
                when={msg.role === "assistant"}
                fallback={
                  <div class="message message-user">
                    <div class="message-body">
                      <p>{(msg as UserMessage).text}</p>
                    </div>
                  </div>
                }
              >
                <AssistantMessageView
                  msg={msg as AssistantMessage}
                />
              </Show>
            )}
          </For>
        </Show>
      </div>

      {/* Input form */}
      <form class="coding-form" onSubmit={handleSubmit}>
        <textarea
          ref={inputRef}
          class="coding-input"
          placeholder="Ask about the codebase…"
          rows={3}
          disabled={busy()}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const text = inputRef?.value?.trim() ?? "";
              if (!text) return;
              if (inputRef) inputRef.value = "";
              void sendMessage(text);
            }
          }}
        />
        <button
          type="submit"
          class="coding-send"
          disabled={busy()}
        >
          Send
        </button>
      </form>
    </div>
  );
}
