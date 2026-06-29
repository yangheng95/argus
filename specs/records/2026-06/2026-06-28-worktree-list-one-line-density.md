# 2026-06-28 Worktree List One-Line Density

## Requirement

Project worktree dropdown rows must render each worktree item as one compact
line. The status, branch, path, and remove action must remain visible or
ellipsized within the row without creating a second row.

## Recall

| Source | Relevant constraint |
| --- | --- |
| `2026-06-09-cwd-worktree-dropdown.md` | `TaskDirBar.tsx` owns the project worktree dropdown in the cwd row. It must remain a compact worktree management surface. |
| `2026-06-18-project-worktree-remove-button-primitive.md` | Worktree remove action stays on the shared `Button` primitive and keeps `data-ui="project-worktree-remove"`. |
| `2026-06-27-worktree-cleanup-adversarial-repair.md` | Project worktree UI/API cleanup semantics are already owned by the current service flow; this density change must not alter deletion or cleanup behavior. |

## Call Point Sweep

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "project-worktree-item|project-worktree-row|project-worktree-panel|project-worktree-path|project-worktree-branch|project-worktree-state" packages/overlay/src packages/overlay/test specs` | Production render owner is `TaskDirBar.tsx`; CSS owner is `conversation.css`; static coverage is `task-cwd-row-layout.test.ts`; browser coverage is `task-dirbar-keyboard.test.ts`; contrast fixture is `popup-contrast-matrix.test.ts`. | Change only the row layout CSS plus tests that assert the row contract. |
| `git diff -- packages/overlay/src/components/TaskDirBar.tsx packages/overlay/src/styles/surfaces/conversation.css packages/overlay/test/task-cwd-row-layout.test.ts packages/overlay/test/browser/task-dirbar-keyboard.test.ts` | These files already contain unrelated in-progress worktree cleanup and cwd popup changes. | Preserve current working-tree logic and edit only the one-line worktree row contract. |

## Fix Plan

1. Keep the existing `TaskDirBar.tsx` DOM and service behavior unchanged.
2. Change `.project-worktree-item` from two-row grid areas to one-row columns:
   name, path, state, branch.
3. Lower row height and padding to match a compact single-line popup row.
4. Keep each text segment `min-width: 0`, `text-overflow: ellipsis`, and
   `white-space: nowrap`.
5. Update static layout assertions and add browser evidence that row heights are
   compact one-line rows.

## Acceptance

- No `.project-worktree-item` uses a two-row grid area.
- Each visible worktree row remains under a compact one-line height.
- Long branch/path text ellipsizes instead of wrapping or resizing the row.
- Worktree delete and cleanup behavior is unchanged.
