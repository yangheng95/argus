# Composer Attachment Cardinality and Folder Reference

## Recall

| Item | Evidence |
| --- | --- |
| User requirement | OpenCorvus must accept no more than 10 uploaded files and no more than 3 folders. A selected folder must be referenced and displayed once as the folder itself; it must not be recursively expanded into every child file. The supplied screenshot shows the current failure mode: one folder selection created dozens of individual file chips. |
| Acceptance criteria | Every composer file ingress (file picker, drag, paste, and host attach) stops at 10 file references; native folder selection stops at 3 folder references; selecting one folder performs no recursive browser file enumeration or child upload and creates exactly one folder chip/reference; file and folder counts remain independent; removal restores capacity; submitted Chat, Mission, Task-create, and Task-follow-up messages retain one canonical folder reference; focused route, contract, Overlay, locale, type, docs, and real desktop screenshot checks pass. |
| Hard constraints | One attachment store and one composer store; no recursive directory enumeration, zip fallback, hidden/synthetic message, keyword routing, state machine, compatibility path, or intervention in the user's running OpenCorvus/Overlay. Folder choice uses the existing cross-host `workspace.pickDir` native capability. The backend validates the chosen filesystem path and stores one small canonical directory-reference manifest, not the directory contents. |
| Sources read | `AGENTS.md`; `packages/opencorvus/test/AGENTS.md`; browser control skill; `specs/current/architecture/02-data.md`; `specs/records/2026-07/2026-07-21-manual-attachment-index-ingress.md`; `ChatComposer.tsx`; attachment upload/store/routes; host transport, Tauri picker, VS Code transport; Task, Mission, Chat serializers; `UserUploadInput`; `Message.FilePart` provider projection; focused attachment and browser tests. |
| Whole-repository search evidence | Exact searches covered `ChatAttachment`, `StoredAttachmentReference`, every `setChatAttachments` writer, `UserUploadInput`, every `UserUploadInput.array()` route/schema, `AttachmentReference`, `attachment-index`, `webkitdirectory`, `webkitRelativePath`, folder picker capabilities, and Task attachment persistence/consumer call points. The only production recursive composer folder path is `ChatComposer.addFolderFiles`; file-picker, drag, paste, and host attach are the four file ingress paths. Chat, Mission, Task create/follow-up, and direct reply all converge on canonical attachment URLs. |
| Independent agent feedback | Not requested. This task is handled by the primary Codex agent without delegation. |

## Diagnosis

The previous attachment-ingress repair moved bytes out of browser state but kept
the browser directory input. `webkitdirectory` can only return a flattened list
of descendant `File` objects, so `addFolderFiles` necessarily uploads and renders
every child. A UI-only chip collapse would hide the fan-out while still indexing
every file, preserving the real defect.

The correct boundary is the existing native directory picker, which returns one
filesystem path. The server can validate that path once and persist a small
canonical manifest describing the directory reference. All downstream message
paths then carry the same one attachment URL already used for ordinary files.

## Call-Point Disposition

| Call point / sibling | Disposition |
| --- | --- |
| `ChatComposer` file picker, drag, paste | Apply the shared 10-file capacity before upload; preserve the existing binary upload route. |
| `composer-attach.ts` host attach | Apply the same shared 10-file capacity so editor-driven attachment cannot bypass the composer limit. |
| `ChatComposer` folder input / `addFolderFiles` / `folderAttachmentFilename` | Delete the recursive browser-file path. Invoke existing `workspace.pickDir` once and append one returned directory reference. |
| `workspace.pickDir` in transport protocol, Tauri, VS Code | Reuse unchanged as the single mature cross-host picker. Browser host remains explicitly unsupported rather than receiving a second emulated picker. |
| `POST /attachment` | Preserve for file bytes. Add one sibling directory-reference operation that validates a real directory and writes a single canonical JSON manifest without walking descendants. |
| `messageStore.chatAttachments` | Keep as the only composer source; store an explicit `kind` so file and folder limits/display never depend on filename or MIME guessing. |
| Chat / Mission / Task serializers | Preserve canonical URL transport; the folder manifest is one stored attachment reference and therefore needs no parallel message pipeline. |
| `UserUploadInput.array()` route/schema call points | Replace with one shared bounded list schema: at most 10 `kind=file` and 3 `kind=folder` inputs. |
| `Message.toModelMessages` index projection | Label the directory-reference MIME as a folder index while retaining the canonical URL; do not read or enumerate its contents. |
| Composer attachment strip | Render directory references with the existing folder icon and one chip per selected root; show independent file/folder capacity text. |

## Implementation Plan

1. Commit and push this plan as the pre-implementation checkpoint.
2. Define the shared file/folder cardinality and directory-reference MIME contract.
3. Add the validated directory-reference attachment endpoint and focused route tests proving it does not enumerate descendants.
4. Replace recursive folder input with native path selection, centralize composer capacity decisions, and cover file picker/drop/paste/host/folder paths with focused tests.
5. Carry explicit attachment kind through Chat, Mission, and Task inputs and enforce the shared bounded-list data contract at backend ingress.
6. Update index-only provider wording and the current data architecture.
7. Run focused tests, typecheck, route/OpenAPI, locale, docs health, build, and diff checks.
8. Launch an isolated Node-backed Overlay fixture, inspect goal-scoped desktop screenshots for 10 file chips plus 3 single folder chips and the over-limit error state, and iterate on visual defects.
9. Perform a second diff review, update this verification record, commit with the required `dsw-33987` prefix, fetch/reconcile git-cc, and push.

## Verification Record

- Focused Overlay/backend run: 138 passed, 0 failed across composer loader,
  canonical upload, capacity, host attach, Mission, Task create/follow-up,
  directory route, bounded upload schema, and prompt persistence suites.
- `bun test packages/opencorvus/test/session/message.test.ts -t "projects one indexed folder reference"`:
  1 passed, proving provider replay receives one folder index and not manifest
  contents or a recursive child inventory.
- `bun run typecheck`: 9 package typecheck tasks passed.
- `bun run api:routes-check`: 31 route files passed the route inventory.
- `bun run docs:check`: generated documentation matched 283 operations.
- `bun run overlay:i18n-check`: English/Chinese locale parity passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`:
  21 passed.
- `bun run --cwd packages/overlay build:vite`: fresh production bundle built.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-selector-browser.test.ts`:
  3 passed in the real built Overlay with the isolated Node HTTP fixture. The
  fixture recorded exactly three directory-reference requests and no child
  file paths. The rendered composer contained 13 cards: 10 files and exactly
  one card for each of `design-system`, `research-notes`, and
  `reference-assets`; its live count read `Files 10/10 · Folders 3/3`.
- Visual inspection of
  `.scratch/composer-bounded-files-whole-folders.png` confirmed a compact
  three-row desktop attachment strip, distinct folder icons, legible names,
  intact remove actions, and no recursive card waterfall.
- `git diff --check` passed.

## Codex Review Revision

The second review found two issues before delivery. First, an upload finishing
after another ingress had consumed the last slot could exceed the visual limit
despite both starts passing their initial check. File, folder, and host attach
paths now re-check capacity at the single store-append boundary, while the
backend bounded-list schema remains the durable request constraint. Second,
formatting the pre-existing browser file had changed unrelated test blocks;
those mechanical hunks were removed so the final browser diff contains only
the directory fixture, 10/3 assertions, screenshot, and the required current
`sessionAgentID` fixture field.
