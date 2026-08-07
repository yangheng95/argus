# Browser Preview Interactive Live Session - 2026-06-11

## Goal

Make the browser preview a complete interactive preview surface. The overlay must show a task-scoped backend-owned browser session and route user input to that session.

## Constraints

- The preview target source remains the persisted task browser preview target artifact.
- The overlay must not embed arbitrary URLs with an iframe or local query override.
- Browser automation must reuse the Node/Playwright sidecar path. Playwright is not launched through Bun on Windows.
- Evidence capture remains available as diagnostics; live preview is a separate interactive surface backed by the same target ID.

## Call Points

| Surface                                                          | Existing role                                | Change                                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `packages/opencorvus/src/server/routes/browser-preview.ts`       | Task-scoped target, evidence, capture routes | Add task-scoped live snapshot/input routes using existing target lookup.                                        |
| `packages/opencorvus/src/browser-preview/persist.ts`             | Persisted target/evidence lookup             | Reuse `findBrowserPreviewTargetByID`; do not add URL bodies.                                                    |
| `packages/opencorvus/src/browser-preview/viewport.ts`            | Single viewport preset source                | Reuse `browserPreviewViewportByID` for live sessions.                                                           |
| `packages/opencorvus/src/browser/runtime/node-sidecar.ts`        | Node/Playwright runtime resolution           | Reuse runtime paths for a persistent sidecar.                                                                   |
| `packages/opencorvus/src/browser/runtime/node-executor.ts`       | One-shot sidecar executor                    | Keep one-shot evidence capture unchanged; live preview gets its own JSON-lines sidecar because it must persist. |
| `packages/overlay/src/services/browser-preview.ts`               | Overlay browser preview API client           | Add binary live snapshot/input calls through HostTransport.                                                     |
| `packages/overlay/src/components/BrowserPreviewPanel.tsx`        | Evidence rendering and target controls       | Render live preview as the primary surface and send pointer/wheel/keyboard input to backend.                    |
| `packages/overlay/src/styles/surfaces/inspector.css`             | Preview stage/evidence CSS                   | Add stable live frame styles without nested cards.                                                              |
| `packages/opencorvus/test/server/browser-preview-routes.test.ts` | Route contract coverage                      | Cover target ID requirement and input payload routing.                                                          |
| `packages/overlay/test/browser-preview-panel.test.ts`            | Static architecture guard                    | Require live service and no iframe.                                                                             |
| `packages/overlay/test/browser/browser-preview-evidence.test.ts` | Browser panel acceptance                     | Verify live screenshot loads and user input posts to backend.                                                   |

## API Shape

- `POST /task/:taskID/browser-preview/live/snapshot`
  - Body: `{ targetID, viewportID }`
  - Response: `image/png`
- `POST /task/:taskID/browser-preview/live/input`
  - Body: `{ targetID, viewportID, input }`
  - Response: `image/png`

The server derives `url` from the persisted target ID and viewport dimensions from `browserPreviewViewportByID`.

## Live Input

- Pointer click: `{ kind: "click", x, y, button }`
- Wheel: `{ kind: "wheel", x, y, deltaX, deltaY }`
- Keyboard press: `{ kind: "key", key }`

Coordinates are browser viewport CSS pixels. The overlay computes them from the displayed screenshot bounds and the selected viewport preset.

## Validation

1. Backend route tests prove arbitrary URLs are still rejected and live routes require `targetID`.
2. Overlay static tests prove live preview uses HostTransport API calls and no iframe.
3. Browser test proves the panel loads a live screenshot and posts pointer/wheel input through task-scoped live routes.
4. Typecheck both backend and overlay, then push with hooks.

## Resource Lifecycle Audit - 2026-06-11

- Live preview sessions must not remain open indefinitely after interaction stops. Each sidecar arms an unref'd idle close timer after command settlement.
- Pending command timeout and abort paths must remove AbortSignal listeners by settling through the same pending reject wrapper used by successful responses.
- Parent/server teardown must explicitly close live preview sessions before instance/global dispose and before the server process exits.
- The Node sidecar must close Chromium when stdin ends or closes, so a parent pipe shutdown does not leave an orphaned browser process.
