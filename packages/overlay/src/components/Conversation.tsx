import { createMemo, For, Show, onMount, onCleanup, createEffect } from "solid-js";
import { Card } from "./Card";
import { toCardTree } from "../utils/card-tree";
import type { CardNode } from "../utils/card-tree";
import { t } from "../utils/i18n";
import { conversationMessages } from "../utils/conversation";
import { setupAutoScroll } from "../utils/dom-utils";

// ── Conversation Component ──
// Renders directly into the host container (e.g. #chatScroll).
// The host element already has the correct CSS classes; this component
// only renders children — no extra wrapper div.
//
// All conversation items route through a single unified <Card> primitive.
// The CardNode tree is built by toCardTree() from messageStore output;
// goal groups, agent stage cards, tool promotions and user / system
// message bubbles are all recursive CardNodes — no legacy branching.

// Collect all CardNode IDs recursively — used by the duplicate-detection
// effect below to catch any rendering-layer bug that would otherwise be
// invisible from the data layer.
function collectAllIDs(nodes: CardNode[], out: string[] = []): string[] {
  for (const n of nodes) {
    out.push(n.id);
    if (n.children && n.children.length > 0) collectAllIDs(n.children, out);
  }
  return out;
}

export function Conversation(props: { container: HTMLElement }) {
  const el = props.container;

  const items = createMemo(() => conversationMessages());
  const tree = createMemo(() => toCardTree(items()));

  // ── Runtime duplicate detector ──
  // Scans the final card tree (items + all descendants) for duplicate IDs.
  // If the data layer is correct this never fires; if it ever does, the
  // user sees a visible banner and the dupe IDs land in the console so we
  // can pinpoint the source without needing a full profiling session.
  createEffect(() => {
    const allIDs = collectAllIDs(tree());
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const id of allIDs) {
      if (seen.has(id)) dupes.push(id);
      else seen.add(id);
    }
    const prevBanner = document.getElementById("overlay-dup-banner");
    if (dupes.length > 0) {
      console.error("[overlay] DOM-tree has duplicate CardNode IDs:", dupes);
      if (!prevBanner) {
        const banner = document.createElement("div");
        banner.id = "overlay-dup-banner";
        banner.style.cssText =
          "position:fixed;top:0;left:0;right:0;z-index:99999;padding:6px 12px;" +
          "background:#c00;color:#fff;font:12px/1.4 monospace;text-align:center;";
        banner.textContent = `[overlay BUG] duplicate cards: ${dupes.slice(0, 5).join(", ")}`;
        document.body.appendChild(banner);
      } else {
        prevBanner.textContent = `[overlay BUG] duplicate cards: ${dupes.slice(0, 5).join(", ")}`;
      }
    } else if (prevBanner) {
      prevBanner.remove();
    }
  });

  onMount(() => {
    const cleanup = setupAutoScroll(el);
    onCleanup(cleanup);
  });

  const emptyText = () => t("chat.empty");

  return (
    <>
      <Show when={items().length === 0}>
        <div class="chat-empty">
          <svg class="chat-empty-icon" width="40" height="40" viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <rect x="4" y="5" width="32" height="22" rx="3.5" stroke="currentColor" stroke-width="1.6"/>
            <path d="M4 27l7-6h22l7 6" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>
            <path d="M13 15h14M13 19.5h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
          </svg>
          <span class="chat-empty-text">{emptyText()}</span>
        </div>
      </Show>
      <For each={tree()}>{(node) => <Card node={node} depth={0} />}</For>
    </>
  );
}
