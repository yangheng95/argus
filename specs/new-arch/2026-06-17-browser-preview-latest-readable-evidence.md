# Browser Preview Latest Readable Evidence

## Problem

`latestEvidenceIDs` was computed from browser preview evidence metadata only.
When the newest `preview-capture` row pointed at a missing PNG, mismatched hash,
or otherwise unreadable artifact, the target route still returned that evidence
ID. The overlay then saw every viewport as already captured, skipped automatic
capture, and later failed to load the evidence route.

## Call Points

| Surface                       | File                                                             | Decision                                                                                                         |
| ----------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Latest evidence query         | `packages/opencorvus/src/browser-preview/persist.ts`             | Return only latest readable `preview-capture` evidence per viewport; unreadable rows are skipped.                |
| Readable evidence helpers     | `packages/opencorvus/src/browser-preview/persist.ts`             | Require explicit `projectRoot` for artifact readability checks; no helper infers it from ambient instance state. |
| Target resolution             | `packages/opencorvus/src/browser-preview/target.ts`              | Await readable latest IDs before returning a ready target.                                                       |
| Server browser preview routes | `packages/opencorvus/src/server/routes/browser-preview.ts`       | Pass `Instance.directory` as the task project root into every evidence read helper.                              |
| Verification result           | `packages/opencorvus/src/browser-preview/verification-core.ts`   | Keep freshly persisted evidence IDs from the capture operation.                                                  |
| Route tests                   | `packages/opencorvus/test/server/browser-preview-routes.test.ts` | Cover newer corrupt evidence plus older readable evidence.                                                       |

## Implementation

1. Make `latestBrowserPreviewEvidenceIDs` asynchronous because artifact
   readability is an I/O check.
2. Reuse the same persisted evidence parser and artifact readability logic used
   by evidence JSON/PNG routes.
3. Add `projectRoot` to latest evidence lookup so the check does not depend on
   ambient directory state.
4. Require `projectRoot` on every readable evidence helper so direct artifact
   reads share the same explicit root contract.
5. Update tests and call sites to await the readable latest query.

## Verification

- `bun test packages/opencorvus/test/server/browser-preview-routes.test.ts`
- `bun test packages/opencorvus/test/browser-preview/verification.test.ts`
- `bun test packages/opencorvus/test/browser-preview/target.test.ts`
- `bun run --cwd packages/opencorvus typecheck`
- `git diff --check` on the changed files.
