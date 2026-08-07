# Browser Preview Stability And Layout Fix

Date: 2026-06-09
Status: Implementation plan

## Acronyms

- UI: User Interface, the visible preview controls and embedded viewport surface.
- DOM: Document Object Model, the browser tree that Solid renders and CSS lays out.
- URL: Uniform Resource Locator, the backend-owned preview address rendered in the iframe.

## Problem

The browser preview flashes every few seconds and renders all viewport frames in a tall scattered stack. The close buttons live in the left viewport rail instead of near the viewport frame they close, so their spatial target is disconnected from the thing being closed.

## Codebase Evidence

| Area              | Evidence                                                                                                                                                                          | Decision                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Overlay component | `packages/overlay/src/components/BrowserPreviewPanel.tsx` owns `setInterval`, `visibleViewportIDs`, `frameToken`, tab rows, close buttons, and iframe stack.                      | Remove active polling from the live UI and key rendered frames by stable viewport IDs so ordinary target refreshes do not remount iframes. |
| Overlay service   | `packages/overlay/src/services/browser-preview.ts` is the only browser-preview client and uses HostTransport-backed `apiJson`.                                                    | Keep service unchanged.                                                                                                                    |
| Backend routes    | `packages/opencorvus/src/server/routes/browser-preview.ts` exposes task-scoped GET/PUT/POST routes.                                                                               | Keep backend as single source; this fix does not add a parallel local source.                                                              |
| CSS surface       | `packages/overlay/src/styles/surfaces/inspector.css` owns `.browser-preview-viewport-layout`, `.browser-preview-frame-stack`, `.browser-preview-frame-shell`, and tab row layout. | Change the frame surface from a centered vertical stack to a bounded viewport grid. Move close controls into each frame header.            |
| Regression tests  | `packages/overlay/test/browser-preview-panel.test.ts` asserts component/service/CSS contracts by source.                                                                          | Update assertions to cover no polling, bounded grid layout, and frame-local close controls.                                                |

## Call Point Sweep

| Symbol / Selector                   | Call points                                                                                                                                    | Action                                                           |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `BrowserPreviewPanel`               | `packages/overlay/src/main.tsx`, `packages/overlay/test/acceptance-panel-mount.test.ts`, `packages/overlay/test/browser-preview-panel.test.ts` | Keep mount and onReady behavior.                                 |
| `loadTaskBrowserPreviewTarget`      | `BrowserPreviewPanel.tsx`, `browser-preview-service.test.ts`                                                                                   | Keep GET source; remove only timer-driven reloads.               |
| `saveTaskBrowserPreviewTarget`      | `BrowserPreviewPanel.tsx`, `browser-preview-service.test.ts`                                                                                   | Keep save-triggered refresh.                                     |
| `captureTaskBrowserPreviewEvidence` | `BrowserPreviewPanel.tsx`, `browser-preview-service.test.ts`                                                                                   | Keep evidence path.                                              |
| `visibleViewportIDs`                | `BrowserPreviewPanel.tsx`, `browser-preview-panel.test.ts`                                                                                     | Keep explicit visibility state.                                  |
| `viewportByID`                      | `BrowserPreviewPanel.tsx`, `browser-preview-panel.test.ts`                                                                                     | Add as the stable lookup backing ID-keyed frame rendering.       |
| `browser-preview-viewport-tab-row`  | `BrowserPreviewPanel.tsx`, `inspector.css`, `browser-preview-panel.test.ts`                                                                    | Replace row close button with visibility checkbox in the rail.   |
| `browser-preview-frame-stack`       | `BrowserPreviewPanel.tsx`, `inspector.css`, `browser-preview-panel.test.ts`                                                                    | Replace stacked centering with a responsive viewport grid class. |
| `data-frame-token` / `frameToken`   | `BrowserPreviewPanel.tsx`, `browser-preview-panel.test.ts`                                                                                     | Keep manual reload token and direct iframe reload support.       |

## Implementation

1. Remove the active `window.setInterval` target reload. The backend remains the single target source; manual refresh, URL save, candidate selection, task changes, directory changes, and board update changes still reload through Solid's resource source.
2. Render frames from `visibleViewportIDs` and look up viewport dimensions through `viewportByID`. This keeps iframe DOM nodes stable when the backend returns fresh viewport objects for the same IDs.
3. Keep viewport selection in Kobalte `Tabs`, but make the rail use checkboxes for show/hide. This gives each viewport a stable visibility control without disconnecting close from the frame.
4. Move the close button into `.browser-preview-frame-header`, next to the frame label and dimensions. Disable it when only one frame remains visible.
5. Change the preview surface to a grid that fits desktop/tablet/mobile cards predictably inside the workbench, with iframe height clamped by viewport units and CSS variables. This preserves the embedded iframe source while avoiding a giant vertically scattered layout.
6. Update source tests to assert the timer is gone, the frame-local close control exists, and the bounded grid CSS is present.

## Acceptance

- No component code contains a browser-preview `setInterval` reload loop.
- Every visible frame owns its close button in the frame header.
- The viewport rail remains a Kobalte-backed tab primitive and adds native checkbox visibility toggles.
- The stage uses a bounded grid instead of a centered vertical stack.
- Overlay tests for browser preview pass.
