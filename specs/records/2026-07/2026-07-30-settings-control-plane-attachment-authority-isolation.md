# Settings Control Plane and Attachment Authority Isolation

## Recall

| Item | Details |
| --- | --- |
| User request | Repair the General Settings failure shown in the supplied screenshot: `GET /path` fails on AttachmentStore authority, while concurrent `GET /skill/mounts` and `GET /mcp` fail because their Instance cache entry changes during lifecycle-lease acquisition. |
| Acceptance criteria | General Settings path, Skill-mount, and Model Context Protocol (MCP) reads succeed for a registered project even when that project's pre-authority attachment directory cannot be claimed by the current Database; the attachment store remains strictly protected from foreign-database adoption or sweep; concurrent full-bootstrap callers receive the original bootstrap failure instead of cache-replacement noise; focused positive non-User Interface (UI) contracts, typecheck, document health, and live read-only route verification pass. |
| Hard constraints | Do not reset or mutate the live Database, create or delete an attachment marker, delete or move Prism blobs, restart/refresh/terminate the running Overlay, add a fallback or compatibility adoption path, weaken AttachmentStore authority, add a Host gate, create a worktree, touch unrelated dirty files, or add/run UI automation tests. Preserve all concurrent work. Commit task-owned paths with the `dsw-33987` prefix and push the current beta branch to `myhexin`. |
| Sources read | `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/02-data.md`; `specs/records/2026-07/2026-07-30-visual-qa-browser-preview-evidence-bridge.md`; `packages/opencorvus/src/storage/attachment-store.ts`; `packages/opencorvus/src/storage/db.ts`; `packages/opencorvus/src/project/instance.ts`; `packages/opencorvus/src/server/server.ts`; `packages/opencorvus/src/server/project-route-context.ts`; `packages/opencorvus/src/server/routes/app.ts`; `packages/opencorvus/src/server/routes/skill.ts`; `packages/opencorvus/src/server/routes/mcp.ts`; focused Instance, route-context, Skill-route, MCP, and AttachmentStore tests. |
| Whole-repository search evidence | `rg -n "Instance cache entry changed|Attachment store|lifecycle lease|authority\\.json|contains blobs|skill/mounts|mcp\\?directory" .`; `rg -n "Instance\\.provide|provideProjectIdentity|projectRouteUsesIdentityContext" packages/opencorvus/src packages/opencorvus/test`; `rg -n "AttachmentStore\\.sweep|attachment-store\\.sweep|claimAuthority|collectReferencedShas" packages/opencorvus/src packages/opencorvus/test specs`; `rg -n "describeRoute|\\.get\\(|\\.post\\(|\\.patch\\(|\\.delete\\(" packages/opencorvus/src/server/routes/{app,skill,mcp}.ts`; `git log` and `git blame` for the AttachmentStore authority introduction. |
| Independent agent feedback | No independent Agent was requested or used. The main Agent performed the call-point audit and live read-only incident reconstruction. |

## Live Evidence

- The running packaged server reports Database path
  `/Users/yangheng/.local/share/opencorvus/opencorvus.db`.
- Its durable Database instance ID was created on 2026-07-30 at 15:26 local
  time. The current Prism Project row is
  `1d7976b0321e8c998adb16bd63abd2dd0d908a5e`.
- Prism has nineteen PNG blobs under `.opencorvus/.r/b/a`; they were created on
  2026-07-28, before AttachmentStore `.authority.json` was introduced by
  commit `9464847cb4` on 2026-07-30.
- The authority marker is absent. The current Database has no durable
  `/attachment/1d7976.../<sha>.png` reference to those nineteen blobs.
  Automatically writing a marker or sweeping the directory would therefore be
  unsafe. The existing `AttachmentStoreAuthorityError` is the correct storage
  result.
- Every project-scoped request currently enters full `Instance.provide`
  bootstrap unless explicitly classified as identity-only. Full bootstrap
  invokes `AttachmentStore.sweep`, so unrelated Settings reads fail before
  their handlers run.
- When the first bootstrap owner fails, rollback deletes the cache entry.
  Already queued readers then pass through `assertEntryCurrent` and receive
  `Instance cache entry changed while acquiring its lifecycle lease` rather
  than the retained primary failure.

## Causal Chain

1. The attachment authority repair correctly made a missing marker plus
   unowned blobs an integrity error.
2. Generic project bootstrap still owns AttachmentStore garbage collection.
3. `/path`, `/skill/mounts`, and `/mcp` are Settings control-plane reads that
   need canonical Project identity and persisted configuration/package facts,
   but no attachment bytes, attachment mutation, Task runtime, watcher, or
   garbage collection.
4. Routing those reads through generic bootstrap unnecessarily couples their
   availability to AttachmentStore ownership.
5. The bootstrap rollback retains the primary error but cache-current
   validation throws a newly manufactured cache race before queued callers can
   observe it.
6. The visible result is one useful authority diagnostic followed by two
   misleading 500 errors, and an unusable General Settings surface.

## Call-Point Disposition

| Surface | Call points | Disposition |
| --- | --- | --- |
| Project request context | `server.ts`, `project-route-context.ts` | Add exact identity-context ownership for `GET /path`, `GET /skill/mounts`, and `GET /mcp`. Keep runtime, Task, attachment, VCS, and package lifecycle operations on full bootstrap. |
| Path read | inline `GET /path` in `routes/app.ts` | Preserve handler and response. `Instance.directory`, `Instance.worktree`, and Project identity are available in `provideProjectIdentity`. |
| Skill matrix read | `routes/skill.ts`, `skill/mounts.ts`, Overlay `loadSkillMountMatrix` | Preserve the canonical matrix and resolver. It reads persisted configuration, installed Skills, and package projections directly; it does not consume AttachmentStore. |
| MCP status read | `routes/mcp.ts`, `mcp/index.ts`, Overlay `loadMcpStatus` | Preserve status semantics. It reads configured/live MCP ownership and does not consume AttachmentStore. Mutating/connect/auth routes remain unchanged. |
| Full Instance rollback | `project/instance.ts::assertEntryCurrent`, `rollbackContextTransaction`, `retryRollbackCleanup`, all `Instance.provide` callers | If a replaced entry retained a primary failure, report that same failure to queued owners. A replacement without a retained failure remains an explicit cache-ownership error. |
| Attachment ownership | `storage/attachment-store.ts::claimAuthority`, `write`, `sweep` | No weakening, automatic adoption, marker write, blob deletion, or fallback. |
| Tests | `project-route-context.test.ts`, `instance-cache.test.ts`, focused server route contracts | Add positive results for the three exact Settings reads and shared primary-failure propagation. Remove touched negative route assertions and cache-call non-occurrence assertions. |

## Implementation

1. Extend the existing exact identity-context route set with the three read-only
   Settings endpoints.
2. Change cache-current validation to prefer the entry's retained bootstrap
   failure when rollback replaced the entry.
3. Add a real server contract that creates a pre-marker non-empty attachment
   directory and proves the three exact Settings requests return their normal
   positive payloads without touching the directory.
4. Update the concurrent rollback contract so the failing owner and queued
   owners all receive the same primary lifecycle error, followed by a
   successful clean retry.
5. Keep AttachmentStore authority code and the live Prism directory unchanged.

## Verification

- `bun test test/project/instance-cache.test.ts --timeout 120000`: 38
  passed. The changed concurrent rollback contract proves the failing owner,
  queued reader, and queued writer receive the same primary Error, then a
  clean retry succeeds.
- `bun test test/server/project-route-context.test.ts
  test/server/settings-control-plane-routes.test.ts
  test/storage/attachment-store-authority.test.ts --timeout 120000`: 4
  passed. The real Server application returned 200 and canonical payloads for
  all three Settings reads while a pre-marker attachment blob existed; the
  separate Database-authority contract retained strict cross-Database
  rejection.
- `bun run typecheck` in `packages/opencorvus`: passed.
- Historical document links, document health, and product-doc single-source:
  72 passed.
- `git diff --check`: passed.
- The first root-level test invocation did not enter the checker because an
  unrelated staged deletion removed `test-preload.ts` while root
  `bunfig.toml` still names it. Running from `packages/opencorvus` used the
  package's canonical `test/preload.ts` and completed the real checker without
  restoring or changing the concurrent deletion.
- Read-only calls against the running packaged server may continue to show the
  old binary's failure until a future approved restart installs the new build;
  this task will not restart it.
