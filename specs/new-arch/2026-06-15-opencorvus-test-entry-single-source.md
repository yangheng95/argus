# Opencorvus default test entry coverage

## Problem

The root `package.json` intentionally rejects `bun test` from the repository root, while CI runs `bunx turbo run test --filter=opencorvus`. The `packages/opencorvus` test script was a manually maintained default-suite list. The root-level `test/check-release-assets.test.ts` was outside the package test tree, so it was not covered by the CI test job.

## Call sites

| Surface | Current state | Decision |
| --- | --- | --- |
| `package.json` root `test` | Rejects root test execution | Keep; root is not the test owner |
| `.github/workflows/test.yml` unit job | Runs `bunx turbo run test --filter=opencorvus` | Keep; it delegates to the package script |
| `packages/opencorvus/package.json` `test` | Handwritten default-suite list missing the release asset regression test | Add the moved release asset test and its entry contract by file path; do not add all `test/script` because it includes packaging smoke tests |
| `test/check-release-assets.test.ts` | Root-level orphan test for root `script/check-release-assets.ts` | Move under `packages/opencorvus/test/script` and resolve the root script explicitly |
| `packages/opencorvus/test/script/*` | Existing package script-contract tests | Include through the package-wide test entry |

## Validation

- Targeted run for the moved release asset test.
- Static package test-entry contract to pin the moved release asset test into the default package suite.
- Run package script-focused tests after the entry change.

## Review note

Running the entire package `test` directory exceeded 15 minutes because it also includes long-running and live suites. Adding the entire `test/script` directory also makes the package default too expensive because that directory includes packaging smoke tests. The default CI command remains an explicit suite until the remaining omitted suites are triaged into CI-safe and live/benchmark groups.
