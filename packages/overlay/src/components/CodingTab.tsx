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
} from "solid-js";
import { createStore, produce } from "solid-js/store";
import { setupAutoScroll } from "../utils/dom-utils";
import { apiUrl, apiHeaders } from "../services/api";
import { Card } from "./Card";
import type { CardNode, CardStatus } from "../utils/card-tree";
import { t } from "../utils/i18n";
import { agentStageLabel } from "../utils/message";

// ── Types ──

interface CodingTextPart {
  type: "text";
  text: string;
  _partID?: string;
  state?: never;
  tool?: never;
  files?: never;
}

interface CodingReasoningPart {
  type: "reasoning";
  text: string;
  _partID?: string;
  state?: never;
  tool?: never;
  files?: never;
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
  text?: never;
  files?: never;
}

interface CodingPatchPart {
  type: "patch";
  files: string[];
  _partID?: string;
  text?: never;
  state?: never;
  tool?: never;
}

type CodingPart = CodingTextPart | CodingReasoningPart | CodingToolPart | CodingPatchPart;

interface CodingUserMessage {
  role: "user";
  text: string;
  // These never-typed fields make "parts" and "streaming" valid keys on the
  // CodingMessage union, so Solid.js store setter path inference doesn't fail.
  parts?: never;
  streaming?: never;
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

// ── Render ──

  /** Map a CodingMessage list to CardNode tree consumed by <Card>. */
  function codingTree(messages: CodingMessage[]): CardNode[] {
    return messages.map((msg, i): CardNode => {
      if (msg.role === "user") {
        return {
          id: `coding:user:${i}`,
          kind: "message",
          role: "user",
          title: t("chat.role.user"),
          parts: [{ type: "text", text: msg.text }],
          children: [],
        };
      }
      const a = msg as CodingAssistantMessage;
      const hasError = a.parts.some(
        (p) => p.type === "text" && (p as CodingTextPart).text.startsWith("Error:"),
      );
      const status: CardStatus = a.streaming ? "running" : (hasError ? "error" : "completed");
      const toolCount = a.parts.filter((p) => p.type === "tool").length;
      // CodingPart is shape-compatible with CardParts' expected part schema:
      //   text/reasoning carry .text; tool carries .tool + .state; patch carries .files.
      // _partID is ignored by downstream renderers.
      return {
        id: `coding:${i}`,
        kind: "agent",
        stage: "executor",
        status,
        title: agentStageLabel("executor"),
        subtitle: toolCount > 0 ? `${toolCount} tools` : undefined,
        parts: a.parts as any[],
        children: [],
      };
    });
  }

  const isEmpty = createMemo(() => store.messages.length === 0);
  const tree = createMemo(() => codingTree(store.messages));

  return (
    <div
      class="coding-tab-root"
      style={{ display: "flex", "flex-direction": "column", height: "100%", "min-width": 0 }}
    >
      <div
        ref={(el) => onCleanup(setupAutoScroll(el))}
        class="chat-scroll coding-scroll"
        style={{ flex: "1 1 auto", overflow: "auto" }}
      >
        <Show
          when={!isEmpty()}
          fallback={<div class="chat-empty">{t("coding.empty")}</div>}
        >
          <For each={tree()}>
            {(node) => <Card node={node} depth={0} />}
          </For>
        </Show>
      </div>
    </div>
  );
}
