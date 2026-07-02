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
  - `git fetch myhexin v0.0.1beta` completed.
  - Local `HEAD` is one commit ahead of git-cc. A pre-change push attempt ran
    quality hooks successfully but git-cc rejected the existing unpushed commit
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
