// ── CodingTab Component ──
// Solid.js port of the Coding tab.
// Uses createStore for fine-grained reactive updates so that <For> can track
// list items by reference and TextPart's streaming state is preserved across
// delta events — same pattern as the task-mode message store.

import {
  createMemo,
  onCleanup,
  For,
  Show,
  Switch,
  Match,
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import { setupAutoScroll } from "../utils/dom-utils";
import { apiUrl, apiHeaders } from "../services/api";
import { TextPart, StaticTextPart } from "./TextPart";
import { ReasoningPart, isEmptyReasoning } from "./ReasoningPart";
import {
  stripAnsi,
  displayToolIcon,
  displayToolDetail,
  toolStatusLabel,
  shortRelativePath,
} from "../utils/tool";
import {
  agentCardExpanded,
  toggleAgentCardExpanded,
  toggleToolOutputExpanded,
  toolOutputExpanded,
} from "../store/conversation-ui";
import { activeDirectory } from "../store/board";
import { t } from "../utils/i18n";
import { agentStageLabel } from "../utils/message";

// ── Types ──

interface CodingTextPart {
  type: "text";
  text: string;
  _partID?: string;
}

interface CodingReasoningPart {
  type: "reasoning";
  text: string;
  _partID?: string;
}

interface CodingToolState {
  status: "pending" | "running" | "completed" | "error";
  title?: string;
  input?: Record<string, any>;
  output?: string;
  error?: string;
  raw?: string;
}

interface CodingToolPart {
  type: "tool";
  tool: string;
  state: CodingToolState;
  _partID?: string;
}

interface CodingPatchPart {
  type: "patch";
  files: string[];
  _partID?: string;
}

type CodingPart = CodingTextPart | CodingReasoningPart | CodingToolPart | CodingPatchPart;

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
  active: boolean;
  onReady?: (api: CodingTabAPI) => void;
}

export interface CodingTabAPI {
  send: (text: string) => void;
  stop: () => void;
  busy: () => boolean;
}

export function CodingTab(props: CodingTabProps) {
// ── Store (fine-grained, same pattern as messageStore) ──

  const [store, setStore] = createStore({
    messages: [] as CodingMessage[],
    sessionID: null as string | null,
    busy: false,
  });

  const busy = () => store.busy;

  let abortController: AbortController | null = null;

  props.onReady?.({
    send: (text: string) => void sendCodingMessage(text),
    stop: () => abortController?.abort(),
    busy,
  });

// ── handleCodingEvent ──

  function handleCodingEvent(msgIndex: number, event: Record<string, any>) {
    if (event.type === "session") {
      setStore("sessionID", event.sessionID ?? null);
      return;
    }

    if (event.type === "delta") {
      const field: string = event.field ?? "text";
      const partID: string = event.partID;
      const delta: string = event.delta ?? "";

      const parts = (store.messages[msgIndex] as CodingAssistantMessage)?.parts;
      if (!parts) return;

      if (field === "raw") {
        const partIdx = parts.findIndex(
          (p) => p.type === "tool" && (p as CodingToolPart)._partID === partID,
        );
        if (partIdx < 0) return;
        setStore("messages", msgIndex, "parts", partIdx, "state", "raw",
          (prev: string | undefined) => (prev ?? "") + delta,
        );
        return;
      }

      // field === "text"
      const partIdx = parts.findIndex(
        (p) => (p.type === "text" || p.type === "reasoning") && p._partID === partID,
      );
      if (partIdx >= 0) {
        setStore("messages", msgIndex, "parts", partIdx, "text",
          (prev: string | undefined) => (prev ?? "") + delta,
        );
      } else {
        setStore("messages", msgIndex, "parts",
          produce((ps: CodingPart[]) => {
            ps.push({ type: "text", text: delta, _partID: partID } as CodingTextPart);
          }),
        );
      }
      return;
    }

    if (event.type === "part") {
      const p = event.part;
      if (!p) return;

      if (p.type === "tool") {
        const parts = (store.messages[msgIndex] as CodingAssistantMessage)?.parts;
        if (!parts) return;
        const partIdx = parts.findIndex(
          (x) => x.type === "tool" && (x as CodingToolPart)._partID === p.id,
        );
        if (partIdx >= 0) {
          setStore("messages", msgIndex, "parts", partIdx, "state", p.state);
          setStore("messages", msgIndex, "parts", partIdx, "tool", p.tool);
        } else {
          setStore("messages", msgIndex, "parts",
            produce((ps: CodingPart[]) => {
              ps.push({
                type: "tool",
                tool: p.tool,
                state: p.state ?? { status: "pending", input: {}, raw: "" },
                _partID: p.id,
              } as CodingToolPart);
            }),
          );
        }
        return;
      }

      if (p.type === "reasoning") {
        const parts = (store.messages[msgIndex] as CodingAssistantMessage)?.parts;
        if (!parts) return;
        const partIdx = parts.findIndex((x) => x._partID === p.id);
        if (partIdx >= 0) {
          // Upgrade existing placeholder to reasoning
          setStore("messages", msgIndex, "parts", partIdx, "type", "reasoning");
        } else {
          setStore("messages", msgIndex, "parts",
            produce((ps: CodingPart[]) => {
              ps.push({ type: "reasoning", text: p.text ?? "", _partID: p.id } as CodingReasoningPart);
            }),
          );
        }
        return;
      }

      if (p.type === "patch") {
        const files: string[] = p.files ?? [];
        if (files.length === 0) return;
        const parts = (store.messages[msgIndex] as CodingAssistantMessage)?.parts;
        if (!parts) return;
        const partIdx = parts.findIndex((x) => x._partID === p.id);
        if (partIdx >= 0) {
          setStore("messages", msgIndex, "parts", partIdx, "files", files);
        } else {
          setStore("messages", msgIndex, "parts",
            produce((ps: CodingPart[]) => {
              ps.push({ type: "patch", files, _partID: p.id } as CodingPatchPart);
            }),
          );
        }
        return;
      }

      return;
    }

    if (event.type === "error") {
      const errorText = event.error?.message ?? JSON.stringify(event.error);
      setStore("messages", msgIndex, "parts",
        produce((ps: CodingPart[]) => {
          ps.push({ type: "text", text: `Error: ${errorText}` } as CodingTextPart);
        }),
      );
      return;
    }

    if (event.type === "done") {
      setStore("messages", msgIndex, "streaming", false);
    }
  }

// ── sendCodingMessage ──

  async function sendCodingMessage(text: string) {
    if (store.busy || !text.trim()) return;
    setStore("busy", true);

    setStore("messages",
      produce((msgs: CodingMessage[]) => {
        msgs.push({ role: "user", text } as CodingUserMessage);
        msgs.push({ role: "assistant", parts: [], streaming: true } as CodingAssistantMessage);
      }),
    );

    const assistantIndex = store.messages.length - 1;
    const controller = new AbortController();
    abortController = controller;

    try {
      const res = await fetch(apiUrl("coding/message/stream"), {
        method: "POST",
        headers: { ...apiHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ text, sessionID: store.sessionID ?? undefined }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error(`Coding stream failed: ${res.status}`);

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
            handleCodingEvent(assistantIndex, JSON.parse(line.slice(5).trim()));
          } catch {
            // malformed JSON — skip
          }
        }
      }
      if (buffer.startsWith("data:")) {
        try {
          handleCodingEvent(assistantIndex, JSON.parse(buffer.slice(5).trim()));
        } catch {
          // malformed JSON — skip
        }
      }
    } catch (err: any) {
      if (err?.name !== "AbortError") {
        setStore("messages", assistantIndex, "parts",
          produce((ps: CodingPart[]) => {
            ps.push({ type: "text", text: `Error: ${err?.message ?? String(err)}` } as CodingTextPart);
          }),
        );
      }
    } finally {
      setStore("messages", assistantIndex, "streaming", false);
      setStore("busy", false);
      abortController = null;
    }
  }

  onCleanup(() => {
    abortController?.abort();
  });

// ── Tool-part rendering ──

  function CodingToolView(pProps: { part: CodingToolPart }) {
    const status = () => pProps.part.state?.status ?? "running";
    const toolName = () => pProps.part.tool || "tool";
    const input = () => pProps.part.state?.input ?? {};
    const detail = () => {
      const raw = displayToolDetail(toolName(), input(), pProps.part.state ?? {}, activeDirectory());
      return raw && raw.toLowerCase() !== toolName().toLowerCase() ? raw : "";
    };
    const raw = () => pProps.part.state?.raw || "";
    const output = () => stripAnsi(pProps.part.state?.output || "");
    const error = () => stripAnsi(pProps.part.state?.error || "") || output();
    const partKey = () => pProps.part._partID || toolName();
    const isExpanded = () => toolOutputExpanded(partKey());

    return (
      <>
        <div class="msg-tool">
          <span class="tool-icon">{displayToolIcon(toolName())}</span>
          <span class="tool-name">{toolName()}</span>
          <Show when={detail()}>
            <span class="tool-detail">{detail()}</span>
          </Show>
          <span class="tool-status" data-status={status()} title={toolStatusLabel(status())}>
            {toolStatusLabel(status())}
          </span>
        </div>
        <Show when={status() === "pending" && raw()}>
          <div class="msg-tool-input">{raw()}</div>
        </Show>
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
            <StaticTextPart text={mProps.msg.text} />
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
                <Switch fallback={null}>
                  <Match when={part.type === "text" && (part as CodingTextPart).text.trim()}>
                    <TextPart text={(part as CodingTextPart).text} />
                  </Match>
                  <Match when={
                    part.type === "reasoning" &&
                    (part as CodingReasoningPart).text.trim() &&
                    !isEmptyReasoning((part as CodingReasoningPart).text)
                  }>
                    <ReasoningPart part={part} />
                  </Match>
                  <Match when={part.type === "tool"}>
                    <CodingToolView part={part as CodingToolPart} />
                  </Match>
                  <Match when={part.type === "patch" && (part as CodingPatchPart).files.length > 0}>
                    <div class="msg-patch">
                      {"\u2699 " +
                        (part as CodingPatchPart).files
                          .map((f) => shortRelativePath(f, activeDirectory()))
                          .join(", ")}
                    </div>
                  </Match>
                </Switch>
              )}
            </For>
          </Show>
        </div>
      </article>
    );
  }

// ── Render ──

  const isEmpty = createMemo(() => store.messages.length === 0);

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
          <For each={store.messages}>
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
