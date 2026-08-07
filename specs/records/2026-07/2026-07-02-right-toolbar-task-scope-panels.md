# 2026-07-02 Right Toolbar Task Scope Panels

## Recall

- User request: move Inspector's req, arch, and goals into separate right-side
  toolbar controls, improve layout and visual design, then delete the historical
  Inspector panel.
- Acceptance criteria:
  - The right activity toolbar exposes separate Requirements, Architect, and
    Goals controls.
  - The old Inspector right activity and static Inspector panel are removed
    from the HTML shell and `main.tsx` panel registry.
  - Requirements, Architect, and Goals continue to read from the existing
    `boardStore` projection; no second source of truth, fallback, compatibility
    path, or duplicated task data is introduced.
  - Layout remains usable when multiple right toolbar panels are open side by
    side, because current center-workbench activities are multi-open rather than
    tab-exclusive.
  - Visual QA must use a real rendered overlay page and screenshot review.
- Hard constraints:
  - No fallback / compatibility / gate behavior.
  - No git reset or broad revert.
  - Existing dirty file `packages/opencorvus/src/provider/models-snapshot.ts`
    is unrelated and must not be staged.
  - Do not restart or interfere with a running OpenCorvus / overlay process;
    use an isolated dev server for visual verification.
  - Playwright must be launched with Node on Windows.
  - Code changes require tests, plus post-benchmark/manual review.
- Disk sources read:
  - `AGENTS.md`
  - `specs/README.md`
  - `specs/records/2026-07/README.md`
  - `specs/current/architecture/07-panel-reactivity.md`
  - `specs/records/2026-06/right-sidebar-opencode-tui-copy-implementation-plan-2026-06-04.md`
  - `specs/records/2026-06/right-sidebar-opencode-tui-upgrade-2026-06-04.md`
  - `packages/overlay/src/index.html`
  - `packages/overlay/src/main.tsx`
  - `packages/overlay/src/components/Board.tsx`
  - `packages/overlay/src/components/RequirementsPanel.tsx`
  - `packages/overlay/src/components/ArchitectPanel.tsx`
  - `packages/overlay/src/components/GoalWorkflowGroup.tsx`
  - `packages/overlay/src/components/SideActivityToolbar.tsx`
  - `packages/overlay/src/styles/surfaces/activity.css`
  - `packages/overlay/src/styles/surfaces/inspector.css`
  - `packages/overlay/src/styles/surfaces/workspace.css`
  - `packages/overlay/test/acceptance-panel-mount.test.ts`
  - `packages/overlay/test/right-panel-tabs-flat.test.ts`
- Whole-repository grep evidence:
  - `rg -n "inspector|Inspector|rightPanelInspector|right-activity|right toolbar|toolbar" packages/overlay/src packages/overlay/test specs/records/2026-06/...`
  - `rg -n "<Board|solidBoardMount|AcceptancePanel|requirementsSection|architectSection|goalWorkflowsSection" packages/overlay/src packages/overlay/test -S`
  - `rg -n "activity\\.tooltip\\.inspector|sections\\.title|workflow\\.requirements|workflow\\.architect|workflow\\.goals|right_panel\\.inspector" packages/overlay/src packages/overlay/test -S`
  - `rg -n "TaskActionsPanel|taskActionsBar|onRetry|retrySelectedTask|cancelSelectedTask|AcceptancePanel|acceptanceSection|acceptance:focus-changes" packages/overlay/src packages/overlay/test -S`
  - `rg -n "syncSectionPhases|clearSectionPhases|phaseSections\\(" packages/overlay/src packages/overlay/test -S`
- Independent agent feedback:
  - None spawned. The available multi-agent tool explicitly forbids spawning
    subagents unless the user asks for subagents/delegation/parallel agent work.
    That higher-priority runtime constraint conflicts with the project record
    template's preferred independent-agent feedback field, so this plan records
    the absence explicitly.
- Git / remote state:
  - Branch: `v0.0.1beta`.
  - `git fetch legacy-remote v0.0.1beta` completed.
  - Local `HEAD` is one commit ahead of legacy remote. A pre-change push attempt ran
    quality hooks successfully but legacy remote rejected the existing unpushed commit
    message because it lacks a `dsw-<taskID>` prefix.

## Plan

1. Replace the historical Inspector workbench view with three workbench views:
   Requirements, Architect, and Goals. Keep notifications, explorer, diff,
   browser, screenshots, and workflow unchanged.
2. Update `main.tsx` panel types, ordering, right toolbar activities, width-cap
   set, view lookup, and mount points. Remove `inspector` from runtime panel
   registries.
3. Refactor `Board.tsx` so Requirements, Architect, and Goals are exported as
   separately mounted task-scope panels reading the same `boardStore`. Do not
   duplicate `boardStore`, `cardTreeStore`, or backend projection state.
4. Preserve required downstream evidence/control surfaces without the Inspector
   aggregate:
   - Goals panel owns the goal list and task action controls.
   - Acceptance remains adjacent to the goals delivery surface because it is the
     post-goal evidence surface and must not be orphaned by deleting Inspector.
5. Add task-scope panel shell CSS for a cleaner right-side layout while reusing
   existing `Section`, `RequirementsPanel`, `ArchitectPanel`, and
   `GoalWorkflowList` primitives.
6. Update i18n for the new toolbar tooltips and empty states; delete unused
   Inspector toolbar strings.
7. Update static and browser tests that pin right toolbar activities, panel
   mounts, and the absence of the historical Inspector panel.
8. Verify with targeted unit/static tests, overlay typecheck, i18n check, an
   isolated Vite preview served without touching any running OpenCorvus window,
   Playwright/browser screenshot review, and final self-review.

## 2026-07-03 GUI/UX Verification Correction

### Recall

- User correction: the first delivery mechanically moved Inspector content but
  did not complete real GUI/UX validation.
- Re-read source of truth before editing:
  - this record's Recall and acceptance criteria;
  - `packages/overlay/src/components/Board.tsx`;
  - `packages/overlay/src/components/GoalWorkflowGroup.tsx`;
  - `packages/overlay/src/styles/surfaces/inspector.css`;
  - `packages/overlay/test/acceptance-panel-mount.test.ts`;
  - `packages/overlay/test/primitives-panel-section.test.ts`;
  - `packages/overlay/test/overlay-architecture-guards.test.ts`;
  - relevant browser tests under `packages/overlay/test/browser/`.
- GUI evidence from isolated desktop preview at 1440x900:
  - Requirements, Architect, and Goals opened simultaneously from the right
    toolbar using a task-scoped fixture.
  - The pre-correction screenshot showed duplicated panel titles: each new
    task-scope panel had an outer header plus an inner `SectionFrame` header
    repeating the same title.
  - Goals rows were too narrow because revision/branch metadata competed with
    the goal title.
  - A fixture timestamp issue produced a toast that was removed from the
    verification fixture before final screenshot review.

### Correction

- Removed the obsolete `SectionFrame` wrapper from the standalone Requirements,
  Architect, and Goals panels. Their content now renders directly under the
  task-scope panel header.
- Moved `requirementsBadge`, `architectBadge`, and `goalWorkflowsBadge` to the
  outer task-scope header, which is the only visible title/badge source for
  those panels.
- Kept Acceptance as its own `Section` inside Goals because it is a distinct
  evidence surface, not a duplicate Goals title.
- Added direct task-scope content styles and narrow-panel goal-header behavior
  so goal titles remain readable when panels are opened side by side.

### Verification

- `bun test packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/task-scope-direct-content.test.ts packages/overlay/test/primitives-panel-section.test.ts packages/overlay/test/overlay-architecture-guards.test.ts packages/overlay/test/right-panel-tabs-flat.test.ts packages/overlay/test/coding-assistant-panel.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/workflow-generating-status-browser.test.ts packages/overlay/test/browser/section-summary-focus-visible-browser.test.ts`
- Manual screenshot review via in-app browser:
  - no repeated Requirements/Architect/Goals title inside the panel body;
  - no task timestamp toast;
  - goals titles render as readable text in a 291px side-by-side panel;
  - Acceptance remains adjacent to Goals and visually separate as evidence.

## 2026-07-03 Second-Pass GUI Review

### Recall

- User challenged whether the quick GUI correction was sufficiently careful.
- Re-read this record, current git state, the last commit summary, the browser
  skill documentation, and the task-scope CSS / tests before making another
  code change.
- Second-pass real browser fixture used a deliberately long goal title and a
  long branch name in the Goals panel while Requirements, Architect, Goals, and
  Workflow were open together at 1440x900.

### Findings

- The duplicate Requirements / Architect / Goals body headers remained fixed.
- Goal titles stayed readable in the narrow Goals panel.
- A new issue was visible in the expanded Goals card: the worktree row's branch
  text had `flex-shrink: 0` and no bounded ellipsis, which widened the GWG
  (Goal Workflow Group) body beyond the panel.
- Acceptance evidence names were still forced into one-line ellipsis, which was
  too brittle for narrow task-scope panels.

### Correction

- Constrained `.gwg-worktree` and the `goal-worktree-open` button to
  `min-width: 0`, `max-width: 100%`, and hidden overflow.
- Changed the expanded worktree row in narrow side-activity containers to a
  two-column grid so path and branch can occupy separate lines without
  widening the card.
- Added max-width + ellipsis to `.gwg-worktree-branch` as the intentional clip
  point.
- Changed `.acceptance-evidence-name` to wrap with `overflow-wrap: anywhere`
  instead of forcing single-line ellipsis.

### Verification

- Real browser screenshot after rebuild:
  `packages/overlay/.scratch/task-scope-second-pass-desktop-after.png`.
- DOM metrics after the second pass:
  - worktree row `clientWidth` equals `scrollWidth`;
  - duplicate task-scope headers remain absent;
  - no alert/toast is visible;
  - the only remaining overflow is the branch text itself, with
    `text-overflow: ellipsis`, inside its bounded span.
- `bun test packages/overlay/test/goal-workflow-group-worktree.test.ts packages/overlay/test/acceptance-panel-mount.test.ts packages/overlay/test/overlay-architecture-guards.test.ts`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build:vite`
