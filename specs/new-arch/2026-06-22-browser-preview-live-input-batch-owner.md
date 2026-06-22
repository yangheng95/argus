# Browser Preview Live Input Batch Owner

Date: 2026-06-22
Status: Verified

## Acronyms

- API: Application Programming Interface, the backend route contract consumed by the overlay.
- GUI: Graphical User Interface, the visible overlay surface.
- PNG: Portable Network Graphics, the live preview image response format.
- UI: User Interface, the overlay controls and preview stage.
- VS Code: Visual Studio Code, the extension host surface that transports overlay binary responses.

## Task Definition

Reduce active Browser Preview input jank by replacing one-request-per-input live
commands with a single batch-owned live input contract. The overlay must coalesce
wheel bursts, preserve click/key ordering, send at most one in-flight live input
request per task/target/viewport owner, and decode only one returned PNG per
batch.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no gate, no compatibility contract, test every change, run Playwright through Node on Windows, and visually verify UI changes. |
| `2026-06-11-browser-preview-interactive-live-session.md` | Live preview is a task-scoped backend-owned browser session; overlay must not embed arbitrary URLs or local query overrides. |
| `2026-06-15-browser-preview-live-target-boundary.md` | Live preview must not mix task and target IDs; target misses re-resolve through the task-scoped route. |
| `2026-06-17-browser-preview-visual-stress-benchmark.md` | Browser Preview visual stress must exercise real live frames, input routing, screenshots, and task-scoped request logs. |
| `2026-06-19-browser-preview-live-frame-application-role.md` | `.browser-preview-live-frame` is an interactive application region and must keep click, wheel, and keyboard routing. |
| `2026-06-22-browser-preview-evidence-live-snapshot-boundary.md` | Persisted evidence ownership suppresses live snapshot requests; this batch only repairs active live-surface input burst. |
| Explorer audit `019eee5e...` | `liveFrameRequestSequence` only discards stale results after HTTP, PNG transport, Blob creation, and decode; it does not prevent backend/VS Code binary pressure. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| `BrowserPreviewPanel.tsx` `handleLiveWheel` | Each wheel event calls `sendLiveInput()` immediately. | Route input through a component-owned batcher; aggregate wheel deltas by animation frame/current in-flight period. |
| `BrowserPreviewPanel.tsx` `sendLiveInput` | Only checks current live image/scope, then starts `loadLiveFrame(scope, input)`. | Queue click/key/wheel inputs for the current live owner and flush one batch. |
| `BrowserPreviewPanel.tsx` auto capture effect | Missing viewport evidence starts `captureTaskBrowserPreviewEvidence` without an explicit user action. | Remove hidden auto capture; the `Capture evidence` button is the single evidence-capture trigger. |
| `BrowserPreviewPanel.tsx` `loadLiveFrame` | Uses `sendTaskBrowserPreviewLiveInputObjectUrl({ input })`. | Replace with batch calls using `inputs[]`; keep snapshot path unchanged. |
| `browser-preview.ts` overlay service | `sendTaskBrowserPreviewLiveInputObjectUrl` serializes `{ targetID, viewportID, input }`. | Replace with `sendTaskBrowserPreviewLiveInputsObjectUrl` serializing `{ targetID, viewportID, inputs }`. |
| `server/routes/browser-preview.ts` | `BrowserPreviewLiveInputRequest` validates a single `input`. | Replace request schema with strict `inputs: BrowserPreviewLiveInput.array().min(1)`; old `{ input }` must be 400. |
| `browser-preview/live.ts` | `interactBrowserPreviewLive` sends one input to the sidecar. | Accept `inputs[]`; sidecar applies inputs in order and captures once at the end. |
| `browser-preview-routes.test.ts` | Route tests post single `input` and concurrent same-session commands. | Update to `inputs[]`, add old-body rejection, and add batch-order/one-response coverage. |
| `browser-preview-service.test.ts` | Asserts service body contains `input`. | Assert service body contains `inputs[]` and no singular input. |
| `browser-preview-visual-stress.test.ts` | Expects click, wheel, key as three request bodies. | Update request assertions to inspect batch contents and add wheel-burst request coalescing coverage. |
| SDK generated output | `types.gen.ts` and `sdk.gen.ts` currently expose singular `input`. | Regenerate/update after route schema changes through existing docs/pre-push flow. |

## Root Cause

The live surface had a display freshness guard but not a request owner. Rapid
wheel input created many `/live/input` requests; old responses were discarded
only after the backend had serialized commands, captured screenshots, transported
PNG bytes, created Blobs, and decoded images. VS Code webviews amplify this by
base64 encoding every binary frame through the extension bridge. Backend
serialization fixed Playwright state correctness but still allowed an unbounded
front-end request backlog. A second owner conflict also existed: opening or
switching to a target without full evidence could start an implicit Playwright
capture while the user was trying to use the live preview. That hidden capture
competed with live snapshot/input requests and made toolbar/target open feel
blocked.

## Fix Plan

1. Replace the route and overlay live input API with `inputs[]` only.
2. Update the live sidecar command to apply all inputs in order and call
   screenshot capture once.
3. Add a component-level live input owner that:
   - keeps one in-flight live input request per current live scope,
   - aggregates wheel bursts into one latest-coordinate delta input,
   - preserves click/key order,
   - flushes pending work after the current request resolves.
4. Clear pending batch state whenever the live scope changes.
5. Remove the implicit auto-capture effect so evidence capture has one trigger:
   the visible `Capture evidence` command.
6. Update unit, route, service, and browser stress tests.
7. Run focused tests, Node browser visual stress/evidence checks, visual
   screenshot review, self-review, commit, and push.

## Acceptance

- `/live/input` accepts only `{ targetID, viewportID, inputs: [...] }`; singular
  `{ input }` is rejected.
- A batch of click/key/wheel inputs is executed in order and returns one PNG.
- Wheel burst on the active live surface results in fewer `/live/input` requests
  than wheel events while preserving final scroll/input effect.
- Click and key inputs are not silently dropped.
- Opening or switching Browser Preview targets does not implicitly launch
  Playwright evidence capture.
- No route fallback, dual schema, iframe, URL override, abort-only workaround,
  or secondary preview source is introduced.
- Focused server, overlay service, static panel, browser evidence, browser
  visual stress, typecheck, visual screenshot review, and self-review pass.

## Implementation Notes

- The backend `/live/input` route now accepts only `inputs[]` and rejects the
  old singular `input` body through the strict route schema.
- The live sidecar applies batched inputs in order and captures one PNG after
  the batch has completed.
- `BrowserPreviewPanel` owns one live input request per current
  task/target/viewport scope, queues click/key input, and coalesces consecutive
  wheel inputs by summing deltas on the latest pointer coordinate.
- Pending live input batches are cleared on live scope changes.
- The hidden auto-capture effect was removed; opening and switching Browser
  Preview targets no longer starts Playwright evidence capture without the
  visible Capture evidence command.
- The visual stress benchmark now treats persisted primary evidence as the
  preview owner, asserts it does not request a live snapshot, and uses a focused
  browser test for live input burst batching.

## Verification

- `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-service.test.ts --timeout 30000`
- `bun test packages/opencorvus/test/server/browser-preview-routes.test.ts --timeout 60000`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/opencorvus typecheck`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-evidence.test.ts`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-visual-stress.test.ts`
- Visual evidence reviewed:
  `packages/overlay/.scratch/browser-preview-live-input-batch.png`,
  `packages/overlay/.scratch/browser-preview-visual-stress/06-alternate-live.png`,
  `packages/overlay/.scratch/browser-preview-visual-stress/07-narrow-layout.png`,
  and `packages/overlay/.scratch/browser-preview-visual-stress/08-target-failed.png`.

## Self Review

- Rechecked that no route fallback or dual request schema remains: the overlay
  service sends `inputs[]`, the route schema is strict, and the old `input`
  body is a 400 case in route tests.
- Rechecked that live input freshness no longer depends on discarding stale
  decoded images; the UI prevents request backlogs by owning and batching the
  in-flight input request.
- Rechecked that manual evidence capture remains covered by the browser
  evidence test, while visual stress asserts that target switching does not
  trigger hidden evidence capture.
- Rechecked generated SDK/OpenAPI output and removed the untracked duplicate
  `packages/sdk/js/openapi.json` emitted by the SDK build.
