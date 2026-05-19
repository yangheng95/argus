# Worktree submodule initialization

## Problem

The task reported that `Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\GgtNetBuy` did not exist, while the directory exists in the selected project checkout.

Evidence collected on 2026-05-19:

- `C:\Users\chuan\myhexin-local\demos\VibeCodingClient-dev\Hithink.PrefabLibrary\PrefabLibrary\PrefabLibrary\Business\GgtNetBuy` exists in the primary checkout.
- The generated build worktrees under `.opencorvus\worktrees\build-phase-0-1` and `.opencorvus\worktrees\build-ggtnetbuy` do not contain that path.
- The primary repo tracks `Hithink.PrefabLibrary` as git mode `160000`, so it is a gitlink/submodule pointer in the parent repository.
- The nested repository itself tracks the C# files:
  - `PrefabLibrary/PrefabLibrary/Business/GgtNetBuy/Models/GgtNetBuyModel.cs`
  - `PrefabLibrary/PrefabLibrary/Business/GgtNetBuy/ViewModels/GgtNetBuyViewModel.cs`
  - `PrefabLibrary/PrefabLibrary/Business/GgtNetBuy/Views/GgtNetBuyView.xaml`
  - `PrefabLibrary/PrefabLibrary/Business/GgtNetBuy/Views/GgtNetBuyView.xaml.cs`
  - `PrefabLibrary/PrefabLibrary/Business/GgtNetBuy/新增港股通净买入.md`

Root cause: `Worktree.create` runs `git worktree add --no-checkout` and then `git reset --hard`, but does not initialize recursive submodules in the new worktree. Build agents then search an incomplete filesystem and produce a false "directory missing" conclusion.

## Call sites

`Worktree.create` is the single implementation to change. Grep results that matter:

| Caller | Decision |
| --- | --- |
| `packages/opencorvus/src/orchestrator/tools.ts` | Covered by shared `Worktree.create`; build goals must receive initialized submodules. |
| `packages/opencorvus/src/workspace/workspace.ts` | Covered by shared `Worktree.create`; manually created workspace worktrees should behave the same. |
| `packages/opencorvus/src/server/routes/experimental.ts` | Covered by shared `Worktree.create`; HTTP worktree creation should expose the same behavior. |
| `packages/opencorvus/test/project/*` and `packages/opencorvus/test/engine/*` | Existing tests remain valid; add a regression test for submodule population. |

Existing submodule behavior already appears in `Worktree.reset`, which runs `git submodule update --init --recursive` after reset. Creation must match that lifecycle instead of relying on later reset.

## Review note

The first regression run exposed a second root cause for local nested repositories: `git submodule update` invoked by automation rejects local-path submodule URLs with `fatal: transport 'file' not allowed`. This is not a separate fallback path; it is part of the same worktree materialization contract. Worktree creation and reset both need the same explicit submodule update command shape so committed local submodules are materialized consistently.

The follow-up task `tsk_e3ee60d930015T6CcWnjsy8EM5` exposed a third, project-specific shape: `Hithink.PrefabLibrary` is recorded as a gitlink (`160000`) but there is no `.gitmodules` URL entry for that path. The primary checkout still has a real nested Git repository at `Hithink.PrefabLibrary`. Plain `git submodule update` cannot resolve that shape and fails with `fatal: No url found for submodule path 'Hithink.PrefabLibrary' in .gitmodules`.

This must be handled as one materialization contract for gitlinks, not as a prompt workaround:

- URL-backed gitlinks use `git submodule update --init`.
- URL-less gitlinks must be materialized from the primary checkout's same-path nested Git repository and checked out at the exact gitlink commit recorded by the parent repository.
- Missing local source repositories or missing commits are hard errors.
- Reset cleanup cannot use `git submodule foreach`, because it has the same `.gitmodules` dependency. It must recurse through `160000` gitlinks directly.

## Plan

1. Replace the bare submodule helper in `packages/opencorvus/src/worktree/index.ts` with a gitlink materialization helper.
2. List gitlinks from `git ls-files --stage -z` so `160000` entries are the single source.
3. Read URL-backed submodule paths from `.gitmodules` using `git config`, not text parsing.
4. For URL-backed paths, run `git -c protocol.file.allow=always submodule update --init` for those explicit paths.
5. For URL-less paths, clone from the primary checkout's same-path nested repository into the created worktree and `git reset --hard` to the gitlink object ID.
6. Invoke this immediately after the successful `git reset --hard` population step and before startup scripts.
7. Route the existing reset-time submodule update through the same materialization helper with force semantics, preserving reset behavior without a parallel command shape.
8. Replace reset-time `git submodule foreach` cleanup with direct recursive reset/clean over materialized gitlinks.
4. Use the existing `network` git timeout profile because recursive submodule initialization may fetch.
5. Fail loud with `WorktreeCreateFailedError` on create-time submodule errors and `WorktreeResetFailedError` on reset-time submodule errors. The existing create cleanup path must remove the incomplete worktree and sandbox row.
6. Add a regression test that creates a parent repository with a real local-path submodule, calls `Worktree.create`, and asserts the submodule file is present in the new worktree.

## Acceptance

- `Worktree.create` output contains recursive submodule files for committed gitlinks.
- Local-path submodule URLs work in automated worktree creation.
- URL-less gitlinks backed by the primary checkout's nested Git repository are materialized in created worktrees.
- Non-submodule repositories still create valid worktrees.
- Submodule initialization failure is not hidden or downgraded.
- Targeted worktree tests pass.
