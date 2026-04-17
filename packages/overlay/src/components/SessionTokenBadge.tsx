// ── SessionTokenBadge ──
// Compact titlebar indicator that surfaces the session's peak context-token
// usage at a glance. The value is the high-water mark of `contextTokens`
// across the live CardNode tree — the same figure each card's own footer
// hint shows, promoted to a persistent position so operators can see
// context pressure without scrolling.
//
// When the peak was taken from a local chars/token approximation (no
// provider figure yet), the badge tags the number with "est." just like
// the per-card hint. Hidden when the conversation is empty.

import { createMemo, Show } from "solid-js";
import {
  mainMessages,
  userContextMessages,
  agentCardItems,
  combineConversation,
} from "../utils/conversation";
import { toCardTree, type CardNode } from "../utils/card-tree";
import { t } from "../utils/i18n";

function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

interface Peak {
  value: number;
  estimated: boolean;
}

function walk(node: CardNode, acc: { peak?: Peak }): void {
  const v = node.contextTokens;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) {
    if (!acc.peak || v > acc.peak.value) {
      acc.peak = { value: v, estimated: !!node.contextTokensEstimated };
    }
  }
  for (const child of node.children || []) walk(child, acc);
}

export function SessionTokenBadge() {
  const peak = createMemo<Peak | undefined>(() => {
    const items = combineConversation(
      mainMessages(),
      userContextMessages(),
      agentCardItems(),
    );
    const tree = toCardTree(items);
    const acc: { peak?: Peak } = {};
    for (const node of tree) walk(node, acc);
    return acc.peak;
  });

  const tooltipKey = () =>
    peak()?.estimated
      ? "card.context_tokens_tooltip_estimated"
      : "card.context_tokens_tooltip";

  return (
    <Show when={peak()}>
      {(p) => (
        <span
          class="session-token-badge"
          data-estimated={p().estimated ? "true" : "false"}
          title={t(tooltipKey(), { value: String(p().value) })}
          aria-label={t(tooltipKey(), { value: String(p().value) })}
        >
          ~{formatTokenCount(p().value)} tok{p().estimated ? " · est." : ""}
        </span>
      )}
    </Show>
  );
}
