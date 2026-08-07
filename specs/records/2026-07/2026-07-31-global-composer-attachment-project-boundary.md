# Global Composer Attachment Project Boundary

## Recall

### User request

- Repair the visible `附件上传失败` error raised when `image.png` is attached
  from the directory-free global New Chat composer.

### Acceptance

- Clicking New Chat, opening a picker, or cancelling a picker remains write-free.
- Selecting, dropping, or pasting a real file is durable input: exactly one
  anonymous Project is created and activated before the project-scoped
  attachment upload.
- Composer state contains only the canonical attachment reference returned by
  the server; browser memory never becomes a second raw-byte attachment store.
- A folder creates the Project only after the native picker returns a real path,
  then writes one canonical directory-reference manifest.
- Existing Project composers upload directly without allocating another Project.
- The first subsequent Chat, Work, or Mission submission reuses the activated
  Project and does not allocate a duplicate.
- Focused non-UI contracts, typecheck/build, and an isolated real-page screenshot
  pass without restarting or refreshing the user's running OpenCorvus process.

### Hard constraints

- Preserve the global New Chat lazy-persistence boundary for empty interaction.
- Preserve the architecture rule that manual attachment raw bytes enter
  project-scoped `POST /attachment` before submit and that the Composer stores
  canonical references only.
- Reuse the existing anonymous Project allocator and workspace activation path;
  do not add a Project identity, raw-byte staging union, fallback upload, route
  gate, or compatibility branch.
- Preserve all unrelated worktree changes and do not run UI automated tests.

### Materials read

- `AGENTS.md`
- `specs/current/architecture/02-data.md`
- `specs/records/2026-07/2026-07-21-manual-attachment-index-ingress.md`
- `specs/records/2026-07/2026-07-29-global-new-chat-lazy-project-persistence.md`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/services/attachment-upload.ts`
- `packages/overlay/src/services/workspace.ts`
- `packages/overlay/src/services/conversation-session.ts`
- `packages/overlay/src/main.tsx`
- Current sidecar log and immutable attachment-authority/Project database facts.

### Full-repository grep

Searches enumerated every `uploadComposerFile`,
`uploadComposerDirectoryReference`, `setChatAttachments`,
`createAnonymousProject`, `createGlobalMissionProject`,
`createGlobalConversationSession`, `selectConversationSession`, `/attachment`,
and `/global/projects/anonymous` call site.

| Owner / call site | Evidence | Decision |
| --- | --- | --- |
| `ChatComposer.addAttachment` | Captures an empty active directory in global New Chat and calls the strict uploader. | Resolve the durable Composer Project after a real file exists, then capture upload ownership and upload. |
| `ChatComposer.addFolder` | Captures the empty directory before the native picker. | Keep picker cancellation write-free; resolve the Project only after a path is returned. |
| `attachment-upload.ts` | Rejects an empty directory before transport and returns canonical references on success. | Keep strict and unchanged. |
| `messageStore.chatAttachments` | Canonical-reference-only browser source. | Keep unchanged; do not add raw `File`, bytes, data URL, or pending variants. |
| `workspace.createAnonymousProject` | Sole anonymous Project allocator. | Keep private and expose one shared Composer durable-input activation owner around it. |
| `workspace.createGlobalMissionProject` | Existing allocator plus selection-epoch validation and activation. | Generalize its name/contract for Mission and attachment durable input. |
| Global Chat/Work submit | Uses `/global/*` only while the active directory is empty. | Preserve; an attachment-created Project naturally selects the project-scoped Session route. |
| Mission submit | Allocates a Project only when the active directory is empty. | Reuse the generalized Composer Project owner. |
| Session selection attachment clear | Clears attachments on ordinary source switches. | Preserve; no pre-submit raw staging lifecycle is introduced. |

### Independent evidence

- Read-only runtime inspection found zero failing HTTP responses and no
  `/attachment` request around the incident. Both active attachment-store
  authority files matched their Project and database instance, proving that the
  failure happened before the backend storage boundary.
- Independent design review rejected client-side deferred raw-byte staging
  because it contradicts the canonical-reference-only Composer contract and
  creates a second attachment lifecycle.

## Causal chain

Directory-free New Chat is intentionally opened without a Project → the user
selects `image.png` → `ChatComposer` captures `activeProjectDirectory()` as an
empty string → `uploadComposerFile()` reaches the strict empty-directory check
before `apiJson()` → the Composer replaces the concrete exception with the
generic upload-failure dialog. The backend receives no request, and the healthy
attachment authority is unrelated to this incident.

The two existing contracts are both correct: an empty New Chat must not write,
and manual bytes must be written to a Project before entering Composer state.
The missing boundary is that selecting actual attachment content is itself the
first durable input. It must activate the canonical anonymous Project before
the existing strict upload.

## Implementation plan

1. Generalize the existing global Mission Project allocator into the single
   Composer durable-input Project resolver and make concurrent attachment
   ingresses share one allocation.
2. Inject that resolver into `ChatComposer`; resolve only after a real File or
   native folder path exists, then capture the post-activation upload owner.
3. Reuse the same resolver for Mission submission and leave the strict upload
   service, canonical reference store, and global Chat/Work submit routes intact.
4. Extend focused non-UI workspace/service tests with exact allocation,
   activation, and reuse contracts. Update current architecture wording.
5. Run focused non-UI tests, typecheck/build/docs health, inspect an isolated
   real-page screenshot, perform a second diff review, commit, and push.

## Verification record

- Read-only incident evidence: the screenshot window contained no
  `/attachment` request and no HTTP error; both live Project attachment
  authorities matched their database Project and database-instance ownership.
- `bun test packages/overlay/test/workspace-active-directory.test.ts
  packages/overlay/test/attachment-upload.test.ts`: 30 focused non-UI tests
  passed. The contracts prove empty/repeated New Chat remains write-free,
  concurrent durable inputs share one Project, Project activation precedes the
  canonical binary upload, and large file/directory reference ingress remains
  strict.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:vite`: passed with 7,062 transformed
  modules.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 2
  documentation-index contracts passed.
- A fresh isolated server at `127.0.0.1:7879` used a temporary
  `OPENCORVUS_HOME`. In the real built Overlay, clicking New Chat kept the
  directory-free heading; selecting tracked `assets/readme-head.png` then
  created exactly one visible anonymous Project and one removable image chip
  with `Files 1/10 · Folders 0/3`, without an error dialog. The inspected
  screenshot showed the Composer layout remained coherent. The isolated
  attachment store contained one 3,185,665-byte canonical PNG, its metadata
  sidecar, and the Project authority file.
- `git diff --check`: passed. A second code review confirmed the empty-directory
  rejection remains strict, the Composer store remains reference-only, folder
  cancellation stays write-free, post-activation ownership is recaptured, and
  unrelated concurrent worktree changes are excluded from this delivery.
