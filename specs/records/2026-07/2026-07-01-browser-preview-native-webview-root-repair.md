# Browser Preview Native Webview Root Repair

## Glossary

- PNG (Portable Network Graphics): the binary image format returned by the current live browser preview routes.
- API (Application Programming Interface): the typed route or host command surface used between overlay, backend, and native host.
- UI (User Interface): the visible overlay panel.
- CSS (Cascading Style Sheets): the overlay styling layer.
- DOM (Document Object Model): the browser document tree inspected by overlay tests.
- CSP (Content Security Policy): the browser security policy that already blocks iframe preview in the VS Code host.

## Recall

### User Request

The user reported that the overlay web preview is very slow, feels frame-by-frame,
lacks back/forward/refresh controls, should not be constrained to a short preview
height when the panel has room for a long page, and asked whether a mature
ecosystem exists because hand-rolling this preview is too low quality.

### Acceptance Criteria

- Explain the current jank from source evidence rather than guessing.
- Do not revive iframe preview, local query override, local signal override, or any fallback preview source.
- Browser back, forward, and page refresh must be explicit browser commands, not confused with target/evidence reload.
- The preview surface must not be locked to the viewport PNG aspect ratio when the panel can allocate more vertical space.
- Prefer a mature browser surface over continuing to hand-roll a browser through screenshots.
- Preserve task-scoped backend preview target and evidence as the single source of truth.

### Hard Constraints

- `AGENTS.md` forbids fallback logic, dual-source preview ownership, gate-style bypasses, and untested code changes.
- Existing right-panel preview rules forbid temporary iframe, local signal, query override, or hand-written interaction masquerading as a mature toolchain.
- Playwright on Windows must be launched through Node, not Bun.
- Existing OpenCorvus or overlay runtime processes must not be restarted, killed, refreshed, or otherwise disturbed without explicit user approval.
- Frontend visual changes require launching a real page, taking screenshots, inspecting them, and iterating until the visual target is actually met.

### Disk Records Read

- `AGENTS.md`
- `specs/current/architecture/07-panel.md`
- `specs/records/2026-06/2026-06-04-right-panel-frontend-preview-mature-toolchain.md`
- `specs/records/2026-06/2026-06-11-browser-preview-interactive-live-session.md`
- `specs/records/2026-06/2026-06-22-browser-preview-evidence-live-snapshot-boundary.md`
- `specs/records/2026-06/2026-06-28-browser-preview-pane-width-autoscale.md`
- `specs/records/2026-06/2026-06-30-browser-preview-viewport-slice-binding.md`
- `specs/records/2026-06/bug-hunt-repair-plan-2026-06-17.md`

### Full-Repository Search

- `rg -n "browser-preview|BrowserPreview|live snapshot|live/input|Webview|webview|iframe|fullPage|page\\.screenshot|goBack|goForward|reload" specs/current specs/records/2026-06 packages/overlay packages/opencorvus`
- `rg -n --glob '!packages/overlay/src-tauri/target*/**' --glob '!**/node_modules/**' --glob '!**/.git/**' "browser-preview|BrowserPreview|live/snapshot|live/input|page\\.screenshot|fullPage|iframe|Webview|webview|goBack|goForward|reload" packages/overlay packages/opencorvus specs/current specs/records/2026-06`
- `rg -n --glob '!packages/overlay/src-tauri/target*/**' --glob '!**/node_modules/**' "loadTaskBrowserPreviewLiveSnapshotObjectUrl|sendTaskBrowserPreviewLiveInputsObjectUrl|PendingBrowserPreviewLiveInput|browser-preview-live|captureBrowserPreviewLiveSnapshot|interactBrowserPreviewLive|BrowserPreviewLiveInput|live/snapshot|live/input" packages/overlay packages/opencorvus`
- `rg -n --glob '!packages/overlay/src-tauri/target*/**' --glob '!**/node_modules/**' "page\\.screenshot\\(|fullPage|ensurePage\\(|goBack|goForward|reload\\(|window\\.location\\.reload|core:webview|allow-create-webview|withGlobalTauri|@tauri-apps/api|Webview" packages/overlay packages/opencorvus`

### Independent Feedback

No independent sub-agent feedback was used. The available sub-agent tool
explicitly forbids spawning agents unless the user asks for sub-agents or
parallel agent work, and the user did not ask for that in this goal. This record
therefore uses local implementation review plus automated and visual verification
as the review path for the native Webview repair.

## Current Evidence

| Area | Evidence | Meaning |
| --- | --- | --- |
| Overlay live input model | `packages/overlay/src/components/BrowserPreviewPanel.tsx` only models `PendingBrowserPreviewLiveInput` as click, wheel, key-ready input and point conversion. | The panel has no browser navigation command model. |
| Overlay live transport | `loadLiveFrame(...)` calls `/live/snapshot` for initial load and `/live/input` after user input, then replaces an object URL. | The visible preview is an image stream, not a browser surface. |
| Overlay live layout | `liveFrameStyle(...)` sets `--browser-preview-live-aspect-ratio` from backend viewport width/height. | The live frame height is intentionally tied to the selected viewport ratio. |
| CSS live frame | `.browser-preview-live-frame` uses `aspect-ratio: var(--browser-preview-live-aspect-ratio)` and the PNG image uses `width: 100%; height: auto`. | Removing a height rule alone cannot make the backend capture a long page. |
| Backend live route schema | `packages/opencorvus/src/server/routes/browser-preview.ts` accepts only `click`, `wheel`, and `key` live inputs. | Back, forward, and page reload are not exposed by the route contract. |
| Backend live sidecar | `packages/opencorvus/src/browser-preview/live.ts` applies input through Playwright and then `activePage.screenshot({ type: "png" })`. | Every visible change waits for backend browser work plus screenshot encoding plus binary transport. |
| Historic live snapshot repair | `bug-hunt-repair-plan-2026-06-17.md` records that same-target snapshots must preserve active page state and not reload automatically. | A refresh button cannot be implemented by making every snapshot reload again. |
| Tauri host | `packages/overlay/src-tauri/tauri.conf.json` has `withGlobalTauri: true`; `capabilities/default.json` does not grant create/set-position/set-size webview permissions; `packages/overlay/package.json` does not depend on `@tauri-apps/api`. | The mature native Webview path is not wired today. |

## Root Cause Chain

The visible symptom is frame-by-frame preview updates. The direct trigger is
that the overlay does not render a live browser. It renders a PNG in an image
element. Each click, wheel, or key event is converted into a backend live input,
serialized through the task-scoped browser preview route, executed in a
persistent headless Playwright page, followed by a new PNG screenshot that
replaces the previous object URL.

The deeper design cause is that the June live-session repair solved
interactivity without embedding arbitrary URLs: it correctly rejected iframe and
local preview-source shortcuts, but the chosen live surface is still a screenshot
transport. That model is acceptable for evidence and diagnostics. It is the
wrong long-term live preview surface because browser scrolling, compositing,
input latency, history, refresh, focus, and long-page layout become manual
protocol work.

The height complaint has the same root cause. The backend returns a viewport
screenshot, and the overlay frame is sized to the viewport aspect ratio. A taller
panel cannot reveal page content that was never captured. Changing CSS alone
would only resize or misframe the viewport PNG.

## Rejected Repairs

- Full-page PNG for live preview: this would make each interaction more
  expensive, break or complicate coordinate mapping for clicks below the current
  viewport, and still leave the preview as a non-browser image.
- Back/forward/reload added only as Playwright live-input commands: this can add
  missing buttons, but it does not address the frame-by-frame image-stream root
  cause.
- Iframe preview: historical records and current tests explicitly reject iframe
  rendering, local query override, and local signal override.
- Automatic snapshot reload: June 17 records explicitly repaired same-target
  snapshots so they preserve active page state.

## Root Repair Direction

The live preview should move to a native embedded browser surface in the overlay
host. For the current Tauri desktop host, the mature ecosystem path is Tauri 2
child Webview backed by the system webview runtime; on Windows this rides the
WebView2 stack already present in the Tauri dependency tree and bundle setup.
Official Tauri 2 documentation exposes Webview creation and webview position/size
control through the webview API surface.

The single-source rule still applies:

- The selected task browser preview target remains the only URL authority.
- The overlay must not accept raw URL bodies, query overrides, local signals, or iframe fallbacks.
- Native host commands should be routed through `HostTransport` / Tauri transport,
  not direct business-code access to `window.__TAURI__`.
- Playwright remains the mature evidence and diagnostics runtime for screenshots,
  console, page error, request failure, and visual acceptance artifacts.
- The live surface becomes a real browser view that fills the panel region and
  internally handles scroll/compositing/history.

Back, forward, and refresh should be browser navigation commands on the native
webview. If Tauri JavaScript APIs do not expose all required navigation methods,
the implementation should add a single Rust-side native command surface for this
preview webview instead of extending the PNG input protocol as the primary fix.

## Callpoint Inventory

| File | Current Role | Implementation Impact |
| --- | --- | --- |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx` | Renders live PNG, input batching, viewport-ratio frame, target/evidence controls. | Replace live PNG stage with native webview rect owner and add browser nav controls through existing UI primitives. |
| `packages/overlay/src/services/browser-preview.ts` | Browser preview backend route client. | Keep target/evidence APIs; avoid making raw URL or local-source APIs. |
| `packages/overlay/src/services/host-transport.ts` | Host command abstraction. | Add native preview host commands here if implementation uses Tauri commands. |
| `packages/overlay/src/services/tauri-transport.ts` | Tauri invoke boundary. | Own Tauri webview command invocation; do not let components call `window.__TAURI__` directly. |
| `packages/overlay/src-tauri/capabilities/default.json` | Native permission scope. | Grant only the webview commands required by the single preview surface. |
| `packages/overlay/src-tauri/src/main.rs` | Tauri host and command setup. | If JavaScript API navigation is insufficient, own the native webview lifecycle and navigation commands here. |
| `packages/opencorvus/src/browser-preview/live.ts` | Playwright screenshot live session. | Keep for evidence or remove only after a full native replacement and tests prove no live PNG owner remains. |
| `packages/opencorvus/src/server/routes/browser-preview.ts` | Task-scoped target/evidence/live routes. | Keep target/evidence routes; do not add raw URL preview routes. |
| `packages/overlay/src/styles/surfaces/inspector.css` | PNG frame layout and aspect ratio. | Replace viewport-PNG frame sizing with a real native webview mount rectangle. |
| `packages/overlay/test/browser-preview-panel.test.ts` | Static architecture guard. | Update to assert native surface ownership, no iframe/local source, and no PNG live-browser fallback. |
| `packages/overlay/test/browser/browser-preview-live-input-batch.test.ts` | Current Node browser test for PNG input batching and visual screenshot. | Replace or narrow after native webview implementation; Node browser tests cannot fully prove Tauri child webview behavior. |
| `packages/opencorvus/test/server/browser-preview-routes.test.ts` | Backend live PNG route coverage. | Keep evidence route coverage; update only if live PNG route is intentionally retired. |

## Implementation Acceptance Criteria

- Native live preview renders the selected task-scoped target in a browser surface, not an iframe and not a PNG image loop.
- The panel can allocate all available preview height to the webview region; long pages scroll in the browser surface instead of requiring backend wheel screenshots.
- Back, forward, and refresh controls operate on the live browser surface and do not reload target/evidence metadata.
- Playwright evidence capture remains available and task-scoped.
- No raw URL body, query override, local signal, hidden iframe, or fallback preview path is introduced.
- Browser preview tests cover the removed screenshot-loop ownership and the new native command boundary.
- A real visual verification pass captures the overlay preview region and confirms the webview is visible, sized to the panel, and not overlapped by controls.

## Required Verification For Code Changes

- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-service.test.ts --timeout 60000`
- `node packages/overlay/test/browser-runner.mjs <focused browser preview test>`
- Relevant Tauri-side unit or integration test for the new native command surface.
- Visual screenshot review of the browser preview panel after launching an isolated test instance, without restarting or disturbing any existing user overlay process.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`

## Implementation Summary

- Replaced the overlay live PNG preview owner with a task-scoped native Webview
  command surface routed through `HostTransport` and Tauri invoke commands.
- Added protocol commands for `browserPreview.sync`,
  `browserPreview.navigate`, and `browserPreview.close`, with typed bounds and
  navigation action validation.
- Added Tauri-side child Webview ownership for the selected task preview target,
  including finite positive bounds validation, position/size synchronization,
  same-surface navigation, history back, history forward, reload, and close.
- Removed the backend `/browser-preview/live/snapshot` and
  `/browser-preview/live/input` PNG loop routes, live session cleanup hooks, and
  overlay live point conversion helper.
- Kept target and evidence routes as the single task-scoped backend authority for
  preview metadata, screenshots, diagnostics, and visual acceptance evidence.
- Updated the preview panel to fill available panel height with the native
  surface region and added back, forward, and refresh controls using existing
  primitives and i18n labels.

## Verification Results

- `bun test packages/transport-protocol/test/contract.test.ts packages/overlay/test/host-transport-capabilities.test.ts packages/overlay/test/browser-preview-native.test.ts packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-service.test.ts packages/vscode-extension/test/bridge-native.test.ts packages/opencorvus/test/browser-preview/live-lifecycle.test.ts packages/opencorvus/test/browser-preview/navigation-inactivity.test.ts packages/opencorvus/test/browser/runtime.test.ts packages/opencorvus/test/server/app-routes.test.ts packages/opencorvus/test/server/browser-preview-routes.test.ts --timeout 120000`
  passed with 103 tests.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts packages/overlay/test/browser/browser-preview-evidence.test.ts packages/overlay/test/browser/browser-preview-visual-stress.test.ts packages/overlay/test/browser/overlay-global-live-pressure-browser.test.ts`
  passed with 5 browser tests. The runner used Node, not Bun.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `bun run --cwd packages/overlay check:i18n` passed.
- `cargo fmt --manifest-path packages/overlay/src-tauri/Cargo.toml` passed.
- `cargo check --manifest-path packages/overlay/src-tauri/Cargo.toml` passed.
- `cargo test --manifest-path packages/overlay/src-tauri/Cargo.toml browser_preview -- --nocapture`
  passed with 2 Rust tests.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts --timeout 60000`
  passed with 19 tests after this final record update.

## Visual Review

- Reviewed `packages/overlay/.scratch/browser-preview-native-surface.png`: the
  preview panel shows native-surface controls, no iframe or PNG live frame, and a
  tall available-height region without control overlap.
- Reviewed `packages/overlay/.scratch/browser-preview-visual-stress/06-alternate-native.png`:
  the visual-stress path shows the native preview region after task switching
  without the previous transient error toast.
- Reviewed `.scratch/overlay-global-live-pressure.png`: the pressure test
  artifact confirms the overlay remains usable while the browser test asserts
  native sync/navigation commands and zero retired live-route requests.
- Chromium browser screenshots cannot render the Tauri child Webview pixels
  themselves. The screenshots therefore verify overlay chrome, layout, height,
  and control non-overlap; Rust command tests and browser command assertions
  verify native child Webview creation and navigation.

## Continuation Notes

- The updated active goal explicitly says not to commit or push to `myhexin`;
  this implementation is intentionally left unstaged and uncommitted.
- Existing running OpenCorvus or overlay processes were not restarted, killed,
  refreshed, or reused for validation.

## Visual Design Repair Addendum

### Recall

The user reported after the native Webview repair that the preview UI has no
design quality and does not look carefully considered. This is a continuation of
the same browser preview delivery surface, not a new backend ownership change.

### Evidence Read Before Editing

- This record's original Recall and implementation summary.
- `packages/overlay/src/components/BrowserPreviewPanel.tsx`
- `packages/overlay/src/styles/surfaces/inspector.css`
- `packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`
- `packages/overlay/.scratch/browser-preview-native-surface.png`
- `rg -n "browser-preview-(stage|live|native|viewport|toolbar|control|nav)|BrowserPreviewPanel|browserPreview\\.nav" packages/overlay/src/components packages/overlay/src/styles/surfaces packages/overlay/src/i18n packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser/browser-preview-visual-stress.test.ts`

### Visual Problem

The previous implementation solved the native-surface architecture but left the
UI as a stack of unrelated controls: status chip, address select, viewport tabs,
history buttons, capture action, and evidence status all competed in a loose
wrap layout. The live region looked like an empty bordered rectangle rather than
a managed browser preview surface.

### Visual Acceptance

- The preview controls should read as one compact browser chrome: history
  navigation, refresh, address target, viewport mode, capture, and status must
  be visually grouped by function.
- The address target should be the dominant control, not another small item in a
  button pile.
- The native surface should attach to that chrome as a framed viewport with
  stable height and no control overlap.
- The repair must keep existing primitives (`Button`, `SegmentedControl`,
  `SelectControl`) and must not introduce iframe, local override, fallback
  preview paths, decorative marketing chrome, or nested card layouts.

### Visual Repair Result

- Moved preview status into the panel header actions so it reads as panel state
  instead of a loose toolbar row.
- Rebuilt the preview controls as a compact browser chrome: native history
  controls and address target share the primary row; viewport and capture share
  the secondary tool row.
- Added an outer native viewport frame while keeping the Webview binding on the
  inner native surface, so the host child Webview cannot cover the overlay frame
  chrome.
- Removed the design-grid stage background that made the preview look like a
  placeholder instead of a browser surface.

### Visual Repair Verification

- `bun test packages/overlay/test/browser-preview-panel.test.ts --timeout 60000`
  passed with 2 tests.
- `bun run --cwd packages/overlay typecheck` passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`
  passed and regenerated
  `packages/overlay/.scratch/browser-preview-native-surface.png`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-visual-stress.test.ts`
  passed and regenerated
  `packages/overlay/.scratch/browser-preview-visual-stress/06-alternate-native.png`.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-evidence.test.ts packages/overlay/test/browser/overlay-global-live-pressure-browser.test.ts`
  passed with 3 tests; the pressure test still observed zero retired live-route
  requests and native navigation actions for back, forward, and reload.
- Manual screenshot review confirmed the header status, browser navigation,
  address target, viewport tabs, capture action, and native surface frame no
  longer appear as a loose stack of unrelated buttons.
