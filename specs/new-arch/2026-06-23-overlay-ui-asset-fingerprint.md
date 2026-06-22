# Overlay UI Asset Fingerprint

Date: 2026-06-23
Status: Verified

## Acronyms

- CSS: Cascading Style Sheets, the browser styling bundle.
- GUI: Graphical User Interface, the visible overlay surface.
- HTML: HyperText Markup Language, the browser document served for `/ui`.
- JS: JavaScript, the executable browser bundle.
- UI: User Interface, the overlay web application served under `/ui`.

## Task Definition

Make stale overlay UI assets directly observable during GUI performance
testing. Live `/ui` verification must be able to prove which UI source and
which JS/CSS asset filenames the running server is actually serving, without
reloading or restarting the overlay process.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no double UI source, no blind patching, test every change, visually verify UI-related work, and commit/push every round. |
| `2026-06-22-overlay-ui-serving-source.md` | `/ui` must choose one source: explicit override, physical bundle, embedded bundle, or missing. Physical bundle wins over embedded when resolved. |
| `2026-06-22-packaged-overlay-ui-asset-parity.md` | Packaged overlay-server health must prove the embedded `/ui` asset names match current `dist-vite` at compile time. |
| `2026-06-22-center-workbench-panel-min-size-contract.md` | Current bundle should set open center panels to `--ui-workbench-panel-min-width`; stale bundles still allow `min-width: 0`. |
| Live `7878` evidence | Running `/ui/index.html` serves `index-CO3SwO-J.js` and `index-DlM3OgGm.css`; current disk `dist-vite` serves `index--QFkHFpX.js` and `index-Lq6mNSVH.css`. Live CSS still has `.center-workbench-body{overflow:hidden}` and no open-panel minimum width. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| UI source selection | `packages/opencorvus/src/server/overlay-ui.ts` owns `selectOverlayUiServingSource`. | Keep source selection unchanged; do not add a new lookup path. |
| Directory HTML serving | `OverlayUI.routes()` reads physical `index.html`, rewrites assets, and sends `Cache-Control: no-cache`. | Add source and asset fingerprint headers derived from the exact HTML being served. |
| Embedded HTML serving | `serveEmbedded()` reads the embedded `/index.html` Bun file. | Add the same fingerprint headers with `embedded` source. |
| Static asset misses | Directory and embedded serving previously fell back to `/index.html` for missing `/assets/*` and `/i18n/*`. | Return 404 for missing static asset requests so stale or absent bundles cannot be masked by SPA HTML. |
| Handler tests | `overlay-ui-handler.test.ts` already tests source selection and directory route behavior. | Add assertions for directory source and asset header. |
| Packaged health test | `packaged-overlay-server-health.test.ts` already compares packaged asset refs to current dist refs. | Add assertions that the compiled server exposes the same asset refs in response headers. |
| Generated embedded module | `overlay-ui-embedded.generated.ts` should remain empty in source after build tooling exits. | Add a source-form guard in `build-artifact.test.ts`. |
| Live browser QA | In-app browser can read headers through HTTP fetch without reloading the page. | Use this header in future live performance checks to fail fast on stale UI. |

## Root Cause

The previous asset-parity work proves a newly built packaged server embeds the
current `dist-vite` bundle, but a long-running desktop process can still serve
older embedded files. Without an explicit runtime fingerprint, GUI performance
testing can silently measure the wrong bundle. The symptom then appears as
toolbar and resize jank even after the source has been fixed.

The same stale-asset failure mode was masked by SPA fallback: a missing
`/ui/assets/*` request could return `200 text/html` with `index.html`, so
packaged and live checks could fail to distinguish a real static asset from the
application shell.

## Fix Plan

1. Parse JS/CSS asset references from the HTML string being served.
2. Add `X-Opencorvus-Overlay-Ui-Source` to HTML responses.
3. Add `X-Opencorvus-Overlay-Ui-Assets` to HTML responses as a comma-separated,
   sorted list of `assets/*.js` and `assets/*.css`.
4. Return 404 for missing `/assets/*` and `/i18n/*` requests before SPA fallback.
5. Extend route handler tests, build-artifact source guards, and packaged
   health tests.
6. Re-run focused tests, typecheck, live header verification on 7878, and visual
   review of the live stale UI screenshot.

## Acceptance

- `/ui/index.html` exposes the actual serving source as `directory` or
  `embedded`.
- `/ui/index.html` exposes the actual JS/CSS asset filenames from the served
  HTML.
- The headers are derived from the served HTML, not from a second manifest.
- Source selection order remains unchanged.
- Packaged health rejects a mismatch between current dist refs and served
  header refs.
- Missing static asset requests return 404 instead of SPA fallback HTML.
- `overlay-ui-embedded.generated.ts` remains empty in repository source after
  packaging tests run.
- Live 7878 can be diagnosed as stale without refreshing or restarting the
  overlay process.

## Verification

- PASS: `bun test packages/opencorvus/test/server/overlay-ui-handler.test.ts packages/opencorvus/test/server/overlay-ui-traversal.test.ts --timeout 30000`.
- PASS: `bun test packages/opencorvus/test/script/build-artifact.test.ts packages/opencorvus/test/script/packaged-overlay-server-health.test.ts --timeout 240000`.
- PASS: `bun run --cwd packages/opencorvus typecheck`.
- Live 7878 read-only verification:
  - `/ui/index.html` status `200`.
  - `X-Opencorvus-Overlay-Ui-Source` absent.
  - `X-Opencorvus-Overlay-Ui-Assets` absent.
  - asset refs: `assets/index-CO3SwO-J.js,assets/index-DlM3OgGm.css`.
  - missing asset probe returned `200 text/html`, proving the running process is
    still old and has not loaded this fix.
- Visual QA uses the current overlay browser screenshots from the paired legal
  size check; no live reload or restart was performed.

## Self Review

- The fingerprint headers are derived from the served HTML string, not a second
  manifest or parallel source.
- Static asset 404 handling only applies to `/assets/*` and `/i18n/*`; SPA deep
  links still serve rewritten `index.html`.
- The packaged health test exercises the compiled overlay-server artifact, not
  only in-process Hono route tests.
