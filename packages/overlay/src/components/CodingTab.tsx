// ── CodingTab Component ──
// Solid.js port of the Coding tab.
// Renders using the same .msg / .agent-card CSS classes as the Conversation
// component so that Build mode messages get the same card treatment as task mode.

import {
  createSignal,
  onCleanup,
  For,
  Show,
  createMemo,
} from "solid-js";
import { setupAutoScroll } from "../utils/dom-utils";
import { apiUrl, apiHeaders } from "../services/api";
import { TextPart } from "./TextPart";
import { stripAnsi, displayToolIcon, toolStatusLabel } from "../utils/tool";
import {
  agentCardExpanded,
  toggleAgentCardExpanded,
  toggleToolOutputExpanded,
  toolOutputExpanded,
} from "../store/conversation-ui";
import { t } from "../utils/i18n";
import { agentStageLabel } from "../utils/message";

// ── Types ──

interface CodingTextPart {
  type: "text";
  text: string;
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

 // ── Tool-part rendering (reuses .msg-tool CSS from conversation) ──

  function CodingToolView(pProps: { part: CodingToolPart }) {
    const status = () => pProps.part.state?.status ?? "running";
    const toolName = () => pProps.part.tool || "tool";
    const icon = () => displayToolIcon(toolName());
    const statusLabel = () => toolStatusLabel(status());
    const detail = () => {
      const title = pProps.part.state?.title || "";
      return title && title.toLowerCase() !== toolName().toLowerCase() ? title : "";
    };
    const output = () => stripAnsi(pProps.part.state?.output || "").slice(0, 2000);
    const error = () => stripAnsi((pProps.part.state as any)?.error || "") || output();
    const partKey = () => pProps.part._partID || toolName();
    const isExpanded = () => toolOutputExpanded(partKey());

    return (
      <>
        <div class="msg-tool">
          <span class="tool-icon">{icon()}</span>
          <span class="tool-name">{toolName()}</span>
          <Show when={detail()}>
            <span class="tool-detail">{detail()}</span>
          </Show>
          <span class="tool-status" data-status={status()} title={statusLabel()}>
            {statusLabel()}
          </span>
        </div>
        <Show when={status() === "completed" && output()}>
          <div
            class="msg-tool-output"
            classList={{ "msg-tool-output--expanded": isExpanded() }}
            onClick={() => toggleToolOutputExpanded(partKey())}
          >
            {output()}
          </div>
        </Show>
        <Show when={status() === "error" && error()}>
          <div class="msg-tool-error">{error()}</div>
        </Show>
      </>
    );
  }

 // ── Message rendering ──

  function UserMessageView(mProps: { msg: CodingUserMessage }) {
    return (
      <article class="turn msg" data-role="user">
        <div class="msg-head">
          <span class="msg-role">{t("chat.role.user") || "You"}</span>
        </div>
        <div class="msg-bubble">
          <div class="msg-body">
            <div class="msg-text">{mProps.msg.text}</div>
          </div>
        </div>
      </article>
    );
  }

  function AssistantMessageView(mProps: { msg: CodingAssistantMessage; index: number }) {
    const cardKey = () => `coding:${mProps.index}`;
    const isStreaming = () => mProps.msg.streaming;
    const expanded = () => agentCardExpanded(cardKey(), isStreaming());
    const toggle = () => toggleAgentCardExpanded(cardKey(), isStreaming());

    const hasParts = createMemo(() => mProps.msg.parts.length > 0);
    const hasError = createMemo(() =>
      mProps.msg.parts.some(
        (p) => p.type === "text" && (p as CodingTextPart).text.startsWith("Error:"),
      ),
    );
    const toolCount = createMemo(() =>
      mProps.msg.parts.filter((p) => p.type === "tool").length,
    );

    return (
      <article
        class="turn msg agent-card"
        classList={{ "agent-card--expanded": expanded() }}
        data-role="assistant"
        data-agent-stage="executor"
      >
        <div
          class="agent-card-header"
          role="button"
          tabindex="0"
          aria-expanded={expanded()}
          onClick={toggle}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
          }}
        >
          <Show
            when={!isStreaming()}
            fallback={
              <span class="agent-card-badge agent-card-badge--running" title="Running">
                <span class="agent-card-spinner" />
              </span>
            }
          >
            <span
              class={hasError() ? "agent-card-badge agent-card-badge--error" : "agent-card-badge agent-card-badge--done"}
              title={hasError() ? "Error" : "Done"}
            >
              {hasError() ? "\u2717" : "\u2713"}
            </span>
          </Show>
          <span class="agent-card-label">{agentStageLabel("executor")}</span>
          <span class="agent-card-count">
            <Show when={toolCount() > 0}>({toolCount()})</Show>
          </span>
          <span class="agent-card-chevron" aria-hidden="true">{"\u25BC"}</span>
        </div>
        <div
          class="agent-card-body"
          classList={{ "agent-card-body--preview": !expanded() }}
          ref={(el) => onCleanup(setupAutoScroll(el))}
        >
          <Show
            when={hasParts()}
            fallback={
              <Show when={isStreaming()}>
                <div class="msg-thinking-live">
                  <span class="msg-thinking-dot" />
                  <span>{t("chat.thinking") || "Thinking…"}</span>
                </div>
              </Show>
            }
          >
            <For each={mProps.msg.parts}>
              {(part) => (
                <Show
                  when={part.type === "text"}
                  fallback={<CodingToolView part={part as CodingToolPart} />}
                >
                  <TextPart text={(part as CodingTextPart).text} />
                </Show>
              )}
            </For>
          </Show>
        </div>
      </article>
    );
  }

 // ── Render ──

  const isEmpty = createMemo(() => messages().length === 0);

  return (
    <div
      class="coding-tab-root"
      style={{ display: props.active ? "flex" : "none", "flex-direction": "column", height: "100%" }}
    >
      <div
        ref={(el) => onCleanup(setupAutoScroll(el))}
        class="chat-scroll coding-scroll"
        style={{ flex: "1 1 auto", overflow: "auto" }}
      >
        <Show
          when={!isEmpty()}
          fallback={
            <div class="chat-empty">
              {t("coding.empty") || "Build agent — ask anything about the codebase"}
            </div>
          }
        >
          <For each={messages()}>
            {(msg, idx) => (
              <Show
                when={msg.role === "user"}
                fallback={
                  <AssistantMessageView
                    msg={msg as CodingAssistantMessage}
                    index={idx()}
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
