# 2026-07-08 Right Toolbar Runtime Status Panel Merge

## Recall

- User request: "把右下角的worktree和git状态panel合并，而且图标也要永新选". I interpret `永新选` as "重新选": replace the visible glyph choice while merging the Worktree and Git status surfaces.
- Acceptance criteria: the right-bottom runtime area exposes one dropdown entry for project runtime state; Worktree list, cleanup/delete actions, Git branch/clean/dirty/ahead/behind status, and Init Git action live in that dropdown; no standalone compact `VcsBadge` remains in the right toolbar; icons are selected from the existing `Icon` single-source registry backed by `lucide-solid`; focused tests and a browser screenshot verify the merged panel.
- Hard constraints: no fallback, no compatibility alias, no second visual/status source, no broad git reset, no new git worktree, preserve unrelated dirty changes, do not restart or refresh the user's running OpenCorvus/overlay process, use Kobalte DropdownMenu and existing Button/Icon primitives, run Playwright through the Node browser runner on Windows.
- Sources read before edits: `AGENTS.md`; `specs/README.md`; `specs/records/2026-07/README.md`; `specs/current/architecture/07-panel.md`; `specs/records/2026-07/2026-07-08-cwd-project-control-right-toolbar.md`; `packages/overlay/src/components/TaskDirBar.tsx`; `packages/overlay/src/components/Icon.tsx`; `packages/overlay/src/styles/surfaces/activity.css`; `packages/overlay/src/styles/surfaces/conversation.css`; `packages/overlay/src/main.tsx`; `packages/overlay/src/utils/i18n.ts`; `packages/overlay/src/utils/git.ts`; `packages/overlay/src/services/meta.ts`; `packages/overlay/test/task-cwd-row-layout.test.ts`; relevant browser tests under `packages/overlay/test/browser/task-dirbar-keyboard.test.ts`.
- Existing dirty worktree: before this task, the worktree already contained unrelated changes. This task must not revert or overwrite those changes.
- Whole-repository grep evidence:
  - `rg -n "ProjectRuntimeToolbarActions|ProjectWorktreeDropdown|VcsBadge|project-worktree-dropdown|project-vcs-badge|vcs-badge-compact|project-runtime-toolbar-actions" packages/overlay/src packages/overlay/test specs/current specs/records/2026-07`
  - `rg -n "worktree\\.|git\\.|vcs\\.|chat\\.git|project-runtime|activity\\.tooltip|project-vcs" packages/overlay/src packages/overlay/test`
  - `rg -n "GitBranch|GitFork|GitCommit|GitCompare|GitPullRequest|GitMerge|FolderGit|Network|FolderTree" packages/overlay/node_modules/lucide-solid/dist`
- Independent agent feedback: not spawned because current tool policy only permits sub-agents when the user explicitly asks for delegation or parallel agent work. The implementation gets a focused self-review after tests and screenshot review instead.

## Current Cause

The previous July 8 change correctly moved project worktree and Git runtime controls into the right activity toolbar, but the surface remained visually split:

- `ProjectRuntimeToolbarActions` renders `<ProjectWorktreeDropdown compact />`, `<InitGitButton compact />`, and `<VcsBadge compact />` as separate right-bottom entries.
- `ProjectWorktreeDropdown` owns the Kobalte panel and `/project/current/worktrees` actions.
- `VcsBadge` owns the Git status projection from `boardStore.vcs` but has no shared panel with Worktree.
- `InitGitButton` is a separate compact button when `canInitGit()` is true.

This makes the right-bottom runtime cluster look like multiple panels even though all three represent one project runtime status surface.

## Design Decision

Replace the right-toolbar cluster with one runtime dropdown component:

1. `ProjectRuntimeStatusDropdown` becomes the only component rendered by `ProjectRuntimeToolbarActions`.
2. The dropdown trigger uses a new `git-worktree` icon from the centralized `Icon` registry.
3. The dropdown content has a Git status section and a Worktree section in one Kobalte `DropdownMenu.Content`.
4. Git status still reads only `boardStore.vcs`; Worktree state still reads only `loadProjectWorktrees(projectDirectory)`. No duplicated store, no DOM-derived status.
5. Init Git moves into the Git section and remains backed by `initGitCurrent()`.
6. The standalone compact `VcsBadge` is deleted from the right toolbar path; helper functions may remain only if they are used by the merged dropdown.
7. Browser selectors should move to the new runtime dropdown/panel names instead of preserving old selector aliases.

## Implementation Plan

1. Extend `Icon.tsx` with Lucide-backed `git-worktree`, `git-branch`, `git-branch-plus`, `git-commit`, and `git-compare` names.
2. Refactor `TaskDirBar.tsx`:
   - rename the worktree dropdown entry to `ProjectRuntimeStatusDropdown`;
   - include the Git status summary and Init Git action inside the panel;
   - remove the right-toolbar standalone `VcsBadge` usage;
   - use the new icons in trigger, section headings, branch/commit rows, and init action.
3. Update `conversation.css` and `activity.css`:
   - style one compact runtime trigger;
   - style the merged runtime panel and Git section;
   - keep worktree row density unchanged.
4. Update i18n strings in `en-US.json` and `zh-CN.json`.
5. Update focused source tests and browser tests to assert the single merged entry and panel.
6. Verify with focused tests, typecheck, i18n check, docs link check, `git diff --check`, and Node-runner browser screenshot review.

## Verification Plan

```powershell
bun test packages/overlay/test/task-cwd-row-layout.test.ts --timeout 90000
bun test packages/overlay/test/overlay-architecture-guards.test.ts -t "project runtime controls" --timeout 90000
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
git diff --check
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-runtime-status-panel.test.ts
```

Visual review must use the generated screenshot for the merged runtime panel and confirm:

- right-bottom toolbar has one project runtime control for Worktree + Git status;
- the trigger icon is the new Git-worktree glyph, not the old folder-only or GitHub glyph;
- the dropdown contains both Git status and Worktree sections;
- worktree delete/cleanup, Escape close, and Kobalte highlighted row behavior still work.

## Implementation Result

- `ProjectRuntimeToolbarActions` now renders only `ProjectRuntimeStatusDropdown`.
- The merged panel uses one Kobalte `DropdownMenu.Content` with a Git status section and a Project worktrees section.
- Git state reads from the existing `boardStore.vcs` projection; Worktree state remains loaded through `/project/current/worktrees`.
- Init Git moved into the Git section and still calls `initGitCurrent()`.
- The visible trigger icon and panel Git glyphs are centralized through `Icon.tsx` names backed by Lucide: `git-worktree`, `git-branch`, `git-branch-plus`, `git-commit`, and `git-compare`.
- CSS ownership stays in `activity.css` for the compact trigger and `conversation.css` for the dropdown panel.

## Verification Result

- Passed: `bun test packages/overlay/test/task-cwd-row-layout.test.ts --timeout 90000`
- Passed: `bun test packages/overlay/test/overlay-architecture-guards.test.ts -t "project runtime controls" --timeout 90000`
- Passed: `bun run --cwd packages/overlay typecheck`
- Passed: `bun run --cwd packages/overlay check:i18n`
- Passed: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/project-runtime-status-panel.test.ts`
- Passed: `git diff --check` for touched files.
- Passed: old standalone implementation grep found no active `ProjectWorktreeDropdown`, `VcsBadge`, `InitGitButton`, `project-worktree-dropdown`, `project-vcs-badge`, `vcs-badge`, or `project-worktree-panel` in `packages/overlay/src` / `packages/overlay/test`.
- Raw color scan: addition-only diff scan found one computed transparent color string in browser test assertion; no implementation TSX/CSS token value was added as a raw color.
- Visual evidence reviewed: `.scratch/task-dirbar-runtime-status-panel-merged.png` and `.scratch/task-dirbar-runtime-status-expanded-state.png`.

## Follow-up Notes

- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/popup-contrast-matrix.test.ts` currently fails on the existing recent-directory disabled submit opacity assertion (`0.85` vs `1`), not on the runtime panel sample. This was not changed to avoid masking an unrelated surface issue.
