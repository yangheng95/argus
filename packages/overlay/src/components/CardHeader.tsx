import { Show } from "solid-js";
import { displayToolIcon } from "../utils/tool";
import type { CardNode } from "../utils/card-tree";

function statusBadge(node: CardNode): { tone: string; glyph: string } {
  const s = node.status;
  if (s === "running") return { tone: "running", glyph: "" };
  if (s === "error") return { tone: "error", glyph: "\u2717" };
  if (s === "skipped") return { tone: "skipped", glyph: "\u2014" };
  if (s === "pending") return { tone: "pending", glyph: "\u00B7" };
  if (s === "completed") return { tone: "done", glyph: "\u2713" };
  if (node.kind === "message") return { tone: "neutral", glyph: "" };
  return { tone: "done", glyph: "\u2713" };
}

function leadingGlyph(node: CardNode): string {
  if (node.kind === "tool") return displayToolIcon(node.title);
  return "";
}

export function CardHeader(props: {
  node: CardNode;
  expanded: boolean;
  collapsible: boolean;
  onToggle: () => void;
}) {
  const badge = () => statusBadge(props.node);
  const glyph = () => leadingGlyph(props.node);

  return (
    <div
      class="card__head"
      role={props.collapsible ? "button" : undefined}
      tabindex={props.collapsible ? 0 : undefined}
      aria-expanded={props.collapsible ? props.expanded : undefined}
      onClick={() => props.collapsible && props.onToggle()}
      onKeyDown={(e) => {
        if (!props.collapsible) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          props.onToggle();
        }
      }}
    >
      <Show
        when={props.node.status !== "running"}
        fallback={
          <span class="card__badge card__badge--running" title="running">
            <span class="card__spinner" />
          </span>
        }
      >
        <span class={`card__badge card__badge--${badge().tone}`} title={props.node.status || ""}>
          {badge().glyph}
        </span>
      </Show>
      <Show when={glyph()}>
        <span class="card__icon">{glyph()}</span>
      </Show>
      <span class="card__title">{props.node.title}</span>
      <Show when={(props.node.round ?? 0) > 0}>
        <span class="card__round">#{props.node.round}</span>
      </Show>
      <Show when={props.node.subtitle}>
        <span class="card__subtitle">{props.node.subtitle}</span>
      </Show>
      <Show when={props.collapsible}>
        <span class="card__chevron" aria-hidden="true">
          {"\u25BC"}
        </span>
      </Show>
    </div>
  );
}
