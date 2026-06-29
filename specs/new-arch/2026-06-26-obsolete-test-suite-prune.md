# Obsolete Test Suite Prune

Date: 2026-06-26

## Objective

Audit repository tests and delete tests that are already invalid against the
current source of truth. This is not a failure-silencing pass: failing tests are
deleted only when they assert a retired contract, reference a deleted interface,
or preserve a behavior that current architecture documents as obsolete.

## Recall

- `AGENTS.md` forbids blind deletion, fallback, compatibility paths, and
  host-side gates.
- `specs/new-arch/2026-06-24-prune-obsolete-invalid-tests.md` defined the
  earlier deletion boundary for retired direct-submit frontend-design tests,
  terminal-task stale continuation tests, and source-audit tests.
- `specs/new-arch/2026-06-26-repo-obsolete-test-doc-prune-followup.md` narrowed
  repo pruning: useful coverage must be repaired, not deleted.
- `specs/retired-reference-ledger.md` records two intentionally removed
  historical notes.

## Deletion Criteria

Delete a test only when all are true:

1. The tested behavior is contradicted by current source, specs, or role
   contracts.
2. The test is not the only remaining coverage for a live behavior.
3. A grep over production and tests proves the referenced API/contract is
   retired or has a replacement.
4. The deletion reduces pressure to reintroduce fallback, gates, compatibility
   branches, or double-source state.

Do not delete:

- Tests failing because production code regressed.
- Tests with stale fixtures that can be made environment-neutral.
- Browser/visual tests that still cover a live UI surface.
- Historical-document health tests unless the file under test is itself the
  obsolete artifact.

## Audit Commands

Use test discovery plus targeted failing suites rather than root `bun test`
because root intentionally exits with "do not run tests from root".

Commands to run:

```powershell
rg --files -g "*.test.ts" -g "*.test.tsx" packages
bun run --cwd packages/opencorvus typecheck
bun test packages/opencorvus/test/frontend-design/output-tools.test.ts
bun test packages/opencorvus/test/orchestrator/tools.test.ts
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
bun test packages/opencorvus/test/session/message.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay test:unit
```

For longer suites, use an inactivity-timeout wrapper around the command output
instead of treating elapsed wall-clock time as test failure.

## Current Known Candidates

| Candidate                                                                          | Prior evidence                                                                                     | Expected action                                                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `packages/opencorvus/test/frontend-design/output-tools.test.ts`                    | 2026-06-24 spec says the whole file asserts retired direct-submit frontend-design report contract. | Delete if still present.                                                  |
| Obsolete blocks in `packages/opencorvus/test/orchestrator/tools.test.ts`           | 2026-06-24 spec says only stale terminal/direct-build/source-audit blocks should be removed.       | Inspect by failing test name and grep before deletion.                    |
| `packages/opencorvus/test/session/message.test.ts` image-input failures            | Current failure points at `model-image-input.ts`; no evidence that the tests are obsolete.         | Do not delete unless source/spec proves the image-input contract retired. |
| `packages/overlay/test/browser/task-dirbar-keyboard.test.ts` personal-path fixture | 2026-06-26 follow-up says repair fixture, not delete.                                              | Do not delete.                                                            |

## Verification

After deletion:

- Rerun the affected suite(s).
- Rerun replacement/current coverage named in the relevant spec.
- Run `bun run --cwd packages/opencorvus typecheck`.
- Run `git diff --check` over changed/deleted files.
- Grep for deleted test names and retired contract identifiers to ensure no
  duplicate stale coverage remains.
