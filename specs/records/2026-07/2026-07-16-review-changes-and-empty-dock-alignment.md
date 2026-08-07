# Review Changes Surface And Empty Dock Alignment

## Recall

| Item                             | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement                 | Remove the Review panel's secondary heading, show Changes by default, hide the Diff tab button, keep the empty Right Dock catalog centered as a group, and left-align all catalog labels.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| Acceptance criteria              | Opening Review renders the Changes list without a secondary toolbar or visible Changes/Diff tab controls; an explicit file-diff request can still use the existing programmatic diff projection; the empty catalog stays centered while every icon and label shares a stable left column; desktop screenshot review passes.                                                                                                                                                                                                                                                                                                                                                                       |
| Hard constraints                 | Keep Right Dock as the only visible Review title owner; retain one diff data source; do not add compatibility, fallback, state-machine, iframe, query override, or local preview state; use the existing Button primitive and task-scoped browser fixture; run Playwright with Node on Windows; do not disturb unrelated dirty-worktree edits or a running Overlay process.                                                                                                                                                                                                                                                                                                                       |
| Sources read                     | `AGENTS.md`; Browser control skill; `2026-07-14-right-dock-panel-ownership-and-browser-draft.md`; current `RightDock.tsx`, `FileChangesPanel.tsx`, `FileChangesView.tsx`, `main.tsx`, Button primitive, activity/workspace styles, and focused/browser tests.                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| Whole-repository search evidence | `FileChangesPanel` is mounted only from `main.tsx`; visible secondary Review controls exist only in `FileChangesPanel.tsx` with styling in `activity.css`; `fileChangesActiveView` is owned only by `main.tsx`; direct diff requests enter through `openWorkspaceDiff -> openWorkspace`, while selecting the Review Dock panel enters through `openDiffActivity`; empty catalog DOM exists only in `RightDock.tsx`, with layout only in `workspace.css`; relevant assertions are in `acceptance-panel-mount`, `center-workbench-header-consistency`, `file-explorer-editor`, `overlay-startup-chrome-parity`, `right-dock-panel-ownership`, `tabs-primitive`, and the two toolbar browser suites. |
| Independent agent feedback       | None; the user did not request sub-agents, so the repository delegation constraint keeps this task single-agent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |

## Root Cause

Review already has a canonical title in the Right Dock tab, but `FileChangesPanel`
adds an empty `SurfaceHeader` whose only content is a second Changes/Diff switcher.
That duplicates navigation chrome even though the Changes list already expands a
file's diff inline. Separately, the empty catalog uses Button, whose primitive
centers children with `justify-content: center`; each label therefore centers as
an independent row despite the catalog container itself being correctly centered.

## Call-Site Disposition

| Surface                | Change                                                                                                                                                                                                                           |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `FileChangesPanel.tsx` | Remove the secondary `SurfaceHeader` and visible Tabs controls; render Changes for ordinary Review selection, while retaining the existing programmatic diff body for explicit file-diff requests.                               |
| `main.tsx`             | Make ordinary Review selection explicitly choose Changes; retain `openWorkspaceDiff` as the only programmatic path that chooses Diff.                                                                                            |
| `activity.css`         | Delete styles owned only by the retired secondary toolbar and tab controls.                                                                                                                                                      |
| `workspace.css`        | Override Button's centering at the empty-catalog item boundary so the shared grid starts at one left edge; preserve the centered list container.                                                                                 |
| tests                  | Replace obsolete tab/header expectations with single-title/default-Changes assertions and add the fixed left-column geometry contract. Update the real browser fixture to assert no secondary controls and inspect a screenshot. |

## Verification Plan

- Focused Bun tests for Review ownership, workspace wiring, Tabs consumers, and empty catalog geometry.
- Overlay TypeScript check and production Vite build.
- Node-driven browser fixture at desktop size, with DOM geometry assertions and screenshots for Review and the empty catalog.
- Visual inspection of current-goal screenshots, followed by a second diff review.
- Selective commit with `dsw-33987` prefix and push to the git-cc remote.

## Progress

- [x] Read governing records and enumerate all call sites.
- [x] Implement Review and empty-catalog layout changes.
- [x] Run focused, build, and real-browser verification.
- [x] Inspect screenshots and complete second review.
- [x] Commit and push the selective delivery.

## Verification Result

- PASS: 23 focused Review, Right Dock, Tabs primitive, workspace wiring, and
  single-title ownership tests (678 assertions).
- PASS: Overlay TypeScript check.
- PASS: production Vite build (2456 modules).
- PASS: dedicated Node/Playwright desktop fixture. It proves the empty catalog
  stays centered within one pixel, all icon left edges match within one pixel,
  all label left edges match within one pixel, labels compute to `text-align:
left`, Review opens with `data-active-view="changes"`, and no secondary
  header or Changes/Diff tab DOM exists.
- PASS: historical links and product-document single-source checks. The broader
  document-health batch has one known dirty-worktree failure because several
  other July records are linked but still untracked by concurrent work; it is
  unrelated to this record's local link resolution.
- Diagnostic only: the two pre-existing large browser suites reached the new
  Review behavior but later failed on unrelated concurrent Pin icon and
  notification-detail assertions. The dedicated fixture isolates this task
  instead of weakening those checks.

## Visual Review

- `packages/overlay/.scratch/right-dock-empty-tools-left-aligned.png` shows the
  catalog centered at the current desktop viewport while icon and label columns
  share stable left edges.
- `packages/overlay/.scratch/right-dock-review-changes-only.png` shows the Right
  Dock `Review` title followed immediately by the Changes empty state, without
  secondary chrome or residual vertical spacing.

## Second Review

- Right Dock remains the only visible Review title owner.
- Ordinary Review selection explicitly chooses Changes. Explicit file-diff
  requests still use the existing `openWorkspaceDiff -> openWorkspace` path and
  the existing diff service; no alternate diff source was added.
- Retired secondary Tabs imports, props, DOM, and CSS were deleted together.
- The empty catalog continues to use the shared Button primitive; only this
  catalog's layout boundary overrides the primitive's centered child alignment.
- Existing unrelated dirty-worktree edits remain outside this task's delivery.

## Delivery Result

- Implementation commit: `3241f1498` (`dsw-33987 simplify Review changes
  surface alignment`).
- The git-cc `work-v0.0.6beta-yr-0716` branch was fetched at the same commit
  after the focused tests, TypeScript, i18n, production build, dedicated
  browser fixture, screenshot inspection, and second review passed.
- Concurrent unstaged additions in the two shared spec indexes were preserved
  in the worktree instead of being folded into this task's implementation
  commit.
