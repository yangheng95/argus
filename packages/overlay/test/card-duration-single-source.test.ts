import { test, expect } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

// 2026-05-11 single-source repair: see card duration single-source contract
// The card duration string is now exclusively rendered by
// CardHeaderChrome's `.card__duration` chip for BOTH running and completed
// cards. tree-writer must not compose any elapsed-time strings.

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..")

function read(rel: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, rel), "utf8")
}

test("CardDurationChip imports shared formatDuration + useNowTick", () => {
  const src = read("src/components/CardHeaderChrome.tsx")
  expect(src).toContain('from "../utils/time"')
  expect(src).toContain('from "../services/clock"')
  expect(src).toContain("useNowTick")
  // The local formatDuration must be gone — single source from utils/time.
  expect(src).not.toMatch(/^function formatDuration\(ms: number\): string/m)
})

test("CardDurationChip handles both running and completed states", () => {
  const src = read("src/components/CardHeaderChrome.tsx")
  // The new memo subtracts now()-time for running cards and
  // timeCompleted-time otherwise. We assert both branches exist.
  expect(src).toContain("durationMs")
  expect(src).toContain("durationText")
  expect(src).toContain('props.node.status === "running"')
  // Chip text must NOT carry the legacy " elapsed" suffix — search for
  // the exact template fragments the deleted formatElapsed() produced.
  expect(src).not.toMatch(/m elapsed`/)
  expect(src).not.toMatch(/s elapsed`/)
  expect(src).not.toMatch(/m elapsed['"]/)
  expect(src).not.toMatch(/s elapsed['"]/)
})

test("CardHeader delegates duration rendering to the shared chrome component", () => {
  const src = read("src/components/CardHeader.tsx")
  expect(src).toContain('import { CardDurationChip, CardHeaderChrome } from "./CardHeaderChrome"')
  expect(src).toContain("<CardDurationChip node={props.node} />")
  expect(src).not.toContain("useNowTick")
  expect(src).not.toContain("formatDuration")
  expect(src).not.toContain("durationMs")
})

test("tree-writer does not compose elapsed-time strings", () => {
  const src = read("src/services/tree-writer.ts")
  // formatElapsed and its `${m}m elapsed` template are gone.
  expect(src).not.toContain("function formatElapsed")
  expect(src).not.toMatch(/`\$\{[^}]+\}m elapsed`/)
  expect(src).not.toMatch(/`\$\{[^}]+\}s elapsed`/)
  expect(src).not.toMatch(/`attempt \$\{[^}]+\} · /)
  // The new path uses the i18n attempt label only.
  expect(src).toContain("integrity.attempt_label")
})

test("integrity.attempt_label key exists in both locales", () => {
  const en = JSON.parse(read("src/i18n/en-US.json")) as Record<string, string>
  const zh = JSON.parse(read("src/i18n/zh-CN.json")) as Record<string, string>
  expect(en["integrity.attempt_label"]).toBeDefined()
  expect(zh["integrity.attempt_label"]).toBeDefined()
  // Both must reference {{value}}.
  expect(en["integrity.attempt_label"]).toContain("{{value}}")
  expect(zh["integrity.attempt_label"]).toContain("{{value}}")
  // Neither carries the legacy elapsed wording.
  expect(en["integrity.attempt_label"]).not.toContain("elapsed")
})

test("TaskStatusHeader uses selected-task SSE activity for active elapsed time", () => {
  const src = read("src/components/TaskStatusHeader.tsx")
  expect(src).toContain('from "../services/task-runtime-activity"')
  expect(src).toContain("selectedTaskSseActiveElapsedMs")
  expect(src).toContain("ACTIVE_STATUS")
  expect(src).toContain("missing completion time")
  expect(src).toContain("invalid completion time")
  expect(src).not.toContain("useNowTick")
  expect(src).not.toContain("createVisibilityInterval")
  expect(src).not.toContain('new Set(["active", "queued"])')
  expect(src).not.toContain("now() - start")
  // The old private setInterval is gone.
  expect(src).not.toContain("setInterval(() => setNow")
})

test("selected-task SSE stream records active elapsed only from real SSE updates", () => {
  const src = read("src/services/sse.ts")
  expect(src).toContain("recordSelectedTaskSseUpdate(event, taskID)")
  expect(src).toContain("recordSelectedTaskSseEventActivity")
  expect(src).toContain("pauseSelectedTaskSseStreamActivity")
  expect(src).toContain('event.type === "task.heartbeat"')
  expect(src).not.toContain("document.hidden")
  expect(src).not.toContain("performance.now")
})

test("conversation hydrate restores selected-task SSE activity from persisted watermarks", () => {
  const src = read("src/services/conversation.ts")
  expect(src).toContain("recordHydratedSelectedTaskActivity")
  expect(src).toContain("messageWatermark")
  expect(src).toContain("recordReplayedSelectedTaskEventActivity")
})

test("promoted tool cards use tool state time instead of mount time", async () => {
  const { toolToCardNode } = await import("../src/utils/tool-card-node")
  const card = toolToCardNode({
    id: "prt_read",
    type: "tool",
    tool: "read_file",
    orderKey: "v1:0001776000001000:0000000000000031:0000000000000000:part:prt_read",
    state: {
      status: "completed",
      input: { file_path: "D:/workspace/app/src/main.ts" },
      output: "ok",
      time: { start: 1_776_000_001_000, end: 1_776_000_002_500 },
    },
  })

  expect(card.time).toBe(1_776_000_001_000)
  expect(card.timeCompleted).toBe(1_776_000_002_500)
})

test("running promoted tool cards keep their original tool start across remounts", async () => {
  const { toolToCardNode } = await import("../src/utils/tool-card-node")
  const part = {
    id: "prt_bash",
    type: "tool",
    tool: "bash",
    orderKey: "v1:0001776000003000:0000000000000031:0000000000000000:part:prt_bash",
    state: {
      status: "running",
      input: { command: "bun test packages/overlay/test/card-duration-single-source.test.ts" },
      time: { start: 1_776_000_003_000 },
    },
  }

  const firstMount = toolToCardNode(part)
  const secondMount = toolToCardNode(part)

  expect(firstMount.time).toBe(1_776_000_003_000)
  expect(secondMount.time).toBe(1_776_000_003_000)
  expect(secondMount.timeCompleted).toBeUndefined()
})

test("pending promoted tool cards use backend tool start time", async () => {
  const { toolToCardNode } = await import("../src/utils/tool-card-node")
  const card = toolToCardNode({
    id: "prt_pending",
    type: "tool",
    tool: "update_research_evidence",
    orderKey: "v1:0001776000003500:0000000000000031:0000000000000000:part:prt_pending",
    state: {
      status: "pending",
      input: {},
      raw: "",
      time: { start: 1_776_000_003_500 },
    },
  })

  expect(card.status).toBe("pending")
  expect(card.time).toBe(1_776_000_003_500)
  expect(card.timeCompleted).toBeUndefined()
})

test("promoted tool cards reject missing persisted identity and time", async () => {
  const { toolToCardNode } = await import("../src/utils/tool-card-node")
  const basePart = {
    id: "prt_strict",
    type: "tool",
    tool: "bash",
    orderKey: "v1:0001776000004000:0000000000000031:0000000000000000:part:prt_strict",
    state: {
      status: "running",
      input: { command: "bun test packages/overlay/test/card-duration-single-source.test.ts" },
      time: { start: 1_776_000_004_000 },
    },
  }

  expect(() => toolToCardNode({ ...basePart, id: "" })).toThrow("tool part id missing")
  expect(() => toolToCardNode({ ...basePart, tool: "" })).toThrow("tool part prt_strict tool missing")
  expect(() =>
    toolToCardNode({
      ...basePart,
      state: { ...basePart.state, time: {} },
    }),
  ).toThrow("tool part prt_strict start time missing positive timestamp")
  expect(() =>
    toolToCardNode({
      ...basePart,
      state: { ...basePart.state, time: { start: 1_776_000_004_000, end: 1_776_000_003_999 } },
    }),
  ).toThrow("tool part prt_strict end time must be later than start time")
})
