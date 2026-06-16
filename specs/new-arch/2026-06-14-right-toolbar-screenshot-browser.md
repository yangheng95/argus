# Right Toolbar Screenshot Browser

Date: 2026-06-14
Status: consensus plan and implementation record

## Acronyms

- UI: User Interface, the visible overlay controls and panels.
- DOM: Document Object Model, the browser element tree declared in the overlay HTML.
- SSE: Server-Sent Events, the task notification stream.
- PNG: Portable Network Graphics, the screenshot image format.
- URL: Uniform Resource Locator, the persisted resource address used by image elements.
- LRU: Least Recently Used, the bounded eviction policy for cached object URLs.
  The full phrase is included because this feature depends on bounded cache eviction.
  Screenshot bytes are stored in `.opencorvus`, not in DB rows.
- DB: Database, the SQLite-backed project metadata store. It may hold lightweight
  screenshot references, but not image bytes or base64 payloads.

## Requirement

Add a right toolbar control for browsing screenshots that have appeared in the task conversation, grouped by agent.

The feature must avoid resource leaks and must not create a second screenshot source, local replay store, live-frame recorder, iframe preview, base64 archive, or fallback path.

Screenshot image bytes must not be stored in the database. They must live under the project `.opencorvus` runtime attachment store, with the UI carrying only stored attachment references such as `/attachment/<projectID>/<name>`.

## Independent Investigation Summary

Four independent agents were assigned:

| Agent | Scope | Finding |
| --- | --- | --- |
| UI architecture | Right toolbar and panel structure | Right toolbar is sourced from `RIGHT_ACTIVITIES`; panels are center workbench views. A new control must join `CenterWorkbenchPanel` / `RIGHT_ACTIVITIES`, not revive old tabs. |
| Screenshot source | Screenshot production and identity | Browser preview evidence is the strongest backend screenshot evidence path, but it lacks agent/session identity. Message/tool attachments carry agent identity and already represent images that appeared in transcript. |
| Resource lifecycle | Memory, object URLs, list size | Do not record live frames or keep base64. Reuse `fetchResourceAsObjectUrl` and `PreviewableImage`; the existing LRU cache owns object URL revocation. Bound and virtualize long lists. |
| Tests | Coverage and commands | Update mount/toolbar/static tests and add focused screenshot browser tests. Browser runner must use Node, not Bun, for Playwright tests. |

## Call Point Sweep

| Surface | Call point | Decision |
| --- | --- | --- |
| Right toolbar registry | `packages/overlay/src/main.tsx` `CenterWorkbenchPanel`, `CENTER_WORKBENCH_PANEL_ORDER`, `RIGHT_ACTIVITIES` | Add `screenshots` as a first-class right activity. |
| Workbench DOM | `packages/overlay/src/index.html` `centerWorkbench*` views | Add `centerWorkbenchScreenshots` and `solidScreenshotBrowserMount`. |
| Workbench view map | `packages/overlay/src/main.tsx` `getCenterWorkbenchViews()` | Add `screenshots` entry so open/close, resizing, and active state stay on the existing workbench path. |
| Screenshot identity | `packages/overlay/src/store/messages.ts` `messageStore.messages` | Derive the panel from current task transcript/timeline messages, not a new overlay store. |
| Agent grouping | `packages/overlay/src/utils/message.ts` `normalizeAgentRole`, `roleLabel` | Use the canonical role classifier and labels; no ad hoc agent-name rules. |
| Tool screenshots | `packages/overlay/src/components/InlineToolPart.tsx` metadata path `metadata.browser.screenshot.attachmentUrl` | Extract the same URL shape for the browser, keeping tool output rendering unchanged. |
| File images | `packages/overlay/src/components/FilePart.tsx` image parts | Extract image file parts only when they reference `/attachment/...`, which is backed by `.opencorvus`. |
| Image rendering | `packages/overlay/src/components/ImagePreview.tsx` `PreviewableImage` | Reuse shared thumbnail and modal preview path. |
| Auth and object URLs | `packages/overlay/src/services/api.ts` `fetchResourceAsObjectUrl` | Server-relative resources go through the existing LRU object URL cache; components must not revoke cached URLs. |
| Browser preview evidence | `packages/opencorvus/src/browser-preview/persist.ts` and routes | Do not force this into agent grouping in this round because evidence has task/target/viewport identity but no agent/session identity. Future backend work should add explicit operation/evidence agent ownership. |
| Live preview frames | `packages/overlay/src/components/BrowserPreviewPanel.tsx` live object URLs | Excluded from screenshot history; recording every live frame would leak resources and create false history. |

## Design

Add `ScreenshotBrowserPanel` as a right workbench panel. It reads `messageStore.messages`, scans image-bearing parts, groups them by canonical agent role, and renders bounded thumbnail rows with shared preview behavior.

Included sources:

- Message file parts whose MIME or URL indicates an image and whose URL is a stored `/attachment/...` reference.
- Tool parts whose `state.metadata.browser.screenshot.attachmentUrl` points at a stored `/attachment/...` screenshot.
- Nested tool attachments if present on a tool part, image typed, and backed by `/attachment/...`.

Excluded sources:

- Browser preview live frames, because they are transient operator frames.
- Backend `browser_preview_evidence` without message/agent linkage, because assigning an agent would be invented data.
- Any data copied from canvas/blob/base64 into a new history store.
- `data:image/...`, external image URLs, or any screenshot bytes embedded in message JSON or DB columns.

The component stores only lightweight derived metadata: IDs, role, timestamp, source URL, filename/title, and source message/tool IDs. It does not store bytes. Database rows may keep references needed to find an attachment, but never the image payload.

## Resource Rules

- Server-relative image URLs render through `PreviewableImage` and the existing resource cache.
- Only `/attachment/...` image references enter the screenshot browser. This keeps image bytes in `.opencorvus/runtime/blobs/attachments/` and prevents DB-resident `data:image` payloads from becoming accepted history.
- The accepted URL shape is exactly `/attachment/<projectID>/<name>`, with no nested path, query, hash, data URL, external URL, or other same-origin route.
- The screenshot panel derives and renders screenshot items only while the panel is active. Hidden workbench views must not prefetch thumbnails or materialize object URLs.
- No direct `URL.createObjectURL` in the screenshot browser.
- No direct `fetch`, `EventSource`, iframe, or MCP monitor URL in the component.
- Cap derived screenshot items before rendering. The first implementation keeps a 120-item display cap and sorts newest first.
- If this grows beyond the cap requirement later, use the existing `virtua/solid` pattern instead of rendering unbounded thumbnails.

## Tests

- Static structure: `acceptance-panel-mount.test.ts` must pin the new workbench view, mount, type union, toolbar entry, and view map.
- Focused component/source: new screenshot browser test must pin grouping by `normalizeAgentRole`, `PreviewableImage` reuse, no direct fetch/EventSource/iframe/object URL creation, and image-source extraction behavior.
- i18n: both locale files must define screenshot browser labels and empty text.
- Existing image preview tests continue to own modal preview behavior.

## Independent Review Feedback

Four read-only reviewers rechecked the implementation after the initial pass.

| Finding | Severity | Resolution |
| --- | --- | --- |
| Hidden `ScreenshotBrowserPanel` still derived all items and created thumbnail resources. | P2 | Gate item derivation on panel active state so hidden views do not prefetch object URLs. |
| `/attachment` URL check was too broad and could accept non-canonical paths. | P2 | Exact-match `/attachment/<projectID>/<name>` on the overlay side and tightened `AttachmentStore.nameFromUrl` on the backend side. |
| Tests did not cover same-origin non-attachment image paths, external browser evidence URLs, external tool attachments, or local storage regressions. | P1/P2 | Added negative cases for file/tool/browser evidence sources and source assertions for `localStorage` / `sessionStorage`. |
| `capture_overlay_screenshot` still returned `data:image/png;base64,...`. | P1 | Changed the screenshot producer to write bytes through `AttachmentStore` and return only `/attachment/...`. |
| `ControlMessageResult.attachments` accepted arbitrary URLs that could be persisted into `control_message.metadata`. | P1 | Split result attachments from input attachments: input can still carry ingress data URLs for task API materialization, while result attachments must be stored `/attachment/...` references. |
| Existing browser preview UI synthesized evidence IDs and timestamps when backend evidence was missing. | P1 | Removed the synthetic evidence ID and timestamp path; missing persisted evidence ID now surfaces as an error. |
| Existing browser preview candidate selection used first candidate as local fallback. | P2 | Removed first-candidate selection; backend-selected/current target candidates remain the only selected value. |
| Right activity active state had a stale `selectedRightActivity` signal beside `centerWorkbenchPanels`. | P1 | Removed the stale right-activity signal; right toolbar active state is now derived from `isRightActivityOpen`. |

## Non-Goals

- Do not implement Browser MCP operation persistence in this round.
- Do not infer agent ownership for browser preview evidence.
- Do not record or replay browser live frames.
- Do not create a second screenshot database or localStorage history.
- Do not add compatibility mappings from old right tabs.
