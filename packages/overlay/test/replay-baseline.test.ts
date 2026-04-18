// ── P0 baseline: capture the old-pipeline tree snapshot for the fixture ──
//
// Run once after the fixture is finalised to produce
// test/fixtures/goal-phase-baseline.json. Subsequent runs of this test
// verify the old pipeline still produces the same snapshot (regression guard
// while P1 is in progress and the old pipeline is still the source of truth).
//
// P1 will add a parallel test that runs the fixture through the new
// cardTreeStore / tree-writer pipeline and asserts the same snapshot.
//
// Re-generate with: OVERWRITE_BASELINE=1 bun test packages/overlay/test/replay-baseline.test.ts

import { test, expect } from "bun:test";
import { writeFileSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { EVENTS, INITIAL_BOARD } from "./fixtures/goal-phase-events";
import { replay, type TreeSnapshot } from "./fixtures/replay";

const BASELINE_PATH = resolve(import.meta.dir, "fixtures/goal-phase-baseline.json");

function stableStringify(value: TreeSnapshot): string {
  // Deterministic JSON: sort keys at every level so diffs are stable.
  const sortKeys = (v: any): any => {
    if (Array.isArray(v)) return v.map(sortKeys);
    if (v && typeof v === "object") {
      const out: Record<string, any> = {};
      for (const k of Object.keys(v).sort()) out[k] = sortKeys(v[k]);
      return out;
    }
    return v;
  };
  return JSON.stringify(sortKeys(value), null, 2);
}

test("capture or verify old-pipeline baseline", async () => {
  const snapshot = await replay(EVENTS, INITIAL_BOARD);
  const serialized = stableStringify(snapshot);

  const overwrite = process.env.OVERWRITE_BASELINE === "1";
  if (overwrite || !existsSync(BASELINE_PATH)) {
    writeFileSync(BASELINE_PATH, serialized + "\n");
    console.log(
      `[baseline] wrote ${BASELINE_PATH} (${snapshot.order.length} root nodes, ` +
        `${Object.keys(snapshot.nodes).length} total nodes)`,
    );
    expect(snapshot.order.length).toBeGreaterThan(0);
    return;
  }

  const expected = readFileSync(BASELINE_PATH, "utf8").trim();
  const actual = serialized.trim();
  if (actual !== expected) {
    // Emit a short structural diff for quick triage.
    const actualObj = JSON.parse(actual);
    const expectedObj = JSON.parse(expected);
    const missing = expectedObj.order.filter((id: string) => !actualObj.nodes[id]);
    const extra = actualObj.order.filter((id: string) => !expectedObj.nodes[id]);
    console.error("[baseline drift]");
    if (missing.length) console.error("  missing nodes:", missing);
    if (extra.length) console.error("  extra nodes:", extra);
  }
  expect(actual).toBe(expected);
});
