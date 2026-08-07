# Manual Attachment Index Ingress

## Recall

| Item                             | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement                 | Manually uploaded files and folders must not be injected directly into conversation context; the conversation must receive index references instead. The supplied screenshot shows a folder upload failing with `Attachment too large` / `Could not read ... — skipping this file.`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Acceptance criteria              | File picker, folder picker, drag, paste, and host-driven composer attachments are stored in the canonical project `AttachmentStore` before submit; composer, Chat, Mission, Task create, and Task follow-up payloads carry `/attachment/<projectID>/<name>` references instead of browser data URLs; no manually uploaded image, PDF, audio, video, text, or archive bytes are converted into provider conversation context; large uploads are not rejected by the retired 10 MiB per-file / 32 MiB aggregate base64-context limits; visible attachment chips and removal remain usable; focused route, persistence, provider-adaptation, Overlay, type, docs, and real desktop screenshot checks pass.                                                                                                                                                                                                                            |
| Hard constraints                 | One canonical byte source in `.opencorvus/.r/b/a/`; no fallback data-URL composer path, no second attachment store, no prompt keyword routing, no workflow gate, no hidden/synthetic message, no process restart or refresh of the user's running OpenCorvus/Overlay; preserve unrelated worktree changes; use the existing HostTransport binary request path and AttachmentStore rather than a hand-written host-specific uploader.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Sources read                     | `AGENTS.md`; `packages/opencorvus/test/AGENTS.md`; `specs/current/architecture/02-data.md`; `specs/current/architecture/15-agent-facts-and-turns.md`; `specs/records/2026-07/2026-07-08-composer-file-loader-right-toolbar-hover.md`; `specs/records/2026-07/2026-07-09-mission-composer-attachments.md`; `specs/records/2026-07/2026-07-15-composer-attachment-session-origin-repair.md`; `specs/records/2026-07/2026-07-16-attachment-request-body-separation.md`; `packages/overlay/src/components/ChatComposer.tsx`; Overlay attachment/chat/task/mission/transport services; `packages/opencorvus/src/server/routes/attachment.ts`; `packages/opencorvus/src/storage/attachment-store.ts`; `packages/opencorvus/src/engine/model.ts`; `packages/opencorvus/src/task-api/index.ts`; `packages/opencorvus/src/server/routes/mission.ts`; `packages/opencorvus/src/session/{prompt/parts,message}.ts`; relevant attachment tests. |
| Whole-repository search evidence | Searches covered the exact dialog strings, `FileReader` / `fileToDataUrl`, both size-limit constants, every composer attachment store writer, `panelMessage`, `createTask`, `wakeMission`, `TaskAttachmentInput`, `MissionWakeAttachmentInput`, `decodeApiAttachments`, AttachmentStore reference validators, `Message.toModelMessages`, and `inlineFileParts`. The interactive composer is the only production consumer of `fileToDataUrl`; `services/chat.ts::addChatAttachment` has no production caller; file and folder picker paths converge at `ChatComposer.addAttachment`; task create/follow-up and Mission currently turn the composer URL back into a `data` field; standalone Chat persists the URL as a file part; provider replay indexes only canonical text attachments while still materializing capable binary attachments.                                                                                     |
| Independent agent feedback       | Not requested. The task is handled by the primary Codex agent without delegation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Diagnosis

The visible size/read error is an ingress architecture defect, not a provider
size setting:

1. `ChatComposer.addAttachment` reads every selected file completely through
   `FileReader.readAsDataURL` before it can enter the composer store.
2. The browser stores those base64 data URLs in `messageStore.chatAttachments`
   and enforces 10 MiB per-file plus 32 MiB aggregate limits because the bytes
   are retained in UI memory and JSON request bodies.
3. Task and Mission submitters strip the data-URL prefix and send base64 again;
   standalone Chat sends the data URL as a session file part. Only then does
   `SessionPrompt` or `EngineService` write the bytes into `AttachmentStore`.
4. `Message.toModelMessages` already converts canonical text attachments into a
   concise reference, but still reads canonical image/PDF bytes and injects them
   into capable provider requests. Therefore "text uses an index" is not the
   same contract as "manual uploads use an index".
5. Folder selection is not a distinct transport: it loops the same per-file
   data-URL path, so one unreadable/oversized member is skipped and the folder
   inventory becomes incomplete.

The root cause is that durable attachment materialization happens after the
composer/context boundary. The repair moves materialization to ingress and
makes the resulting canonical reference the only value carried by later
conversation/task APIs.

## Call-Point Disposition

| Call point / sibling                                                                    | Current behavior                                                             | Disposition                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ChatComposer.addAttachment`, file/folder/drop/paste callers                            | Reads a data URL and applies base64-size limits.                             | Replace with one project-scoped binary upload service; keep every input path converged.                                                                                                                                                     |
| `messageStore.chatAttachments`                                                          | Holds `{ mime, data-url, filename }`.                                        | Hold canonical reference metadata only.                                                                                                                                                                                                     |
| `composer-attach.ts` host command                                                       | Adds a host-provided data URL directly.                                      | Decode only at ingress, upload through the same service, then store the returned reference.                                                                                                                                                 |
| `file-to-data-url.ts`, `chat-attach-limits.ts`, and unused `chat.ts::addChatAttachment` | Express the retired browser/base64 contract.                                 | Delete after all call sites are replaced; no compatibility path remains.                                                                                                                                                                    |
| `sessionPromptParts`                                                                    | Accepts file URLs and already works with canonical refs.                     | Preserve; it receives refs from the composer.                                                                                                                                                                                               |
| Overlay Task create/follow-up and Mission wake serializers                              | Re-encode composer URLs into base64 `data`.                                  | Send the canonical reference form without reading bytes again.                                                                                                                                                                              |
| `TaskAttachmentInput` and task materialization                                          | Accept base64-only public ingress and always rewrite bytes.                  | Add an explicit stored-reference variant and converge both variants in one canonical materializer that validates project ownership and metadata. Base64 remains the API ingress for channel/tool callers that do not own an upload session. |
| `MissionWakeAttachmentInput` / `missionWakeAttachmentParts`                             | Accept base64-only and synthesize data URLs.                                 | Accept the same explicit stored-reference variant and validate it before persisting the canonical file part.                                                                                                                                |
| `Message.toModelMessages` user file branch                                              | Canonical text is indexed; capable image/PDF bytes are injected.             | Represent manual uploads carrying `presentation="attachment-index"` as one concise index row for every MIME; retain programmatic typed evidence and noncanonical explicit local/external file behavior.                                     |
| `AttachmentStore.inlineFileParts`                                                       | Explicit agent/tool utility, not called by the composer/session replay path. | Preserve; semantic workers may explicitly inspect selected evidence through typed contracts.                                                                                                                                                |
| `AttachmentRoutes` GET                                                                  | Serves canonical bytes.                                                      | Add the project-scoped POST ingress alongside the canonical GET owner.                                                                                                                                                                      |

## Implementation Plan

1. Land and push this evidence-backed plan as the pre-implementation checkpoint.
2. Add a project-scoped binary attachment upload route and a single Overlay
   upload service returning canonical reference metadata.
3. Replace composer file/folder/drop/paste and host-attach staging with the
   reference upload service; remove data-URL limits and obsolete helpers.
4. Extend Task and Mission ingress schemas with a strict stored-reference
   variant, validate current-project ownership/canonical metadata, and pass refs
   through without rewriting bytes.
5. Mark manual user file parts with the explicit `attachment-index` presentation
   contract and make those parts index-only at provider replay for every MIME.
6. Update the current data architecture and add focused positive/negative tests
   for upload, project isolation, payload mapping, persistence, and provider
   adaptation.
7. Run focused tests, OpenCorvus/Overlay typechecks, route/OpenAPI checks, docs
   health tests, and `git diff --check`; then use an isolated Node-launched
   browser fixture to inspect a goal-scoped desktop screenshot without touching
   the running application.
8. Perform a second diff review, record verification evidence here, commit with
   the `dsw-33987` prefix, fetch/reconcile legacy remote, and push the delivery commit.

## Verification Record

- `bun test packages/overlay/test/attachment-upload.test.ts packages/overlay/test/composer-attach-store-integration.test.ts packages/overlay/test/composer-file-loader-right-dock.test.ts packages/overlay/test/mission-launcher-component.test.ts packages/overlay/test/mission-service-actions.test.ts`: 49 passed, 0 failed. This covers raw binary ingress, payloads above the retired 10 MiB limit, canonical-reference-only store state, shared upload blocking, Mission reference transport, and removal of the browser data-URL path.
- The five-file backend run executed 108 tests. Every new attachment route, Mission, Task, provider-adaptation, and indexed-prompt assertion passed; five unrelated prompt fixture cases failed during temporary-repository `ensureGitignore` bootstrap. Three runs returned a bare `git commit failed`, while two reported that the Windows process supervisor exited before its ready marker became observable; the shared deeper cause is not proven. A clean attachment-specific rerun, `bun test packages/opencorvus/test/session/prompt.test.ts -t "materializes an indexed manual upload|retains and validates an already-uploaded indexed reference"`, passed 2/2. The mixed-run infrastructure failure is recorded rather than presented as an attachment regression or a clean full-suite pass.
- `bun run typecheck`: 9 package typecheck tasks passed, 0 failed.
- `bun run api:routes-check`: route inventory passed across 31 route files.
- `bun run docs:check`: generated API documentation matched 282 operations in 23 groups.
- `bun run overlay:i18n-check`: locale parity passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 21 passed, 0 failed.
- `bun run --cwd packages/overlay build:vite`: the fresh production Overlay bundle built successfully before visual inspection.
- Real desktop rendering was inspected at 1440 x 900 through the in-app Browser against the fresh bundle and an isolated local response fixture; this is visual verification, not claimed as backend end-to-end validation. During upload, `.scratch/manual-attachment-index-ingress/uploading.png` shows the visible `Indexing 1 attachment(s)…` status and a disabled Send action without an error dialog. After completion, `.scratch/manual-attachment-index-ingress/indexed.png` shows a removable canonical file-index chip. Folder selection of `world-economy-design-v3` produced two indexed child entries with their folder provenance preserved, recorded in `.scratch/manual-attachment-index-ingress/folder-indexed.png`; the final Send action was enabled and no `Attachment too large` / skipped-file dialog appeared.
- After fetching legacy remote, the branch merged `legacy-remote/v0.0.12beta` at `b844a3c41`. The merged tree passed `bun run typecheck` (9/9), the eight attachment-specific backend regressions (8/8), the Overlay-focused suite (49/49), route inventory, generated-doc consistency, locale parity, and `git diff --check`.

## Codex Review Revision

The implementation review found that a rule based only on canonical
`/attachment/...` shape was too broad: programmatic Build or tool evidence can
use the same storage URL and still require typed multimodal provider input.
The design was therefore revised before delivery to persist the explicit
per-file `presentation="attachment-index"` contract only on manual ingress.
Provider replay now distinguishes user intent by that durable field rather than
guessing from URL, MIME, filename, or session kind.

The same review also caught a content-addressing edge case: identical bytes may
be uploaded again under a different display filename, while the blob metadata
sidecar retains the first filename. Filename is provenance rather than byte
identity, so stored-reference validation now verifies project, URL, MIME, size,
and readable bytes, then preserves the caller's current display filename on the
message/task reference. This matches the existing architecture rule and avoids
rejecting legitimate duplicate-content files in a folder upload.

## 2026-07-24 Follow-up: Conversation Image Attachment Presentation

### Recall

| Field | Evidence |
| --- | --- |
| User requirement | Images added while chatting must render as a compact thumbnail strip above the user's text bubble, matching the supplied reference; every thumbnail must open the existing enlarged image viewer. Image attachments staged above the composer must also be clickable. |
| Acceptance criteria | A user message containing one or more image file parts shows those images in one right-aligned thumbnail strip before the text surface; the same file parts are not rendered again as large inline images; each message thumbnail and each pending composer image opens the shared image-preview dialog; non-image attachments, agent/tool images, markdown images, attachment removal, and submission keep their existing behavior; keyboard focus exposes the same preview action; focused tests, type/build checks, and a real desktop screenshot/click review pass. |
| Hard constraints | Reuse `PreviewableImage`, `ImagePreviewHost`, the canonical authenticated resource loader, attachment references, shared Button primitives, and the existing stored-image thumbnail variant; do not create a second lightbox, preview store, attachment URL source, handwritten dialog, fallback path, hidden message, mobile scope, or process restart/refresh of the user's running OpenCorvus/Overlay. Preserve unrelated worktree changes and do not claim or overwrite them. |
| Sources read | `AGENTS.md`; browser-control skill; `packages/opencorvus/test/AGENTS.md`; this attachment-ingress record; `2026-07-23-composer-work-placeholder.md`; `ChatComposer.tsx`; `ChatBubble.tsx`; `CardParts.tsx`; `FilePart.tsx`; `ImagePreview.tsx`; `App.tsx`; `services/image-preview.ts`; `services/api.ts`; `styles/surfaces/{composer,chat-bubble,messages}.css`; `styles/surfaces/markdown.css`; attachment, chat-bubble, and image-preview tests. |
| Whole-repository search evidence | `ChatComposer.ComposerAttachmentThumbnail` is the only pending composer-image renderer and currently emits a plain `<img>`; `FilePart` is the only persisted file-part renderer and already owns MIME/URL/auth handling through `PreviewableImage`; production `FilePart` consumers are `CardParts`, `InlineToolPart`, `TaskDirBar`, and interactive media/notebook artifacts; `CardParts` is the only flattened conversation-part dispatcher; `ChatBubble` is the only owner of the user text surface; `ImagePreviewHost` is mounted once in `App`; markdown, browser evidence, screenshot browser, and persisted message images already converge on `PreviewableImage`. |
| Independent agent feedback | Not requested by the user; no sub-agent was delegated. |

### Diagnosis

The shared enlarged viewer is already complete. The presentation gap comes
from two call sites bypassing or underusing it:

1. the composer thumbnail is a plain image inside the removable attachment
   chip, so it has no preview trigger; and
2. persisted user image file parts enter the generic chronological
   `CardParts` renderer, so `FilePart` displays them at normal message-image
   dimensions inside the text surface.

The repair must therefore change presentation ownership, not attachment
storage or preview state. `FilePart` remains the sole renderer for persisted
file URLs and gains a thumbnail presentation variant. `ChatBubble` partitions
only user-role image file parts from the user's remaining parts and renders
those images before the text surface. All non-user consumers keep the default
`FilePart` presentation.

### Call-point Decisions

| Call point | Decision |
| --- | --- |
| `ChatComposer.ComposerAttachmentThumbnail` | Replace the plain image with `PreviewableImage`; load the stored thumbnail for the chip and the original authenticated object URL when the preview opens. |
| `FilePart` image classification and authenticated loader | Export one image-file predicate and add an explicit thumbnail presentation; retain the default large content presentation for every existing caller. |
| `ChatBubble` user body | Partition image file parts from the user's remaining parts, render one thumbnail strip before the text surface, and pass only remaining parts to `CardParts`. |
| `CardParts` | Preserve as the sole chronological renderer for all non-hoisted parts; do not add a second part dispatcher. |
| `InlineToolPart`, `TaskDirBar`, media/notebook artifacts | Keep default `FilePart` presentation unchanged. |
| `ImagePreview`, `services/image-preview`, `App` host | Reuse unchanged as the single preview state and modal owner. |
| Focused tests | Extend the image-preview contract for composer and user-message thumbnail reuse; add browser evidence for layout order, deduplication, focusability, and opening the shared dialog from both surfaces. |

### Verification Plan

1. Run focused Overlay tests for image preview, chat bubbles, attachment upload,
   and composer contracts.
2. Run Overlay typecheck, locale parity, production Vite build, and diff check.
3. Launch an isolated Overlay target with Node, render a desktop user message
   with several image attachments plus a pending composer image, click and
   keyboard-focus both preview triggers, and capture task-scoped screenshots.
4. Inspect screenshots at original resolution, correct visual mismatches,
   repeat the browser check, then perform a second diff review.

### Verification Record

- Focused image-preview, Chat bubble, and role tests passed: 23 tests, 431
  assertions, 0 failures.
- Attachment upload and composer attachment-capacity regressions passed,
  including the raw-binary upload above the retired 10 MiB limit.
- The Node-launched real Overlay browser test
  `conversation-image-attachments-browser.test.ts` passed. It verified two
  user image file parts render once in a right-aligned strip before the text
  surface; each thumbnail is a focusable Button; the first thumbnail opens the
  shared `ImagePreviewHost`; an actual composer file-input change uploads a
  canonical reference; the pending composer thumbnail remains next to its file
  name and remove action; and clicking it opens the same preview dialog.
- The fresh production Vite build passed (4,952 modules transformed). Locale
  parity passed. Historical docs link/placement health passed 21/21.
- Original-resolution visual evidence was inspected at 1440 x 900:
  `.scratch/conversation-image-attachments/message-and-composer-thumbnails.png`
  and
  `.scratch/conversation-image-attachments/composer-image-dialog.png`.
  The message strip follows the reference hierarchy and density, the text stays
  in its own compact surface, and the preview dialog exposes the existing zoom,
  width-fit, whole-image fit, original-size, and copy controls.
- Full Overlay typecheck remains blocked by pre-existing dirty-worktree errors
  in the newly added interactive-artifact renderers and a missing
  `artifact_missing` terminal projection. None of the reported errors points to
  `ChatBubble`, `ChatComposer`, `FilePart`, or the changed styles/tests.
- Two broad existing tests remain red for unrelated staged work:
  `browser-error-collector.test.ts` still names the already-renamed
  `agent-summary-card-browser.test.ts`, and
  `composer-file-loader-right-dock.test.ts` still expects the retired
  `SelectControl` composer intent while the staged product code uses the
  current dropdown. These failures are recorded rather than folded into this
  image change.

### Codex Second Review

The review confirmed one preview source and one persisted file renderer remain:
`PreviewableImage` owns both click paths, `ImagePreviewHost` remains the only
modal state, and `FilePart` remains the only authenticated message-file byte
loader. The user-only partition removes image file parts from the body before
rendering the thumbnail strip, so the same attachment cannot appear both above
and inside the text surface. Default `FilePart` rendering is unchanged for
agent/tool evidence, Task directory views, markdown images, and interactive
artifacts.

No visual correction was required after inspecting the generated screenshots.
Before delivery, the repository was rechecked with `git ls-files -u` and
`git diff --name-only --diff-filter=U`; both returned no paths. The current
branch and `legacy-remote/work-v0.0.17beta-yr-0723` also resolve to the same commit.
Only the image-presentation files and the corresponding test hunks may enter
the delivery commit; the remaining dirty-worktree files belong to other
in-progress changes and stay untouched.
