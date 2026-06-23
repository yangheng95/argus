# Browser Preview Live Snapshot Scope Owner

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- PNG: Portable Network Graphics, the live preview image response format.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Ensure Browser Preview live snapshot loading is owned by the live scope. Opening
the live preview for a task/target/viewport must request exactly one initial
`/live/snapshot`, and switching viewport scopes must request exactly one
snapshot for the new scope.

## Recall

| Source                                                          | Constraint carried forward                                                                                         |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `AGENTS.md`                                                     | No fallback, no dual source, test every change, visually verify UI work, and commit/push every round.              |
| `2026-06-11-browser-preview-interactive-live-session.md`        | Live preview is task-scoped and backend-owned; screenshot routes are task/target/viewport scoped.                  |
| `2026-06-22-browser-preview-evidence-live-snapshot-boundary.md` | Persisted evidence suppresses live snapshots; live snapshots are only for live preview ownership.                  |
| `2026-06-22-browser-preview-live-input-batch-owner.md`          | Live input request batching must remain the input owner; snapshot ownership must not reintroduce request pressure. |
| `2026-06-23-browser-preview-live-input-rect-cache.md`           | Live input handlers use a cached image rect; snapshot ownership must not affect input coordinate routing.          |
| Confucius read-only audit                                       | First live image writes could retrigger the live-scope effect and duplicate `/live/snapshot` requests.             |

## Call Point Inventory

| Search                                     | Findings                                                                                                                            | Decision                                                                                                         |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `createEffect<string                       | undefined>`in`BrowserPreviewPanel.tsx`                                                                                              | The live-scope effect calls `clearLiveImageUrl()` when the scope key changes, then calls `loadLiveFrame(scope)`. | Keep the scope effect as the single snapshot requester. |
| `clearLiveImageUrl()`                      | The helper read `liveImage()` directly. When called inside the scope effect, that read subscribed the effect to live image changes. | Read `liveImage` through Solid `untrack` so cleanup does not add a dependency.                                   |
| `replaceLiveImageUrl()`                    | Setting the first live image could retrigger any effect subscribed to `liveImage`.                                                  | Do not add response-discard or request gates; remove the accidental subscription at the source.                  |
| `browser-preview-live-input-batch.test.ts` | The live test recorded snapshot bodies but only asserted that one existed.                                                          | Assert exact snapshot counts for desktop initial scope and tablet scope switch.                                  |
| `browser-preview-panel.test.ts`            | Static guard covered live ownership broadly.                                                                                        | Add a guard that `clearLiveImageUrl` uses `untrack(liveImage)` and does not call `liveImage()`.                  |

## Root Cause

The live-scope effect was intended to depend on `liveScope()`, but its cleanup
helper read `liveImage()` while the effect was tracking. After the first
snapshot response set `liveImage`, Solid could run the same effect again with
the same scope key and start a second `/live/snapshot`. The old
`liveFrameRequestSequence` discarded stale responses after the request had
already been made; it did not prevent duplicate backend and binary PNG work.

## Fix

1. Import Solid `untrack`.
2. Change `clearLiveImageUrl()` to read `liveImage` with `untrack(liveImage)`.
3. Keep `loadLiveFrame(scope)` in the live-scope effect; the effect now tracks
   the scope owner instead of live image state.
4. Extend the real browser live-input batch test:
   - initial desktop live scope requests exactly one snapshot;
   - switching to tablet requests exactly one tablet snapshot;
   - desktop does not repeat after load or after live input.

No fallback, response discard workaround, route gate, iframe, or alternate
preview source is introduced.

## Verification

- PASS: `bun test packages/overlay/test/browser-preview-panel.test.ts packages/overlay/test/browser-preview-live-point.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/browser-preview-live-input-batch.test.ts`.

## Visual Review

- `packages/overlay/.scratch/browser-preview-live-input-batch.png`: live preview
  still renders the backend-owned screenshot and controls after the input batch.

## Self Review

- Rechecked `clearLiveImageUrl` source: it contains `untrack(liveImage)` and no
  direct `liveImage()` call.
- Rechecked browser fixture assertions: desktop and tablet each require exactly
  one snapshot body for the same target.
- Rechecked input coverage: layout-read instrumentation and wheel-burst
  batching still pass in the same browser test.
