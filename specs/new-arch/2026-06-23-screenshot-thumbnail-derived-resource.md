# Screenshot Thumbnail Derived Resource

Date: 2026-06-23
Status: Verified

## Acronyms

- GUI: Graphical User Interface, the visible overlay surface.
- UI: User Interface, visible controls and interaction surfaces.
- URL: Uniform Resource Locator, the string identifying a served resource.

## Task Definition

Stop the screenshots toolbar from fetching and decoding full-size screenshot
attachments for list thumbnails. The visible thumbnail image must load a
server-derived small resource, while explicit image preview still opens the
original attachment through the shared authenticated resource API.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback logic, no duplicate source, recall before edits, test every change, visually verify UI work, commit and push. |
| `2026-06-22-screenshot-browser-thumbnail-decode-budget.md` | Screenshot thumbnails already use async decode, low fetch priority, lazy intersection, and one load per RAF frame. |
| `2026-06-23-screenshot-thumbnail-request-abort.md` | Started thumbnail requests now abort when the thumbnail unmounts and share one resource API. |
| `2026-06-23-overlay-panel-legal-size-contract.md` | Overlay aspect ratio and minimum panel width remain hard legality constraints. |
| Gibbs read-only audit 2026-06-23 | Thumbnails still fetch/decode the original screenshot image; the remaining performance fix needs a thumbnail resource source. |
| Laplace read-only audit 2026-06-23 | Variant strings must be single-source, `thumbnailSrc` must participate in card-tree cache equality, and `PreviewableImage.previewLoader` must not leave delegated preview attributes pointing at the thumbnail blob. |

## Call Point Inventory

| Surface | Evidence | Decision |
| --- | --- | --- |
| Attachment route | `GET /attachment/:projectID/:name` is the existing route for stored attachment bytes. | Reuse this route with a named `variant=screenshot-browser-thumbnail` query instead of adding a second route path. |
| Attachment store | `AttachmentStore.resolveAbsolute()` is the single source of attachment file paths. | Add a store-owned thumbnail derivation helper that reads the original and caches a deterministic derivative under the attachment blob root's internal `.derived/screenshot-browser-thumbnail` directory so the derivative is not directly routable as a second attachment URL. |
| Image processing | `sharp` is already a root dependency and used by browser visual tests. | Use `sharp` server-side; do not decode or resize thumbnails in the overlay UI. |
| Variant contract | Overlay, server, and browser tests all need the same variant name. | Define `SCREENSHOT_BROWSER_THUMBNAIL_VARIANT` once in `@opencorvus-ai/transport-protocol` and re-export/consume it from package-local surfaces. |
| Directory policy | `apiUrl()` and transports inject `directory` for project-scoped routes. | Mark `/attachment/` as a shared directory-bypass prefix because attachment routes carry `projectID` in the path; variant requests must not receive `directory`. |
| Screenshot item model | `ScreenshotBrowserItem` currently carries only original `src`. | Add a derived `thumbnailSrc` computed from the original attachment URL by one helper in `utils/screenshot-browser.ts`. |
| Card tree screenshot cache | `equalScreenshotItem()` guards incremental top-level screenshot cache updates. | Include `thumbnailSrc` in equality so cached screenshot items cannot retain a stale thumbnail resource. |
| Thumbnail component | `ScreenshotThumbnail` fetches `props.item.src` for the visible list image. | Fetch `props.item.thumbnailSrc` for the list image, but keep `props.item.src` as the original preview source. |
| Shared preview primitive | `PreviewableImage` opens the same `src` it renders, and markdown preview delegation reads `data-image-preview-src`. | Extend the primitive with an explicit `previewLoader`; when present, do not register delegated preview data attributes, so the component click handler is the only preview source and loads the original object URL on demand. |
| Browser benchmark | `screenshot-browser-panel-browser.test.ts` asserts thumbnail natural size equals the original 1440x900 image. | Change the benchmark to require thumbnail natural size below the original and prove click preview opens the original. |

## Root Cause

The previous rounds moved thumbnail work later, made it abortable, and lowered
browser image priority, but the work itself is still full-size. Each visible
screenshot thumbnail requests the same original attachment bytes that the modal
preview needs. The UI then decodes a 1440x900 image just to paint a small list
card, so toolbar open, scroll, close, and resize remain exposed to unnecessary
binary transfer and image decode cost.

The correct owner is the attachment service because it already owns the
content-addressed file and MIME handling. A front-end canvas resize would still
download/decode the original in the hot path. A new public route path would
expand the API surface and SDK inventory for a view-specific derivative. A
named query variant on the existing attachment route keeps the route source
single while making the derivative explicit.

Two integration bugs appeared during browser verification:

- The resource fetch path initially preserved `variant` but let shared
  directory injection add `directory=` to `/attachment/` requests. That made
  the thumbnail route invalid. The route directory policy was the real source
  of truth, so `/attachment/` is now a shared bypass prefix instead of adding a
  resource-specific transport switch.
- `PreviewableImage.previewLoader` initially coexisted with delegated preview
  attributes. The document-level markdown preview handler opened the thumbnail
  blob before the component click path could load the original. Loader-owned
  instances now omit delegated preview attributes.

## Fix Plan

1. Add `AttachmentStore.screenshotBrowserThumbnail()` that validates the
   original attachment, uses `sharp` to produce a bounded WebP thumbnail, and
   caches the derivative under the attachment blob root.
2. Extend `AttachmentRoutes` to serve
   `/attachment/:projectID/:name?variant=screenshot-browser-thumbnail` via the
   store helper; unknown variants return 404.
3. Add `screenshotBrowserThumbnailUrl(src)` in the screenshot browser utility
   and add `thumbnailSrc` to `ScreenshotBrowserItem`.
4. Change `ScreenshotThumbnail` to fetch/cache/abort `thumbnailSrc` while
   using a `PreviewableImage.previewLoader` to fetch the original `src` only on
   click.
5. Extend static tests for the model, primitive reuse, no UI canvas resize, and
   no original thumbnail fetch.
6. Extend backend tests for derived thumbnail dimensions/content type and
   unknown variant failure.
7. Extend browser visual benchmark to assert thumbnail natural dimensions are
   below original size and explicit preview opens the original image.
8. Run focused tests, overlay/opencorvus typecheck, browser visual QA,
   self-review, commit, and push.

## Acceptance

- Screenshot list thumbnails fetch the named thumbnail variant, not the original
  screenshot attachment.
- Clicking a thumbnail preview still opens the original attachment object URL.
- Thumbnail derivation is server-owned by `AttachmentStore`; no front-end canvas
  resize, duplicate route path, or panel-local source is introduced.
- Existing stored attachment URL validation remains strict; query variants are
  request-only and not accepted as canonical stored attachment references.
- Overlay aspect-ratio and center workbench minimum-width tests remain passing.

## Implementation

- Added `AttachmentStore.screenshotBrowserThumbnail()` with bounded `sharp`
  WebP derivation and internal `.derived/screenshot-browser-thumbnail` cache.
- Extended `GET /attachment/:projectID/:name` with the shared
  `variant=SCREENSHOT_BROWSER_THUMBNAIL_VARIANT` query; unknown variants and
  direct derivative names return 404.
- Added `thumbnailSrc` to `ScreenshotBrowserItem`, generated from the original
  stored attachment URL through one helper.
- Changed screenshot thumbnails to fetch/cache/abort `thumbnailSrc` while
  preview click loads the original `src`.
- Moved the variant name into `@opencorvus-ai/transport-protocol`, added
  `/attachment/` to the shared no-directory route policy, and preserved resource
  query parameters through `fetchResourceAsObjectUrl`.
- Included `thumbnailSrc` in card-tree screenshot cache equality.
- Prevented `PreviewableImage` instances with `previewLoader` from registering
  delegated preview data attributes.

## Verification

- `bun test packages/transport-protocol/test/contract.test.ts packages/opencorvus/test/server/attachment-routes.test.ts packages/overlay/test/api-directory-injection.test.ts packages/overlay/test/blob-cache.test.ts packages/overlay/test/tree-writer-stats-cache.test.ts packages/overlay/test/screenshot-browser-panel.test.ts packages/overlay/test/message-image-preview.test.ts packages/overlay/test/overlay-layout-frame.test.ts packages/overlay/test/overlay-window-size-contract.test.ts packages/overlay/test/workspace-surface-consistency.test.ts --timeout 30000` passed: 172 tests.
- `bun run --cwd packages/overlay typecheck` passed.
- `bun run --cwd packages/opencorvus typecheck` passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/screenshot-browser-panel-browser.test.ts` passed after rebuilding `dist-vite`.
- `bun run --cwd packages/overlay build:vite` passed.
- `bun run --cwd packages/overlay build` reached the final binary copy step but failed with `EACCES` on `packages/overlay/dist/opencorvus-overlay-windows-x64/opencorvus-overlay.exe`; this is consistent with the existing executable being locked. Per process-boundary rule 39, no running overlay process was killed or restarted.

## Visual QA

Reviewed:

- `.scratch/screenshot-browser-panel-browser.png`
- `.scratch/screenshot-browser-panel-browser-reopen.png`
- `.scratch/screenshot-browser-panel-browser-narrow-panel.png`
- `.scratch/screenshot-browser-panel-browser-preview.png`

The screenshots panel renders visible thumbnail cards without overflow, the
reopen view remains populated, the narrow legal-width panel keeps title/list
content inside the panel, and the preview dialog opens the full-size original
image with toolbar controls visible.

## Self Review

- No front-end canvas resize or local thumbnail source was introduced.
- The variant string has one definition in `transport-protocol`.
- Thumbnail variant requests do not receive `directory`.
- Direct derivative attachment filenames are not routable.
- Unknown variants do not serve the original.
- Overlay aspect-ratio and center workbench minimum-width tests remained
  passing.
