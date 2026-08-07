# Overlay Page Preview End-to-End Repair

## Recall

- User request on 2026-07-09:
  - `请端到端测试和修复现在的overlay页面预览的问题`.
- Acceptance criteria:
  - Browser Preview must be tested end to end with isolated Node-driven Playwright/Chromium fixtures and visual screenshots.
  - A ready task-scoped backend Browser Preview target must open the real native live preview surface when the Tauri native commands are available.
  - Persisted Playwright evidence remains task-scoped diagnostic/capture evidence; it must not become a second page-preview owner or suppress the live page preview by default.
  - Evidence capture/refresh must stay explicit through the backend `/task/:taskID/browser-preview*` routes; opening or reloading the live preview must not auto-capture evidence.
  - No iframe, PNG live loop, local signal, query override, raw URL body, fallback preview path, or compatibility branch may be introduced.
  - Visual verification must inspect generated screenshots, not only lint/typecheck or DOM text.
  - Tests must use no-activity timeout behavior and must not hang without useful diagnostics.
- Hard constraints:
  - Do not restart, refresh, kill, or reuse the user's running OpenCorvus/overlay process.
  - Do not revert existing dirty worktree changes.
  - Do not create a new git worktree.
  - Playwright browser tests on Windows must be launched with Node, not Bun.
  - Keep task-scoped backend preview target/evidence as the single authority.
- Sources read before implementation:
  - `AGENTS.md`
  - `C:/Users/chuan/.codex/skills/benchmark-debug-template/SKILL.md`
  - `specs/README.md`
  - `specs/records/2026-07/README.md`
  - `specs/current/architecture/09-verification-evidence.md`
  - `specs/current/architecture/18-webpage-replica-agent-workflow.md`
  - `specs/records/2026-07/2026-07-01-browser-preview-native-webview-root-repair.md`
  - `specs/records/2026-07/2026-07-05-overlay-preview-cli-root-repair.md`
  - `specs/records/2026-07/2026-07-08-browser-preview-dom-selection-sync.md`
  - `specs/records/2026-07/2026-07-09-browser-preview-header-project-action-visibility.md`
  - `specs/records/2026-07/2026-07-09-browser-preview-selection-unmounted-rejection.md`
  - `specs/records/2026-06/2026-06-15-browser-preview-live-target-boundary.md`
  - `specs/records/2026-06/2026-06-17-browser-preview-selected-target-authority.md`
  - `specs/records/2026-06/2026-06-17-browser-preview-visible-region-locator.md`
  - `packages/overlay/src/components/BrowserPreviewPanel.tsx`
  - `packages/overlay/src/services/browser-preview.ts`
  - `packages/overlay/src/services/browser-preview-native.ts`
  - `packages/overlay/src/services/host-transport.ts`
  - `packages/overlay/src/services/tauri-transport.ts`
  - `packages/overlay/src/styles/surfaces/inspector.css`
  - `packages/overlay/src-tauri/src/main.rs`
  - `packages/overlay/test/browser-preview-panel.test.ts`
  - `packages/overlay/test/browser-preview-native.test.ts`
  - `packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`
  - `packages/overlay/test/browser/browser-preview-visual-stress.test.ts`
  - `packages/overlay/test/browser/browser-preview-evidence.test.ts`
  - `packages/overlay/test/browser-runner.mjs`
- Whole-repository grep evidence:
  - `rg -n "BrowserPreview|browser preview|preview target|previewTarget|task-scoped|evidence" specs/current specs/records/2026-07 specs/records/2026-06 specs/artifacts packages/overlay packages/opencorvus/src packages/opencorvus/test`
  - `rg -n "browserPreview|BrowserPreview|browser-preview|preview target|previewTarget|overlay_browser_preview|browser_preview" packages/overlay/src packages/overlay/test packages/opencorvus/src/browser-preview packages/opencorvus/src/server/routes packages/opencorvus/test/browser-preview packages/opencorvus/test/server packages/transport-protocol packages/vscode-extension/test -g "!**/node_modules/**" -g "!packages/overlay/src-tauri/target*/**"`
  - `rg -n "latestEvidenceIDs|browser-preview-native-surface|browser-preview-evidence|evidence-missing|capture|native sync|native surface|selection|reload|selectedTarget|targetID|live preview" packages/overlay/test/browser/browser-preview-evidence.test.ts packages/overlay/test/browser/browser-preview-visual-stress.test.ts packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`
  - `rg -n "browser-preview-candidate|browser-preview-viewport|browser-preview-capture|browser-preview-status|browser-preview-evidence-status|Refresh the saved preview evidence|Capture Playwright|candidate-trigger|capture-button|viewport-controls|SelectControl|SegmentedControl" packages/overlay/src/components/BrowserPreviewPanel.tsx packages/overlay/src/styles/surfaces/inspector.css packages/overlay/test -S`
- Independent agent feedback:
  - No subagent was launched because the currently available multi-agent tool explicitly requires a user request for subagents or parallel agent work. This record uses main-agent source review, grep evidence, focused tests, and visual screenshots.

## Current Benchmark Results

- Passed:
  - `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-native.test.ts --timeout 120000`
  - `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`
- Failed / unusable:
  - `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-visual-stress.test.ts` ended with `overlay browser tests inactive for 600000ms after runner start; terminating test process`.
- Visual review:
  - Reviewed `packages/overlay/.scratch/browser-preview-native-surface.png`; Chromium cannot show Tauri child WebView pixels, but the overlay chrome and tall native surface region render.
  - Reviewed `packages/overlay/.scratch/browser-preview-native-error.png`; the native sync error state is visible and bound to the selected backend URL.

## Diagnosis

The immediate preview defect is in `BrowserPreviewPanel.tsx`:

- `nativePreviewScope()` returns `undefined` when `latestEvidenceScope()` or `renderedEvidence()` exists and no DOM node selection is active.
- The render `Switch` places `[data-ui="browser-preview-evidence"]` before `[data-ui="browser-preview-live"]`.
- As a result, a ready task-scoped preview target with persisted evidence defaults to the screenshot evidence card instead of the page preview surface.

That behavior conflicts with the current native WebView architecture record. Browser Preview's page preview owner is the native live surface; Playwright screenshots are evidence/diagnostics. Existing tests encode both models: the native-surface test expects live preview for a ready target without evidence, while older evidence/stress tests expect persisted evidence to suppress live preview and also reference retired controls such as candidate trigger, viewport buttons, capture button, and evidence status. The stress benchmark hanging without a useful assertion is therefore a benchmark problem and a product-contract problem.

## Plan

1. Replace the evidence-first stage ownership with live-preview-first ownership for ready native targets.
2. Keep persisted evidence as explicit evidence detail/diagnostic state without becoming the default page preview surface.
3. Update browser tests so a target with `latestEvidenceIDs` still syncs the native preview and does not auto-call `/capture` or retired `/live/*` routes.
4. Keep source guards for no iframe, no PNG live loop, no raw URL/local override, and task-scoped backend service paths.
5. If old tests still target deleted controls, retire or rewrite those assertions to the current command surface rather than preserving dead UI.
6. Rerun focused unit tests, Node browser tests, screenshot review, docs health for the new record, and diff checks.

## Validation Targets

- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-native.test.ts --timeout 120000`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`
- A focused Node browser regression proving persisted evidence does not suppress the live native preview.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts --timeout 120000`
- `bun run --cwd packages/overlay check:i18n`
- `git diff --check`

## Implementation Results

- `BrowserPreviewPanel.tsx` now lets a ready task-scoped native target render `[data-ui="browser-preview-live"]` before persisted evidence states, so saved Playwright evidence no longer suppresses the live page preview.
- `nativePreviewScope()` no longer depends on `latestEvidenceScope()` or `renderedEvidence()`.
- Hidden evidence PNG loading is disabled while the native live preview scope exists; non-native hosts still render the persisted evidence card and screenshot from task-scoped evidence routes.
- `navigatePreview("reload")` now issues the native reload command against the current live surface before refreshing the backend target token. The previous ordering refreshed the resource first and could make `nativePreviewScope()` disappear inside the same click handler.
- The obsolete browser tests that waited for retired candidate, viewport, and capture controls were rewritten around the current address-input/native-surface/evidence-host contract.

## Verified Results

- Passed `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-native.test.ts --timeout 120000`.
- Passed `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`.
- Passed `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-visual-stress.test.ts`.
- Passed `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-evidence.test.ts`.
- Passed `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-header-browser.test.ts`.
- Visual review inspected:
  - `packages/overlay/.scratch/browser-preview-visual-stress/01-target-load-failure.png`
  - `packages/overlay/.scratch/browser-preview-visual-stress/02-ready-native.png`
  - `packages/overlay/.scratch/browser-preview-visual-stress/03-native-sync-failure.png`
  - `packages/overlay/.scratch/browser-preview-visual-stress/04-missing-target.png`
  - `packages/overlay/.scratch/browser-preview-visual-stress/05-target-failed.png`
  - `packages/overlay/.scratch/browser-preview-evidence/01-evidence-backed-preview.png`
