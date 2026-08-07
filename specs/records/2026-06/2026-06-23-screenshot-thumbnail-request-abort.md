# Screenshot Thumbnail Request Abort

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- RAF: Request Animation Frame, the browser callback used to spread visual work across frames.
- UI: User Interface, visible controls and interaction surfaces.

## Task Definition

Keep screenshot toolbar close, reopen, scroll, and resize responsive after
thumbnail requests have already started. When a virtualized thumbnail row
unmounts or the screenshots panel closes, its in-flight resource request must
stop consuming transport, blob cache, and image decode budget unless another
visible consumer still needs the same resource.

## Recall

| Source                                                       | Constraint carried forward                                                                                                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                  | No fallback logic, no duplicate source, recall before edits, test every change, visually verify UI work, commit and push.                                  |
| `2026-06-23-screenshot-thumbnail-load-queue-cancellation.md` | Thumbnail jobs are physically removed from the RAF queue before starting; warm-cache thumbnails still wait for load permission.                            |
| `2026-06-22-screenshot-browser-thumbnail-decode-budget.md`   | Thumbnail fetch/decode remains off the toolbar-open critical path.                                                                                         |
| Gibbs read-only audit 2026-06-23                             | `ScreenshotThumbnail` can cancel queued work but cannot abort a request after `fetchResourceAsObjectUrl()` starts.                                         |
| User feedback 2026-06-23                                     | Overlay aspect ratio and minimum panel width are legality constraints; this thumbnail fix must not reintroduce illegal wide/tall frames or crushed panels. |
| Current call sweep                                           | `FilePart`, `InlineToolPart`, and `ScreenshotBrowserPanel` all use the same resource object URL API.                                                       |

## Call Point Inventory

| Surface                           | Evidence                                                                                                                 | Decision                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Resource API                      | `services/api.ts::fetchResourceAsObjectUrl(raw)` owns object URL fetch, in-flight de-duplication, and blob cache writes. | Extend this single API with optional `AbortSignal`; do not add screenshot-only fetch logic.                         |
| Host transport                    | `TransportRequest.signal` already exists and is forwarded by `apiRequest()` / transports.                                | Reuse the existing signal channel for server-relative attachments.                                                  |
| External/data/blob/file resources | `fetchResourceAsObjectUrl()` still uses plain `fetch()` for these schemes.                                               | Pass the same abort signal to plain `fetch()` paths.                                                                |
| In-flight de-duplication          | `blobInFlight` currently stores one promise per raw URL.                                                                 | Replace with an entry that tracks consumers and aborts the underlying request only when the final consumer cancels. |
| Screenshot thumbnails             | `ScreenshotThumbnail` starts `fetchResourceAsObjectUrl()` after `loadAllowed()` and cleanup only cancels queued jobs.    | Add a thumbnail-owned `AbortController` and abort on cleanup/unmount.                                               |
| FilePart / InlineToolPart         | These callers need warm-cache immediate render and do not currently own unmount cancellation.                            | Keep call sites compatible; they continue to call `fetchResourceAsObjectUrl(raw)` without a signal.                 |
| Static tests                      | `screenshot-browser-panel.test.ts` pins queue, cache, and shared preview contracts.                                      | Add guards that screenshot thumbnail cleanup aborts active resource requests and passes a signal.                   |
| API tests                         | `blob-cache.test.ts` pins shared in-flight fetch and cache behavior.                                                     | Add abort tests for single-consumer cancellation and shared-consumer survival.                                      |
| Browser visual test               | `screenshot-browser-panel-browser.test.ts` already exercises open, scroll, close, reopen, resize, and screenshots.       | Re-run and inspect screenshots after the API/component change.                                                      |

## Root Cause

The previous screenshot queue fixes only covered work that had not started yet.
Once a visible thumbnail flips `loadAllowed()` to true, `createResource()` calls
`fetchResourceAsObjectUrl()` with no cancellation channel. If the virtualized
row unmounts during scroll, close, reopen, or resize, the binary attachment
request continues and can still create/cache a blob object URL. That stale work
competes with the next visible thumbnail batch and keeps the toolbar/resize path
busy after the panel has already changed.

The underlying transport already supports `AbortSignal`, so the missing piece is
not a timeout or UI gate. The single resource API must expose cancellation while
preserving the existing cache and same-URL in-flight sharing.

## Fix Plan

1. Change `fetchResourceAsObjectUrl(raw)` to accept an optional
   `{ signal?: AbortSignal }` argument.
2. Replace `blobInFlight: Map<string, Promise<string>>` with a consumer-tracked
   entry that owns one internal `AbortController`.
3. Reject only the cancelling caller when its signal aborts; abort the
   underlying request only when no active consumers remain.
4. Pass the internal signal to both plain `fetch()` and `HostTransport.request`.
5. Add a `ScreenshotThumbnail` request controller that aborts on cleanup and is
   replaced when the source changes.
6. Add API tests for aborting the only consumer and for preserving a shared
   request while one consumer aborts.
7. Add static screenshot panel tests for the component-owned abort path.
8. Run focused tests, overlay typecheck, Node browser visual benchmark,
   screenshot review, self-review, commit, and push.

## Acceptance

- A closed/unmounted screenshot thumbnail aborts its in-flight attachment
  request before it writes a blob object URL.
- Aborting one consumer does not cancel a shared in-flight request still needed
  by another consumer.
- Existing FilePart and InlineToolPart callers remain source-compatible and use
  the same resource API.
- Screenshot thumbnails still use the card-tree source, `IntersectionObserver`,
  RAF load queue, shared blob cache, and `PreviewableImage`.
- Existing overlay aspect-ratio and center workbench minimum-width contracts
  remain passing; no illegal aspect or too-small panel state is introduced.
- No raw URL fallback, duplicate thumbnail source, timeout extension, or toolbar
  gate is introduced.

## Verification

- PASS: `bun test packages/overlay/test/blob-cache.test.ts packages/overlay/test/screenshot-browser-panel.test.ts packages/overlay/test/message-image-preview.test.ts packages/overlay/test/overlay-layout-frame.test.ts packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/workspace-surface-consistency.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`.

## Visual QA

- Reviewed `.scratch/screenshot-browser-panel-browser.png`: the screenshots
  panel opens with nonblank thumbnails and no overlap with the center workbench.
- Reviewed `.scratch/screenshot-browser-panel-browser-reopen.png`: close/reopen
  keeps the right toolbar and screenshots activity aligned, and thumbnails
  re-render from the shared resource path.
- Reviewed `.scratch/screenshot-browser-panel-browser-narrow-panel.png`: the
  narrow screenshots panel remains coherent and does not force illegal panel
  compression.

## Self Review

- Rechecked `fetchResourceAsObjectUrl()`: the abortable path is still the single
  resource API, and same-URL consumers share one transport request.
- Rechecked cancellation semantics: aborting the final active consumer cancels
  the underlying request before it writes the blob cache, while aborting one
  shared consumer leaves the remaining consumer alive.
- Rechecked Solid resource call sites: `ScreenshotThumbnail` owns an
  `AbortController`; `FilePart` wrappers keep existing callers source-compatible
  without letting Solid's fetcher info object become resource options.
- Rechecked legal-size regression scope: aspect-ratio and minimum-panel tests
  pass with this change, so the screenshot performance fix did not introduce a
  compact raw-viewport branch or a second panel width source.
