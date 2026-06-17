# Browser Preview Evidence Operation Kind Strictness

## Problem

Browser preview evidence rows are operation-aware: plain captures use
`operation_kind: "preview-capture"` and region comparisons use
`operation_kind: "reference-comparison"`. The persisted reader still treated a
missing or unknown operation kind as `"preview-capture"`, which lets malformed
or legacy comparison rows pollute `latestEvidenceIDs` and evidence read routes.

## Call Points

| Surface | File | Decision |
| --- | --- | --- |
| Persisted evidence schema | `packages/opencorvus/src/browser-preview/persist.ts` | Require an explicit known `operationKind`; do not default missing values to preview capture. |
| Evidence row parser | `packages/opencorvus/src/browser-preview/persist.ts` | Reject rows whose `operation_kind` is absent or not one of the two operation kinds. |
| Latest capture query | `packages/opencorvus/src/browser-preview/persist.ts` | Include only rows with `operation_kind === "preview-capture"`. |
| Evidence JSON/PNG routes | `packages/opencorvus/src/server/routes/browser-preview.ts` | Keep routing through readable evidence helpers so malformed rows resolve to 404. |
| Route regression coverage | `packages/opencorvus/test/server/browser-preview-routes.test.ts` | Insert malformed rows directly and assert they do not become latest evidence or readable route artifacts. |

## Implementation

1. Remove the Zod default from `PersistedBrowserPreviewEvidence.operationKind`.
2. Add one parser for `operation_kind` and use it in both full evidence reads
   and SQL metadata extraction.
3. Make latest capture metadata require explicit `"preview-capture"` rather than
   treating unknown rows as capture evidence.
4. Add regression tests for missing and unknown operation kind payloads.

## Verification

- `bun test packages/opencorvus/test/server/browser-preview-routes.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check` on the changed files.
