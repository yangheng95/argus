import { For, Switch, Match, Show } from "solid-js"
import { TextPart } from "./TextPart"
import { ReasoningPart, isEmptyReasoning } from "./ReasoningPart"
import { InteractionCard } from "./InteractionCard"
import { Card } from "./Card"
import { FilePart } from "./FilePart"
import { stamp, fullStampWithRelative } from "../utils/time"
import { shortRelativePath } from "../utils/tool"
import { selectedTaskDirectory } from "../store/board"
import { toolToCardNode } from "../utils/tool-card-node"

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
                <span class="card-boundary-time" title={fullStampWithRelative(part.time)}>
                  {stamp(part.time)}
                </span>
              </Show>
            </div>
          </Match>
          <Match when={part?.type === "text" && (part.text || "").trim()}>
            <TextPart text={part.text || ""} streaming={props.streaming} />
          </Match>
          <Match when={part?.type === "reasoning" && (part.text || "").trim() && !isEmptyReasoning(part.text || "")}>
            <ReasoningPart part={part} streaming={props.streaming} />
          </Match>
          <Match when={part?.type === "tool"}>
            <Card node={toolToCardNode(part)} depth={props.depth + 1} />
          </Match>
          <Match when={part?.type === "patch" && (part.files || []).length > 0}>
            <div class="msg-patch">
              {"\u2699 " +
                (part.files || []).map((f: string) => shortRelativePath(f, selectedTaskDirectory())).join(", ")}
            </div>
          </Match>
          <Match when={part?.type === "file"}>
            <FilePart part={part} />
          </Match>
          <Match
            when={
              (part?.type === "interaction-question" || part?.type === "interaction-permission") && part.interaction
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
  )
}
