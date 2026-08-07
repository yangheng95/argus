# Composer Pasted Image Byte Capture

## Recall

### User request

- Repair the Composer dialog failure shown after pasting `image.png`: `无法将 image.png 写入项目附件索引。`

### Acceptance

- Pasting an image into the enabled Composer captures its bytes while the clipboard event's temporary `File` is still readable.
- A directory-free global New Chat still creates and activates exactly one anonymous Project only after real attachment content exists.
- The captured bytes use the existing project-scoped attachment upload and produce one canonical `/attachment/<projectID>/<name>` reference in Composer state.
- File picker and drag/drop attachment ingress retain the same canonical upload behavior.
- No raw clipboard `File`, data URL, fallback store, compatibility route, or provider-context injection is introduced.
- Focused non-UI contracts, Overlay typecheck/build, and a real desktop paste interaction with screenshot inspection pass without restarting or refreshing the user's running OpenCorvus process.

### Hard constraints

- Preserve the canonical-reference-only Composer contract and strict project-scoped upload route.
- Preserve global New Chat lazy Project creation until the first real durable input.
- Do not add or run UI automated tests; UI acceptance uses a real isolated page, interaction, screenshot, and manual review.
- Preserve unrelated worktree changes.
- Do not restart, close, refresh, or otherwise interfere with the running OpenCorvus/Overlay process.

### Materials read

- `AGENTS.md`
- `CLAUDE.md`
- `specs/current/architecture/02-data.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/2026-07-21-manual-attachment-index-ingress.md`
- `specs/records/2026-07/2026-07-31-global-composer-attachment-project-boundary.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/services/attachment-upload.ts`
- `packages/overlay/src/services/api.ts`
- `packages/overlay/src/services/tauri-transport.ts`
- `packages/overlay/src/main.tsx`
- `packages/opencorvus/src/server/routes/attachment.ts`
- `packages/opencorvus/src/storage/attachment-store.ts`
- Focused attachment and workspace tests.

### Full-repository grep

Searches enumerated every `onPaste`, `ClipboardEvent`, `clipboardData`,
`uploadComposerFile`, `uploadComposerDataUrl`, `resolveAttachmentDirectory`,
`chooseAttachmentFilename`, `attachment-upload`, and attachment `POST` route
call site.

| Owner / call site                              | Evidence                                                                                                                               | Decision                                                                                                  |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `ChatComposer.handlePaste`                     | Reads `clipboardData.files`, prevents default text insertion, then awaits the shared file ingress.                                     | Keep the single paste entry and capture bytes before any Project activation wait.                         |
| `ChatComposer.addAttachment`                   | Chooses the filename, then currently awaits `resolveAttachmentDirectory()` before `uploadComposerFile()` invokes `file.arrayBuffer()`. | Detach MIME and bytes from the transient `File` first; only then activate/resolve the Project and upload. |
| `ChatComposer.handleDrop` and file picker      | Converge on the same `addFiles` / `addAttachment` path.                                                                                | Retain convergence and canonical upload semantics.                                                        |
| `attachment-upload.ts::uploadComposerFile`     | Owns both transient `File` reading and durable transport, so callers cannot control the required lifetime boundary.                    | Split byte capture from canonical byte upload; delete the old combined API rather than retain two paths.  |
| `attachment-upload.ts::uploadComposerDataUrl`  | Used for host-driven ingress and already converges on the same byte writer.                                                            | Keep it converged on the renamed byte-upload owner.                                                       |
| `main.tsx::resolveAttachmentDirectory`         | May allocate and activate an anonymous Project through asynchronous transport and workspace hydration.                                 | Keep unchanged; it must run after transient bytes are captured.                                           |
| `POST /attachment` and `AttachmentStore.write` | Accept raw bytes plus MIME/filename and return the canonical reference.                                                                | Keep unchanged; the failure is before this stable storage boundary.                                       |
| `attachment-upload.test.ts`                    | Verifies raw binary transport and canonical reference output.                                                                          | Rewrite against the split capture/upload contract and prove detached captured bytes remain uploadable.    |
| `workspace-active-directory.test.ts`           | Verifies Project activation precedes upload but currently creates/reads the `File` only after activation.                              | Capture bytes first, then resolve Project and upload, matching the production lifetime order.             |

### Independent review

- A session-local read-only reviewer was started against the bounded attachment paths.
- Claude Code CLI was also invoked as required, but its stream result was `is_error: true` with `authentication_failed` (`Not logged in`), so it produced no valid review evidence and is not counted as acceptance.

## Causal chain

The paste handler receives a real clipboard `File` named `image.png` → shared
attachment ingress waits for asynchronous global Project allocation/activation →
only afterward does `uploadComposerFile()` call `file.arrayBuffer()` → Windows
WebView2 no longer guarantees that the event-backed clipboard item is readable →
the read rejects before `POST /attachment` can store canonical bytes → the
Composer catches the concrete error and shows the generic attachment-index
failure dialog.

The July global-Project repair fixed the missing directory boundary, but its
real-page evidence used a file-input selection rather than a clipboard paste.
The resulting implementation therefore moved a new asynchronous Project wait
in front of clipboard byte materialization without validating the transient
clipboard lifetime.

## Implementation plan

1. Replace the combined `uploadComposerFile(File, ...)` API with one explicit
   transient-file capture function and one canonical byte-upload function.
2. In `ChatComposer.addAttachment`, capture MIME and bytes before resolving the
   attachment Project, then upload the detached bytes through the existing
   project-scoped transport.
3. Update focused non-UI tests to prove captured bytes survive beyond source
   lifetime and that global Project activation still precedes canonical upload.
4. Run focused tests, Overlay typecheck/build, locale/docs checks, and diff
   inspection.
5. Start an isolated real Overlay page, perform an actual clipboard image paste,
   inspect the rendered attachment chip and screenshot, then perform a second
   code review.
6. Commit with the `dsw-33987` prefix and push the final delivery to `myhexin`.

## Verification record

- `bun test packages/overlay/test/attachment-upload.test.ts
packages/overlay/test/workspace-active-directory.test.ts`: 31 non-UI
  contracts passed with 139 assertions. The new contract proves detached PNG
  bytes remain uploadable after the transient source becomes unreadable; the
  workspace contract captures bytes before anonymous Project activation and
  still observes Project allocation before `POST /attachment`.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed with 7,063 transformed
  modules. Existing third-party `use client` and chunk-size warnings remained
  non-fatal.
- `bun run overlay:i18n-check`: passed.
- `git diff --check`: passed after implementation.
- The documentation index contract relevant to the changed index passed:
  `bun test packages/opencorvus/test/script/historical-docs-links.test.ts -t
"root and July indexes publish readable five-client benchmark sources"`.
  The complete two-test file has one unrelated failure because the operator's
  pre-existing uncommitted benchmark-catalog rewrite renames the former
  `E01`–`N10` headings while the old catalog contract still expects them. That
  file and its test were preserved and excluded from this delivery.
- A fresh isolated server at `127.0.0.1:7899` used a task-specific
  `OPENCORVUS_HOME`. In a headed Chromium browser at 1,440 × 900, the review
  wrote the real `assets/readme-head.png` bytes to the browser clipboard as
  `image/png`, focused the Code Composer, and pressed `Ctrl+V`. The resulting
  page created one anonymous Project and displayed a removable `image.png`
  thumbnail with `Files 1/10 · Folders 0/3`; there were zero dialogs, console
  errors, or page errors. The screenshot
  `.scratch/composer-paste-visual-20260801/pasted-image.png` was inspected at
  original resolution and showed coherent attachment, Composer, toolbar, and
  suggestion-card layout. The isolated browser was closed, the exact listener
  was stopped by port, and port 7899 was verified free.
