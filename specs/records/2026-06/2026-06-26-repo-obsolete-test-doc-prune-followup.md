# Repo Obsolete Test/Doc Prune Follow-up

Date: 2026-06-26

## Objective

Delete repository docs/tests only where the file itself is now obsolete, wrong,
or invalid against the current source of truth. Do not delete still-useful
coverage or current task inputs just to silence hygiene tests.

## Recalled Constraints

- `specs/records/2026-06/2026-06-24-prune-obsolete-invalid-tests.md` already defined
  the previous deletion boundary: remove tests only when they assert retired
  contracts.
- `specs/records/2026-06/2026-06-24-remove-web-clone-source-audit.md` already removed
  the source-audit tool/contract and its dedicated acceptance path.
- `specs/README.md` defines `specs/**` as historical evidence by default.
  Superseded or historical notes are not automatically deletion candidates.
- `AGENTS.md` forbids blind pruning. Current artifacts must be kept if they are
  still active inputs, still valuable coverage, or still the only historical
  evidence for a root cause.

## Evidence Sweep

Commands:

```powershell
git status --short
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
rg -n "docs/etfs/final-delivery-report.md|C:/Users/chuan|C:\\Users\\chuan" specs packages
```

Observed:

- The repository already has two obsolete historical notes deleted in the
  working tree:
  - `specs/records/2026-06/2026-06-24-prune-obsolete-invalid-tests.md`
  - `specs/records/2026-06/2026-06-24-remove-web-clone-source-audit.md`
- `historical-docs-links.test.ts` fails because:
  - `specs/records/2026-06/2026-06-25-visual-qa-self-report-consistency-repair.md`
    still references missing historical file
    `docs/etfs/final-delivery-report.md`;
  - `specs/artifacts/tv2ainvest.md` is a live prompt/reference artifact but is missing
    from `specs/README.md`;
  - many existing June architecture/history notes are valid records but were
    missing from `specs/records/2026-06/2026-06-29-spec-consolidation.md`.
- `document-health.test.ts` fails because
  `packages/overlay/test/browser/task-dirbar-keyboard.test.ts` hard-codes the
  developer-specific path prefix `C:/Users/chuan/...`. That test still provides
  useful browser coverage and should be repaired, not deleted.

## Decision

- Keep the two 2026-06-24 obsolete notes deleted and remove their index
  entries.
- Do not delete `specs/artifacts/tv2ainvest.md`; it is an active task input and must be
  indexed as a prompt/reference artifact.
- Do not delete `specs/records/2026-06/2026-06-25-visual-qa-self-report-consistency-repair.md`;
  the note still documents a real contract repair. The missing
  `docs/etfs/final-delivery-report.md` path should move to the retired
  reference ledger instead of forcing recreation of a dead doc or deleting the
  still-valid note.
- Do not delete `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`;
  replace the personal-path fixture with a generic workspace path.
- Reindex all existing June historical notes so the historical doc contract
  matches the actual repo contents under `specs/records/2026-06/**`.

## Verification

```powershell
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
```
