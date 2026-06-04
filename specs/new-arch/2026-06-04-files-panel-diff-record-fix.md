# Files Panel Diff Record Fix

Date: 2026-06-04

## Symptom

The Files panel can show hundreds of changed-file rows with `+0/-0`. Clicking a row opens the Diff view, waits for the lazy acceptance lookup, then renders "no preview".

## Call-Point Audit

| Surface | File | Decision |
| --- | --- | --- |
| Files panel source merge | `packages/overlay/src/components/ChangesPanel.tsx` | Keep as the single UI entry. It merges board-derived acceptance groups with agent-derived structured file evidence. |
| Diff lazy lookup | `packages/overlay/src/services/diff.ts` | Keep. It resolves only acceptance-backed `runID` / `goalRunID` diffs. |
| Agent file extraction | `packages/overlay/src/utils/file-change-summary.ts` | Change. Do not promote bare tool input paths or string-only patch file lists into diff rows. |
| Inline tool file display | `packages/overlay/src/components/InlineToolPart.tsx` | Keep reading `toolFileChangesFromState`; it already depends on structured tool metadata. |
| Tests | `packages/overlay/test/agent-file-changes.test.ts`, `packages/overlay/test/diff-resolve-inflight-cache.test.ts` | Update/add targeted regression coverage for non-diff path inputs and acceptance stat hydration. |

## Root Cause

`file-change-summary.ts` treated completed `write` / `edit` tool input paths and string-only patch file lists as `FileChange` rows. Those rows are only path mentions: they do not carry `before` / `after`, additions, deletions, `runID`, or `goalRunID`.

`DiffPreviewPanel` resolves by calling `resolveDiff(target)`, which deliberately reads acceptance diffs. For unscoped agent-only path rows there is no acceptance target, so the UI shows rows that cannot produce a diff.

## Fix

Use structured diff evidence as the Files panel source:

- Keep tool `metadata.files` and `metadata.filediff`, because they can carry before/after and real stats.
- Keep object-shaped patch entries only when they normalize like a real diff.
- Stop converting bare tool input paths into file changes.
- Stop converting string-only patch file paths into file changes.

Board/acceptance `changedFileDiffs` remains the canonical source for final per-file additions/deletions and full diff lazy loading.

## Regression Assertions

- A completed write/edit tool with only an input path does not create a Files row.
- A string-only patch part does not create a Files row.
- Structured tool metadata still creates rows with stats and preview content.
- Acceptance rows still merge with agent rows by goal-run and provide stats/diff.
