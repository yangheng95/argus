# Browser Preview Scrollable Evidence Fix - 2026-06-11

## Problem

The browser preview panel now resolves the development port and displays task-scoped evidence, but it cannot scroll through pages taller than the viewport.

## Evidence

- `packages/opencorvus/src/browser-preview/evidence-runner.ts` captures with `page.screenshot({ clip: { x: 0, y: 0, width, height } })`, so the artifact only contains the visible viewport.
- The same sidecar result reports `size` as the requested viewport, not the PNG dimensions.
- `packages/overlay/src/styles/surfaces/inspector.css` puts the preview stage in a centered grid. That is suitable for an empty state, but not for a scrollable evidence surface.

## Call Points

| Surface                                        | Current role                                    | Change                                                                         |
| ---------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `runBrowserPreviewEvidenceJob`                 | Builds sidecar viewport inputs                  | Keep the task-scoped evidence source.                                          |
| `BROWSER_PREVIEW_BATCH_SCRIPT.captureViewport` | Produces screenshot artifacts                   | Use Playwright full-page screenshots and report document dimensions.           |
| `finalizeBrowserPreviewSidecarCapture`         | Persists screenshot and computes pixel evidence | Use decoded PNG dimensions as the final evidence size.                         |
| `BrowserPreviewPanel`                          | Displays evidence screenshot                    | Keep task-scoped image rendering; no iframe or local override.                 |
| `inspector.css`                                | Defines preview stage layout                    | Make the stage a real scroll container while preserving empty-state centering. |
| `browser-preview-evidence.test.ts`             | Browser acceptance for evidence image           | Assert a tall evidence image creates scrollable preview UI.                    |
| `evidence-runner.test.ts`                      | Backend evidence contract                       | Assert final evidence size follows PNG dimensions, not viewport metadata.      |

## Implementation

1. Replace viewport-clipped screenshots with full-page Playwright screenshots in the browser preview sidecar.
2. Derive finalized evidence `size` from decoded PNG width and height.
3. Change the preview stage CSS to a scrollable flex column and keep empty states centered with targeted margin.
4. Add focused backend and browser tests for full-page dimensions and scroll behavior.
