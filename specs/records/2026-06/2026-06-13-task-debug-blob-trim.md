# Task Debug Blob Trim

Date: 2026-06-13

## Problem

Double-clicking the Workflow conversation title copies `buildTaskDebugBlob` from
`packages/overlay/src/main.tsx`. The blob currently mixes the first useful
identity lines with notes, project-scoped HTTP probes, and long SQL templates.
The copied text is too noisy for the requested Workflow debug path.

## Grep Evidence

| Surface              | Evidence                                                                                                         | Decision                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Debug source         | `rg "buildTaskDebugBlob                                                                                          | Task Debug Info                                                                                            | Project-scoped HTTP probes | SQL templates" packages/overlay/src/main.tsx packages/overlay/test/task-debug-info.test.ts` | Keep the single copy source in `buildTaskDebugBlob`; delete the redundant tail there. |
| Double-click trigger | `packages/overlay/src/main.tsx` binds `#chatViewTitle` double-click to `buildTaskDebugBlob(boardStore.board)`    | Do not add another trigger or fallback copy path.                                                          |
| Existing tests       | `packages/overlay/test/task-debug-info.test.ts` asserts the old Files projection, HTTP probes, and SQL templates | Replace with a regression guard that requires the concise leading fields and rejects the removed sections. |
| Product PRD          | `specs/records/2026-06/2026-06-03-overlay-workbench-page-prd.md` previously required probes and SQL templates           | This task supersedes that debug-blob copy detail: the double-click copy now stays concise.                 |

## Acceptance

- Double-click Workflow debug copy keeps task identity, directory, server URL,
  session/run, timestamps, and per-goal summary lines.
- The copied blob no longer contains `Notes:`, project-scoped HTTP probes, or
  SQL templates.
- No second debug source, compatibility path, or fallback copy behavior is
  introduced.
- `packages/overlay/test/task-debug-info.test.ts` passes and prevents the
  removed verbose sections from returning.
