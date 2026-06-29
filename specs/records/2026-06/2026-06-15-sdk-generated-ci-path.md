# SDK Generated CI Path

Date: 2026-06-15
Status: implementation plan

## Acronyms

- CI: Continuous Integration, the GitHub workflow that verifies pushed changes.
- SDK: Software Development Kit, the generated JavaScript client under `packages/sdk/js`.

## Problem

The typecheck workflow regenerates the SDK but diffs
`packages/sdk/js/src/v2/gen`, which does not exist. The SDK generator deletes
and writes `packages/sdk/js/src/gen`, so generated SDK drift can pass CI as long
as `packages/sdk/openapi.json` is unchanged.

## Call Point Sweep

| Surface   | Call point                                                                                 | Decision                                                                        |
| --------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------- |
| Workflow  | `.github/workflows/typecheck.yml` `Verify generated SDK and OpenAPI`                       | Diff `packages/sdk/js/src/gen` and `packages/sdk/openapi.json`.                 |
| Generator | `packages/sdk/js/script/build.ts` `rmWithinPackage("src/gen")` and `generate("./src/gen")` | Keep as the single generated SDK output.                                        |
| Tests     | `packages/opencorvus/test/script/sdk-build-format-contract.test.ts`                        | Assert the workflow checks `src/gen` and does not mention retired `src/v2/gen`. |

## Acceptance

- Generated SDK source drift under `packages/sdk/js/src/gen` fails CI.
- The retired `src/v2/gen` path is absent from workflow checks.
