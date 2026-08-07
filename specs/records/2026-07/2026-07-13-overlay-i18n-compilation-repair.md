# Overlay i18n Compilation Repair

## Recall

- User request: 修复 i18n 并完成编译。
- Acceptance criteria:
  - The repository i18n checker passes against the current panel source.
  - English and Chinese locale catalogs retain identical keys and the current panel revision.
  - Overlay TypeScript compilation and the UI build pipeline pass.
  - The final diff is reviewed after the automated checks pass.
- Hard constraints: no fallback or compatibility path; preserve unrelated dirty work; do not restart or stop a running OpenCorvus/Overlay process; use the repository-owned revision generator; do not run Playwright through Bun; commit subjects use the required `dsw-33987` prefix and push only to `legacy-remote` when a safe task-owned commit is possible.
- Sources read: `AGENTS.md`, `specs/current/architecture/{07-panel.md,12-overlay-card-system.md,99-principles.md}`, `specs/records/2026-07/{2026-07-12-work-ledger-pin-unpin.md,2026-07-13-expert-squad-integration-guide.md}`, `packages/overlay/package.json`, `packages/overlay/script/{check-panel-i18n.ts,bump-panel-revision.ts,build-overlay.ts}`, and `packages/overlay/test/panel-i18n-script.test.ts`.
- Whole-repository search evidence: `panel_revision`, `check-panel-i18n`, and `bump-panel-revision` identify one checker, one repository-owned generator, two locale metadata values, the build entry point, and the focused checker test. `src/index.html` is the only current panel file contributing to the revision hash.
- Independent agent feedback: none; the user did not request sub-agents.

## Root cause

`packages/overlay/src/index.html` gained the OpenCorvus favicon link. The panel revision intentionally hashes top-level HTML/JavaScript panel files, so the canonical revision changed from `b353058543e01fc0` to `8994cac2bbb2992a`. Both locale catalogs still carried the old revision, causing `check:i18n` to fail before Vite compilation. This is stale generated metadata, not a missing translation key or TypeScript failure.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| `src/index.html` | Preserve the existing favicon change; it is the source change that invalidated the revision. |
| `script/bump-panel-revision.ts` | Use unchanged as the single revision producer. |
| `src/i18n/en-US.json` | Replace only `_meta.panel_revision`; preserve existing expert-squad and Work Ledger strings. |
| `src/i18n/zh-CN.json` | Replace only `_meta.panel_revision`; preserve existing expert-squad and Work Ledger strings. |
| `script/check-panel-i18n.ts` | Keep unchanged; it correctly rejected stale metadata and continues to validate coverage, unused keys, and locale parity. |
| `script/build-overlay.ts` | Keep unchanged; its mandatory i18n-first ordering is correct. |
| `test/panel-i18n-script.test.ts` | Run as the focused regression check; no production checker behavior changes require a new test case. |
| `test/browser/agent-compact-visual-stress.test.ts` | Preserve the existing shared `finalizeBrowserEvidence` cleanup-first browser-health path. |
| `test/script/document-health.test.ts` | Replace its stale direct-collector assertion with assertions for the current shared finalizer and collected browser-error evidence. |

## Benchmark

- Input: the current dirty Windows host workspace, including the existing favicon HTML change and bilingual locale additions.
- Output: locale metadata generated from the current panel source and a successfully compiled Overlay UI artifact.
- Environment: repository-pinned Bun/TypeScript/Vite dependencies in the current host workspace; no live Overlay process intervention.
- Timeout: commands are observed for output/progress; any timeout is based on inactivity rather than elapsed time from process start.
- Pass: `check:i18n`, the focused checker test, Overlay `typecheck`, `build:overlay --skip-tauri`, spec-link/document-health checks, and final diff review all succeed.

## Progress

- [x] Reproduced the stale panel revision error.
- [x] Recalled current architecture and related July records.
- [x] Enumerated revision producer, consumers, storage, build entry point, and tests.
- [x] Synchronize locale metadata with the repository-owned generator.
- [x] Run focused and compilation verification.
- [x] Review the final diff and record delivery status.

## Secondary review finding

The required document-health review exposed a pre-existing stale assertion: it required `browserErrors.assertNoUnexpectedErrors()` in the agent compact fixture even though that fixture now delegates final health evaluation to `finalizeBrowserEvidence` after browser/server cleanup. The shared finalizer calls `collectEvidence`, rejects non-empty page/console/request/HTTP error arrays, persists the final report, and rethrows the combined primary, health, and cleanup failures. The health test must verify this current single path rather than require the retired direct call.

## Verification and review

- `bun run --cwd packages/overlay check:i18n`: passed at revision `8994cac2bbb2992a`.
- `bun test packages/overlay/test/panel-i18n-script.test.ts`: 1 passed.
- `bun run --cwd packages/overlay typecheck`: passed.
- `bun run --cwd packages/overlay build:overlay --skip-tauri`: passed; Vite compiled 2,439 modules and produced `dist-vite/`. The full Tauri path was intentionally not invoked because it deletes/rebuilds shared sidecar artifacts and its own instructions require the caller to stop any running Overlay first.
- Browser-finalizer/source/document-health tests: 62 passed.
- Historical docs link tests: 20 passed.
- `git diff --check` and staged diff whitespace checks: passed.
- Manual review: both locale key sets remain synchronized; only `_meta.panel_revision` changed for this repair; existing expert-squad and Work Ledger translations remain intact; the checker and generator continue to use the same normalized SHA-256 input; no fallback, compatibility branch, or duplicate revision source was added.
