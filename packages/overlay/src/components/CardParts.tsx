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
import { t } from "../utils/i18n"
import { isBoundaryMessagePart } from "../utils/message-part"

const KNOWN_PART_TYPES = new Set([
  "boundary",
  "text",
  "part-error",
  "reasoning",
  "tool",
  "patch",
  "file",
  "interaction-question",
  "interaction-permission",
  "subtask",
])

function unsupportedPartFallback(part: any) {
  const type = String(part?.type || "")
  if (KNOWN_PART_TYPES.has(type)) return null
  throw new Error(`CardParts unsupported part type: ${type || "<missing>"}`)
}

function partErrorSummary(part: any): string {
  const message = String(part?.message || "").trim()
  if (message) return message
  const id = String(part?.id || "").trim()
  return id ? t("chat.part_error_message", { id }) : t("chat.part_error_unknown")
}

function partErrorMeta(part: any): string {
  const originalType = String(part?.originalType || "").trim()
  const originalTool = String(part?.originalTool || "").trim()
  return [originalType ? `type=${originalType}` : "", originalTool ? `tool=${originalTool}` : ""]
    .filter(Boolean)
    .join(" · ")
}

/** Render the parts list of a card body. Handles boundary separators,
 *  inline text / reasoning, and nested tool cards. Each part renders as its
 *  own sibling. */
export function CardParts(props: { parts: any[]; depth: number; streaming?: boolean }) {
  return (
    <For each={props.parts}>
      {(part) => (
        <Switch fallback={unsupportedPartFallback(part)}>
          <Match when={isBoundaryMessagePart(part)}>
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
          <Match when={part?.type === "part-error"}>
            <div class="msg-tool-error" data-part-error-id={part.id || undefined}>
              <div>{part.title || t("chat.part_error_title")}</div>
              <div>{partErrorSummary(part)}</div>
              <Show when={partErrorMeta(part)}>{(meta) => <div>{meta()}</div>}</Show>
            </div>
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
              <span class="tool-name">{t("card.subtask")}</span>
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
