import { expect, test, describe } from "bun:test"
import {
  aggregateUsageAcrossSessions,
  formatCostUSD,
  formatTokenCount,
  formatUsageStrip,
  type UsageCardLike,
} from "../src/utils/format-usage"

describe("formatTokenCount", () => {
  test("renders raw integers below 1k", () => {
    expect(formatTokenCount(0)).toBe("0")
    expect(formatTokenCount(42)).toBe("42")
    expect(formatTokenCount(999)).toBe("999")
  })

  test("compacts 1k..10k with one decimal, 10k+ as rounded integers", () => {
    expect(formatTokenCount(1_000)).toBe("1.0k")
    expect(formatTokenCount(8_432)).toBe("8.4k")
    expect(formatTokenCount(10_500)).toBe("11k")
    expect(formatTokenCount(123_456)).toBe("123k")
  })

  test("returns em-dash on invalid input", () => {
    expect(formatTokenCount(NaN)).toBe("—")
    expect(formatTokenCount(-1)).toBe("—")
  })
})

describe("formatCostUSD", () => {
  test("renders the documented tight badge format", () => {
    expect(formatCostUSD(0)).toBe("$0")
    expect(formatCostUSD(0.005)).toBe("<$0.01")
    expect(formatCostUSD(0.123)).toBe("$0.123")
    expect(formatCostUSD(0.999)).toBe("$0.999")
    expect(formatCostUSD(1.5)).toBe("$1.50")
    expect(formatCostUSD(42.123)).toBe("$42.12")
  })

  test("returns empty string on invalid input", () => {
    expect(formatCostUSD(NaN)).toBe("")
    expect(formatCostUSD(-0.5)).toBe("")
  })
})

describe("aggregateUsageAcrossSessions", () => {
  test("returns zero totals for an empty tree", () => {
    expect(aggregateUsageAcrossSessions([])).toEqual({ tokens: 0, costUSD: 0 })
  })

  test("skips cards without a session attribution", () => {
    const cards: UsageCardLike[] = [
      { usage: { totalTokens: 9_999, costUSD: 5 } }, // no sessionID/phaseSessionID
    ]
    expect(aggregateUsageAcrossSessions(cards)).toEqual({ tokens: 0, costUSD: 0 })
  })

  test("skips cards without a usage payload", () => {
    const cards: UsageCardLike[] = [{ sessionID: "s1" }]
    expect(aggregateUsageAcrossSessions(cards)).toEqual({ tokens: 0, costUSD: 0 })
  })

  test("takes max per session, not sum, to avoid double-counting cumulative snapshots", () => {
    // tree-writer stamps cumulative session totals onto whichever turn
    // card was active at event time; older turn cards in the same
    // session retain stale snapshots. The aggregator must use max.
    const cards: UsageCardLike[] = [
      { sessionID: "s1", usage: { totalTokens: 100, costUSD: 0.05 } },
      { sessionID: "s1", usage: { totalTokens: 250, costUSD: 0.12 } },
      { sessionID: "s1", usage: { totalTokens: 180, costUSD: 0.09 } },
    ]
    expect(aggregateUsageAcrossSessions(cards)).toEqual({ tokens: 250, costUSD: 0.12 })
  })

  test("sums across distinct sessions", () => {
    const cards: UsageCardLike[] = [
      { sessionID: "s1", usage: { totalTokens: 250, costUSD: 0.12 } },
      { sessionID: "s2", usage: { totalTokens: 400, costUSD: 0.20 } },
      { sessionID: "s3", usage: { totalTokens: 80, costUSD: 0.03 } },
    ]
    expect(aggregateUsageAcrossSessions(cards)).toEqual({ tokens: 730, costUSD: 0.35 })
  })

  test("counts phase-absorbed sessions via phaseSessionID", () => {
    // Phase cards (build / planner under a goal) don't set sessionID;
    // the owning session id lives on phaseSessionID. Without this
    // fallback the build pipeline's tokens — typically the dominant
    // chunk — would be silently dropped.
    const cards: UsageCardLike[] = [
      { sessionID: "orchestrator", usage: { totalTokens: 200, costUSD: 0.10 } },
      { phaseSessionID: "build-1", usage: { totalTokens: 5_000, costUSD: 1.50 } },
      { phaseSessionID: "planner-1", usage: { totalTokens: 800, costUSD: 0.25 } },
    ]
    expect(aggregateUsageAcrossSessions(cards)).toEqual({ tokens: 6_000, costUSD: 1.85 })
  })

  test("falls back to inputTokens + outputTokens when totalTokens is absent", () => {
    const cards: UsageCardLike[] = [
      { sessionID: "s1", usage: { inputTokens: 120, outputTokens: 80 } },
    ]
    expect(aggregateUsageAcrossSessions(cards)).toEqual({ tokens: 200, costUSD: 0 })
  })

  test("treats nullish and undefined card entries as no-ops", () => {
    const cards = [
      undefined,
      null,
      { sessionID: "s1", usage: { totalTokens: 50, costUSD: 0.02 } },
    ] as Array<UsageCardLike | undefined | null>
    expect(aggregateUsageAcrossSessions(cards)).toEqual({ tokens: 50, costUSD: 0.02 })
  })
})

describe("formatUsageStrip", () => {
  test("returns empty string when nothing was spent — hides the chip via :empty", () => {
    expect(formatUsageStrip({ tokens: 0, costUSD: 0 })).toBe("")
  })

  test("formats tokens and cost separated by middle dot", () => {
    // formatCostUSD uses 3-decimal precision below $1 (cents-wise) and
    // 2-decimal above; the strip just composes that output verbatim.
    expect(formatUsageStrip({ tokens: 3_200, costUSD: 0.45 })).toBe("3.2k tok · $0.450")
    expect(formatUsageStrip({ tokens: 12_500, costUSD: 4.2 })).toBe("13k tok · $4.20")
  })

  test("omits the cost segment when cost is zero but tokens were recorded", () => {
    expect(formatUsageStrip({ tokens: 500, costUSD: 0 })).toBe("500 tok")
  })

  test("omits the tokens segment when only cost is recorded", () => {
    // Defensive — backends might emit cost without token breakdown for
    // some providers.
    expect(formatUsageStrip({ tokens: 0, costUSD: 0.5 })).toBe("$0.500")
  })
})
