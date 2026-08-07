# Browser Preview Selection Unmounted Rejection Repair

## Recall

- User request on 2026-07-09:
  - Overlay runtime reported `source: window.unhandledrejection`.
  - Error message: `browser preview webview is not mounted`.
- Acceptance criteria:
  - Browser Preview must not emit `window.unhandledrejection` when selection cleanup runs before the native child webview is mounted.
  - Disabling Browser Preview node selection is idempotent when the native webview is absent; the desired state is already disabled.
  - Enabling Browser Preview node selection still requires a mounted native webview and must surface a Browser Preview panel error if that command fails.
  - Keep `window.unhandledrejection` diagnostics intact for real unowned failures.
  - Keep the single native child-webview live preview path; do not add iframe, local signal, fallback preview, gate, or compatibility behavior.
  - Add regression coverage that reproduces the unmounted native selection disable path and proves it is owned.
- Hard constraints:
  - No fallback or compatibility branch.
  - Do not restart, refresh, or kill the user's running OpenCorvus or overlay process.
  - Browser verification must use isolated Node-driven browser fixtures on Windows.
  - Preserve task-scoped Browser Preview target/evidence ownership.
- Sources read before implementation:
  - `AGENTS.md`
  - `specs/records/2026-07/2026-07-09-browser-preview-header-project-action-visibility.md`
  - `specs/records/2026-07/2026-07-08-browser-preview-dom-selection-sync.md`
  - `specs/records/2026-06/2026-06-23-overlay-window-unhandledrejection-root-repair.md`
  - `specs/records/2026-06/2026-06-23-task-list-refresh-unhandled-rejection.md`
  - `packages/overlay/src/components/BrowserPreviewPanel.tsx`
  - `packages/overlay/src/services/browser-preview-native.ts`
  - `packages/overlay/src/services/tauri-transport.ts`
  - `packages/overlay/src-tauri/src/main.rs`
  - `packages/overlay/test/browser-preview-panel.test.ts`
  - `packages/overlay/test/browser-preview-native.test.ts`
  - `packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`
- Whole-repository grep evidence:
  - `rg -n "browser preview webview is not mounted|webview is not mounted|Browser preview webview|mounted|unhandledrejection|overlay_browser_preview|browserPreview" packages/opencorvus packages/overlay packages/transport-protocol specs -g "!**/node_modules/**"`
  - `rg -n "void setNativeSelectionEnabled\\(|overlay_browser_preview_selection_set_enabled|browser preview webview is not mounted|unhandledrejection|window\\.unhandledrejection|BrowserPreviewPanel|browser-preview-native" packages/overlay/src packages/overlay/test packages/overlay/src-tauri/src/main.rs specs/records/2026-06 specs/records/2026-07 -g "!**/node_modules/**"`
- Independent agent feedback:
  - No subagent was launched because the current request is a focused owner-path repair and no user request asked for parallel subagents.

## Diagnosis

`BrowserPreviewPanel.clearNodeSelection()` calls `void setNativeSelectionEnabled(false)` without a rejection owner. This function runs during task-scope cleanup, reload cleanup, and initial native-scope transitions, including before `overlay_browser_preview_sync` has created the native child webview.

On the Rust side, `overlay_browser_preview_selection_set_enabled(false)` currently requires `app.get_webview(BROWSER_PREVIEW_WEBVIEW_LABEL)` and returns `Err("browser preview webview is not mounted")` when the webview is absent. That is correct for enabling selection, but it is too strict for disabling selection: if no child webview exists, selection is already disabled. The rejected Promise then reaches the global `window.unhandledrejection` listener.

The root fix is not to remove the global listener or mask runtime diagnostics. The Browser Preview selection lifecycle must own this cleanup path, and the native command contract must make `enabled=false` idempotent when no webview is mounted.

## Plan

1. Make native `overlay_browser_preview_selection_set_enabled(false)` clear the selection store and return `Ok(false)` when the webview is absent.
2. Keep `overlay_browser_preview_selection_set_enabled(true)` rejecting when the native webview is absent.
3. Add a Browser Preview panel owner helper for selection disable promises so unexpected native cleanup failures do not escape to `window.unhandledrejection`.
4. Extend browser tests with a Tauri fixture that rejects unmounted selection disable before the first native sync and asserts no `window.unhandledrejection`.
5. Extend source/unit tests to lock the idempotent disable contract.

## Validation Targets

- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-native.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-header-browser.test.ts packages/overlay/test/browser/project-directory-new-chat-browser.test.ts packages/overlay/test/browser/project-ledger-group-browser.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts`
- `bun run typecheck`
- `bun run api:routes-check`
- `bun run docs:check`
- `bun run --cwd packages/overlay check:i18n`
- `git diff --check`
