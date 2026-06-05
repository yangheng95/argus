# 2026-06-05 Diff Preview VCS Backfill Plan

## Problem

The Files panel can show a changed file row with additions/deletions while the Diff view renders `diff.no_preview`. The row can be a board/agent stub that has stats but no `before`/`after` body. `resolveDiff()` currently only upgrades stubs from acceptance endpoints (`/goal-run/:goalRunID/acceptance` or `/run/:runID/acceptance`). If that source has no full blob for the clicked file, the renderer receives the stub and has nothing to display.

## Call-Point Audit

`rg resolveDiff/currentChangeGroups/changedFileDiffs/DiffTarget` found these relevant call sites:

| Surface | Current behavior | Change |
| --- | --- | --- |
| `packages/overlay/src/components/ChangesPanel.tsx` | Click creates `DiffTarget`, eagerly calls `resolveDiff()`, then opens the workspace diff. | Keep. |
| `packages/overlay/src/components/DiffPreviewPanel.tsx` | Resource calls `resolveDiff(target)` and renders `DiffView` only when a `FileChange` is returned. | Keep. |
| `packages/overlay/src/services/diff.ts` | Builds board groups, fetches acceptance diffs, and resolves one file by exact path. | Add VCS diff backfill after acceptance lookup misses full body. |
| `packages/overlay/src/services/meta.ts` | `normalizeDiffs()` normalizes acceptance diff rows. | Reuse through `normalizeAcceptanceDiffs`; no parallel status normalization. |
| `packages/opencorvus/src/server/routes/app.ts` | Existing `GET /vcs/diff` route returns `Vcs.FileDiff[]`. | Use this mature source; do not implement filesystem diffing in overlay. |
| `packages/opencorvus/src/project/vcs.ts` | Existing VCS diff implementation returns `file`, `before`, `after`, stats, and status. | No change. |

## Implementation

1. Add a cached `fetchVcsDiffs()` in `packages/overlay/src/services/diff.ts` using `apiJson("vcs/diff")`.
2. Add normalized path matching so acceptance and VCS rows match `a/`, `b/`, slash, absolute/relative, and display-path variants consistently.
3. In `resolveDiff()`, after scoped acceptance lookup fails to return a full body, query VCS diffs and return the matching full row before falling back to the stub.
4. Add focused overlay tests:
   - acceptance empty/stub first, VCS diff full body second, preview resolves;
   - VCS empty result is not cached over later full content.

## Verification

Run the focused diff tests first:

```powershell
bun test packages/overlay/test/diff-resolve-inflight-cache.test.ts
```

If the focused test passes and time allows, run the existing diff engine test:

```powershell
bun test packages/overlay/test/diff-view-engine.test.ts packages/overlay/test/diff-change-groups.test.ts
```
