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
 *   - Unused `headless` constant (Playwright launch hardcodes `false` per
 *     rule 25 — visible UI is required for visual benchmarks).
 *   - Stale `TASK_GOALS` mention referencing a removed input format.
 *
 * Rule 17 says delete don't keep — this test makes sure the dead wiring
 * doesn't crawl back via well-meaning "for back-compat" PRs.
 */

const BENCH_SCRIPT = path.join(import.meta.dir, "..", "..", "script", "benchmark", "overlay-web-benchmark.ts")
const BENCHMARK_DIR = path.dirname(BENCH_SCRIPT)

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

test("unused module-scope `headless` const is gone (Playwright launch keeps the literal)", () => {
  expect(src).not.toMatch(/^const headless = false$/m)
  // Sanity: the Playwright launch site still exists and still uses the literal,
  // so removal of the unused module-scope const didn't accidentally hide the
  // visual-mode requirement (rule 25).
  expect(src).toMatch(/headless: false,/)
})

test("stale TASK_GOALS mention is gone", () => {
  expect(src).not.toMatch(/TASK_GOALS/)
})

test("benchmark errors cannot be swallowed as successful no-report exits", () => {
  const catchIndex = src.indexOf("} catch (error) {")
  const exitCodeIndex = src.indexOf("process.exitCode = 1", catchIndex)
  const reportIndex = src.indexOf("buildBenchmarkReport(error)", catchIndex)

  expect(catchIndex).toBeGreaterThan(0)
  expect(exitCodeIndex).toBeGreaterThan(catchIndex)
  expect(reportIndex).toBeGreaterThan(exitCodeIndex)
  expect(src).toContain("failed to write benchmark report")
  expect(src).toContain('type: "benchmark_report_failed"')
})

test("benchmark path flags tolerate shell-preserved wrapping quotes", () => {
  expect(src).toContain("function stripWrappingQuotes")
  expect(src).toContain('const report = stripWrappingQuotes(flag("--report"))')
})

test("benchmark does not auto-resume failed terminal tasks", () => {
  expect(src).not.toMatch(/--max-auto-resumes/)
  expect(src).not.toMatch(/\bmaxAutoResumes\b/)
  expect(src).not.toMatch(/\bautoResumes\b/)
  expect(src).not.toMatch(/auto-resume/)
  expect(src).toContain("report preserves the terminal state without automatic resume")
})

test("resume mode attaches read-only unless an explicit message is provided", () => {
  expect(src).toContain('const resumeMessage = flag("--resume-message")')
  expect(src).not.toContain("修复所有失败的goals并重试")
  expect(src).toContain("attached without message injection")
  expect(src).toContain("injecting explicit message")
  expect(src).not.toContain("resume message inject failed")
})

test("benchmark timeout mechanism stays disabled instead of using stale inactivity heuristics", () => {
  expect(src).toContain("--idle-timeout-ms")
  expect(src).toContain("idle_timeout_ms=disabled")
  expect(src).not.toContain("function assertRecentBenchmarkActivity")
  expect(src).not.toContain("had no benchmark activity")
  expect(src).not.toContain("Date.now() - lastActivityLogAt")
})

test("benchmark trace override uses current runtime root instead of legacy trace path", () => {
  expect(src).toContain(`".opencorvus", "runtime", "trace"`)
  expect(src).not.toContain(`".opencorvus", "trace"`)
})

test("benchmark model config does not shadow built-in providers with empty overrides", () => {
  expect(src).toContain("Do not write an empty provider override")
  expect(src).not.toContain("const providerID = model.split")
  expect(src).not.toContain("[providerID]:")
})

test("benchmark report preserves missing evidence instead of substituting empty API data", () => {
  expect(src).not.toContain("tryApiJson")
  expect(src).not.toContain("fallback: unknown")
  expect(src).toContain("report_api_errors")
  expect(src).toContain("report api error")
})

test("benchmark git changed-file evidence fails loudly", () => {
  expect(src).not.toMatch(/gitFallback/)
  expect(src).not.toMatch(/catch\(\(\) => \[\] as string\[\]\)/)
  expect(src).toContain("Git is a parallel evidence")
  expect(src).toContain("failed with exit")
})

test("benchmark local visual verification waits for completed tasks", () => {
  expect(src).toContain("skippedLocalVerify")
  expect(src).toContain('currentTaskStatus !== "completed"')
  expect(src).toContain("skipped because task status is")
  expect(src).toContain("skipped because benchmark ended before task completion")
})

test("benchmark auto verification uses task-scoped HTML skeleton workflow thresholds", () => {
  expect(src).toContain("WEB_CLONE_VISUAL_THRESHOLD")
  expect(src).toContain("WEB_CLONE_VISUAL_WORST_THRESHOLD")
  expect(src).toContain("html-skeleton-workflow-check.ts")
  expect(src).toContain(`".opencorvus", "runtime", "tasks"`)
  expect(src).toContain("--task-dir=${safe(taskRoot)}")
  expect(src).toContain(".html-skeleton-workflow-out")
  expect(src).toContain("--threshold=${WEB_CLONE_VISUAL_THRESHOLD}")
  expect(src).toContain("--worst-threshold=${WEB_CLONE_VISUAL_WORST_THRESHOLD}")
  expect(src).not.toContain("--rendered-dir=${safe(temp.dir)}")
  expect(src).not.toContain("Fig2code SSIM thresholds (mean 0.85")
})

test("benchmark task metadata wires auto verification into acceptance checks", () => {
  expect(src).toContain("checks: { verify_cmd: [ACCEPTANCE_VERIFY_CMD] }")
  expect(src).not.toContain("acceptance_verify_cmd: ACCEPTANCE_VERIFY_CMD")
})

test("benchmark evidence inputs stay outside the project worktree", () => {
  expect(src).not.toContain("Copy request file into the project directory")
  expect(src).not.toContain('path.join(temp.dir, "references")')
  expect(src).not.toContain("await fs.copyFile(path.resolve(requestFile)")
  expect(src).not.toContain('path.join(dir, "opencorvus.json")')
  expect(src).not.toContain('path.join(dir, ".opencorvus", "opencorvus.json")')
  expect(src).toContain('await Bun.write(path.join(temp.config, "opencorvus.json"), config)')
})

test("retired mirror and image-to-code benchmark entrypoints stay removed", async () => {
  expect(await Bun.file(path.join(BENCHMARK_DIR, "mirror-baidu-clone.ts")).exists()).toBe(false)
  expect(await Bun.file(path.join(BENCHMARK_DIR, "mirror-bbc-clone.ts")).exists()).toBe(false)
  expect(await Bun.file(path.join(BENCHMARK_DIR, "image2code-benchmark.ts")).exists()).toBe(false)
})
