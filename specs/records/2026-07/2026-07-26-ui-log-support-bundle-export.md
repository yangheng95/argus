# UI Log Support Bundle Export

## Recall

### User request

Add a UI log-export action that produces a ZIP file, with detailed and formatted logs.

### Acceptance criteria

1. A visible, keyboard-operable action exists in the Overlay settings UI.
2. The action exports every retained file from the canonical `Global.Path.log` directory through the existing server.
3. The ZIP contains exact raw logs, human-readable formatted logs, and a structured manifest with per-file statistics.
4. The current asynchronous log destination is flushed before the archive snapshot is collected.
5. Malformed/non-JSON log lines remain visible in the formatted output and are counted in the manifest rather than being silently dropped.
6. The response has an `application/zip` content type and a deterministic safe download filename.
7. UI progress, success, and failure states are visible and localized in English and Simplified Chinese.
8. Backend, OpenAPI, Overlay service/UI, keyboard interaction, download response, and visual layout have regression coverage.
9. A real Vite page is opened, the General settings panel is exercised, and a goal/region-specific screenshot is inspected and corrected if necessary.
10. Existing unrelated worktree changes remain untouched and unstaged.

### Hard constraints

- Use the existing unified log directory and logger; do not create a second client-side or task-scoped log source.
- Use the repository's existing ZIP.js and browser download pipeline.
- Preserve raw evidence. Formatting is an additional archive representation, not a replacement or compatibility path.
- Do not restart, stop, refresh, or otherwise interfere with the user's running OpenCorvus/Overlay process.
- Playwright/browser verification must run through Node, not Bun.
- Stage only task-owned files/hunks and push only to the legacy remote.

### Read material

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `packages/opencorvus/src/util/log.ts`
- `packages/opencorvus/src/util/log-safety.ts`
- `packages/opencorvus/src/server/routes/app.ts`
- `packages/opencorvus/src/engine/task-project-archive.ts`
- `packages/opencorvus/test/server/log-routes.test.ts`
- `packages/opencorvus/test/server/app-routes.test.ts`
- `packages/overlay/src/utils/log.ts`
- `packages/overlay/src/services/project-archive.ts`
- `packages/overlay/src/components/settings/GeneralPanel.tsx`
- `packages/overlay/src/components/settings/layout.tsx`
- `packages/overlay/src/components/ConfigDialogHost.tsx`
- `packages/overlay/src/store/dialog.ts`
- `packages/overlay/src/i18n/en-US.json`
- `packages/overlay/src/i18n/zh-CN.json`
- `packages/overlay/test/general-panel-db-reset.test.ts`
- `packages/overlay/test/browser/general-panel-fail-fast-browser.test.ts`

### Whole-repository grep

| Surface | Call sites and disposition |
| --- | --- |
| `Log.files()` | `server/routes/app.ts` owns `GET /log/files`; retain it and reuse the same canonical file inventory inside the export builder. |
| `Log.read()` | `GET /log`, `GET /log/tail`, log route tests, and `project/open-lifecycle.test.ts`; retain unchanged because bounded tail reading is distinct from complete support-bundle export. |
| Log write path | Overlay `AppLog` posts to `POST /log`; backend `Log.create()` writes Pino JSON lines to `Global.Path.log`; retain as the single source. |
| Existing log UI | `LogViewer.tsx` reads `GET /log/tail`; retain as the live viewer. Export is a durable archive action, not another viewer source. |
| Existing archive implementation | `engine/task-project-archive.ts`, Expert Squad manager/tests, and Skill manager/tests use `@zip.js/zip.js`; reuse ZIP.js for support-bundle creation. |
| Existing ZIP download | `overlay/services/project-archive.ts` is called by Task and Mission services and already owns binary response decoding, `Content-Disposition` validation, Blob URL creation, and anchor download. Generalize its archive download function and keep Task/Mission wrappers on it. |
| Server route ownership | Project-scoped `AppRoutes` currently owns `/log`, `/log/files`, and `/log/tail`; add `/log/export` beside them so it shares the exact same route and error boundary. |
| OpenAPI/generated client | `server/app-routes.test.ts`, `packages/sdk/openapi.json`, and generated JS SDK types/client reflect `AppRoutes`; regenerate/check after adding `log.export`. |
| UI location | `GeneralPanel.tsx` owns global notifications and database maintenance. Add one Diagnostics group there using `SettingsGroup`, `SettingsRow`, `Button`, and the existing status-box pattern. |
| Settings navigation | `CONFIG_SECTIONS` projects General into the dialog, menu, and command palette. No new settings tab or navigation source is needed. |
| Localization | `en-US.json` and `zh-CN.json` are the paired locale authorities; add the same export keys to both and run the i18n checker. |
| Browser fixtures | Existing general-settings and config-dialog browser fixtures route `/log/tail`; add a focused Node-launched Vite browser test for `/log/export`, loading/progress, success/error state, and screenshot evidence. |

### Independent agent feedback

No independent agent was requested by the user. Repository policy forbids introducing an unsolicited delegation chain for this task, so the main agent owns implementation and second review.

## Root-cause and design decision

OpenCorvus already has detailed durable logs, but the only public operations are line-oriented read/list endpoints and the only UI is a transient log viewer. Generating a ZIP in the browser from viewer state would lose rotated files, race the asynchronous logger, and create a second evidence source. The canonical repair is a server-owned snapshot builder over `Log.files()` after `Log.flush()`, exposed by one binary route and downloaded by the established archive transport.

The archive contract is:

- `manifest.json`: schema/version, export time, OpenCorvus/runtime/platform identity, log directory, totals, and per-file byte/line/parse statistics.
- `README.txt`: concise interpretation and privacy guidance.
- `logs/raw/<name>`: byte-exact retained log files.
- `logs/formatted/<name>`: deterministic human-readable rendering with timestamp, level, service, message, and pretty-printed remaining fields; malformed lines are marked and preserved.

## Implementation plan

1. Add a focused log-support-bundle module that flushes the logger, collects one canonical inventory, reads each file once, derives statistics/formatting, and builds the ZIP with ZIP.js.
2. Add `GET /log/export` beside the existing log routes, including OpenAPI binary response metadata and a safe filename.
3. Generalize the existing Overlay archive downloader, add a log-export service, and expose the action in General > Diagnostics with progress/success/error feedback.
4. Add English and Simplified Chinese strings.
5. Add backend ZIP-content and route/OpenAPI regressions, Overlay service/UI contract tests, and a focused Node-launched Vite browser test with a screenshot.
6. Regenerate/check OpenAPI and SDK artifacts, run targeted tests/typechecks/i18n/docs checks, inspect the screenshot, and perform a second diff review.
7. Commit only task-owned files/hunks with the required `dsw-33987` subject prefix and push to `legacy-remote/v0.0.18beta`.

## Verification log

- Backend and contract regression: `bun test packages/opencorvus/test/server/log-routes.test.ts packages/opencorvus/test/server/app-routes.test.ts packages/transport-protocol/test/contract.test.ts packages/overlay/test/task-project-archive-download-service.test.ts packages/overlay/test/general-panel-db-reset.test.ts packages/overlay/test/api-directory-injection.test.ts` passed with 174 tests and 1,770 assertions.
- Overlay browser acceptance: `OPENCORVUS_OVERLAY_BROWSER_TEST_NODE_RUNNER=1 node --test packages/overlay/test/browser/general-panel-fail-fast-browser.test.ts` passed in a headed browser. It covered Enter-key activation, one valid ZIP download, visible success, a real HTTP 500, visible failure, and produced `.scratch/general-settings-log-export-complete.png`.
- Independent Vite visual review: an isolated Vite 6.4.3 server at `127.0.0.1:5198` was opened through the in-app browser. General > Diagnostics rendered with the canonical settings row, readable wrapped description, aligned action, disabled offline state, and no duplicate titlebar. The isolated server and browser tab were closed after review without touching the user's running Overlay.
- Generated contracts: SDK build completed; `api:routes-check` passed with 292 documented operations after adding `log.export`; `docs:check` and paired Overlay i18n checking passed before later parallel Artifact Catalog edits resumed.
- Documentation tests: historical links and product-doc single-source checks passed. The combined document-health run had one unrelated failure because two concurrently authored July records were indexed while still untracked.
- Full repository typecheck currently reaches all other packages but is blocked only by concurrently edited, untracked Artifact Catalog/compaction code. No log-export TypeScript error remains; final hook will be rerun after that parallel work settles.
