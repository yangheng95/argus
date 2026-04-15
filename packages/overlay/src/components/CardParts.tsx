import { For, Switch, Match, Show } from "solid-js";
import { TextPart } from "./TextPart";
import { ReasoningPart, isEmptyReasoning } from "./ReasoningPart";
import { InlineToolPart } from "./InlineToolPart";
import { InteractionQuestionPart } from "./InteractionQuestionPart";
import { InteractionPermissionPart } from "./InteractionPermissionPart";
import { Card } from "./Card";
import { shouldPromoteTool, type CardNode } from "../utils/card-tree";
import { stamp } from "../utils/time";
import { toolNameKey, displayToolDetail, shortRelativePath } from "../utils/tool";
import { escapeHtml } from "../utils/markdown";
import { activeDirectory } from "../store/board";

function renderFilePart(part: any): string {
  const url = part.url || part.filename || "";
  const name = part.filename || url || "file";
  const mime = part.mime || part.mediaType || "";
  const isImg =
    (mime && mime.startsWith("image/")) ||
    /^data:image\//i.test(url) ||
    /\.(png|jpe?g|gif|webp|svg|bmp|ico)(\?|$)/i.test(url);
  if (isImg && url) {
    return `<div class="msg-img-wrap"><img class="md-img" src="${escapeHtml(url)}" alt="${escapeHtml(name)}" loading="lazy"></div>`;
  }
  return `<div class="msg-text" style="font-family:var(--mono);font-size:var(--ui-font-small);color:var(--text-soft)">${escapeHtml(name)}</div>`;
}

/** Build a transient CardNode for a promoted tool part so <Card> can frame it. */
function toolToCardNode(part: any): CardNode {
  const status = (() => {
    const s = String(part?.state?.status || "").toLowerCase();
    if (s === "pending" || s === "running" || s === "completed" || s === "error") return s as any;
    if (s === "failed") return "error";
    return undefined;
  })();
  const toolName = String(part?.tool || "tool");
  const state = part?.state || {};
  const detail = displayToolDetail(toolName, state.input || {}, state, activeDirectory());
  const subtitle =
    detail && detail.toLowerCase() !== toolName.toLowerCase() ? detail : undefined;
  return {
    id: String(part?.id || `tool:${toolName}:${Math.random().toString(36).slice(2)}`),
    kind: "tool",
    stage: toolNameKey(toolName),
    status,
    title: toolName,
    subtitle,
    parts: [],
    children: [],
    toolPart: part,
  };
}

/** Render the parts list of a card body. Handles boundary separators,
 *  inline text / reasoning, and tool promotion (promoted tools are rendered
 *  as nested <Card>s so they fold independently). */
export function CardParts(props: { parts: any[]; depth: number }) {
  return (
    <For each={props.parts}>
      {(part: any) => (
        <Switch fallback={null}>
          <Match when={part.type === "boundary"}>
            <div class="card-boundary">
              <span class="card-boundary-role">{part.roleLabel}</span>
              <Show when={part.time}>
                <span class="card-boundary-time">{stamp(part.time)}</span>
              </Show>
            </div>
          </Match>
          <Match when={part.type === "text" && (part.text || "").trim()}>
            <TextPart text={part.text || ""} />
          </Match>
          <Match
            when={
              part.type === "reasoning" &&
              (part.text || "").trim() &&
              !isEmptyReasoning(part.text || "")
            }
          >
            <ReasoningPart part={part} />
          </Match>
          <Match when={part.type === "tool" && shouldPromoteTool(part)}>
            <Card node={toolToCardNode(part)} depth={props.depth + 1} />
          </Match>
          <Match when={part.type === "tool"}>
            <InlineToolPart part={part} mode="block" />
          </Match>
          <Match when={part.type === "patch" && (part.files || []).length > 0}>
            <div class="msg-patch">
              {"\u2699 " +
                (part.files || [])
                  .map((f: string) => shortRelativePath(f, activeDirectory()))
                  .join(", ")}
            </div>
          </Match>
          <Match when={part.type === "file"}>
            <div innerHTML={renderFilePart(part)} />
          </Match>
          <Match when={part.type === "interaction-question" && part.interaction}>
            <InteractionQuestionPart interaction={part.interaction} />
          </Match>
          <Match when={part.type === "interaction-permission" && part.interaction}>
            <InteractionPermissionPart interaction={part.interaction} />
          </Match>
          <Match when={part.type === "subtask"}>
            <div class="msg-tool">
              <span class="tool-icon">{"\u2192"}</span>
              <span class="tool-name">Subtask</span>
              <span class="tool-detail">{part.description || part.prompt || ""}</span>
            </div>
          </Match>
        </Switch>
      )}
    </For>
  );
}
