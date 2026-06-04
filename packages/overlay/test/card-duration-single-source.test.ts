import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// 2026-05-11 single-source repair: see specs/card-duration-single-source-2026-05-11.md
// The card duration string is now exclusively rendered by
// CardHeader's `.card__duration` chip for BOTH running and completed
// cards. tree-writer must not compose any elapsed-time strings.

const OVERLAY_ROOT = path.resolve(import.meta.dir, "..");

function read(rel: string): string {
  return readFileSync(path.join(OVERLAY_ROOT, rel), "utf8");
}

test("CardHeader imports shared formatDuration + useNowTick", () => {
  const src = read("src/components/CardHeader.tsx");
  expect(src).toContain('from "../utils/time"');
  expect(src).toContain('from "../services/clock"');
  expect(src).toContain("useNowTick");
  // The local formatDuration must be gone — single source from utils/time.
  expect(src).not.toMatch(/^function formatDuration\(ms: number\): string/m);
});

test("CardHeader duration chip handles both running and completed states", () => {
  const src = read("src/components/CardHeader.tsx");
  // The new memo subtracts now()-time for running cards and
  // timeCompleted-time otherwise. We assert both branches exist.
  expect(src).toContain("durationMs");
  expect(src).toContain("durationText");
  expect(src).toContain('props.node.status === "running"');
  // Chip text must NOT carry the legacy " elapsed" suffix — search for
  // the exact template fragments the deleted formatElapsed() produced.
  expect(src).not.toMatch(/m elapsed`/);
  expect(src).not.toMatch(/s elapsed`/);
  expect(src).not.toMatch(/m elapsed['"]/);
  expect(src).not.toMatch(/s elapsed['"]/);
});

test("tree-writer does not compose elapsed-time strings", () => {
  const src = read("src/services/tree-writer.ts");
  // formatElapsed and its `${m}m elapsed` template are gone.
  expect(src).not.toContain("function formatElapsed");
  expect(src).not.toMatch(/`\$\{[^}]+\}m elapsed`/);
  expect(src).not.toMatch(/`\$\{[^}]+\}s elapsed`/);
  expect(src).not.toMatch(/`attempt \$\{[^}]+\} · /);
  // The new path uses the i18n attempt label only.
  expect(src).toContain("integrity.attempt_label");
});

test("integrity.attempt_label key exists in both locales", () => {
  const en = JSON.parse(read("src/i18n/en-US.json")) as Record<string, string>;
  const zh = JSON.parse(read("src/i18n/zh-CN.json")) as Record<string, string>;
  expect(en["integrity.attempt_label"]).toBeDefined();
  expect(zh["integrity.attempt_label"]).toBeDefined();
  // Both must reference {{value}}.
  expect(en["integrity.attempt_label"]).toContain("{{value}}");
  expect(zh["integrity.attempt_label"]).toContain("{{value}}");
  // Neither carries the legacy elapsed wording.
  expect(en["integrity.attempt_label"]).not.toContain("elapsed");
});

test("TaskStatusHeader uses the shared clock tick", () => {
  const src = read("src/components/TaskStatusHeader.tsx");
  expect(src).toContain('from "../services/clock"');
  expect(src).toContain("useNowTick");
  // The old private setInterval is gone.
  expect(src).not.toContain("setInterval(() => setNow");
});

test("promoted tool cards use tool state time instead of mount time", async () => {
  const { toolToCardNode } = await import("../src/utils/tool-card-node");
  const card = toolToCardNode({
    id: "prt_read",
    type: "tool",
    tool: "read_file",
    state: {
      status: "completed",
      input: { file_path: "D:/workspace/app/src/main.ts" },
      output: "ok",
      time: { start: 1_776_000_001_000, end: 1_776_000_002_500 },
    },
  }, 1_776_999_999_999);

  expect(card.time).toBe(1_776_000_001_000);
  expect(card.timeCompleted).toBe(1_776_000_002_500);
});

test("running promoted tool cards keep their original tool start across remounts", async () => {
  const { toolToCardNode } = await import("../src/utils/tool-card-node");
  const part = {
    id: "prt_bash",
    type: "tool",
    tool: "bash",
    state: {
      status: "running",
      input: { command: "bun test packages/overlay/test/card-duration-single-source.test.ts" },
      time: { start: 1_776_000_003_000 },
    },
  };

  const firstMount = toolToCardNode(part, 1_776_000_010_000);
  const secondMount = toolToCardNode(part, 1_776_000_030_000);

  expect(firstMount.time).toBe(1_776_000_003_000);
  expect(secondMount.time).toBe(1_776_000_003_000);
  expect(secondMount.timeCompleted).toBeUndefined();
});
