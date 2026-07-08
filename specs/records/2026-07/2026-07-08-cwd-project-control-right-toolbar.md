# 2026-07-08 Opened Project Management And Right Toolbar Git Surface

## Recall

| Item | Detail |
| --- | --- |
| User request | Initial request: "把cwd控件的功能完整消融到mission/任务列表的项目控件上，然后把worktree，git合并移动到右侧toolbar". Follow-up correction after visual review: "不是，你把这个控件删了吧。做好已打开项目的管理就够了". |
| Product direction already established | The left Mission / Task / Chat entries are unified in one Work Ledger panel, and Task rows owned by a Mission appear under that Mission instead of being duplicated as standalone rows. |
| Acceptance criteria | The old top cwd project bar is no longer mounted; the newly introduced project-group cwd/recent/detected-projects popup is removed rather than relocated; Work Ledger project groups manage only already-opened projects and their explicit project actions; project worktree management and Git status/init controls render through the right activity toolbar; no second cwd/worktree/git source remains in the old top bar or project group; focused tests cover the retired cwd controls and right-toolbar ownership; visual verification checks that no cwd/recent popup entry remains. |
| Hard constraints | No fallback, compatibility alias, double source, or gate; no broad git reset; preserve existing dirty worktree changes; do not restart or refresh the user's running OpenCorvus / overlay window; use Kobalte primitives already used by the project; frontend work requires screenshot review on an isolated page. |
| Read before editing | `specs/records/2026-07/2026-07-08-mission-task-chat-toolbar-consolidation-impact.md`; `specs/current/architecture/07-panel.md`; current `TaskDirBar.tsx`, `ProjectLedgerGroup.tsx`, `WorkLedger.tsx`, `App.tsx`, `main.tsx`, `index.html`, `activity.css`, `conversation.css`, and `work-ledger.css`. |
| Dirty worktree note | The repository already has many unrelated modified and untracked files, including prior overlay and expert-squad work. This change must touch only the files needed for the requested UI ownership shift and must not revert unrelated content. |

## Grep Evidence

Command:

```powershell
rg -n "ProjectDirectoryBar|TaskDirContent|ProjectWorktreeDropdown|InitGitButton|VcsBadge|solidProjectDirectoryBarMount|workbench-project-bar|SideActivityToolbar|ProjectLedgerGroup|task-cwd|cwd\.|worktree|git" packages/overlay/src packages/overlay/test specs/records/2026-07 specs/current/architecture
```

Findings:

- `packages/overlay/src/index.html` owns the old static top project bar with `solidProjectDirectoryBarMount` inside `.workbench-project-bar`.
- `packages/overlay/src/components/App.tsx` mounts `ProjectDirectoryBar` into that old host.
- `packages/overlay/src/components/TaskDirBar.tsx` owns the legacy cwd popover code and the project worktree dropdown, `InitGitButton`, and `VcsBadge` in one component file.
- `packages/overlay/src/components/ProjectLedgerGroup.tsx` is the shared project-group primitive for left ledger group headers.
- `packages/overlay/src/components/WorkLedger.tsx` renders Mission / Task / Chat rows through `ProjectLedgerGroup`.
- `packages/overlay/src/main.tsx` renders the right `SideActivityToolbar`; `SideActivityToolbar` already exposes a `trailing` slot that can host project runtime controls without a new toolbar implementation.
- `packages/overlay/test/task-cwd-row-layout.test.ts` must assert both the old top-row cwd mount and the project-group cwd popup are retired so tests do not preserve the deleted UI as a hidden source.
- `packages/overlay/test/app-shell.test.ts` still expects `ProjectDirectoryBar` under `App` and must be updated.

## Design Decision

- Work Ledger is the single owner of already-opened project grouping, not cwd discovery or directory switching.
- The project-group cwd/recent/detected-projects popup is deleted. The previous refactor that exposed `ProjectDirectoryControl` from `TaskDirBar.tsx` is explicitly superseded because it preserved a control the user does not want.
- `ProjectLedgerGroup` only renders explicit project actions supplied by callers, such as copy/rename/delete. It does not render cwd path switching, manual path entry, recent directories, detected projects, or browse/open breadcrumb actions.
- The old `ProjectDirectoryBar` mount is deleted from `App.tsx` and `index.html`; no hidden or empty top cwd bar remains.
- `ProjectWorktreeDropdown`, `InitGitButton`, and `VcsBadge` remain in `TaskDirBar.tsx` but are composed as `ProjectRuntimeToolbarActions` and passed into `SideActivityToolbar.trailing` from `main.tsx`.
- Right-toolbar controls use compact icon button chrome and retain the existing Kobalte DropdownMenu worktree panel; the Git badge remains read-only status backed by `boardStore.vcs`, and the init button remains the explicit action backed by `initGitCurrent`.

## Implementation Steps

1. Refactor `TaskDirBar.tsx`:
   - Delete `TaskDirContent`, `ProjectDirectoryBar`, `ProjectDirectoryControl`, and the cwd popover's manual path input, recent directories, discovered project list, delete-recent action, and breadcrumb path action handlers.
   - Keep only the right-toolbar `ProjectRuntimeToolbarActions` for worktree/Git runtime controls.
   - Make worktree/git controls compact when rendered in the right toolbar.
2. Remove `ProjectDirectoryControl` from `ProjectLedgerGroup`; Work Ledger project headers manage already-opened groups and explicit caller-provided project actions only.
3. Remove the old top cwd mount from `App.tsx` and `index.html`.
4. Pass `ProjectRuntimeToolbarActions` into the right `SideActivityToolbar` trailing slot from `main.tsx`.
5. Delete project-group cwd popup styles and keep right toolbar compact runtime styles.
6. Replace old top-cwd tests with source tests that assert the new single-source ownership and retired mount.
7. Run focused tests, typecheck, i18n checks, diff check, and isolated visual verification.

## Verification Plan

```powershell
bun test packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/app-shell.test.ts packages/overlay/test/project-delete-button.test.ts
bun test packages/overlay/test/composer-file-loader-right-toolbar.test.ts packages/overlay/test/work-ledger-consolidation.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
git diff --check
```

Visual verification must use an isolated dev server and Playwright launched via Node on Windows, with screenshots reviewed for:

- no blank old top cwd strip;
- Work Ledger project groups do not expose cwd/recent/detected-project selector actions;
- right toolbar remains hover-revealed and shows compact worktree/Git controls in the trailing area.

## Implementation Notes

- Follow-up visual review rejected the project-group cwd popup. `ProjectDirectoryControl` is removed from `ProjectLedgerGroup`; the old `ProjectDirectoryBar` / `TaskDirContent` mount path remains removed from `App.tsx` and `index.html`.
- `ProjectRuntimeToolbarActions` now composes `ProjectWorktreeDropdown compact`, `InitGitButton compact`, and `VcsBadge compact` through `SideActivityToolbar.trailing`.
- Visual QA found that the first project-action implementation overlaid action buttons on top of the project toggle. The hidden toggle chevron intercepted pointer events. The final CSS uses the project-group header's second grid column for explicit project actions rather than an absolute overlay.
- `index.html` changed, so both locale catalogs were updated to panel revision `cb0fb8c63ed25325`.

## Verification Results

```powershell
bun test packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/app-shell.test.ts packages/overlay/test/project-delete-button.test.ts packages/overlay/test/recent-dir-remove-hover-layout.test.ts packages/overlay/test/composer-file-loader-right-toolbar.test.ts packages/overlay/test/work-ledger-consolidation.test.ts
# 21 pass

bun test packages/overlay/test/overlay-architecture-guards.test.ts -t "project runtime controls|task bar and task status|retired field input|directory, sidebar"
# 4 pass

bun run --cwd packages/overlay typecheck
# pass

bun run --cwd packages/overlay check:i18n
# overlay panel i18n ok (cb0fb8c63ed25325)

bun test packages/opencorvus/test/script/historical-docs-links.test.ts
# 20 pass

git diff --check
# pass
```

Superseded visual verification from the first implementation used `.scratch/cwd-project-right-toolbar.png`; that screenshot showed the project-group cwd popup and therefore does not satisfy the corrected requirement.

Corrected visual verification used an isolated Vite dev server on `http://127.0.0.1:5278/` plus Playwright mock API data. Screenshot: `.scratch/opened-project-management-right-toolbar.png`.

Observed screenshot state:

- `topProjectBar: false`, proving the old `workbench-project-bar` / `solidProjectDirectoryBarMount` gap is not present.
- `projectDirectoryControl: false`, `recentDirPanel: false`, and `cwdPathInput: false`, proving the project-group cwd/recent/detected-project selector is removed rather than hidden.
- `projectGroups: 1`, proving Work Ledger still renders already-opened project management.
- `rightToolbarRuntime: true`, `worktreeButton: true`, and `vcsBadge: true`, proving the right toolbar still owns worktree/Git runtime controls.

Known unrelated validation noise: a full unfiltered `overlay-architecture-guards.test.ts` run still fails pre-existing/stale assertions around `sidebar-new-task-button`, `prompt-preview-card`, and `SkillMarketPanel` SettingsGroup counts. The cwd/project/right-toolbar subtests added or updated for this change pass.
