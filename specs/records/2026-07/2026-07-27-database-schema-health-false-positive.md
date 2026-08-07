# Database schema-reset health false positive

## Recall

### User requirement

- Continue the direct Prism TradingView Spaces end-to-end run on port `7777`.
- Repair every naturally exposed infrastructure or Expert Squad defect until the real Task and visual product evidence pass.
- A monitor must not inject messages, synthesize evidence, or use a benchmark wrapper.
- Services started by this agent may be restarted when needed.
- Preserve every parallel worktree change and commit only task-owned files.

### Acceptance

- A database that cannot initialize its current schema must never report `healthy: true`.
- The control-plane health route must remain available without opening SQLite and must expose the durable typed failure.
- Project routes must surface the same failure as `503 DatabaseUnavailableError`, not an unrelated `500 UnknownError`.
- Existing lossless schema-refresh protection remains strict: populated rows lacking derived integrity columns require an explicit database reset; no migration, fallback, default hash, or compatibility path may invent data.
- The repaired service must rebuild a clean database and continue one fresh, direct Mission.

### Constraints

- No database migration or compatibility path.
- No route gate, retry loop, keyword matching, or Prism-specific behavior.
- Preserve the failed database image and its SHA-256 digest.
- Keep `/global/health` read-only and independent of opening SQLite.

### Read material

- `AGENTS.md`
- `specs/records/2026-07/2026-07-25-database-schema-refresh-fts-shadow-repair.md`
- `packages/opencorvus/src/storage/db.ts`
- `packages/opencorvus/src/server/routes/global.ts`
- `packages/opencorvus/src/server/error-handler.ts`
- `packages/opencorvus/src/cli/cmd/serve.ts`
- `packages/opencorvus/src/engine/host-recovery.ts`
- `packages/opencorvus/test/storage/db-path.test.ts`
- `packages/opencorvus/test/server/directory-required.test.ts`
- `packages/opencorvus/test/server/onerror-mapping.test.ts`

### Full-repository search

The investigation enumerated:

- `DatabaseUnavailableError`, `Database.unavailable`, `recordUnavailable`, `throwOwnedInitializationFailure`, `normalizeError`, and `isUnavailableError`;
- `/global/health`, its SDK/OpenAPI consumers, and Overlay connection diagnostics;
- `assertLosslessSchemaRefresh`, `refreshSchemaDatabase`, `ensureCurrentSchema`, and all `Database.Client` initialization paths;
- `recoverStartedTaskExecutions` and the `serve` startup recovery catch;
- storage, global-health, route-error, packaged-health, and SDK-auth regression suites.

No existing typed schema-reset-required error exists. `DatabaseUnavailableError` is already the single durable process-wide database failure projection and its `code` field accepts an exact non-SQLite failure code.

## Incident evidence

At `2026-07-27T00:47:41+08:00`, restarting the agent-owned port-`7777` service loaded the current schema contract. PID `407` emitted:

```text
Cannot refresh populated engine_artifact: stale schema lacks derived integrity column(s)
catalog_import_source_task_id, catalog_revision. Reset the database explicitly;
OpenCorvus will not restore false hashes, catalog metadata, or exact Artifact bindings.
```

The same process then returned:

- `GET /global/health` request `c8807955-3a40-4f37-ab53-c4b6b47fb577`: HTTP `200`, `healthy: true`;
- `GET /mission` request `ff7024e7-c413-4c45-a953-e19ce3d25488`: HTTP `500`, `UnknownError`, with the exact schema-reset message.

SQLite `PRAGMA quick_check` remained `ok`; the problem was not corrupt bytes. The populated `engine_artifact` table lacked the two new derived-integrity columns, so lossless refresh correctly refused to fabricate them.

Before reset, all Task, tool, and prompt owner counts were zero. The stopped database image was preserved at:

```text
/Users/yangheng/.local/share/opencorvus/opencorvus.failed-stale-schema-2026-07-27T00-48-01.db
```

SHA-256:

```text
e440735f59b64fe5cfcddaf87244d67442d29ebf5454d9f11d6fb9daa1c7285b
```

Its WAL and SHM siblings were preserved beside it. A clean database was then rebuilt by PID `1198`; it contains both current columns and passes `PRAGMA quick_check`.

## Causal chain

1. `assertLosslessSchemaRefresh` correctly detected that populated rows lacked derived integrity columns.
2. It threw a generic `Error`.
3. `Database.Client` called `throwOwnedInitializationFailure`.
4. `recordUnavailable` only persisted existing `DatabaseUnavailableError` instances or SQLite errors with unavailable codes.
5. The generic schema-reset error therefore closed SQLite but left `state.unavailable` empty.
6. `/global/health` intentionally does not open SQLite and derives `healthy` only from `Database.unavailable()`.
7. Health consequently reported `true`, while every project route that opened SQLite failed.

The failure is at the storage error boundary, not the health route: the health route cannot discover a failure the database owner discarded.

## Repair

- Make the lossless-refresh guard throw the existing typed `DatabaseUnavailableError`.
- Use exact code `SCHEMA_REFRESH_REQUIRED`, operation `Database.Client.schemaRefresh`, and the canonical `Database.Path`.
- Let the existing `throwOwnedInitializationFailure` and `recordUnavailable` path persist it, close SQLite, project it through `/global/health`, and map project routes to HTTP `503`.
- Retain the exact reset-required message and the strict refusal to invent derived metadata.

## Regression matrix

- Storage initialization preserves the populated stale database and exposes durable `SCHEMA_REFRESH_REQUIRED` data.
- Repeated `Database.Client` calls fail with the same typed durable error and do not reopen SQLite.
- Existing global-health projection test proves that durable database failures produce `healthy: false` without opening SQLite.
- Existing error-handler test proves `DatabaseUnavailableError` maps to HTTP `503`.
- Existing schema-refresh, FTS shadow, reset, and current-schema tests remain green.
- Server tests that intentionally select synthetic `test/*` model references now declare one shared in-memory test provider catalog. Strict model-reference validation remains enabled; tests no longer depend on formerly permissive unknown-model loading.

## Runtime continuation

The direct fresh run is Mission `355553a997f3d741`, Mission Session `ses_060a47d7affeZGA9DLUpIp2Eon`, using only:

```text
/Users/yangheng/Documents/OpenCorvus-Demos/prism/runs/tradingview-spaces-20260727-fresh-22
```

The monitor does not inject messages or create acceptance evidence.
