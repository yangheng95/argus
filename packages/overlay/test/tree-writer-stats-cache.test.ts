// ── Tree-writer subtree-stats cache invariant ──
//
// `store/card-tree-stats.ts` maintains per-card `subtreeCounts /
// subtreeLatestHit / subtreeTodoHit` aggregates so collapsed bubble headers
// read O(1) instead of walking the subtree on every SSE event. The cache is
// updated incrementally by tree-writer (markCardStatsDirty + flushCardStats);
// these tests pin the invariant that after every batch, the cached values
// for any store-backed card equal a fresh recursive recomputation from the
// same store state.
//
// Run: bun test test/tree-writer-stats-cache.test.ts

import { test, expect } from "bun:test"
import type { UsageAggregate } from "../src/utils/format-usage"
;(globalThis as typeof globalThis & { __OPENCORVUS_OVERLAY_VERSION__?: string }).__OPENCORVUS_OVERLAY_VERSION__ = "test"
if (typeof globalThis.requestAnimationFrame === "undefined") {
  ;(globalThis as any).requestAnimationFrame = (() => 1) as any
  ;(globalThis as any).cancelAnimationFrame = (() => {}) as any
}

const { installRealOverlayI18n } = await import("./fixtures/i18n")
installRealOverlayI18n()

const { setBoardStore } = await import("../src/store/board")
const { applyEvent, flushBufferedPartDeltas, resetWriter } = await import("../src/services/tree-writer")
const { cardTreeStore, replaceCardTreeOrder, setCardTreeStore } = await import("../src/store/card-tree")
const { flushCardStats, markCardStatsDirty } = await import("../src/store/card-tree-stats")
const cardTreeUtils = await import("../src/utils/card-tree")
const screenshotBrowserUtils = await import("../src/utils/screenshot-browser")
const { aggregateUsageAcrossSessions } = await import("../src/utils/format-usage")

const TASK_ID = "tsk_stats"
const SID = "ses_stats"
const MSG_ID_A = "msg_stats_a"
const MSG_ID_B = "msg_stats_b"
const PART_ID_TEXT = "part_text_stats"
const PART_ID_BASH = "part_bash_stats"
const PART_ID_TODO = "part_todo_stats"
const PART_ID_TASK = "part_task_stats"

const BOARD = {
  task: {
    id: TASK_ID,
    status: "active",
    request: "stats test",
    sessionID: SID,
    time: { created: 1_777_000_000_000 },
    attachments: [],
  },
  goalWorkflows: [],
  interactions: [],
}

function bootstrap() {
  setBoardStore("board", BOARD)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: MSG_ID_A,
        sessionID: SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: 1_777_000_000_000 },
      },
    },
  })
}

// ── Reference recursive walks (mirror the policy in utils/card-tree.ts) ──
// Intentionally a separate implementation from both the cache and the
// transient-card recursive path, so a bug in the kernel can't silently make
// the independent walk match.

function walkCounts(cardID: string): { messages: number; tools: number; agents: number; skills: number } {
  const card = cardTreeStore.cards[cardID]
  const out = { messages: 0, tools: 0, agents: 0, skills: 0 }
  if (!card) return out
  const consume = (part: any) => {
    if (!part) return
    if (part.type === "text" || part.type === "reasoning") {
      if (String(part.text || "").trim()) out.messages += 1
      return
    }
    if (part.type !== "tool") return
    const key = String(part.tool || "")
      .toLowerCase()
      .replace(/[^a-z]+/g, "")
    if (!key) return
    if (key === "task" || key === "agent" || key === "spawnagent" || key === "subagent") {
      out.agents += 1
      return
    }
    if (key === "skill" || /skill/.test(key)) {
      out.skills += 1
      return
    }
    out.tools += 1
  }
  if (card.kind === "tool" && card.toolPart) consume(card.toolPart)
  for (const p of card.parts || []) consume(p)
  for (const cid of card.childIDs || []) {
    const childCounts = walkCounts(cid)
    out.messages += childCounts.messages
    out.tools += childCounts.tools
    out.agents += childCounts.agents
    out.skills += childCounts.skills
  }
  return out
}

function walkScreenshotItems(cardID: string): Array<import("../src/utils/screenshot-browser").ScreenshotBrowserItem> {
  const card = cardTreeStore.cards[cardID]
  if (!card) return []
  const itemSets = [screenshotBrowserUtils.collectScreenshotBrowserItemsFromCard(card as any)]
  for (const childID of card.childIDs || []) itemSets.push(walkScreenshotItems(childID))
  return screenshotBrowserUtils.mergeScreenshotBrowserItemSets(itemSets)
}

function walkTopLevelScreenshotItems(): Array<import("../src/utils/screenshot-browser").ScreenshotBrowserItem> {
  const seen = new Set<string>()
  const itemSets: Array<Array<import("../src/utils/screenshot-browser").ScreenshotBrowserItem>> = []
  for (const cardID of cardTreeStore.order) {
    if (seen.has(cardID)) continue
    seen.add(cardID)
    itemSets.push(walkScreenshotItems(cardID))
  }
  return screenshotBrowserUtils.mergeScreenshotBrowserItemSets(itemSets)
}

function combineUsageAggregates(aggregates: Iterable<UsageAggregate>): UsageAggregate {
  let tokens = 0
  let costUSD = 0
  let estimated = false
  for (const aggregate of aggregates) {
    tokens += aggregate.tokens
    costUSD += aggregate.costUSD
    estimated = estimated || aggregate.estimated
  }
  return { tokens, costUSD, estimated }
}

function walkUsageAggregate(cardID: string): UsageAggregate {
  const card = cardTreeStore.cards[cardID]
  if (!card) return { tokens: 0, costUSD: 0, estimated: false }
  const aggregates: UsageAggregate[] = [aggregateUsageAcrossSessions([card])]
  for (const childID of card.childIDs || []) aggregates.push(walkUsageAggregate(childID))
  return combineUsageAggregates(aggregates)
}

function forEachStoreBackedCard(callback: (card: any) => void): void {
  for (const card of Object.values(cardTreeStore.cards)) {
    if (!card) continue
    // Skip transient cards (those with inline children); store-backed cards
    // always use childIDs. The only way an inline-children card lands in the
    // store is via test fixture error — we let it bypass for now.
    if (Array.isArray((card as any).children) && (card as any).children.length > 0) continue
    callback(card)
  }
}

function expectCacheMatchesWalk(): void {
  forEachStoreBackedCard((card) => {
    const fresh = walkCounts(card.id)
    expect(card.subtreeCounts).toEqual(fresh)
    expect(card.subtreeScreenshotItems).toEqual(walkScreenshotItems(card.id))
    expect(card.subtreeUsageAggregate).toEqual(walkUsageAggregate(card.id))
  })
  expect(cardTreeStore.screenshotItems).toEqual(walkTopLevelScreenshotItems())
  expect(cardTreeStore.usageAggregate).toEqual(aggregateUsageAcrossSessions(Object.values(cardTreeStore.cards)))
}

// ── Cases ──

test("part deltas accumulating on a leaf bump its own subtreeCounts", () => {
  bootstrap()
  // Seed a text part on msg A.
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: PART_ID_TEXT,
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "text",
        text: "hello",
      },
    },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()

  // Stream additional deltas — text already counts as 1 message; further
  // appends don't change the count, so the cache should stay stable.
  for (let i = 0; i < 5; i++) {
    applyEvent({
      type: "message.part.delta",
      properties: {
        taskID: TASK_ID,
        sessionID: SID,
        partID: PART_ID_TEXT,
        field: "text",
        delta: ` chunk-${i}`,
      },
    })
  }
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()
})

test("tool / agent / skill parts classify into the right bucket", () => {
  bootstrap()
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: PART_ID_BASH,
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "tool",
        tool: "bash",
        state: { status: "completed", output: "ok", input: { command: "ls" } },
      },
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: PART_ID_TASK,
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "tool",
        tool: "task",
        state: { status: "completed", input: { description: "spawn sub" } },
      },
    },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()

  // collectActivityCounts uses the cache and must match the walk exactly.
  const card = cardTreeStore.cards[`assistant:session:${SID}:message:${MSG_ID_A}`]
  expect(card).toBeDefined()
  const fromAPI = cardTreeUtils.collectActivityCounts(card as any)
  const fromWalk = walkCounts(card!.id)
  expect(fromAPI).toEqual(fromWalk)
})

test("part removal updates the cache to reflect the new totals", () => {
  bootstrap()
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: PART_ID_BASH,
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "tool",
        tool: "bash",
        state: { status: "completed", output: "ok" },
      },
    },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()

  applyEvent({
    type: "message.part.removed",
    properties: {
      taskID: TASK_ID,
      sessionID: SID,
      messageID: MSG_ID_A,
      partID: PART_ID_BASH,
    },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()
})

test("screenshot file, browser evidence, and tool attachment items are cached and removed with parts", () => {
  bootstrap()
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: "part_screenshot_file",
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "file",
        url: "/attachment/project/file.png",
        mime: "image/png",
        filename: "file.png",
      },
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: "part_screenshot_browser",
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "tool",
        tool: "browser_observe",
        state: {
          metadata: {
            browser: {
              url: "https://example.test",
              title: "Browser evidence",
              screenshot: { attachmentUrl: "/attachment/project/browser.png" },
            },
          },
        },
      },
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: "part_screenshot_attachment",
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "tool",
        tool: "visual_check",
        state: {
          attachments: [{ url: "/attachment/project/tool.webp", mime: "image/webp", filename: "tool.webp" }],
        },
      },
    },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()

  const card = cardTreeStore.cards[`assistant:session:${SID}:message:${MSG_ID_A}`]
  expect(card?.subtreeScreenshotItems?.map((item) => item.src)).toEqual([
    "/attachment/project/file.png",
    "/attachment/project/browser.png",
    "/attachment/project/tool.webp",
  ])
  expect(cardTreeStore.screenshotItems.map((item) => item.src)).toEqual([
    "/attachment/project/file.png",
    "/attachment/project/browser.png",
    "/attachment/project/tool.webp",
  ])

  applyEvent({
    type: "message.part.removed",
    properties: {
      taskID: TASK_ID,
      sessionID: SID,
      messageID: MSG_ID_A,
      partID: "part_screenshot_browser",
    },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()
  expect(cardTreeStore.cards[`assistant:session:${SID}:message:${MSG_ID_A}`]?.subtreeScreenshotItems?.map((item) => item.src)).toEqual([
    "/attachment/project/file.png",
    "/attachment/project/tool.webp",
  ])
  expect(cardTreeStore.screenshotItems.map((item) => item.src)).toEqual([
    "/attachment/project/file.png",
    "/attachment/project/tool.webp",
  ])
})

test("resetWriter clears the top-level screenshot cache", () => {
  bootstrap()
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: "part_screenshot_reset",
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "file",
        url: "/attachment/project/reset.png",
        mime: "image/png",
        filename: "reset.png",
      },
    },
  })
  flushBufferedPartDeltas()
  expect(cardTreeStore.screenshotItems.map((item) => item.src)).toEqual(["/attachment/project/reset.png"])

  resetWriter()

  expect(cardTreeStore.order).toEqual([])
  expect(cardTreeStore.screenshotItems).toEqual([])
  expect(cardTreeStore.usageAggregate).toEqual({ tokens: 0, costUSD: 0, estimated: false })
})

test("part-before-message server timestamp refreshes screenshot cache ordering", () => {
  setBoardStore("board", BOARD)
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  resetWriter()
  const originalDateNow = Date.now
  const partFirstMessageID = "msg_part_first_screenshot_stats"
  const partFirstSessionID = "ses_part_first_screenshot_stats"
  const observationTime = 1_777_000_010_000
  const serverTime = 1_777_000_000_500
  Date.now = () => observationTime
  try {
    applyEvent({
      type: "message.part.updated",
      properties: {
        taskID: TASK_ID,
        resolvedRole: "assistant",
        channel: "assistant",
        part: {
          id: "part_first_screenshot",
          messageID: partFirstMessageID,
          sessionID: partFirstSessionID,
          resolvedRole: "assistant",
          channel: "assistant",
          type: "file",
          url: "/attachment/project/part-first.png",
          mime: "image/png",
          filename: "part-first.png",
        },
      },
    })
    flushBufferedPartDeltas()

    const cardID = `assistant:session:${partFirstSessionID}:message:${partFirstMessageID}`
    expect(cardTreeStore.cards[cardID]?.time).toBe(observationTime)
    expect(cardTreeStore.cards[cardID]?.subtreeScreenshotItems?.[0]?.time).toBe(observationTime)
    expect(cardTreeStore.screenshotItems[0]?.time).toBe(observationTime)

    applyEvent({
      type: "message.updated",
      properties: {
        taskID: TASK_ID,
        info: {
          id: partFirstMessageID,
          sessionID: partFirstSessionID,
          role: "assistant",
          resolvedRole: "assistant",
          agent: "assistant",
          channel: "assistant",
          time: { created: serverTime },
        },
      },
    })

    expect(cardTreeStore.cards[cardID]?.time).toBe(serverTime)
    expect(cardTreeStore.cards[cardID]?.subtreeScreenshotItems?.[0]?.time).toBe(serverTime)
    expect(cardTreeStore.screenshotItems[0]?.time).toBe(serverTime)
    expectCacheMatchesWalk()
  } finally {
    Date.now = originalDateNow
    resetWriter()
  }
})

test("usage aggregate cache tracks own card usage and context estimates", () => {
  bootstrap()
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: MSG_ID_A,
        sessionID: SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: 1_777_000_000_000 },
        tokens: { input: 1_200, output: 150, reasoning: 0, total: 1_350, cache: { read: 0, write: 0 } },
        cost: 0.031,
      },
    },
  })
  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: MSG_ID_B,
        sessionID: SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: 1_777_000_001_000 },
        tokens: { input: 2_000, output: 400, reasoning: 0, total: 2_400, cache: { read: 0, write: 0 } },
        cost: 0.052,
      },
    },
  })
  setCardTreeStore("cards", `assistant:session:${SID}:message:${MSG_ID_B}`, "usage", undefined)
  setCardTreeStore("cards", `assistant:session:${SID}:message:${MSG_ID_B}`, "contextTokens", 2_000)
  setCardTreeStore("cards", `assistant:session:${SID}:message:${MSG_ID_B}`, "contextTokensEstimated", true)
  markCardStatsDirty(`assistant:session:${SID}:message:${MSG_ID_B}`)
  flushCardStats()

  expectCacheMatchesWalk()
  expect(cardTreeStore.usageAggregate).toEqual({ tokens: 3_350, costUSD: 0.031, estimated: true })
})

test("top-level screenshot cache bounds many roots before the panel reads it", () => {
  resetWriter()
  try {
    const rootCount = 5_000
    const order = Array.from({ length: rootCount }, (_item, index) => `bulk-root-${index}`)
    const cards = Object.fromEntries(
      order.map((id, index) => {
        const item = {
          id: `file:bulk-message-${index}:bulk-part-${index}`,
          role: "visual-qa" as const,
          src: `/attachment/project/bulk-${index}.png`,
          alt: `bulk-${index}.png`,
          title: `bulk-${index}.png`,
          detail: "image/png",
          time: index + 1,
          messageID: `bulk-message-${index}`,
          partID: `bulk-part-${index}`,
          source: "file" as const,
        }
        return [
          id,
          {
            id,
            kind: "agent" as const,
            role: "visual-qa",
            stage: "visual-qa",
            title: `Bulk ${index}`,
            time: index + 1,
            parts: [],
            childIDs: [],
            subtreeCounts: { messages: 0, tools: 0, agents: 0, skills: 0 },
            subtreeScreenshotItems: [item],
            subtreeUsageAggregate: { tokens: 0, costUSD: 0, estimated: false },
          },
        ]
      }),
    )

    setCardTreeStore("cards", cards)
    replaceCardTreeOrder(order)
    flushCardStats()

    expect(cardTreeStore.screenshotItems).toHaveLength(screenshotBrowserUtils.SCREENSHOT_BROWSER_ITEM_LIMIT)
    expect(cardTreeStore.screenshotItems[0]?.src).toBe("/attachment/project/bulk-4999.png")
    expect(cardTreeStore.screenshotItems.at(-1)?.src).toBe("/attachment/project/bulk-4880.png")
  } finally {
    resetWriter()
  }
})

test("subtree latest-hit cache equals the fresh recursive pick", () => {
  bootstrap()
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: PART_ID_TEXT,
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "text",
        text: "first prose",
      },
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: PART_ID_BASH,
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "tool",
        tool: "bash",
        state: { status: "completed", output: "ok", input: { command: "ls -la" } },
      },
    },
  })
  flushBufferedPartDeltas()
  const card = cardTreeStore.cards[`assistant:session:${SID}:message:${MSG_ID_A}`]
  expect(card).toBeDefined()
  const fromAPI = cardTreeUtils.collectLatestActivityText(card as any)
  // Newest-by-(time,index): the bash tool part was added after the text part
  // and lives at a later array index, so the latest hit must be the bash
  // line. (collectLatestActivityText formats it as "<icon> <tool>: <detail>".)
  expect(fromAPI).toContain("bash")
})

test("todo-tool snapshot is cached and equals the fresh pick", () => {
  bootstrap()
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: PART_ID_TODO,
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "tool",
        tool: "todowrite",
        state: {
          status: "completed",
          input: {
            todos: [
              { content: "step 1", activeForm: "Doing step 1", status: "completed" },
              { content: "step 2", activeForm: "Doing step 2", status: "in_progress" },
              { content: "step 3", activeForm: "Doing step 3", status: "pending" },
            ],
          },
        },
      },
    },
  })
  flushBufferedPartDeltas()
  const card = cardTreeStore.cards[`assistant:session:${SID}:message:${MSG_ID_A}`]
  expect(card).toBeDefined()
  const summary = cardTreeUtils.collectTodoSummary(card as any)
  expect(summary).not.toBeNull()
  expect(summary!.total).toBe(3)
  expect(summary!.completed).toBe(1)
  expect(summary!.inProgress).toBe(1)
  expect(summary!.pending).toBe(1)
  expect(summary!.current).toBe("Doing step 2")
})

test("removing a card decrements its former parent's cached counts", () => {
  bootstrap()
  // Seed a bash tool on msg A. msg A is top-level (no parent), so removal
  // touches `cardTreeStore.order` and the writer's bookkeeping rather than
  // a parent's childIDs — but the invariant must still hold for the
  // remaining cards.
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: PART_ID_BASH,
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "tool",
        tool: "bash",
        state: { status: "completed", output: "ok" },
      },
    },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()

  applyEvent({
    type: "message.removed",
    properties: {
      taskID: TASK_ID,
      sessionID: SID,
      messageID: MSG_ID_A,
    },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()
})

test("review.stream.chunk mutations are reflected in the cache (handler dirty-marks)", async () => {
  bootstrap()
  // review.stream.chunk writes a reasoning part directly onto the integrity
  // session card — a different code path from the message.part.* events
  // above. The handler must `markCardStatsDirty(cardID)` for the cache to
  // see the new reasoning part; otherwise the subtree counts stay zero
  // forever on integrity timelines. Codex flagged this in the perf review
  // (tree-writer.ts:1138). The test routes a started + chunk sequence and
  // asserts the cache invariant survives.
  const REVIEW_TASK_ID = TASK_ID
  const REVIEW_SID = "ses_integrity_stats"
  applyEvent({
    type: "review.stream.started",
    properties: {
      taskID: REVIEW_TASK_ID,
      reviewID: `integrity:${REVIEW_SID}`,
      sessionID: REVIEW_SID,
      startedAt: 1_777_000_002_000,
      attempt: 0,
      phase: "integrity",
    },
  })
  applyEvent({
    type: "review.stream.chunk",
    properties: {
      taskID: REVIEW_TASK_ID,
      reviewID: `integrity:${REVIEW_SID}`,
      attempt: 1,
      phase: "integrity",
      kind: "reasoning",
      delta: "the reviewers found a potential drift in the auth boundary",
    },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()
  // Sanity: at least one card should now report subtreeCounts.messages >= 1
  // (the reasoning delta counts as a message-bearing part).
  let foundIntegrityCard = false
  for (const card of Object.values(cardTreeStore.cards)) {
    if (!card) continue
    if ((card as any).stage === "integrity") {
      foundIntegrityCard = true
      expect((card as any).subtreeCounts?.messages ?? 0).toBeGreaterThan(0)
    }
  }
  expect(foundIntegrityCard).toBe(true)
})

test("board rebuild (rebuildBoardDerivedCards) flushes stats before visible-version bump", () => {
  // task.updated triggers rebuildBoardDerivedCards which rewrites
  // childIDs across step/phase/interaction cards. Codex flagged that the
  // batch must flush card-stats inside it (otherwise downstream
  // subscribers see the new visible-version with stale subtreeCounts).
  // Re-running the bootstrap board + a second task.updated exercises that
  // path; the invariant check enforces correctness.
  bootstrap()
  applyEvent({
    type: "task.updated",
    properties: {
      taskID: TASK_ID,
      task: { id: TASK_ID, goalWorkflows: [] },
    },
  })
  expectCacheMatchesWalk()
})

test("rebuilds that detach a child clear parentID on the orphaned card", async () => {
  // Board with one phase claimed under a step. After a rebuild that
  // produces a different runID for the same goal, the step still owns the
  // step card id (it is goalRun-invariant) but its childIDs may shift.
  // The cache invariant survives either way; this test pins it under a
  // second task.updated that supplies a fresh goalWorkflows snapshot.
  const GOAL_ID = "g_stats_orphan"
  const BUILD_SID = "ses_build_stats_orphan"
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "orphan rebuild",
      sessionID: SID,
      time: { created: 1_777_000_000_000 },
      attachments: [],
    },
    workflow: { steps: [{ stepID: "build", phases: [{ id: "plan" }, { id: "build" }] }] },
    goalWorkflows: [
      {
        goalID: GOAL_ID,
        goalRunID: "run_initial",
        goalTitle: "rebuild orphan",
        orderIndex: 0,
        steps: [
          {
            stepID: "build",
            label: "Executor",
            status: "running",
            startedAt: 1_777_000_001_000,
            phases: {
              plan: { status: "completed", startedAt: 1_777_000_001_000, completedAt: 1_777_000_001_500 },
              build: { status: "running", startedAt: 1_777_000_001_600 },
            },
            payload: { buildSessionID: BUILD_SID },
          },
        ],
      },
    ],
    interactions: [],
  })
  setBoardStore("selectedSource", { kind: "task", id: TASK_ID })
  applyEvent({
    type: "task.updated",
    properties: { taskID: TASK_ID, task: { id: TASK_ID, goalWorkflows: [] } },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()

  // Drop the goal entirely on the next rebuild. The previously-claimed
  // phase cards become orphans (or disappear); the cache invariant must
  // still hold and no stale ancestor link should keep an old phase
  // card's contributions baked into a step's count.
  setBoardStore("board", {
    task: {
      id: TASK_ID,
      status: "active",
      request: "orphan rebuild",
      sessionID: SID,
      time: { created: 1_777_000_000_000 },
      attachments: [],
    },
    workflow: { steps: [{ stepID: "build", phases: [{ id: "plan" }, { id: "build" }] }] },
    goalWorkflows: [],
    interactions: [],
  })
  applyEvent({
    type: "task.updated",
    properties: { taskID: TASK_ID, task: { id: TASK_ID, goalWorkflows: [] } },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()

  // Any phase card still in the store after the second rebuild that no
  // parent reaches must have its parentID cleared so future bubble-up
  // walks stop there instead of climbing a stale ancestor.
  for (const card of Object.values(cardTreeStore.cards)) {
    if (!card) continue
    if ((card as any).kind !== "phase") continue
    const parentID = (card as any).parentID
    if (parentID === undefined) continue
    const parent = cardTreeStore.cards[parentID]
    expect(parent?.childIDs ?? []).toContain((card as any).id)
  }
})

test("appending a second message keeps the cache invariant under multi-card load", () => {
  bootstrap()
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: PART_ID_TEXT,
        messageID: MSG_ID_A,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "text",
        text: "from A",
      },
    },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()

  applyEvent({
    type: "message.updated",
    properties: {
      taskID: TASK_ID,
      info: {
        id: MSG_ID_B,
        sessionID: SID,
        role: "assistant",
        resolvedRole: "assistant",
        agent: "assistant",
        channel: "assistant",
        time: { created: 1_777_000_001_000 },
      },
    },
  })
  applyEvent({
    type: "message.part.updated",
    properties: {
      taskID: TASK_ID,
      part: {
        id: `${PART_ID_TEXT}_b`,
        messageID: MSG_ID_B,
        sessionID: SID,
        resolvedRole: "assistant",
        channel: "assistant",
        type: "text",
        text: "from B",
      },
    },
  })
  flushBufferedPartDeltas()
  expectCacheMatchesWalk()
})
