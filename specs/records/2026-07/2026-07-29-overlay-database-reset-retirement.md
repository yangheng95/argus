# Overlay database reset retirement

## Recall

### User request

Remove the database-reset feature shown in the General settings screenshot: the
`Database` group containing the destructive `Reset database` action.

### Acceptance criteria

- General settings no longer renders the database-reset group or action.
- The hidden sidebar-title double-click reset backdoor is removed.
- Overlay has no database-reset request helper or reset-specific translations.
- `POST /global/db/reset` is absent from the runtime router, generated OpenAPI,
  generated Software Development Kit (SDK), and generated API reference.
- A direct request to the retired route cannot dispose instances, delete
  SQLite/Write-Ahead Log (WAL)/Shared Memory (SHM) files, or restart the server.
- The real desktop settings page is opened and visually reviewed in a desktop
  viewport; the retained screenshot is task-scoped evidence.
- The internal `Database.resetFiles` lifecycle primitive and the explicit
  `opencorvus db reset --force` maintenance command remain available. They are
  required by isolated tests and the repository's reset-and-rebuild database
  workflow and are not reachable from the product UI or public reset endpoint.

### Hard constraints

- Do not add, modify, delete, update, or run UI automation tests. Existing
  source-string and browser tests for the old reset UI remain an independently
  owned historical test burden and are not part of this UI change.
- Verify UI only by real page interaction, screenshot capture, and manual
  inspection.
- Do not add a feature flag, compatibility alias, fallback endpoint, or hidden
  replacement.
- Preserve the user's unrelated uncommitted change in
  `packages/opencorvus/src/skill/builtin-payload.ts`.
- Keep generated OpenAPI, SDK, and public API documentation synchronized.
- Commit subjects use the required `dsw-33987` prefix and pushes target
  `myhexin`.

### Sources read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/2026-07-10-overlay-codex-strict-parity-remediation.md`
- Browser control skill instructions used for the required visual acceptance
- The user-provided screenshot

### Whole-repository search evidence

Searches covered the exact UI copy, translation keys, handler names, runtime
route, operation identifier, endpoint path, storage primitive, generated SDK
symbols, public documentation, and tests:

```text
rg -n -i "reset database|reset db|resetDatabase|reset-db|database/reset|reset.*sqlite|sqlite.*reset|WAL/SHM|wal.*shm" .
rg -n "global/db/reset|global\.db\.reset|DatabaseResetRequest|resetFiles\(" packages script
rg -n "settings\.section\.database|settings\.db_reset|sidebar\.reset_db" packages/overlay
rg -n "GlobalDbReset|globalDbReset" packages/sdk/js/src/gen
```

The large `resetDatabase` result set under `packages/opencorvus/test/**` is the
test fixture in `test/fixture/db.ts`; it calls the internal storage primitive
and is not an Overlay/public-API consumer.

### Independent agent feedback

No sub-agent was commissioned: the current collaboration policy permits
delegation only when the user explicitly requests it. This is recorded rather
than inventing an independent review. The primary agent performs the required
second review after implementation.

## Root cause

A local destructive maintenance action was projected into two product-facing
surfaces: a visible General-settings row and an undocumented sidebar-title
double-click backdoor. Both converged on a public HTTP reset-and-restart route.
Removing only the card would leave the backdoor and remote destructive
capability active, so the retirement boundary must remove the complete
Overlay-to-route chain.

The storage reset primitive is not the product leak. It is the single lifecycle
implementation used by test isolation and explicit command-line maintenance.
Deleting it would replace a bounded product-surface retirement with an
unrelated storage/test architecture rewrite.

## Call-point disposition

| Call point                                                              | Disposition                                                                                                                                  |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/overlay/src/components/settings/GeneralPanel.tsx`             | Remove reset imports, signals, summarizer, handler, settings group, and notice.                                                              |
| `packages/overlay/src/main.tsx`                                         | Remove reset import, stale reset comments, and sidebar-title double-click listener.                                                          |
| `packages/overlay/src/services/config.ts`                               | Remove reset response types and request helper.                                                                                              |
| `packages/overlay/src/i18n/{en-US,zh-CN}.json`                          | Remove settings and sidebar reset keys, including the now-empty Database section title.                                                      |
| `packages/opencorvus/src/server/routes/global.ts`                       | Remove the request schema and `/db/reset` route; revise health wording so it does not advertise the retired endpoint.                        |
| `packages/opencorvus/test/server/global-db-destructive.test.ts`         | Replace route-success coverage with a non-UI contract proving the retired route is absent and non-destructive; retain MySQL import coverage. |
| `packages/opencorvus/test/script/routes-check-openapi.test.ts`          | Replace reset request-shape coverage with an absence assertion.                                                                              |
| `packages/opencorvus/test/server/onerror-mapping.test.ts`               | Keep generic owned-controller mapping coverage but use the surviving `global.dispose` operation identity.                                    |
| `packages/overlay/test/general-panel-db-reset.test.ts`                  | Do not modify or run: it asserts TSX/UI strings and is prohibited UI-test debt.                                                              |
| `packages/overlay/test/browser/general-panel-fail-fast-browser.test.ts` | Do not modify or run: it is prohibited UI automation debt.                                                                                   |
| `packages/overlay/test/api-directory-injection.test.ts`                 | Remove retired route entries only if the assertions are non-UI API path logic; otherwise leave untouched under the UI-test prohibition.      |
| `packages/sdk/openapi.json`                                             | Regenerate from runtime routes.                                                                                                              |
| `packages/sdk/js/src/gen/{sdk.gen,types.gen}.ts`                        | Regenerate from OpenAPI.                                                                                                                     |
| `packages/web/src/content/docs/{reference/api,zh-cn/reference/api}.mdx` | Regenerate from runtime OpenAPI.                                                                                                             |
| `packages/opencorvus/src/storage/db.ts` and storage tests               | Preserve the internal lifecycle primitive and its focused tests.                                                                             |
| `packages/opencorvus/src/cli/cmd/db.ts` and CLI tests/docs              | Preserve the explicit local maintenance command.                                                                                             |

## Verification

Non-UI verification:

```text
bun test packages/opencorvus/test/server/global-db-destructive.test.ts
bun test packages/opencorvus/test/script/routes-check-openapi.test.ts
bun test packages/opencorvus/test/server/onerror-mapping.test.ts
bun test packages/overlay/test/api-directory-injection.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
bun run docs:check
bun run api:routes-check
bun run typecheck
```

UI acceptance uses the real desktop page in a desktop viewport. Open General
settings, capture a task-scoped screenshot, inspect it manually, and confirm
that Notifications flows directly into Diagnostics with no Database group,
reset action, notice, or unexpected spacing artifact.

## Implementation result

- Removed the complete General-settings database group, reset handler state,
  response summarizer, and destructive action.
- Removed the sidebar-title double-click reset backdoor and its confirmation,
  warning, and failure flows.
- Removed the Overlay request helper, response types, and both locales' reset
  strings.
- Removed `POST /global/db/reset` and its request schema from `GlobalRoutes`.
  The health description no longer advertises an explicit reset endpoint.
- Regenerated the OpenAPI artifact, JavaScript/TypeScript SDK, and English and
  Chinese API reference. The generated operation count moved from 307 to 306.
- Replaced the route's success-path tests with a retirement contract proving a
  direct request returns 404 without calling `Instance.disposeAll` or
  `Database.resetFiles`.
- Removed the retired route from the shared Overlay directory-policy
  enumeration and kept the generic owned-controller error mapping on the live
  `global.dispose` operation.
- Preserved the internal storage reset primitive and explicit command-line
  maintenance command.

## Verification result

The following non-UI checks passed:

```text
bun test packages/opencorvus/test/server/global-db-destructive.test.ts
# 4 pass, 0 fail

bun test packages/opencorvus/test/script/routes-check-openapi.test.ts
# 10 pass, 0 fail

bun test packages/opencorvus/test/server/onerror-mapping.test.ts
# 28 pass, 0 fail

bun test packages/overlay/test/api-directory-injection.test.ts
# 99 pass, 0 fail

bun test packages/opencorvus/test/script/historical-docs-links.test.ts
# 22 pass, 0 fail

bun test packages/opencorvus/test/script/product-docs-single-source.test.ts
# 8 pass, 0 fail

bun test packages/opencorvus/test/script/document-health.test.ts
# 63 pass, 0 fail

bun run api:routes-check
# route inventory clean

bun run docs:check
# 306 operations, 24 groups

bun run --cwd packages/overlay check:i18n
# panel i18n clean

bun run typecheck
# 8 packages successful
```

The first document-health run was temporarily blocked by another task's staged
monthly index pointing to an untracked record. After that concurrent task
committed its own files, the unchanged document-health suite was rerun and
passed 63 of 63 checks.

## Visual acceptance

The real Vite-powered Overlay was opened against the running backend on port
7878 through the in-app browser. General settings was opened through the
OpenCorvus menu and scrolled to the changed region. The task-scoped screenshot
was inspected manually:

- Notifications flows directly into Diagnostics.
- No Database heading, reset row, reset button, status notice, or residual
  spacing artifact is visible.
- The retained controls preserve their existing width, row rhythm, typography,
  and alignment.
- Returning to the app and double-clicking the visible Projects sidebar title
  produced no JavaScript confirmation dialog, confirming that the hidden
  backdoor is gone through the real interaction path.

No UI automation test or screenshot baseline was added, modified, deleted, or
run.

## Second review

The primary-agent review re-ran the whole-repository searches after generation.
Remaining `resetDatabase()` references under `packages/opencorvus/test/**` are
the internal test fixture, and the two retained mentions of
`/global/db/reset` are negative retirement assertions. No production Overlay,
runtime router, OpenAPI, SDK, or public API documentation reference remains.

During the focused OpenAPI test run, an unrelated stale expected task-body
inventory omitted the already-live optional `artifactImports` and `directory`
fields. The non-UI assertion was corrected to match the generated OpenAPI
single source; the complete focused test then passed.
