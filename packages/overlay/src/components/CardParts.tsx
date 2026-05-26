import { For, Switch, Match, Show } from "solid-js";
import { TextPart } from "./TextPart";
import { ReasoningPart, isEmptyReasoning } from "./ReasoningPart";
import { InteractionCard } from "./InteractionCard";
import { Card } from "./Card";
import { FilePart } from "./FilePart";
import { type CardNode } from "../utils/card-tree";
import { stamp, fullStampWithRelative } from "../utils/time";
import { toolNameKey, displayToolArguments, shortRelativePath } from "../utils/tool";
import { selectedTaskDirectory } from "../store/board";

const TODO_CARD_TITLES: Record<string, string> = {
  todowrite: "Todos",
  todoread: "Todos",
  todoupdate: "Todos",
  updateplan: "Plan",
};

/** Build a transient CardNode for a tool part so every tool shares the same
 *  card chrome. Completed tools intentionally inherit the card default of
 *  starting collapsed so the timeline only shows header-level summary. */
function toolToCardNode(part: any): CardNode {
  const status = (() => {
    const s = String(part?.state?.status || "").toLowerCase();
    if (s === "pending" || s === "running" || s === "completed" || s === "error") return s as any;
    if (s === "failed") return "error";
    return undefined;
  })();
  const toolName = String(part?.tool || "tool");
  const state = part?.state || {};
  const key = toolNameKey(toolName);
  const args = displayToolArguments(toolName, state.input, state, selectedTaskDirectory());
  const title = TODO_CARD_TITLES[key] || toolName;
  return {
    id: String(part?.id || `tool:${toolName}:${Math.random().toString(36).slice(2)}`),
    kind: "tool",
    stage: key,
    status,
    title,
    subtitle: args || undefined,
    parts: [],
    children: [],
    toolPart: part,
    // Transient tool cards are always nested; this value never enters the
    // top-level sort (rebuildTopLevelOrder filters on card.kind === "tool").
    // Observation time is sufficient for the required `time` field.
    time: Date.now(),
  };
}

/** Render the parts list of a card body. Handles boundary separators,
 *  inline text / reasoning, and nested tool cards. Each part renders as its
 *  own sibling. */
export function CardParts(props: { parts: any[]; depth: number; streaming?: boolean }) {
  return (
    <For each={props.parts}>
      {(part) => (
        <Switch fallback={null}>
          <Match when={part?.type === "boundary"}>
            <div class="card-boundary">
              <span class="card-boundary-role">{part.roleLabel}</span>
              <Show when={part.time}>
                <span
                  class="card-boundary-time"
                  title={fullStampWithRelative(part.time)}
                >{stamp(part.time)}</span>
              </Show>
            </div>
          </Match>
          <Match when={part?.type === "text" && (part.text || "").trim()}>
            <TextPart text={part.text || ""} streaming={props.streaming} />
          </Match>
          <Match
            when={
              part?.type === "reasoning" &&
              (part.text || "").trim() &&
              !isEmptyReasoning(part.text || "")
            }
          >
            <ReasoningPart part={part} streaming={props.streaming} />
          </Match>
          <Match when={part?.type === "tool"}>
            <Card node={toolToCardNode(part)} depth={props.depth + 1} />
          </Match>
          <Match when={part?.type === "patch" && (part.files || []).length > 0}>
            <div class="msg-patch">
              {"\u2699 " +
                (part.files || [])
                  .map((f: string) => shortRelativePath(f, selectedTaskDirectory()))
                  .join(", ")}
            </div>
          </Match>
          <Match when={part?.type === "file"}>
            <FilePart part={part} />
          </Match>
          <Match
            when={
              (part?.type === "interaction-question" ||
                part?.type === "interaction-permission") &&
              part.interaction
            }
          >
            <InteractionCard interaction={part.interaction} />
          </Match>
          <Match when={part?.type === "subtask"}>
            <div class="msg-tool">
              <span class="tool-icon">{"\u2192"}</span>
              <span class="tool-name">Subtask</span>
              <span class="tool-detail" title={part.description || part.prompt || ""}>
                {part.description || part.prompt || ""}
              </span>
            </div>
          </Match>
        </Switch>
      )}
    </For>
  );
}
