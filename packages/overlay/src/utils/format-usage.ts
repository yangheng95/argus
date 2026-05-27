// ── Usage formatters & aggregation ──
//
// Shared compact token / cost formatters used by every surface that prints
// LLM usage hints: per-card chrome (CardHeader, ChatBubble) and the chat
// header's whole-session aggregate strip. Single-source so the three
// surfaces stay byte-aligned — rule 8 (no double source) / rule 9 (no
// copy-paste).
//
// `aggregateUsageAcrossSessions` is the pure kernel of the chat-header
// usage strip. main.tsx wraps it with a Solid effect that subscribes to
// `cardTreeStore.cards`; extracted here so it can be unit-tested without
// touching the DOM or Solid.

/** Compact token count — "8.4k" rather than "8432", so low-contrast hint
 *  chrome reads at a glance without dominating the row. */
export function formatTokenCount(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1000) return String(n);
  if (n < 10_000) return (n / 1000).toFixed(1) + "k";
  return Math.round(n / 1000) + "k";
}

/** Format a cost in USD as a tight badge value: under $0.01 → "<$0.01",
 *  under $1 → 3-decimal cents-wise, otherwise 2 decimals. Hundreds of
 *  these scan past the operator so we stay under 7 chars. */
export function formatCostUSD(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  if (n < 1) return "$" + n.toFixed(3);
  return "$" + n.toFixed(2);
}

/** Minimal card shape consumed by the usage aggregator. Kept
 *  independent of the full `CardNode` interface so tests can build
 *  fixtures without importing the store. */
export interface UsageCardLike {
  sessionID?: string;
  phaseSessionID?: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    costUSD?: number;
  };
}

/** Aggregate per-session usage into a single whole-conversation total.
 *  Each runtime session emits cumulative totals; tree-writer writes the
 *  latest value onto whichever card was the active turn at event time
 *  (`services/tree-writer.ts:handleUsageUpdated`). To avoid double-
 *  counting stale snapshots on older turn cards within the same session,
 *  we take the max per session, then sum across sessions.
 *
 *  Phase-absorbed sessions (build / planner under a goal — see
 *  tree-writer's `isPhaseAbsorbedSession`) store the owning session in
 *  `phaseSessionID` instead of `sessionID`, so the grouping key falls
 *  back to it. Cards with neither key are skipped (no session
 *  attribution means we cannot tell which max to compare against). */
export function aggregateUsageAcrossSessions(
  cards: Iterable<UsageCardLike | undefined | null>,
): { tokens: number; costUSD: number } {
  const perSessionTokens = new Map<string, number>();
  const perSessionCost = new Map<string, number>();
  for (const card of cards) {
    const sessionKey = card?.sessionID ?? card?.phaseSessionID;
    const usage = card?.usage;
    if (!sessionKey || !usage) continue;
    const totalTokens =
      (usage.totalTokens ?? 0) ||
      ((usage.inputTokens ?? 0) + (usage.outputTokens ?? 0));
    const cost = usage.costUSD ?? 0;
    if (totalTokens > (perSessionTokens.get(sessionKey) ?? 0)) {
      perSessionTokens.set(sessionKey, totalTokens);
    }
    if (cost > (perSessionCost.get(sessionKey) ?? 0)) {
      perSessionCost.set(sessionKey, cost);
    }
  }
  let tokens = 0;
  for (const value of perSessionTokens.values()) tokens += value;
  let costUSD = 0;
  for (const value of perSessionCost.values()) costUSD += value;
  return { tokens, costUSD };
}

/** Format a `{tokens, costUSD}` aggregate as the strip text. Empty
 *  string when nothing was spent (CSS `.chat-usage:empty` hides the
 *  chip). Segments with zero value are dropped — a session that
 *  reports tokens but no cost should not show a stray "· $0", and
 *  vice-versa. */
export function formatUsageStrip(input: { tokens: number; costUSD: number }): string {
  const parts: string[] = [];
  if (input.tokens > 0) parts.push(`${formatTokenCount(input.tokens)} tok`);
  if (input.costUSD > 0) {
    const costLabel = formatCostUSD(input.costUSD);
    if (costLabel) parts.push(costLabel);
  }
  return parts.join(" · ");
}
