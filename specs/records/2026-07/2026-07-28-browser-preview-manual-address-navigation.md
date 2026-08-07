# Browser Preview Manual Address Navigation

## Recall

### User request

- “浏览器组件不支持手动输入url地址，调整下。”
- The Browser component must let the operator type an address and submit it.

### Acceptance criteria

- With a selected task and project directory, the Browser address field is
  editable even when no preview target exists yet.
- Enter submits the typed HTTP(S) address, including scheme-less loopback input
  such as `localhost:5173`, and the Browser opens the resulting page.
- A manual address is persisted as the task's canonical
  `browser_preview_target` EngineArtifact before the native preview renders it.
- Existing target viewports remain authoritative when navigating an existing
  target. A first manual target records the current visible Browser stage as the
  operator-selected desktop viewport instead of inventing a global preset.
- Invalid, empty, cross-shape, or non-HTTP(S) requests fail at the route schema
  boundary. No iframe, query override, local preview target, direct native URL
  owner, compatibility branch, or fallback source remains.
- Focused backend, Overlay, transport, generated contract, Node-launched
  Playwright, screenshot, type, document-health, and second-review checks pass.

### Hard constraints

- The task-scoped backend target/evidence chain remains the only Browser URL
  authority.
- Preserve task-provided viewport metadata. The repository deliberately has no
  global Browser Preview viewport-size preset.
- Reuse the existing TextField primitive and Right Dock Browser chrome.
- Do not restart, refresh, close, or kill the user's running OpenCorvus/Overlay.
  Visual verification uses an isolated fixture and Node-launched Playwright.
- Preserve unrelated dirty-worktree edits. Do not create another worktree.
- New commits use the `dsw-33987` subject prefix and are pushed to `legacy-remote`.

### Sources read before implementation

- `AGENTS.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/records/2026-06/2026-06-11-browser-preview-manual-url-input.md`
- `specs/records/2026-06/2026-06-15-browser-preview-consensus-closure.md`
- `specs/records/2026-06/2026-06-22-browser-preview-viewport-source.md`
- `specs/records/2026-07/2026-07-10-overlay-preview-yerui-revert-e2e.md`
- `specs/records/2026-07/2026-07-20-chat-browser-preview-task-binding.md`
- `packages/opencorvus/src/browser-preview/{target,persist,viewport}.ts`
- `packages/opencorvus/src/server/routes/browser-preview.ts`
- `packages/opencorvus/src/tool/browser-preview.ts`
- `packages/overlay/src/components/BrowserPreviewPanel.tsx`
- `packages/overlay/src/services/{browser-preview,browser-preview-native,host-transport,tauri-transport}.ts`
- `packages/transport-protocol/src/index.ts`
- Browser Preview route, service, component, transport, native-host, and
  Node-browser regressions under `packages/opencorvus/test/**` and
  `packages/overlay/test/**`.

### Whole-repository call-point search

The pre-change inventory searched production, tests, generated Software
Development Kit (SDK), API docs, and landed design records for
`/browser-preview/target`, `selectTaskTarget`,
`BrowserPreviewSelectTaskTargetData`, `persistBrowserPreviewTarget`,
`normalizeBrowserPreviewUrl`, `normalizeBrowserPreviewAddress`,
`browserPreview.navigateUrl`, `overlay_browser_preview_navigate_url`,
`navigateBrowserPreviewNativeUrl`, `browser-preview-address-input`, and
`browser-preview-address-form`.

| Call point | Evidence | Disposition |
| --- | --- | --- |
| `BrowserPreviewPanel` address field | The field exists but is disabled unless native URL navigation is supported and the current native surface is already ready. | Enable it from canonical task/directory scope, submit through the backend target route, show pending/failure state, and refresh from the returned target. |
| `BrowserPreviewPanel::submitAddress` | Normalizes locally and calls the native child WebView directly. | Replace with the task target service. Preserve current target viewports; for the first target, record the measured Browser stage as the explicit desktop viewport. |
| Overlay `browser-preview.ts` | Reads target/evidence only; there is no target write client. | Add one target-setting call to the existing task-scoped `PUT` route. |
| `PUT /task/:taskID/browser-preview/target` | Strictly accepts `{ targetID }` and promotes an existing artifact. | Make this one assignment route accept exactly `{ targetID }` or `{ url, viewports }`; URL input normalizes and persists through the existing artifact owner. |
| `persistBrowserPreviewTarget` | Called only by the explicit Browser Preview tool and test fixture. | Reuse unchanged for operator URL publication; do not add another persistence implementation. |
| `normalizeBrowserPreviewUrl` | Shared by the tool, startup output extraction, command derivation, and target tests. | Reuse at the route boundary; do not duplicate backend URL parsing. |
| Generated OpenAPI/SDK/API docs | Operation is named `selectTaskTarget` and documents a target-ID-only body. | Regenerate after the route contract changes and update strict contract tests. |
| Native `browserPreview.navigateUrl` protocol | Defined by transport protocol, host capability tables, Overlay native service and Tauri transport, Rust command registration, and browser/native tests. | Delete the complete direct-URL channel so persisted target assignment is the only manual navigation owner. Keep history back/forward/reload native commands. |
| Browser tests | Existing address tests require a mounted target and assert the direct native URL command. | Replace with a missing-target manual-entry flow that observes the task-scoped `PUT`, resulting `GET`, native sync, keyboard focus, and rendered screenshot. |

No independent agents are used because the user did not request delegation or a
parallel audit.

## Causal chain

Observable symptom: the Browser toolbar displays an address field, but the
operator cannot type a URL when the component is on its empty new-tab state.

Direct trigger: both the TextField root and input are disabled until
`browserPreviewNativeUrlNavigationAvailable()` and
`nativePreviewNavigationReady()` are true. Those conditions require a ready
persisted target and a mounted native child WebView.

Deep cause: the address bar was modeled as a command for an already-mounted
native renderer instead of a publisher of the Browser component's canonical
task target. That reverses the dependency: manual input is unavailable until a
target already exists. When it is available, it changes only the child WebView,
while backend target/evidence discovery still points to the previous URL.

Why the prior path did not root-fix it: adding a visual TextField and a direct
native navigation command made an existing preview resemble a browser, but it
did not give the empty Browser a target-creation path and it split current page
state from the persisted target used by refresh, evidence, task events, and
reopen.

## Implementation plan

1. Extend the single task target assignment route with an exclusive
   URL-plus-viewports request branch that normalizes and persists through
   `persistBrowserPreviewTarget`.
2. Add the matching Overlay service call and make the address field editable
   whenever task and directory scope exist.
3. Submit existing target viewports or a measured first-target Browser stage,
   reload the canonical target, and expose submission failure beside the field.
4. Delete the direct native URL command across protocol, host capability,
   service, Tauri, Rust, and tests.
5. Regenerate OpenAPI, SDK, and API docs; update the active panel architecture.
6. Add focused route/service/component and real Node-browser regressions, inspect
   the Browser-region screenshot, run type/docs checks, and perform an exact-diff
   plus whole-repository second review.

## Verification plan

- Focused Browser Preview route and SDK contract tests from
  `packages/opencorvus`.
- Focused Overlay service, component, native transport, and capability tests.
- `node test/browser-runner.mjs <manual-address-browser-test>` from
  `packages/overlay`.
- Visual inspection of the Browser-region screenshot emitted by that test.
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `bun run api:routes-check`
- `bun run docs:check`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts --timeout 120000`
- `git diff --check`

## Implementation and verification results

- The empty Browser panel now exposes a focusable URL field and submit button.
  Enter and button submission use the same form action.
- `PUT /task/:taskID/browser-preview/target` now accepts exactly one strict
  body branch: `{ targetID }` or `{ url, viewports }`. The URL branch reuses
  backend normalization and `persistBrowserPreviewTarget`, then resolves the
  persisted task target for the response.
- The Overlay preserves an existing target's viewport contract. With no target,
  it submits the measured Browser stage as the explicit desktop viewport.
- The direct `browserPreview.navigateUrl` native command was deleted across the
  transport protocol, capability tables, Overlay service and Tauri transport,
  Rust command registration, and native/browser tests. Back, forward, and
  reload remain native history operations.
- OpenAPI and the JavaScript SDK now expose the strict target-ID/manual-address
  request union.
- The Node-launched Playwright stress path started on a missing target, focused
  and typed into the URL field, submitted with Enter, observed the task-scoped
  PUT and resolved GET, verified measured viewport persistence, verified the
  native sync, and rejected any native-only URL command. It passed together
  with the native-surface browser regression.
- The Browser-region screenshot
  `packages/overlay/.scratch/browser-preview-visual-stress/01-manual-address-from-empty-browser.png`
  was inspected at original resolution. The address, submit affordance, native
  surface boundary, and surrounding Browser controls were visible without
  overlap or clipping.
- Focused backend route, OpenAPI/SDK contract, Overlay service/component/native
  transport, and host capability suites passed: 67 tests total.
- Both Node browser regressions passed: the full Browser visual stress path
  passed 2 tests, and the native-surface interaction path passed 1 test.
- Repository type checking passed across all 10 packages. Rust `cargo check`
  passed for the Tauri host. API route inventory, generated API documentation,
  Overlay internationalization, and generated SDK checks passed.
- Historical link and document-health verification passed all 85 tests.
