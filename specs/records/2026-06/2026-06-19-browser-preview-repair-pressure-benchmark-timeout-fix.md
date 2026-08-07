# Browser Preview Repair Pressure Benchmark Timeout Fix - 2026-06-19

## Acronyms

- API: Application Programming Interface, the backend contract used by routes and tools.
- ID: Identifier, a task, target, region, viewport, or artifact key.
- JSON: JavaScript Object Notation, the structured output format used by sidecar tools.
- QA: Quality Assurance, the review stage that verifies benchmark evidence.

## Task

Repair the `browser-preview` repair-tool algorithm pressure benchmark so it has
a deterministic unattended execution path. The fix must preserve the 2026-06-18
algorithm acceptance surface and remove the current ambiguity between:

1. Bun's per-test timeout.
2. The benchmark's outer process timeout.
3. Browser Node sidecar timeout behavior.

## Recall

- `AGENTS.md` requires Windows Playwright to launch through Node, not Bun.
- `2026-06-18-browser-preview-repair-tool-algorithm-pressure-benchmark.md`
  requires an inactivity-aware benchmark wrapper and says Bun's per-test timeout
  is only a last-resort hung-test guard.
- `specs/records/2026-06/bug-hunt-2026-06-17.md` records prior timeout failures:
  sidecar handshake reads that waited forever on silent open stdout and
  acceptance runners that used fixed process-start deadlines.
- `packages/opencorvus/src/shell/shell.ts` already provides `Shell.run(...)`
  with `idleTimeoutMs`, resetting the timer on stdout or stderr activity.

## Reproduction

From `packages/opencorvus`:

```powershell
bun test test/browser-preview/local-module-source-binding.test.ts test/browser-preview/region-comparison.test.ts test/browser-preview/region-visible-locator.test.ts test/browser-preview/region-source-bbox.test.ts test/browser-preview/region-route-diagnostics.test.ts test/browser-preview/region-route-state.test.ts test/browser-preview/region-strict-schema.test.ts test/agent/runner-prompt.test.ts test/tool/browser-preview.test.ts test/visual-qa/output-tools.test.ts test/integrity/acceptance-tools.test.ts
```

Observed on 2026-06-19:

- Result: `53 pass / 1 fail / 1 error`.
- Runtime: about 134 seconds.
- Failure: `runAgentSession does not hide-recover when structured output is missing`
  exceeded Bun's default 5000ms test timeout.
- Browser-preview algorithm tests passed.

With `--timeout 30000`, the same benchmark can pass, but an outer 120-second
mechanical wall-clock limit can still kill it before completion. That creates a
false "hang" diagnosis even when stdout/stderr activity and test progress exist.

## Call Point Sweep

| Surface                           | Evidence                                                                                                                                  | Decision                                                                                                              |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Pressure benchmark command        | `2026-06-18-browser-preview-repair-tool-algorithm-pressure-benchmark.md` lists a raw `bun test ...` command without `--timeout`.          | Replace the benchmark entry with a dedicated runner and document the raw command only with explicit per-test timeout. |
| Inactivity runner                 | `Shell.run(command, { idleTimeoutMs })` resets on stdout/stderr and is already tested by benchmark script tests.                          | Reuse this mature runner instead of adding another process runner.                                                    |
| `runner-prompt.test.ts`           | Eight tests use Bun's default timeout even though several create instances, databases, sessions, and dynamic imports.                     | Add one explicit test timeout constant and attach it to every test in the file.                                       |
| Browser Node sidecar executor     | `runBrowserNodeSidecar(...)` has a fixed `hardTimeoutMs` and all browser-preview/webpage/frontend-design callers pass wall-clock budgets. | Record as a separate shared-runtime follow-up; do not rewrite the sidecar protocol inside this benchmark fix.         |
| Browser-preview region comparison | `region-comparison.ts` delegates runtime capture to `evidence-runner.ts`; it no longer owns a second sidecar.                             | No algorithm change required.                                                                                         |
| Node Playwright runtime           | `resolveBrowserNodeSidecarRuntime(...)` chooses `node.exe`/`node` under Bun development and sets `OPENCORVUS_PLAYWRIGHT_REQUIRE_PATH`.    | Preserve this path; do not launch Playwright directly from Bun.                                                       |

## Root Cause

The benchmark definition did not expose the actual timeout contract as code.
The raw command allowed Bun's default 5000ms per-test guard to fail long but
valid runner tests, and external invocations could still apply a mechanical
process-start timeout. The visible symptom was a "hung" benchmark, but the
browser-preview algorithms were not deadlocked in the reproduced failures.

## Fix Plan

1. Add `packages/opencorvus/script/benchmark/browser-preview-repair-pressure.ts`.
   - The script runs the exact 2026-06-18 pressure file list.
   - It invokes `bun test --timeout <per-test-timeout-ms> ...`.
   - It runs through `Shell.run(..., { idleTimeoutMs })`, so the outer watchdog
     fails only after stdout/stderr inactivity.
   - It emits a concise benchmark log and exits non-zero when tests fail,
     hard-timeout, idle-timeout, or abort.

2. Add a source-contract test for the benchmark runner.
   - Assert the file list includes the browser-preview and runner tool suites.
   - Assert `--timeout` is wired as Bun's per-test guard.
   - Assert `Shell.run` receives `idleTimeoutMs`.
   - Assert no hard `timeoutMs`, `Date.now()` deadline loop, or `proc.exited`
     based mechanical wait is introduced.

3. Add explicit timeout to `test/agent/runner-prompt.test.ts`.
   - Use one named constant.
   - Attach the same timeout to all eight tests.
   - This is a test harness stability fix, not a product behavior change.

4. Update the 2026-06-18 benchmark spec.
   - Point manual runs to the dedicated benchmark script.
   - Keep the raw test command as an implementation detail with explicit
     `--timeout 30000`.
   - Record that the benchmark runner is the single unattended entry.

## Acceptance

- `bun test test/agent/runner-prompt.test.ts` passes without relying on Bun's
  default 5000ms timeout.
- `bun test test/benchmark/browser-preview-repair-pressure.test.ts` passes.
- `bun script/benchmark/browser-preview-repair-pressure.ts --idle-timeout-ms 120000 --per-test-timeout-ms 30000` passes.
- The original pressure file list passes through the new runner.
- The repair introduces no fallback path, raw URL comparison, extra sidecar, or
  direct Bun Playwright launch.

## Deferred Risk

`runBrowserNodeSidecar(...)` still uses fixed `hardTimeoutMs`. That is a real
shared-runtime timeout semantics risk, but the child scripts currently emit only
final JSON, so converting it to pure stdout/stderr inactivity would require a
small progress protocol across all sidecar scripts. That should be handled as a
separate browser Node sidecar runtime repair with its own regression tests.
