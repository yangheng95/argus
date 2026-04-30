import { test, expect } from "bun:test"
import path from "node:path"

/**
 * Pin the bench-script cleanup landed alongside the engine-stream-error wedge
 * fix. The script accumulated dead wiring from earlier pipeline architectures:
 *
 *   - `--spec-max-steps` / `--planner-max-steps` flags + their
 *     `OPENCORVUS_SPEC_AGENT_MAX_STEPS` / `OPENCORVUS_PLANNER_AGENT_MAX_STEPS`
 *     env-var writes — zero readers in `packages/opencorvus/src` (only a
 *     legacy e2e test still consumes them, out of scope here).
 *   - Legacy `orchestrator.spec.created`/`spec.updated`/`plan.created`/
 *     `plan.activated` event types in `DIAG_TYPES` and the matching
 *     `formatEventLine` handler — the engine no longer emits them.
 *   - Unused `headless` constant (puppeteer launch hardcodes `false` per
 *     rule 25 — visible UI is required for visual benchmarks).
 *   - Stale `TASK_GOALS` mention referencing a removed input format.
 *
 * Rule 17 says delete don't keep — this test makes sure the dead wiring
 * doesn't crawl back via well-meaning "for back-compat" PRs.
 */

const BENCH_SCRIPT = path.join(
  import.meta.dir,
  "..",
  "..",
  "script",
  "benchmark",
  "overlay-web-benchmark.ts",
)

const src = await Bun.file(BENCH_SCRIPT).text()

test("legacy spec/planner-max-steps wiring is gone", () => {
  expect(src).not.toMatch(/--spec-max-steps/)
  expect(src).not.toMatch(/--planner-max-steps/)
  expect(src).not.toMatch(/\bspecMaxSteps\b/)
  expect(src).not.toMatch(/\bplannerMaxSteps\b/)
  expect(src).not.toMatch(/OPENCORVUS_SPEC_AGENT_MAX_STEPS/)
  expect(src).not.toMatch(/OPENCORVUS_PLANNER_AGENT_MAX_STEPS/)
  expect(src).not.toMatch(/stage_max_steps/)
})

test("legacy spec/plan event types stay removed from DIAG_TYPES", () => {
  expect(src).not.toMatch(/orchestrator\.spec\.created/)
  expect(src).not.toMatch(/orchestrator\.spec\.updated/)
  expect(src).not.toMatch(/orchestrator\.plan\.created/)
  expect(src).not.toMatch(/orchestrator\.plan\.activated/)
})

test("unused module-scope `headless` const is gone (puppeteer launch keeps the literal)", () => {
  expect(src).not.toMatch(/^const headless = false$/m)
  // Sanity: the puppeteer launch site still exists and still uses the literal,
  // so removal of the unused module-scope const didn't accidentally hide the
  // visual-mode requirement (rule 25).
  expect(src).toMatch(/headless: false,/)
})

test("stale TASK_GOALS mention is gone", () => {
  expect(src).not.toMatch(/TASK_GOALS/)
})
