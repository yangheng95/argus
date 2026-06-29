# Browser Preview Panel UX Refactor

Date: 2026-06-09
Status: Implementation plan

## Acronyms

- UI: User Interface, the visible browser preview controls and frame surface.
- UX: User Experience, the user's task flow, clarity, and control ergonomics.
- URL: Uniform Resource Locator, the saved preview address resolved by the backend.
- CSP: Content Security Policy, the host rule that can block embedded preview frames.

## Problem

The current browser preview panel wastes the first viewport with disconnected chrome:

- The URL field, candidate selector, status row, viewport controls, live frame area, and evidence capture sit in separate bands.
- The left viewport rail consumes scarce horizontal space even when there is no frame to show.
- The empty state appears as a small floating message inside a large grid canvas, so the user sees a broken workspace rather than a clear next action.
- Evidence capture is visually detached from the target and status, even though it operates on the same backend-resolved task target.

This is a product layout problem, not a preview target discovery problem. The backend task-scoped target remains the only source for the panel.

## Codebase Evidence

| Area      | Evidence                                                                                                                                                                                                             | Decision                                                                                              |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Component | `packages/overlay/src/components/BrowserPreviewPanel.tsx` owns the URL form, candidate select, viewport tabs, status, frame rendering, empty states, and evidence capture.                                           | Recompose these controls into a single compact command surface plus a single stage.                   |
| Service   | `packages/overlay/src/services/browser-preview.ts` calls `GET /task/{taskID}/browser-preview`, `PUT /task/{taskID}/browser-preview/target`, and `POST /task/{taskID}/browser-preview/capture` through HostTransport. | Keep unchanged as the single UI data source.                                                          |
| CSS       | `packages/overlay/src/styles/surfaces/inspector.css` owns every `.browser-preview-*` selector.                                                                                                                       | Update only browser preview selectors; do not create another surface stylesheet.                      |
| Test      | `packages/overlay/test/browser-preview-panel.test.ts` pins source-level UI and single-source contracts.                                                                                                              | Extend it to assert the unified command surface, centered empty stage, and no detached viewport rail. |

## Call Point Sweep

| Symbol / Selector / Route           | Call points                                                                                                                                    | Action                                                                                     |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `BrowserPreviewPanel`               | `packages/overlay/src/main.tsx`, `packages/overlay/test/acceptance-panel-mount.test.ts`, `packages/overlay/test/browser-preview-panel.test.ts` | Keep mount and `onReady` contract.                                                         |
| `loadTaskBrowserPreviewTarget`      | `BrowserPreviewPanel.tsx`, `browser-preview-service.test.ts`                                                                                   | Keep.                                                                                      |
| `saveTaskBrowserPreviewTarget`      | `BrowserPreviewPanel.tsx`, `browser-preview-service.test.ts`                                                                                   | Keep for URL submit and candidate selection.                                               |
| `captureTaskBrowserPreviewEvidence` | `BrowserPreviewPanel.tsx`, `browser-preview-service.test.ts`                                                                                   | Keep, but move the button into the command surface.                                        |
| `browser-preview-candidate-select`  | `BrowserPreviewPanel.tsx`, `inspector.css`, `browser-preview-panel.test.ts`                                                                    | Keep the native select, but place it in the command surface.                               |
| `browser-preview-viewport-layout`   | `BrowserPreviewPanel.tsx`, `inspector.css`, `browser-preview-panel.test.ts`                                                                    | Remove the two-column rail layout and replace it with a top control row plus stage.        |
| `browser-preview-viewport-tab-row`  | `BrowserPreviewPanel.tsx`, `inspector.css`, `browser-preview-panel.test.ts`                                                                    | Remove the detached rail rows. Viewport tabs become inline segmented controls.             |
| `browser-preview-viewport-toggle`   | `BrowserPreviewPanel.tsx`, `inspector.css`, `browser-preview-panel.test.ts`                                                                    | Keep as a native checkbox, but render it beside the active segmented control.              |
| `browser-preview-status`            | `BrowserPreviewPanel.tsx`, `inspector.css`                                                                                                     | Move into the command surface so target state is visible before the stage.                 |
| `browser-preview-empty`             | `BrowserPreviewPanel.tsx`, `inspector.css`                                                                                                     | Make the empty state a centered stage content block with the URL field as the action path. |
| `/task/{taskID}/browser-preview*`   | SDK, docs, backend route tests, overlay service tests                                                                                          | Unchanged.                                                                                 |

## Implementation

1. Replace the detached vertical viewport rail with `.browser-preview-controls`, a compact row containing status, candidate select, viewport `Tabs`, visibility checkboxes, and evidence capture.
2. Keep the URL input as the first command row because the user's primary action is entering or confirming the target.
3. Render the stage directly under the controls. Empty, failed, and host-blocked states occupy the stage center with a bounded width and clear readable diagnostics.
4. Keep existing Kobalte `Tabs`, native `select`, native checkboxes, shared `Button`, `Icon`, and HostTransport-backed services. No local preview source, query override, iframe fake, or polling loop is introduced.
5. Update tests to reject the detached two-column viewport rail and assert the command surface/stage contract.

## Acceptance

- The panel has one command surface and one stage, not multiple detached bands.
- Empty state is centered in the stage and does not appear as a tiny orphaned message on the grid.
- Viewport selection and visibility controls remain mature primitives and stay spatially near the target controls.
- Evidence capture stays backend-backed and target-scoped.
- Browser preview overlay tests pass.
