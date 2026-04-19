import { For, Switch, Match, Show, createMemo } from "solid-js";
import { TextPart } from "./TextPart";
import { ReasoningPart, isEmptyReasoning } from "./ReasoningPart";
import { InlineToolPart } from "./InlineToolPart";
import { InteractionCard } from "./InteractionCard";
import { Card } from "./Card";
import { FilePart } from "./FilePart";
import { shouldPromoteTool, type CardNode } from "../utils/card-tree";
import { stamp } from "../utils/time";
import { toolNameKey, displayToolDetail, shortRelativePath } from "../utils/tool";
import { selectedTaskDirectory } from "../store/board";
import { t } from "../utils/i18n";

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
  const detail = displayToolDetail(toolName, state.input || {}, state, selectedTaskDirectory());
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

/** Render-time grouping: consecutive tool parts of the same "aggregator" kind
 *  (currently the architect's `register_contract`) are collapsed under one
 *  `<details>` so a session with dozens of contracts doesn't unroll its whole
 *  payload by default. Each contract inside still renders via the normal
 *  `toolToCardNode` + `<Card>` path — same header, same accent, same fold
 *  semantics. No new CardKind, no cardTreeStore write, no backend event:
 *  this is purely the `parts[]` walker deciding to render a run of sibling
 *  parts under one shared summary.
 *
 *  Extending to another tool: add its canonical name to `AGGREGATOR_TOOLS`
 *  and, if needed, a matching `contracts.group_title` i18n key. */
const AGGREGATOR_TOOLS = new Set(["register_contract", "registercontract"]);

function isAggregatorToolPart(part: any): boolean {
  if (!part || part.type !== "tool") return false;
  const name = String(part.tool || "").trim().toLowerCase();
  return AGGREGATOR_TOOLS.has(name);
}

type PartSegment =
  | { kind: "single"; part: any }
  | { kind: "aggregator"; tool: string; parts: any[] };

function segmentParts(parts: any[]): PartSegment[] {
  const segments: PartSegment[] = [];
  let current: Extract<PartSegment, { kind: "aggregator" }> | null = null;
  for (const part of parts || []) {
    if (isAggregatorToolPart(part)) {
      const tool = String(part.tool || "").trim().toLowerCase();
      if (!current || current.tool !== tool) {
        current = { kind: "aggregator", tool, parts: [] };
        segments.push(current);
      }
      current.parts.push(part);
      continue;
    }
    current = null;
    segments.push({ kind: "single", part });
  }
  return segments;
}

/** Localised header for an aggregator group. Keyed by tool name so future
 *  aggregators (e.g. the evaluator's per-goal scorer runs) can register their
 *  own label without touching this function's logic. */
function aggregatorTitle(tool: string): string {
  if (tool === "register_contract" || tool === "registercontract") {
    return t("contracts.group_title");
  }
  return tool;
}

/** Render the parts list of a card body. Handles boundary separators,
 *  inline text / reasoning, and tool promotion (promoted tools are rendered
 *  as nested <Card>s so they fold independently). */
export function CardParts(props: { parts: any[]; depth: number }) {
  const segments = createMemo(() => segmentParts(props.parts));
  return (
    <For each={segments()}>
      {(segment) => (
        <Switch fallback={null}>
          <Match when={segment.kind === "aggregator"}>
            <Show
              when={
                segment.kind === "aggregator" &&
                (segment as Extract<PartSegment, { kind: "aggregator" }>).parts.length > 0
              }
            >
              {(() => {
                const agg = segment as Extract<PartSegment, { kind: "aggregator" }>;
                return (
                  <details class="card__aggregator" data-tool={agg.tool}>
                    <summary class="card__aggregator-head">
                      <span class="card__aggregator-chevron" aria-hidden="true">▸</span>
                      <span class="card__aggregator-title">{aggregatorTitle(agg.tool)}</span>
                      <span class="card__aggregator-count">{agg.parts.length}</span>
                    </summary>
                    <div class="card__aggregator-body">
                      <For each={agg.parts}>
                        {(part) => <Card node={toolToCardNode(part)} depth={props.depth + 1} />}
                      </For>
                    </div>
                  </details>
                );
              })()}
            </Show>
          </Match>
          <Match
            when={
              segment.kind === "single" &&
              (segment as Extract<PartSegment, { kind: "single" }>).part.type === "boundary"
            }
          >
            {(() => {
              const part = (segment as Extract<PartSegment, { kind: "single" }>).part;
              return (
                <div class="card-boundary">
                  <span class="card-boundary-role">{part.roleLabel}</span>
                  <Show when={part.time}>
                    <span class="card-boundary-time">{stamp(part.time)}</span>
                  </Show>
                </div>
              );
            })()}
          </Match>
          <Match
            when={
              segment.kind === "single" &&
              (() => {
                const part = (segment as Extract<PartSegment, { kind: "single" }>).part;
                return part.type === "text" && (part.text || "").trim();
              })()
            }
          >
            <TextPart
              text={(segment as Extract<PartSegment, { kind: "single" }>).part.text || ""}
            />
          </Match>
          <Match
            when={
              segment.kind === "single" &&
              (() => {
                const part = (segment as Extract<PartSegment, { kind: "single" }>).part;
                return (
                  part.type === "reasoning" &&
                  (part.text || "").trim() &&
                  !isEmptyReasoning(part.text || "")
                );
              })()
            }
          >
            <ReasoningPart
              part={(segment as Extract<PartSegment, { kind: "single" }>).part}
            />
          </Match>
          <Match
            when={
              segment.kind === "single" &&
              (() => {
                const part = (segment as Extract<PartSegment, { kind: "single" }>).part;
                return part.type === "tool" && shouldPromoteTool(part);
              })()
            }
          >
            <Card
              node={toolToCardNode(
                (segment as Extract<PartSegment, { kind: "single" }>).part,
              )}
              depth={props.depth + 1}
            />
          </Match>
          <Match
            when={
              segment.kind === "single" &&
              (segment as Extract<PartSegment, { kind: "single" }>).part.type === "tool"
            }
          >
            <InlineToolPart
              part={(segment as Extract<PartSegment, { kind: "single" }>).part}
              mode="block"
            />
          </Match>
          <Match
            when={
              segment.kind === "single" &&
              (() => {
                const part = (segment as Extract<PartSegment, { kind: "single" }>).part;
                return part.type === "patch" && (part.files || []).length > 0;
              })()
            }
          >
            {(() => {
              const part = (segment as Extract<PartSegment, { kind: "single" }>).part;
              return (
                <div class="msg-patch">
                  {"\u2699 " +
                    (part.files || [])
                      .map((f: string) => shortRelativePath(f, selectedTaskDirectory()))
                      .join(", ")}
                </div>
              );
            })()}
          </Match>
          <Match
            when={
              segment.kind === "single" &&
              (segment as Extract<PartSegment, { kind: "single" }>).part.type === "file"
            }
          >
            <FilePart
              part={(segment as Extract<PartSegment, { kind: "single" }>).part}
            />
          </Match>
          <Match
            when={
              segment.kind === "single" &&
              (() => {
                const part = (segment as Extract<PartSegment, { kind: "single" }>).part;
                return (
                  (part.type === "interaction-question" ||
                    part.type === "interaction-permission") &&
                  part.interaction
                );
              })()
            }
          >
            <InteractionCard
              interaction={
                (segment as Extract<PartSegment, { kind: "single" }>).part.interaction
              }
            />
          </Match>
          <Match
            when={
              segment.kind === "single" &&
              (segment as Extract<PartSegment, { kind: "single" }>).part.type === "subtask"
            }
          >
            {(() => {
              const part = (segment as Extract<PartSegment, { kind: "single" }>).part;
              return (
                <div class="msg-tool">
                  <span class="tool-icon">{"\u2192"}</span>
                  <span class="tool-name">Subtask</span>
                  <span class="tool-detail">{part.description || part.prompt || ""}</span>
                </div>
              );
            })()}
          </Match>
        </Switch>
      )}
    </For>
  );
}
