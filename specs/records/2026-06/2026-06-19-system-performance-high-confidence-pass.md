# System Performance High Confidence Pass

Date: 2026-06-19
Status: Implemented

## Acronyms

- API: Application Programming Interface, the HTTP surface served by OpenCorvus.
- UI: User Interface, the visible overlay application.
- DB: Database, the SQLite persistence layer used by OpenCorvus.
- SSE: Server-Sent Events, the streaming update channel used by the overlay.
- LRU: Least Recently Used, a bounded cache eviction policy.

## Goal

Systematically analyze inefficient code in `packages/opencorvus` and `packages/overlay`, then repair high-confidence performance defects without changing feature semantics. Running processes must not be restarted; source fixes take effect on the next use after normal rebuild/restart.

## Acceptance

- No process restart, sidecar restart, or overlay reload is performed by this pass.
- Each code change preserves existing response shapes and user-visible behavior.
- No fallback, compatibility alias, gate, or stale-cache masking is introduced.
- Every changed behavior has a focused regression test or benchmark-style source assertion.
- Focused tests and package typechecks pass before commit.
- Benchmark/review evidence records both fixed and deferred performance candidates.

## Recall

| Source                                                          | Constraint carried forward                                                                                                                                                   |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `specs/records/2026-06/2026-06-19-overlay-diff-poll-pressure.md`       | Port 7878 pressure came from repeated overlay acceptance-diff fetches plus INFO-level scheduler tick logging; those were already repaired in commit `625a1ec1e2`.            |
| `specs/records/2026-06/2026-06-06-overlay-live-efficiency-safe-fix.md` | Selected task message SSE handling must remain incremental. Conversation tail hydrate may be bounded, but selected stream semantics must not be replaced by broad refreshes. |
| `specs/records/2026-06/2026-06-15-gui-benchmark-quality-audit.md`      | Benchmark timeouts must be inactivity-based; browser preview and overlay fixes need targeted evidence, not broad green typecheck alone.                                      |

## Candidate Inventory

| Candidate                                                                                                                        | Evidence                                                                                                                                                                                                                                                      | Decision                                                                                                                                                       |
| -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/task/:taskID/conversation/session/:sessionID` loads `loadFullTaskTranscript(taskID)` then filters one session.                 | `packages/opencorvus/src/server/routes/orchestrator.ts` calls `loadFullTaskTranscript(taskID)` in the session route even though `Session.messages({ sessionID })` can read one session directly.                                                              | Fix first. It preserves the exact route payload shape while eliminating reads of unrelated sessions.                                                           |
| `/task/:taskID/conversation/history` loads `loadFullTaskTranscript(taskID)` before slicing older history.                        | Same route file calls full transcript in the history route.                                                                                                                                                                                                   | Defer until a bounded-before-session reader is added; doing it correctly needs a query-level before cursor, not a lossy per-session latest tail.               |
| `/provider` returns a 3.7 MB provider catalog and computes defaults by sorting each provider's model list.                       | Live endpoint measurement showed 168-241 ms and 3.7 MB.                                                                                                                                                                                                       | Defer schema/payload trimming because it changes API contract. A later pass can add a single-pass default model helper if tests prove equivalence.             |
| `AttachmentStore.sweep(projectID)` scans all `part` and `engine_task` rows across every project.                                 | `packages/opencorvus/src/storage/attachment-store.ts::collectReferencedShas()` does unfiltered `.from(PartTable).all()` and `.from(EngineTaskTable).all()` even when sweep only needs one project. `Instance.provide()` calls sweep during project bootstrap. | Fix second. Preserve unscoped diagnostics while adding a scoped path for project sweep.                                                                        |
| `taskSummary()` scans the same task rows repeatedly.                                                                             | `task-api/index.ts` filters rows five times and sorts completed durations.                                                                                                                                                                                    | Low-risk but lower expected impact than conversation route IO. Consider after higher-impact fixes.                                                             |
| `taskItems()` performs per-task plan/run/evaluation/interaction/session queries.                                                 | `task-api/index.ts::taskItems()` calls store helpers inside a per-row map.                                                                                                                                                                                    | High potential impact, but requires batched store helpers and broader route tests; defer until after a narrow first fix.                                       |
| Overlay diff lazy loaders can issue duplicate acceptance requests for the same scope while the first request is still in flight. | `packages/overlay/src/services/diff.ts::fetchScopedDiffs()` checks only completed `diffCache` before calling `apiJson(...)`. `DiffPreviewPanel`, `FileChangesView`, and `ChangesPanel` can all request the same scoped diff before that cache is populated.   | Fix third. Add in-flight Promise coalescing keyed by the existing scope cache key; keep the current completed-cache rule that only non-empty diffs are cached. |
| Loaded conversation message normalization computes a full content signature even when `info.id` is present.                      | `packages/overlay/src/store/messages.ts::normalizeLoadedMessage()` calls `messageSignature(message)` before checking whether the server supplied a stable message id.                                                                                         | Fix fourth. Server ids are already the identity source, so only compute the expensive signature for id-less reconstructed messages.                            |

## First Fix Contract

Replace the session conversation route's full-task transcript read with a task-scoped single-session transcript reader:

1. Resolve the task root and child session IDs through the existing `taskSessionIDs(taskID)` authority.
2. Return an empty transcript when the requested `sessionID` is not in that task tree, matching the old full-task-filter result.
3. For an in-tree session, call `Session.messages({ sessionID })` directly and apply the same overlay metadata enrichment as `loadTaskTranscript()`.
4. Keep timeline/event/view/history response fields unchanged.
5. Add a regression test where a task has a large unrelated sibling session; the session route must return only the requested session and the source must no longer call `loadFullTaskTranscript(taskID)` in that route block.

## Verification Plan

- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "conversation/session"`
- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "single session transcript without full task transcript"`
- `bun run --cwd packages/opencorvus typecheck`
- Source review with `rg "conversation/session|loadFullTaskTranscript|loadTaskSessionTranscript" packages/opencorvus/src/server/routes/orchestrator.ts packages/opencorvus/test/server/task-conversation-routes.test.ts`

## Second Fix Contract

Make attachment sweep project-scoped without changing retain semantics:

1. Keep `harvestReferences(...)` as the only URL-to-sha extraction primitive.
2. Keep `AttachmentStore.collectReferencedShas()` with no arguments returning the full project map for diagnostics and existing tests.
3. Add `AttachmentStore.collectReferencedShas(projectID)` scoped to the requested project:
   - parts are read through `PartTable.session_id -> SessionTable.id` with `SessionTable.project_id = projectID`;
   - task attachment columns are read with `EngineTaskTable.project_id = projectID`.
4. Change `sweep(projectID)` to use `collectReferencedShas(projectID)`.
5. Add a regression test proving scoped collection excludes foreign project references while unscoped collection still sees both projects.

## Second Verification Plan

- `bun test packages/opencorvus/test/storage/attachment-store-sweep.test.ts -t "project-scoped retain scan"`
- `bun test packages/opencorvus/test/storage/attachment-store-sweep.test.ts`
- `bun run --cwd packages/opencorvus typecheck`

## Third Fix Contract

Coalesce duplicate overlay acceptance diff requests without changing result semantics:

1. Keep `scopeCacheKey(...)` as the single key authority for run and goal-run diff scopes.
2. Add a module-level in-flight map keyed by the same scope key.
3. When a completed non-empty diff exists in `diffCache`, return it exactly as before.
4. When a same-key request is already in flight, return that Promise instead of calling `apiJson(...)` again.
5. Delete the in-flight entry in a `finally` block once the request settles.
6. Preserve the existing completed-cache behavior: empty diff results are not cached, and thrown API errors are not swallowed or cached.
7. Add tests proving same-key concurrent requests share one API call and that empty completed results still re-fetch on a later request.

## Third Verification Plan

- `bun test packages/overlay/test/diff-resolve-inflight-cache.test.ts`
- `bun run --cwd packages/overlay typecheck`

## Fourth Fix Contract

Superseded by `2026-06-27-message-card-orderkey-convergence.md`.

The historical version of this section allowed id-less loaded messages to
generate `loaded-msg:*` IDs from `messageSignature(...)`. That is no longer an
accepted contract. Loaded conversation rows must carry backend message IDs,
roles, channels, and order keys; missing visible message identity is a data
error and must fail loudly instead of generating `loaded-msg:*` or
`loaded-part:*`.

Current contract:

1. Messages with a non-empty `info.id` use that server ID.
2. Messages without `info.id` fail immediately.
3. Parts without explicit `id`, `messageID`, `sessionID`, or display
   `orderKey` fail immediately.
4. Tests assert fail-fast behavior rather than generated fallback IDs.

## Fourth Verification Plan

- `bun test packages/overlay/test/message-store.test.ts`
- `bun run --cwd packages/overlay typecheck`

## Implemented Fixes

1. `packages/opencorvus/src/server/routes/orchestrator.ts`
   - The single-session conversation route now reads the requested session through `Session.messages({ sessionID })` after validating it belongs to the task session tree.
   - The existing transcript metadata enrichment was extracted so full-task transcript and single-session transcript share the same annotation behavior.
2. `packages/opencorvus/src/storage/attachment-store.ts`
   - `AttachmentStore.sweep(projectID)` now collects retain references through a project-scoped query.
   - Unscoped `collectReferencedShas()` is still available for diagnostics and existing full-map callers.
3. `packages/overlay/src/services/diff.ts`
   - Acceptance diff fetches now share an in-flight Promise per existing scope cache key.
   - Empty completed results and thrown errors are not cached.
4. `packages/overlay/src/store/messages.ts`
   - Loaded messages with explicit server ids skip the expensive content-signature path.
   - Id-less message id generation remains unchanged.

## Verification Results

- `bun test packages/opencorvus/test/server/task-conversation-routes.test.ts -t "conversation/session" --timeout 30000` — 3 pass.
- `bun test packages/opencorvus/test/storage/attachment-store-sweep.test.ts -t "project-scoped retain scan" --timeout 30000` — 1 pass.
- `bun test packages/opencorvus/test/storage/attachment-store-sweep.test.ts --timeout 30000` — 10 pass.
- `bun test packages/overlay/test/diff-resolve-inflight-cache.test.ts --timeout 30000` — 4 pass.
- `bun test packages/overlay/test/message-store.test.ts --timeout 30000` — 3 pass.
- `bun test packages/overlay/test/diff-resolve-inflight-cache.test.ts packages/overlay/test/message-store.test.ts --timeout 30000` — 7 pass.
- `bun run --cwd packages/opencorvus typecheck` — pass.
- `bun run --cwd packages/overlay typecheck` — pass.

## Deferred Candidates

- `/task/:taskID/conversation/history` still uses full-task transcript before slicing. Fixing it correctly needs a bounded query-before-cursor reader.
- `/provider` payload size and default-model derivation remain API-contract work, not a safe performance-only change.
- `taskItems()` per-row helper queries need batched store APIs and broader route coverage.
- Scheduler event wakeups and log tailing remain candidates for a later pass with dedicated tests.
