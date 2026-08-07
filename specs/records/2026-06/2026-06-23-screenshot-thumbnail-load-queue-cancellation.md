# Screenshot Thumbnail Load Queue Cancellation

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- RAF: Request Animation Frame, the browser callback used to run visual work once per frame.
- UI: User Interface, visible controls and layout surfaces.

## Task Definition

Keep screenshot toolbar reopen, scroll, and resize responsive when thumbnail
rows mount and unmount quickly. Cancelled thumbnail load jobs must leave the
shared RAF queue immediately instead of occupying future frames one cancelled
job at a time.

## Recall

| Source                                                     | Constraint carried forward                                                                                                                                                                |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                | No fallback logic, no duplicate source, recall before edits, test every change, visually verify UI work, commit and push.                                                                 |
| `2026-06-22-screenshot-browser-open-jank.md`               | Screenshot browser derives from card-tree screenshot items, renders through `virtua/solid`, lazy-loads thumbnails, and reuses `PreviewableImage`.                                         |
| `2026-06-22-screenshot-browser-thumbnail-decode-budget.md` | Thumbnail decode/fetch priority must stay off the toolbar-open critical path; browser benchmark measures first visible card and frame gaps.                                               |
| `2026-06-22-screenshot-browser-virtual-row-measurement.md` | CSS and `virtua` own row geometry; do not add fixed row-height or alternate geometry sources.                                                                                             |
| Live 7878 measurement 2026-06-23                           | Screenshot activity opens fast with a few screenshots, but after multiple right panels and screenshot entries it can take seconds; current source still has a cancelled-job queue hazard. |
| James read-only audit 2026-06-23                           | `pendingThumbnailLoads` only marks cancelled jobs and drains one cancelled closure per RAF frame.                                                                                         |

## Call Point Inventory

| Surface           | Evidence                                                                                                                                   | Decision                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Thumbnail queue   | `ScreenshotBrowserPanel.tsx` has module-level `pendingThumbnailLoads: Array<() => void>`.                                                  | Replace it with removable job records so cleanup deletes pending work immediately.                    |
| Pump budget       | `SCREENSHOT_BROWSER_THUMBNAIL_LOADS_PER_FRAME = 1`.                                                                                        | Keep the one-load-per-frame decode budget.                                                            |
| Thumbnail cleanup | `onCleanup` calls `cancelQueuedLoad?.()` and disconnects `IntersectionObserver`.                                                           | Preserve cleanup ownership, but make cancellation remove the exact job from the pending queue.        |
| Fetch/cache path  | `ScreenshotThumbnail` uses `fetchResourceAsObjectUrl`, `peekResourceObjectUrl`, and `PreviewableImage`.                                    | Keep the shared preview and object URL path unchanged.                                                |
| Browser benchmark | `screenshot-browser-panel-browser.test.ts` measures initial open, RAF gaps, long tasks, bounded requests, scroll, resize, and screenshots. | Add a close/reopen path after scroll/resize to exercise queued cancellation and visible-card latency. |
| Static tests      | `screenshot-browser-panel.test.ts` pins lazy loading and shared preview ownership.                                                         | Add guards that cancellation deletes queued jobs and no cancelled-closure drain remains.              |

## Root Cause

Virtualized screenshot rows mount and unmount during open, scroll, resize, and
panel close. Each intersecting thumbnail currently pushes a closure into a
module-level RAF queue. Cleanup only flips a local `cancelled` boolean, so a
closed or unmounted thumbnail remains in `pendingThumbnailLoads` until the pump
spends a future frame on that closure. Because the queue intentionally allows
only one thumbnail load per frame, cancelled entries can delay real visible
thumbnail loads after a fast close/reopen or resize churn.

## Fix Plan

1. Replace the pending array of closures with queue job records.
2. Return a cancellation function that removes the exact pending job from the
   queue before it reaches the pump.
3. Keep the existing one-thumbnail-per-frame pump budget and shared
   `PreviewableImage` fetch path.
4. Strengthen static tests to reject cancelled-closure queue draining.
5. Extend the browser screenshot benchmark with a close/reopen pass after
   scroll/resize and assert first visible cards remain responsive.
6. Run focused tests, overlay typecheck, browser visual benchmark, visual
   review, self-review, commit, and push.

## Acceptance

- Cancelled thumbnail jobs are removed from the queue immediately.
- The queue still starts at most one thumbnail load per RAF frame.
- Screenshot thumbnails still use `IntersectionObserver`, `fetchResourceAsObjectUrl`,
  `peekResourceObjectUrl`, and shared `PreviewableImage`.
- Reopening screenshots after scroll/resize still shows first visible cards
  within the existing browser budget and without full-history requests.
- No duplicate screenshot source, fallback fetch path, direct object URL path,
  iframe, local storage, or second toolbar source is introduced.

## Implementation

| Change                                                                                                                              | Reason                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Replaced queued thumbnail closures with `ScreenshotThumbnailLoadJob` records.                                                       | Gives cleanup a concrete queue item to remove instead of leaving a cancelled closure behind.         |
| `enqueueScreenshotThumbnailLoad()` now removes the pending job and cancels the scheduled RAF when the queue becomes empty.          | Prevents closed/unmounted thumbnails from spending future frames before visible thumbnails can load. |
| Kept `SCREENSHOT_BROWSER_THUMBNAIL_LOADS_PER_FRAME = 1`.                                                                            | Preserves the previous decode/fetch budget.                                                          |
| Extended the browser benchmark with scroll churn, close, reopen, first-card timing, request-budget checks, and a reopen screenshot. | Verifies the exact lifecycle that left cancelled thumbnail jobs queued.                              |

## Verification

- PASS: `bun test packages/overlay/test/screenshot-browser-panel.test.ts --timeout 30000`.
- PASS: `bun run --cwd packages/overlay typecheck`.
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts`.
- Visual QA reviewed:
  `.scratch/screenshot-browser-panel-browser-reopen.png`,
  `.scratch/screenshot-browser-panel-browser-narrow.png`, and
  `.scratch/screenshot-browser-panel-browser-narrow-panel.png`.

## Self Review

- Rechecked `ScreenshotBrowserPanel`: screenshot thumbnails still use the same
  card-tree source, `IntersectionObserver`, `fetchResourceAsObjectUrl`,
  `peekResourceObjectUrl`, and `PreviewableImage`.
- Rechecked queue ownership: cancelled jobs are physically removed from
  `pendingThumbnailLoads`; the pump still drains at most one real thumbnail job
  per RAF frame.
- Rechecked live 7878 evidence: the active tab served on port 7878 can still be
  stale relative to current committed assets, so code verification and visual QA
  used isolated browser-runner builds while live measurements guided the failure
  shape.
- Follow-up candidates from read-only agents remain for later rounds: config
  sidebar width clamp double source, left header action primitive ownership,
  pane resizer dead `::before` CSS, warm-cache thumbnail decode gating, and
  screenshot column geometry source consolidation.

## Follow-up 2026-06-23: Warm-Cache Thumbnail Decode Gating

### Recall

| Source                                                     | Constraint carried forward                                                                                                                                    |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `2026-06-22-screenshot-browser-open-jank.md`               | Screenshot browser rows derive from the card tree, render through `virtua/solid`, and visible thumbnails must enter the load path through the lazy queue.     |
| `2026-06-22-screenshot-browser-thumbnail-decode-budget.md` | Thumbnail fetch/decode remains off the toolbar-open critical path; the browser benchmark samples RAF gaps and long tasks.                                     |
| This file                                                  | Cancelled thumbnail jobs must be physically removed from the queue, and the queue starts at most one thumbnail load per RAF frame.                            |
| Godel read-only audit                                      | Warm cache hits currently seed `createResource` through `initialValue`, so cached blob URLs can render before `loadAllowed()` and bypass the per-frame queue. |

### Call Point Inventory

| Call point                                         | Current evidence                                                                                                                                                           | Decision                                                                                                                               |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `ScreenshotBrowserPanel.tsx` `ScreenshotThumbnail` | Authenticated screenshots call `peekResourceObjectUrl(props.item.src)` as the resource `initialValue`.                                                                     | Remove the eager `initialValue`; read warm cache only after `loadAllowed()` is true.                                                   |
| `ScreenshotBrowserPanel.tsx` `src()`               | Authenticated screenshots return `objectUrl()` regardless of `loadAllowed()`.                                                                                              | Require `loadAllowed()` before exposing any authenticated or raw URL to `PreviewableImage`.                                            |
| `ScreenshotBrowserPanel.tsx` URL branch            | The component still has a non-authenticated `resolveResourceUrl` path even though `screenshot-browser.ts` filters screenshot items through `/attachment/<project>/<name>`. | Remove the raw URL branch; screenshot thumbnails use only stored attachment URLs and object URLs.                                      |
| `ScreenshotBrowserPanel.tsx` error branch          | `<Show when={!objectUrl.error}>` hides failed thumbnails as an empty slot.                                                                                                 | Render an explicit same-size error placeholder for invalid sources or load failures.                                                   |
| `services/api.ts` `peekResourceObjectUrl`          | The API comment recommends `initialValue` for flicker-free first render.                                                                                                   | Clarify that staged/lazy renderers must not use the peek to bypass their reveal gate.                                                  |
| `screenshot-browser-panel.test.ts`                 | Static contract only checks that `peekResourceObjectUrl` is present.                                                                                                       | Add guards that screenshot browser has no cache-backed `initialValue` and that `src()` remains gated by `loadAllowed()`.               |
| `screenshot-browser-panel-browser.test.ts`         | The browser benchmark opens, scrolls, closes, and reopens 120 screenshots, but does not prove warm-cache images wait for RAF permission.                                   | Prewarm cache on the first open, instrument image insertions per RAF on reopen, and assert warm-cache insertion spans multiple frames. |

### Root Cause

The queue fix removed cancelled jobs, but cached authenticated screenshots still
had a second reveal path. `peekResourceObjectUrl` populated the Solid resource
before the thumbnail's IntersectionObserver callback had queued a load job. On
reopen, warm-cache thumbnails could therefore mount `PreviewableImage`
instances immediately, shifting decode work back into the toolbar-open frame.

The component also kept a raw URL rendering branch after the collector had
already made `/attachment/...` the source contract. That was a compatibility
path, not a required screenshot input. When the object URL failed, the panel hid
the thumbnail slot instead of showing the broken source, which made attachment
problems harder to locate.

### Fix Plan

1. Remove the cache-backed `initialValue` from screenshot thumbnails.
2. Resolve cached object URLs inside the resource fetcher after `loadAllowed()`
   flips true, preserving cache reuse without a second reveal path.
3. Gate authenticated `src()` by `loadAllowed()` so no blob URL reaches
   `PreviewableImage` before the per-frame queue permits it.
4. Remove the non-attachment `resolveResourceUrl` path from screenshot
   thumbnails.
5. Add a same-size explicit error placeholder for invalid sources and object URL
   load failures.
6. Update the `peekResourceObjectUrl` comment to distinguish immediate-preview
   callers from staged/lazy callers.
7. Extend static and browser tests for warm-cache reopen behavior.
8. Re-run focused tests, browser visual QA, self-review, commit, and push.

### Acceptance

- Warm-cache screenshots still use the shared blob cache and do not refetch
  visible cached thumbnails on reopen.
- Cached screenshot thumbnails do not expose an image `src` until their queued
  load job runs.
- Screenshot thumbnails no longer support a raw URL/`resolveResourceUrl` branch.
- Invalid or failed thumbnails show a visible same-size error state instead of
  disappearing.
- Warm-cache image insertion on reopen is spread across multiple RAF frames and
  remains below the existing open long-task/RAF-gap budget.
- Browser screenshots for open, reopen, and narrow layout remain visually valid.
