# Overlay Archive Single Entry Plan

## Rule

Overlay is the only product entry for task/session archive import and export. CLI import/export is not an acceptance surface for this feature.

## Current Evidence

- Overlay calls `GET /export/task/{taskID}/archive` from `packages/overlay/src/services/task-archive.ts`.
- Overlay calls `POST /export/import` from `packages/overlay/src/services/task-archive.ts`.
- The visible controls live in `packages/overlay/src/components/TaskList.tsx`.

## Problems To Fix

1. Import currently sends `overwrite=true` without an explicit UI decision.
2. Browser import reads the selected zip into an ArrayBuffer before fetch, contradicting the streaming intent and doubling memory pressure for large archives.
3. Tests currently assert only that import posts a zip, not that the overwrite policy is visible and deterministic.

## Implementation

1. Make overwrite an explicit Overlay control.
2. Default overwrite to false so imports do not clobber existing project files unless the operator opts in.
3. Send the selected Blob/File directly as the fetch body.
4. Update the Overlay browser test to assert the default policy in the request query.

## Verification

- `bun test packages/overlay/test/task-archive-ui.test.ts`
- `bun test packages/opencorvus/test/server/export-archive.test.ts`
