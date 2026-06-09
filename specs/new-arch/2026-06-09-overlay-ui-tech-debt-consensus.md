# Overlay UI Tech Debt Consensus

Date: 2026-06-09
Status: Consensus plan

## Acronyms

- API: Application Programming Interface, the server route and client contract used by overlay services.
- CSP: Content Security Policy, the browser or webview security policy that controls embedded frames, scripts, and network resources.
- DOM: Document Object Model, the browser tree manipulated by the overlay UI.
- E2E: End to End, a test that exercises a visible user workflow through the real UI and backend boundary.
- HTML: HyperText Markup Language, the document format used by the overlay shell and embedded previews.
- ID: Identifier, a stable route, artifact, task, or element key.
- MCP: Model Context Protocol, the browser automation integration used for non-task interactive tooling.
- P0: Priority 0, a blocker for a shipped surface or required workflow.
- P1: Priority 1, a high-impact architectural debt that should be handled before adjacent feature work.
- P2: Priority 2, a confirmed debt that can be scheduled after P0 and P1 convergence.
- SDK: Software Development Kit, generated client types and request helpers.
- SSE: Server-Sent Events, the streaming event protocol used by overlay task and server updates.
- UI: User Interface, the visible overlay controls and panels.
- URL: Uniform Resource Locator, the address of a backend route or browser preview target.
- VS Code: Visual Studio Code, the editor host for the extension webview overlay surface.

## Consensus

Two independent codebase investigations agree that the overlay UI stack is partially modernized but not converged. The strongest pattern is not missing libraries; the repository already has `@kobalte/core`, `lucide-solid`, `virtua`, Vite, and a Node-backed browser sidecar. The remaining debt is that several old handwritten surfaces still coexist with newer primitives and backend-owned evidence contracts.

The consensus direction is replacement, not compatibility:

1. Browser preview must have one host-aware product contract. The iframe may remain a live display surface only when the host policy allows it; evidence comes only from task-scoped backend preview target and `BrowserEvidenceRunner`.
2. Browser automation used by tests and evidence must run through Node-owned Playwright launchers on Windows. Bun can run ordinary unit tests, but it must not own Playwright browser lifecycle.
3. Overlay controls must converge on mature primitives. Kobalte-backed primitives are the local default where their declarations pass `tsc --noEmit`; when a Kobalte package is blocked by declaration defects, fix by upgrading or patching the dependency, not by growing new handwritten ARIA behavior.
4. Host capabilities must be explicit data from the active `HostTransport`, not scattered `nativeUnsupported` surprises behind visible controls.
5. API directory scoping must be generated or shared from one route policy source. Overlay-side and server-side path lists must not remain manually synchronized.
6. Tests must stop preserving debt shapes such as `<dialog>.showModal()`, raw `<select>` preview controls, or static `readText().toContain(...)` as the only evidence for complex UI behavior.

## Evidence Inventory

| Area | Current call points | Target action |
| --- | --- | --- |
| VS Code preview CSP | `packages/overlay/src/components/BrowserPreviewPanel.tsx` renders an iframe; `packages/overlay/src/main.tsx` mounts `BrowserPreviewPanel`; `packages/vscode-extension/src/webview/html.ts` sets `frame-src 'none'`. | Decide the VS Code product behavior explicitly: either no embedded preview in VS Code with visible backend evidence controls, or a CSP contract that allows only the approved preview host model. Do not leave the same UI silently broken under one host. |
| Preview mount and shell | `packages/overlay/src/index.html` owns `solidBrowserPreviewMount`; `packages/overlay/test/acceptance-panel-mount.test.ts` and `browser-preview-panel.test.ts` assert the mount exists. | Keep a first-class preview surface only if it is host-aware and task-scoped. Tests must validate visible states, not only mount strings. |
| Browser preview evidence | `packages/opencorvus/src/browser-preview/evidence-runner.ts` exists; `packages/opencorvus/src/browser-preview/verification.ts` still accepts injected capture and no-task `captureRuntimePage`; `latestBrowserPreviewEvidenceID` still accepts missing `targetID`. | Make `BrowserEvidenceRunner` the only product task evidence owner. Keep direct capture only for private tests or explicitly non-task utilities. Require target ID for task evidence. |
| Non-preview browser evidence | `browser/webpage/render.ts`, `browser/webpage/extract.ts`, `browser/webpage/runtime-state.ts`, `runtime/visual-page.ts`, `acceptance/checks/walkthrough/run.ts`, frontend-design tools, and MCP browser sessions still call sidecars or expose old evidence paths. | Migrate or quarantine these as non-product-private until they call the runner. SingleFile cannot be a fallback authority beside runner evidence. |
| Overlay Playwright tests | `packages/overlay/package.json` runs `bun test`; many tests call `packages/overlay/test/launch.ts` which launches Playwright in a Node sidecar from inside the Bun test process. | Split ordinary Bun unit tests from browser UI tests. Browser UI tests must be launched by a Node command that owns Playwright lifecycle and delegates assertions to a test harness. |
| Dialog primitive | `packages/overlay/src/components/primitives/Dialog.tsx` drives native `<dialog>`, `showModal()`, drag offsets, and pointer listeners; `dialog-primitive.test.ts` asserts that shape. | Replace primitive internals with a mature dialog primitive once dependency typing is fixed. Preserve public store and CSS contracts only. Tests should assert no owner outside the primitive calls `showModal()` or manages dialog focus. |
| Menubar | `TitlebarMenubar.tsx` owns `role=menubar/menu/menuitem`, outside click, Alt key handling, and focus movement; `2026-06-01-overlay-mature-ui-primitives-refactor.md` records Kobalte Menubar declaration defects. | Patch or upgrade Kobalte, then migrate root/menu/item semantics to Menubar. Retain only product-specific Alt access-key mapping outside the primitive. |
| Tabs and segmented controls | `components/ui/Tabs.tsx` is Kobalte-backed, but `PromptCatalog.tsx`, `ExecutorSelector.tsx`, `WorkspacePanel.tsx`, and `settings/primitives.tsx` still hand-roll tab or segmented semantics. | Replace handwritten tablists with the shared Tabs primitive or a new Kobalte-backed segmented primitive. |
| HostTransport native coverage | `host-transport.ts` defines server, workspace, notification, window, devtools, and settings commands; `vscode-transport.ts` only handles settings and otherwise calls `nativeUnsupported`. | Surface host capability data and hide or re-route unsupported controls before click. Implement missing VS Code commands where the VS Code extension owns an equivalent API. |
| SSE transport | Business services use `HostTransport.openStream`; Tauri transport still splits POST/auth streams through fetch and unauthenticated GET through native `EventSource`. | Keep one public stream abstraction, but add host/runtime tests for both concrete branches. Do not add business-level retry gates that know transport internals. |
| Directory injection | `overlay/src/services/api.ts` has `NO_DIRECTORY_PATHS` and `NO_DIRECTORY_PREFIXES`; `opencorvus/src/server/server.ts` has separate project directory bypass lists. | Generate overlay route injection decisions from the server/OpenAPI route metadata or export one shared policy artifact. Tests should assert generation, not manual list parity. |
| App shell | `App.tsx` returns null; `index.html` plus `main.tsx` manage many roots, mount nodes, dataset mutations, and resizers. | Gradually converge root ownership into a real Solid app shell while preserving current surface IDs through a single shell component. Avoid broad rewrites until primitive and preview P0s are closed. |
| CSS | `index.html` links many global surface CSS files; tests assert selector ownership. | Keep tokens and surface files during P0/P1 fixes, then move high-churn component styles behind component-owned classes. Do not mix this with behavior migrations unless a selector blocks the migration. |

## Decisions

### 1. Browser Preview Host Contract

The overlay preview panel has two distinct responsibilities:

- live display: an iframe that can be visible only in hosts whose CSP and embedding policy allow it
- evidence: backend-owned task target resolution and Node/Playwright capture through `BrowserEvidenceRunner`

These responsibilities must not be merged. The iframe load state, local reload, local storage, query parameters, and host-local frame errors cannot become task evidence. If VS Code cannot embed the target because `frame-src 'none'` remains the product policy, the VS Code panel must show a truthful "display unavailable in this host" state and still expose backend evidence status and open-external actions backed by HostTransport or extension commands.

### 2. Node-Owned Browser Testing

Overlay browser tests need a separate Node entrypoint. The existing `launch.ts` already moves Playwright into a Node child, but the test process is still Bun. The new split is:

- `bun test` for static, store, service, parser, and non-browser component tests
- `node <overlay browser test runner>` for tests that call Playwright, open Chromium, or inspect visible UI

The browser test runner should reuse the existing overlay browser sidecar code and become the single place that resolves Playwright. It must not use `bunx playwright`, `npx playwright test`, or shell command detection.

### 3. Mature Primitive Migration

The primitive migration order is:

1. Patch or upgrade `@kobalte/core` so Dialog and Menubar declarations pass `tsc --noEmit`.
2. Replace Dialog internals behind the existing `Dialog` component boundary.
3. Replace Titlebar Menubar semantics with Kobalte Menubar.
4. Replace remaining handwritten tablists and segmented controls with shared primitives.
5. Collapse duplicate resize/drag utilities only after visible behavior has browser tests.

This avoids a wide visual rewrite while still removing the root cause: handmade accessibility and focus logic spread across feature components.

### 4. HostTransport Capabilities

The UI should not learn host support by throwing `nativeUnsupported` after a user clicks a visible control. The active HostTransport should expose a typed capabilities object for native commands. Components render or route commands from that object. VS Code support must be implemented in `packages/vscode-extension` where an equivalent VS Code API exists, such as directory pick, editor open, and notification.

This is a data contract, not a flow gate. It does not teach the app which path to take at runtime through ad hoc checks; it makes the host capability surface explicit.

### 5. Route Directory Policy

Directory injection policy belongs to the server route contract. The overlay should consume generated route metadata or a shared policy artifact and then derive whether a request receives a directory query. The server remains authoritative.

The migration target is one source for:

- bypass paths such as health, auth, ui, global, and log routes
- project-scoped task routes
- generated SDK/OpenAPI metadata for new route families
- overlay tests that enumerate real routes from the same artifact

### 6. Browser Evidence Convergence

`BrowserEvidenceRunner` becomes the single public product task evidence owner. The first follow-up implementation should not attempt to migrate every browser path at once. It should close the preview product path first:

- preview capture accepts task ID and required target ID
- capture can request the viewport set in one job
- persisted evidence stores manifest path, target ID, viewport IDs, diagnostics, and failure state
- overlay shows manifest-backed evidence and does not infer evidence from the iframe

After preview is converged, migrate `webpage_render`, `webpage_runtime_state`, acceptance walkthrough, and frontend-design evidence operations. SingleFile remains out of task evidence unless reintroduced as a runner operation.

## Phased Plan

### Phase 0: Lock the Consensus

- Add this spec.
- Do not change product code in this phase.
- Use this spec as the checklist for later PRs.

### Phase 1: Preview and Browser Runtime P0

- Make VS Code preview behavior explicit under the current CSP.
- Add visible UI tests for VS Code host behavior or a host-rendered fixture that enforces `frame-src 'none'`.
- Split overlay browser tests so Playwright runs under Node.
- Add an architecture test that fails if browser UI tests are only reachable through `bun test`.

### Phase 2: BrowserEvidenceRunner Product Path

- Make preview capture batch over all required viewports.
- Remove task-product no-target capture paths.
- Ensure preview routes, SDK/OpenAPI, overlay service, and tests require target ID and consume runner manifest output.
- Add a product-path import test that migrated task preview evidence does not import `captureRuntimePage` directly.

### Phase 3: Mature Primitive Replacement

- Patch or upgrade Kobalte declaration issues recorded in `2026-06-01-overlay-mature-ui-primitives-refactor.md`.
- Migrate Dialog and Menubar behind existing component boundaries.
- Replace remaining handwritten tabs and segmented controls.
- Convert tests from preserving implementation strings to preventing handwritten ARIA/focus regressions outside primitives.

### Phase 4: Host and Route Contract Convergence

- Add HostTransport capability data and VS Code-native command implementations for supported workspace/server/notification operations.
- Generate or share route directory injection policy from the server route contract.
- Replace overlay manual path lists with generated policy consumption.

### Phase 5: Shell and Style Cleanup

- Move multi-root mount orchestration toward a single Solid app shell.
- Keep existing IDs and CSS classes until behavior tests prove parity.
- Decompose only the highest-churn global CSS areas after primitive migration has removed selector coupling.

## Required Tests

- VS Code CSP preview test: browser preview surface does not silently render a broken iframe under `frame-src 'none'`; it shows the host-specific visible state and backend evidence controls.
- Node browser test runner test: at least one overlay browser test opens Chromium from Node, not Bun.
- Preview evidence E2E test: resolved backend target, visible panel state, capture click, manifest-backed evidence status, and screenshot artifact are observed through the real UI.
- Browser evidence architecture test: migrated product preview evidence does not import `captureRuntimePage`, `renderPage`, or direct webpage sidecars.
- Dialog primitive test: feature components do not call `showModal()` or own dialog focus/escape behavior outside the primitive.
- Menubar primitive test: titlebar no longer hand-rolls menu roles and focus movement after Kobalte migration.
- Tabs primitive test: no feature component outside `components/ui/Tabs.tsx` emits raw `role="tablist"` / `role="tab"` for tab behavior.
- HostTransport capability test: visible native-command controls match host capabilities for Tauri, browser, and VS Code.
- Directory policy generation test: overlay route directory injection decisions are derived from the server policy artifact or generated metadata.
- SSE branch test: Tauri EventSource and fetch-stream branches are both covered through HostTransport, including auth change and reconnect behavior.

## Rejected Designs

| Design | Reason |
| --- | --- |
| Allow all frames in VS Code CSP to make preview work | It weakens the extension security policy without solving task-scoped evidence ownership. |
| Hide preview failures with a local iframe fallback | It creates a second preview source and violates the task-scoped backend target contract. |
| Keep Bun as the owner of Playwright browser tests on Windows | It conflicts with the project Windows constraint and reproduces known browser startup risk. |
| Fix Kobalte typing by enabling `skipLibCheck` | It hides dependency type defects and weakens the repo-wide type contract. |
| Add host-specific if/else checks in every component | Host capability belongs to HostTransport data, not scattered component logic. |
| Preserve manual directory path lists and rely on parity tests | Parity tests detect drift after the fact; one generated/shared route policy prevents drift. |
| Convert the whole overlay shell and CSS in one PR | The current dirty surface is large; primitive and preview P0 fixes should land before broad shell/style cleanup. |

## Open Verification

- VS Code webview preview behavior has not been run in this investigation. The static CSP conflict is confirmed, but the exact visible failure message needs runtime evidence.
- Windows Playwright hangs were not reproduced in this investigation. The policy conflict is confirmed by scripts and constraints; the split runner still needs a minimal Windows smoke.
- Preview polling pressure needs runtime measurement on a task with multiple dead and live candidates.
- SSE branch behavior needs Tauri WebView2 runtime verification because Bun unit tests cannot fully model native EventSource buffering and auth behavior.

