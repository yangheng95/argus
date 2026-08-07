# Attachment Authority Runtime Isolation

## Recall

| Item | Details |
| --- | --- |
| User request | Explain why `@squad("base")` could not be sent, delete the reported `.authority.json`, and prevent the same class of failure from blocking messages again. |
| Acceptance criteria | A foreign Database attachment authority keeps attachment mutation and garbage collection closed, while text-only Project runtime, Expert Squad catalog, Mission Skill catalog, and Chat capability reads remain available; the exact Composer pre-submit catalog no longer becomes empty because attachment sweeping failed; focused non-User Interface (UI) contracts, typecheck, document health, live route evidence, review, commit, and git-cc push succeed. |
| Hard constraints | Do not adopt, rewrite, delete, or sweep foreign blobs; do not reset the Database; do not add fallback, compatibility, gate, state-machine, or UI automation test behavior; preserve unrelated files; use the current DDL (Data Definition Language, data definition language) only; commit subjects start with `dsw-33987`. |
| Sources read | `AGENTS.md`; `specs/current/architecture/02-data.md`; `specs/current/architecture/99-principles.md`; `specs/records/2026-07/2026-07-30-settings-control-plane-attachment-authority-isolation.md`; deleted pre-August record `2026-07-31-empty-attachment-authority-rebind`; `packages/opencorvus/src/storage/attachment-store.ts`; `packages/opencorvus/src/project/instance.ts`; `packages/opencorvus/src/project/open-lifecycle.ts`; `packages/opencorvus/src/server/project-route-context.ts`; Composer catalog and submit services; focused storage, project lifecycle, and Settings route tests. |
| Whole-repository search evidence | `rg -n "AttachmentStoreAuthority|database authority|database_instance_id|\\.authority\\.json|assertAuthority|attachment-store\\.sweep" packages specs`; `rg -n "AttachmentStore\\.sweep|claimAuthority|AttachmentStore\\.write|AttachmentStore\\.read" packages/opencorvus/src packages/opencorvus/test`; `rg -n "composer-references|mentionCatalog|resolveComposerMentionDirectives|unknown_squad" packages/overlay packages/opencorvus`; Git history and blame show empty-store rebinding existed only on another non-ancestor branch and cannot solve the observed non-empty store. |
| Live evidence | The packaged server logged `/expert-squad/catalog`, `/mission-skill/catalog`, and `/chat/capability` HTTP (Hypertext Transfer Protocol) 500 responses because `C:\\Users\\hengu\\Downloads\\prism\\.opencorvus\\.r\\b\\a\\.authority.json` belonged to another Database instance. Overlay then logged `Reference catalog unavailable for composer`; pre-submit validation rejected `@squad("base")`. The global catalog independently returned `base`, `advanced`, and `research-studio`, proving `base` was installed. After the user-authorized marker deletion, the physical store still contained nineteen PNG (Portable Network Graphics) blobs and nineteen metadata sidecars, so automatic adoption remains unsafe. |
| Independent agent feedback | No independent Agent was requested or used. |

## Causal chain

1. `AttachmentStore.sweep` correctly calls `claimAuthority` before examining or deleting blobs.
2. Generic `Instance` bootstrap runs that sweep before every full Project runtime becomes usable.
3. A foreign authority therefore aborts the whole runtime even when the requested operation does not read or mutate attachments.
4. Composer reference reconciliation receives three HTTP 500 results, replaces its scoped Expert Squad list with an empty list, and rejects the otherwise valid `base` directive before submission.
5. Route-by-route identity-context exemptions reduced earlier Settings impact but left every new full-runtime surface vulnerable. The storage constraint is still incorrectly acting as a Project/Agent flow gate.

## Design

- Keep `AttachmentStore.claimAuthority`, `write`, and `sweep` strict. A non-empty foreign store remains inaccessible to the current Database and no marker is rewritten.
- Serialize authority reads and marker publication with the repository's existing `proper-lockfile` cross-process lease; publish an empty-store rebind through the canonical atomic filesystem writer so two Database processes cannot overwrite each other's claim.
- Treat only the typed `AttachmentStore.AuthorityError` from bootstrap-time maintenance as an isolated storage subsystem diagnostic. Record it visibly and continue generic Project bootstrap.
- Preserve propagation for all other sweep failures. Disk, permission, programming, and unknown maintenance errors still fail bootstrap rather than being hidden.
- Do not enumerate more identity-only routes. One storage boundary fixes current and future Project runtime consumers without a growing route allowlist.

## Implementation plan

1. Add a focused positive server contract that creates an attachment under one Database identity, rebuilds the isolated test Database, and proves the exact Composer reference routes return their canonical payloads under the replacement identity.
2. Update the storage authority contract to prove generic Project runtime opens while `claimAuthority` still returns the typed foreign-authority error and preserves the original bytes.
3. Isolate the typed authority error around bootstrap-time sweep, retain lifecycle failure evidence, and emit one explicit runtime-isolation warning.
4. Update current data architecture and the obsolete project-open stage expectation.
5. Run focused contracts, production typecheck, required documentation checks, and read-only live route verification; then perform a second diff review, commit, and push `v0.0.29beta` to `git-cc`.

## Verification

- `bun test test/project/instance-cache.test.ts test/project/open-lifecycle.test.ts test/storage/attachment-store-authority.test.ts test/server/composer-reference-attachment-authority-isolation.test.ts --timeout 120000`: 45 passed with 182 assertions. The exact Composer reference routes returned canonical payloads under a non-empty foreign authority; storage authority remained closed; cross-process-leased empty-store rebinding, unknown sweep-failure propagation, replacement runtime recovery, and explicit runtime disposal all passed.
- `bun run typecheck` in `packages/opencorvus`: passed.
- `bun test test/script/historical-docs-links.test.ts test/script/product-docs-single-source.test.ts test/script/document-health.test.ts --timeout 120000`: 70 passed with 1,188 assertions after exact task staging. The earlier pre-staging failure was limited to README-linked records not yet present in the Git index.
- `git diff --check`: passed.
- A source server on `127.0.0.1:7878` against the real Prism directory returned HTTP 200 for `/expert-squad/catalog`, `/mission-skill/catalog`, and `/chat/capability`; the Expert Squad response contained `base`. The user-authorized marker remained absent and all nineteen PNG blobs remained present, proving bootstrap neither adopted nor deleted the foreign store.
