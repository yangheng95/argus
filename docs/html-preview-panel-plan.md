# Live Frontend Preview Panel Plan

## Goal

Add a Preview tab inside the existing right-side panel. It sits next to the current Inspector tab and embeds the currently running frontend page through the browser engine, not through static HTML source rendering.

The Preview tab auto-activates when the selected task has frontend runtime evidence or when the workspace has a running local frontend server that can be resolved to a live HTTP page.

## Current Architecture

- The right-side panel is `#sections` in `packages/overlay/src/index.html`.
- The Inspector content is assembled from existing Solid mount points:
  - `#solidBoardMount`
  - `#solidInteractionMount`
  - `#solidDeliveryMount`
  - `#solidFilesSectionMount`
- Runtime delivery evidence already exists on `candidateDelivery` / `acceptedDelivery` as `evidenceManifest.runtimeFlows`.
- Overlay API calls already go through `packages/overlay/src/services/api.ts`, which injects project directory context for project-scoped routes.
- Server project routes are mounted in `packages/opencorvus/src/server/routes/app.ts` behind `Instance.provide`.

## Design

### 1. Rendering Engine

Use a real browser engine surface:

- Add `FrontendPreviewPanel` in the overlay.
- Render the preview with `<iframe src={resolvedUrl}>`.
- Do not use `srcdoc`, `DOMParser`, static file reads, or resource inlining.
- Keep the iframe isolated from the parent UI with the minimum sandbox needed for normal frontend execution: scripts and forms. Popups/downloads stay off by default.
- Refuse to embed the OpenCorvus overlay/API origin; the open-external action remains available for pages that need full browser privileges.
- Provide a small toolbar with the resolved URL, refresh, and open-external action.

This means relative assets, module scripts, CSS, routing, WebSocket, hot reload, and framework runtime behavior are handled by the frontend server and Chromium/WebView engine instead of an overlay-side parser.

### 2. Preview URL Resolution

Add one resolver abstraction with two ordered, verified inputs:

1. Structured runtime evidence URL from the selected board delivery manifest.
   - Add `previewUrl` as an optional structured field on `DeliveryRuntimeFlowResult`.
   - Never parse URLs out of free-form `evidence` strings.
   - Accept only loopback hosts: `localhost`, `127.0.0.1`, and `[::1]`.
   - This preserves the delivery system as the highest-authority source when it already produced a runnable page.
2. Live port probe from the server route `/preview/frontend`.
   - Probe only loopback ports from the configured preview port list.
   - In automatic mode, accept a port only when the listening process can be tied to `Instance.directory` by process metadata.
   - Exclude OpenCorvus' own server/overlay origin.
   - Return the first owned page that responds successfully with document-like HTML.
   - Do not start a server automatically. If no live frontend service is running, return `url: null`.

The ordered resolver is the single source consumed by the UI; the UI does not separately infer package managers or framework types.

### 3. Automatic Port Detection

Implement `packages/opencorvus/src/preview/frontend.ts`:

- Add one config-backed port source:
  - `preview.ports` in `opencorvus.jsonc` when configured.
  - A centralized default list when no project config is set.
  - A bounded `ports` route query only for tests and explicit manual calls.
- Probe loopback HTTP endpoints with short per-port timeouts.
- Resolve the listening process owner for each candidate port and require ownership by the current project directory in automatic mode.
- Validate response status, content type, and document body.
- Return structured result:
  - `url`
  - `source`
  - `port`
  - `checkedPorts`
  - `reason` when no URL is found

The candidate list should cover common local frontend dev servers without coupling this general tool to a specific framework. Tests can pass an explicit `ports` query parameter so route behavior is deterministic without relying on host machine state.

Blind unowned probe results are never allowed to auto-activate the Preview tab. They are available only to explicit manual route calls/tests and remain loopback-only.

### 4. Right Panel Tabs

Replace the static right-panel title with a tablist:

- `Inspector`: existing right-panel mount points, unchanged.
- `Preview`: the live frontend preview surface.

Both tab bodies stay mounted. Visibility switches through attributes/CSS so Inspector state and Preview iframe state are not repeatedly destroyed during ordinary tab switches.

### 5. Auto Activation

Track right-panel tab state in `main.tsx`:

- Default tab is `inspector`.
- The auto-activation key is `selectedTaskID + snapshotVersion`.
- When that key changes, resolve preview asynchronously.
- Before applying the async result, compare the returned key to the current key to avoid stale task switches.
- If a URL is found, switch to `preview`.
- Manual tab clicks are respected for the current key. The next task/snapshot key may auto-switch again.
- Auto activation only pushes from Inspector to Preview. A transient empty/error result must not force an already-visible Preview tab back to Inspector.
- Manual refresh and background snapshot resolution share the same request-key guard so stale responses cannot overwrite the current task URL.

### 6. Empty, Loading, Error States

Preview tab behavior:

- Loading: show compact progress while resolving URL.
- Empty: show that no running frontend page was detected.
- Error: show resolver failure and keep a Refresh action.
- Loaded: iframe fills the preview body.

The empty state should be explicit that Nova AI detected no running local frontend page; it should not imply a static HTML fallback.

### 7. Styling

Extend `packages/overlay/src/styles.css`:

- Header tablist uses the same compact toolbar language as the rest of the right panel.
- Right-panel tab bodies use `min-height: 0` and `overflow: hidden`.
- Preview iframe fills the available right-panel area.
- URL text is ellipsized and selectable.

### 8. i18n

Add locale keys to both `en-US.json` and `zh-CN.json`:

- Right panel tab labels.
- Preview loading/empty/error copy.
- Preview refresh/open-external/title strings.

Update `_meta.panel_revision` after HTML and locale changes so `check:i18n` passes.

### 9. Tests

Add focused tests:

- Server resolver returns a running HTML server URL when passed an explicit port.
- Server resolver returns `url: null` for non-HTML or unreachable ports.
- Server resolver excludes OpenCorvus' own server port.
- Server resolver does not accept unowned ports in automatic mode.
- Overlay service extracts localhost runtime evidence URL from a delivery manifest.
- Auto-tab helper switches to Preview only for the current request key and respects manual selection for the current key.
- Existing mount tests verify Inspector mount points remain in the Inspector tab and Preview mount exists.
- Static preview regression verifies no `srcdoc`, `DOMParser`, or `/file/content` preview path remains.

Run targeted verification:

- `bun test packages/opencorvus/test/preview-frontend.test.ts`
- `bun test packages/overlay/test/frontend-preview.test.ts`
- `bun test packages/overlay/test/delivery-panel-mount.test.ts`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`

Final push must pass repository hooks without `--no-verify`.

## Implementation Checklist

- [x] Sub-agent review approves the live-rendering plan.
- [x] Replace static `html-preview` service with live `frontend-preview` service.
- [x] Add structured `DeliveryRuntimeFlowResult.previewUrl` field.
- [x] Add server preview resolver and route.
- [x] Add `FrontendPreviewPanel`.
- [x] Wrap existing right-panel mounts in Inspector tab body.
- [x] Mount Preview component and wire tab state in `main.tsx`.
- [x] Add CSS for right-panel tabs and live preview iframe.
- [x] Update i18n keys and panel revision.
- [x] Add tests.
- [x] Run targeted verification.
- [ ] Review final diff, commit, and push.
