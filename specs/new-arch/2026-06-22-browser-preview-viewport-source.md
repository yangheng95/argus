# Browser Preview Viewport Source

Date: 2026-06-22
Status: Planned

## Acronyms

- API: Application Programming Interface, the server contract used by overlay and tools.
- GUI: Graphical User Interface, the visible overlay browser preview panel.
- SDK: Software Development Kit, the generated client package.
- URL: Uniform Resource Locator, the persisted preview target address.

## Task Definition

Remove hard-coded browser preview desktop/tablet/mobile dimensions from frontend
preview capture and live preview. Viewport dimensions must come from task-scoped
preview target metadata or task-scoped webpage/source evidence. Missing viewport
metadata is a visible contract failure, not a fallback to guessed sizes.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate source, no blind patching, test every change, and frontend/preview work must use task-scoped backend evidence. |
| `2026-06-14-frontend-design-mobile-reference-image.md` | Mobile visual truth is `reference-mobile.png`, produced by the webpage evidence pipeline for mobile responsive checks. |
| `2026-06-15-browser-preview-viewport-evidence-binding.md` | Browser preview evidence is keyed by viewport ID; the target response exposes per-viewport latest evidence IDs. |
| `2026-06-17-browser-preview-region-runner-single-source.md` | Region comparison must use the shared browser evidence runner as the single Playwright capture owner. |
| `AGENTS.md` right preview rule | The right preview panel must use task-scoped backend preview target/evidence as its single source. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Viewport definition | `packages/opencorvus/src/browser-preview/viewport.ts` hard-codes `desktop 1280x800`, `tablet 834x1112`, `mobile 390x844` and falls back to desktop on lookup miss. | Remove global dimensions and fallback lookup. Keep viewport IDs as semantic labels only. |
| Target response | `target.ts` returns `viewports: [...BROWSER_PREVIEW_VIEWPORTS]` for ready, missing, and failed targets. | Resolve viewports from persisted target metadata or task source manifest; missing target has no viewports; ready target without viewport source is failed with diagnostics. |
| Target persistence | `persist.ts` stores only `url` and `source`. | Store normalized target viewports with the target artifact. |
| Preview tool | `tool/browser-preview.ts` persists discovered URLs without viewport metadata. | Add explicit viewport input and resolve task source viewports before persisting when available; if neither exists, fail visibly. |
| Capture verification | `verification-core.ts` remaps requested IDs through the global preset. | Select viewport objects from the resolved target's `viewports`. Unknown IDs fail explicitly. |
| Evidence runner | `evidence-runner.ts` remaps IDs through the global preset. | Accept the already-resolved viewport objects from verification and region comparison. |
| Live preview | `live.ts` maps `viewportID` through the global preset. | Resolve the viewport from the persisted target/task source before creating or reusing the live sidecar. |
| Region comparison | `region-comparison.ts` seeds implementation viewports from global presets and special-cases desktop width from source image width. | Use target/source viewport metadata and source reference dimensions as validation, not as a fallback preset table. |
| Local module binding | `local-module-source-binding.ts` captures local module with the global preset. | Resolve the viewport from target/source metadata for the requested viewport. |
| Overlay service/types | `packages/overlay/src/services/browser-preview.ts` hard-types IDs and receives backend dimensions. | Keep dimensions as backend-supplied data; do not introduce frontend constants. |
| Overlay panel | `BrowserPreviewPanel.tsx` starts selected viewport at `"desktop"` and adjusts after target load. | Keep initial semantic ID, but trust target viewports for available choices. |
| Tests | Browser preview tests assert the three hard-coded IDs and dimensions. | Replace them with tests proving target/source dimensions are used and missing metadata fails. |

## Root Cause

The original browser preview viewport table was a Playwright runner preset, but
later changes promoted it into the API, SDK, overlay controls, live preview, and
region-comparison contract. That created a second source beside webpage evidence
and source package manifests. It also preserved a silent desktop fallback in
`browserPreviewViewportByID()`, so a bad viewport request could produce evidence
under the wrong dimensions instead of failing at the boundary.

## Fix Plan

1. Replace `BROWSER_PREVIEW_VIEWPORTS` with strict viewport normalization and
   lookup helpers that require a caller-supplied viewport list.
2. Extend browser preview target payloads to store normalized viewports.
3. Teach target resolution to use persisted target viewports. When target
   artifacts have no viewports, resolve viewports from the task source manifest;
   if no source exists, fail with an explicit diagnostic.
4. Update `browser_preview` tool persistence to pass explicit or source-derived
   viewports into `persistBrowserPreviewTarget()`.
5. Pass resolved viewport objects through verification and evidence runner
   instead of remapping IDs through globals.
6. Update live preview, region comparison, and local module binding to resolve
   viewport dimensions from task/target metadata.
7. Add regressions for no fallback, source-manifest dimensions, persisted target
   dimensions, and no hard-coded viewport table.

## Acceptance

- No product code contains the old `desktop 1280x800`, `tablet 834x1112`, or
  `mobile 390x844` viewport table.
- `browserPreviewViewportByID()` no longer falls back to desktop.
- Browser preview target artifacts include their viewport list, or target
  resolution obtains the list from task-scoped source evidence.
- Capture, live preview, region comparison, and local module binding use the
  same resolved viewport dimensions.
- A target without viewport metadata/source evidence fails visibly instead of
  inventing dimensions.
- Focused browser-preview tests and typecheck pass; diff review confirms no
  unrelated SDK or overlay changes were overwritten.

## Verification Plan

- `bun test packages/opencorvus/test/browser-preview/target.test.ts packages/opencorvus/test/browser-preview/verification.test.ts packages/opencorvus/test/browser-preview/region-comparison.test.ts`
- `bun test packages/opencorvus/test/server/browser-preview-routes.test.ts packages/opencorvus/test/tool/browser-preview.test.ts`
- `bun test packages/overlay/test/browser-preview-service.test.ts packages/overlay/test/browser-preview-panel.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `bun run --cwd packages/overlay typecheck`
- `git diff --check`
