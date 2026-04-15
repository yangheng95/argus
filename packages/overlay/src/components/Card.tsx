import { For, Show } from "solid-js";
import type { CardNode } from "../utils/card-tree";
import { defaultExpandedForNode } from "../utils/card-tree";
import { cardExpanded, toggleCard } from "../store/conversation-ui";
import { CardHeader } from "./CardHeader";
import { CardParts } from "./CardParts";
import { InlineToolPart } from "./InlineToolPart";
import { StaticTextPart } from "./TextPart";

/**
 * Unified recursive card primitive.
 *
 * Every conversation item — whether a goal group, a stage agent card,
 * a promoted tool call, or a plain message bubble — is rendered through
 * this component. Nesting is handled by recursion on `node.children`.
 *
 * Folding state lives in the unified `expandedCards` store. The
 * (status, statusAtSet) stale-override protocol is preserved: when
 * `node.status` transitions, any manual override is silently discarded
 * and the default expansion policy resumes.
 */
export function Card(props: { node: CardNode; depth: number }) {
  const defaultExpanded = () => defaultExpandedForNode(props.node);

  const expanded = () =>
    cardExpanded(props.node.id, props.node.status, defaultExpanded());

  const collapsible = () => {
    // User / synthetic bubbles render as non-foldable bubbles.
    if (props.node.kind === "message" && props.node.role === "user") return false;
    return true;
  };

  const toggle = () => {
    toggleCard(props.node.id, props.node.status, defaultExpanded());
  };

  // Tool-kind nodes render their body via InlineToolPart(mode="body"),
  // not via CardParts — header already summarises the tool call.
  const isTool = () => props.node.kind === "tool";
  const toolPart = () => props.node.toolPart;

  return (
    <article
      class="card"
      data-kind={props.node.kind}
      data-role={props.node.role || undefined}
      data-stage={props.node.stage || undefined}
      data-status={props.node.status || "none"}
      data-depth={props.depth}
      style={props.node.accent ? { "--card-stage": props.node.accent } : undefined}
      classList={{ "card--expanded": expanded(), "card--collapsed": !expanded() }}
    >
      <CardHeader
        node={props.node}
        expanded={expanded()}
        collapsible={collapsible()}
        onToggle={toggle}
      />
      <Show when={expanded()}>
        <div class="card__body">
          {/* Goal-specific preamble: description + architect contracts */}
          <Show when={props.node.kind === "goal" && props.node.goalDescription}>
            <div class="card__goal-desc">
              <StaticTextPart text={props.node.goalDescription!} />
            </div>
          </Show>
          <Show when={props.node.kind === "goal" && (props.node.contracts?.length ?? 0) > 0}>
            <div class="card__contracts">
              <For each={props.node.contracts}>
                {(c) => (
                  <div class="card__contract">
                    <span class="card__contract-key">{c.key}</span>
                    <div class="card__contract-value">
                      <StaticTextPart text={c.value} />
                    </div>
                  </div>
                )}
              </For>
            </div>
          </Show>

          {/* Tool card body: delegate to InlineToolPart body mode */}
          <Show when={isTool() && toolPart()}>
            <InlineToolPart part={toolPart()} mode="body" />
          </Show>

          {/* Generic parts */}
          <Show when={!isTool() && (props.node.parts?.length ?? 0) > 0}>
            <CardParts parts={props.node.parts} depth={props.depth} />
          </Show>

          {/* Recursive children */}
          <Show when={(props.node.children?.length ?? 0) > 0}>
            <div class="card__children">
              <For each={props.node.children}>
                {(child) => <Card node={child} depth={props.depth + 1} />}
              </For>
            </div>
          </Show>
        </div>
      </Show>
    </article>
  );
}
