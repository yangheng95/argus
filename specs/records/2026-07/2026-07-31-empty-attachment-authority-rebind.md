# Empty Attachment Authority Rebind

## Recall

- User request: sending a conversation fails with API 500 on `coding/chat/session`, reporting that the project attachment store `.opencorvus/.r/b/a/.authority.json` belongs to another database authority.
- Acceptance criteria: identify the root cause, keep existing attachment database ownership protection, unblock sends for the observed empty attachment store, and verify with a non-UI positive storage contract test.
- Hard constraints: no fallback/double-source behavior; do not weaken non-empty attachment ownership; do not run or add UI automation; follow TDD for non-UI code; preserve unrelated working-tree changes.
- Sources read: `packages/opencorvus/src/storage/attachment-store.ts`, `packages/opencorvus/test/storage/attachment-store-authority.test.ts`, `packages/opencorvus/src/storage/db.ts`, `packages/opencorvus/src/storage/database.sql.ts`, `packages/opencorvus/src/project/project.sql.ts`, `specs/README.md`.
- Whole-repository search evidence: `rg -n "Attachment store|authority\\.json|database authority|belongs to another|coding/chat/session|attachment store" -S packages` found the thrown error in `packages/opencorvus/src/storage/attachment-store.ts` and the existing storage authority test in `packages/opencorvus/test/storage/attachment-store-authority.test.ts`; `rg -n "DatabaseAuthorityTable|database_authority|ProjectTable|worktree" packages/opencorvus/src/storage packages/opencorvus/src/project -S` found database identity creation in `packages/opencorvus/src/storage/db.ts` and project worktree identity in `packages/opencorvus/src/project/project.ts`.
- Local evidence: current `opencorvus.db` has `database_authority.instance_id = 85857f1c-d331-4607-98cb-576a7b79859b`; the failing store authority file has `database_instance_id = 7d84c480-cf1f-455c-8002-4263c98c2378`; the same project row exists in the current database; the attachment directory currently contains only `.authority.json`; current part rows for the project contain no `/attachment/<project>/<sha>` references.
- Independent agent feedback: read-only audit agreed that the root cause is the authority marker database-instance mismatch; agreed that empty marker-only stores can be re-bound without weakening protection for stores with real content-addressed blobs; recommended the same storage test file and coverage. It noted one residual boundary: `listOnDisk` treats only `<sha>.<ext>` blobs as protected store contents, not orphan metadata-only files, which matches current attachment ownership semantics but may warrant separate cleanup if such residue appears.

## Diagnosis

`AttachmentStore.claimAuthority` compares the existing authority marker against the current project id, resolved worktree, and durable database identity. This is correct for a store that contains blobs, because accepting a different database would let the current database own bytes whose references may live only in another database.

The observed failure is narrower: the physical attachment store is empty except for a stale `.authority.json`. The current database still owns the project row and has no attachment references for that project, so there are no bytes to protect and no live reference graph to preserve. The stale marker blocks the first new attachment write during message send.

## Plan

1. Add a focused test to `packages/opencorvus/test/storage/attachment-store-authority.test.ts` that creates an empty store authority under one database identity, rebuilds the database, reprovides the same project directory, writes a new attachment, and asserts the new authority equals the current `Database.Identity()`.
2. Run that test before production edits and confirm it fails on the current strict mismatch.
3. Change `AttachmentStore.claimAuthority` so an authority mismatch is still fatal when the store contains attachment blobs, but an empty store may be re-claimed by the current database by replacing the stale marker.
4. Re-run the focused storage test and relevant doc-link verification after spec index updates.

## Verification

- `bun test packages/opencorvus/test/storage/attachment-store-authority.test.ts`
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
