// ── SessionTokenBadge ──
// Compact titlebar indicator that surfaces the session's peak context-token
// usage at a glance. Peak = max `contextTokens` across every message the
// provider has reported so far; rendered with low contrast and an "est."
// marker when the max came from a local chars/token approximation.
//
// Data source: `messageStore.messages` — the flat chronological index. A
// direct O(n) walk over messages that have run through the LLM. Solid tracks
// reads of `messageStore.messages`, so this memo only re-runs when the flat
// list itself changes (not on every part delta).

import { createMemo, Show } from "solid-js";
import { messageStore } from "../store/messages";
import { providerContextTokens, charsToTokens, estimateMessageChars } from "../utils/tokens-estimate";
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

export function SessionTokenBadge() {
  const peak = createMemo<Peak | undefined>(() => {
    let best: Peak | undefined = undefined;
    for (const message of messageStore.messages) {
      const provided = providerContextTokens(message);
      if (typeof provided === "number" && Number.isFinite(provided) && provided > 0) {
        if (!best || provided > best.value) best = { value: provided, estimated: false };
        continue;
      }
      const est = charsToTokens(estimateMessageChars(message));
      if (Number.isFinite(est) && est > 0) {
        if (!best || est > best.value) best = { value: est, estimated: true };
      }
    }
    return best;
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