# Right Toolbar Responsive Panels

Date: 2026-07-06
Status: Implemented
Owner: Codex

## Glossary

- GUI: Graphical User Interface, the visible application surface.
- UI: User Interface, visible controls and layout surfaces.
- RAF: Request Animation Frame, the browser frame callback used by the existing center-workbench layout scheduler.

## Recall

### User Request

The user reported that every panel opened from the right toolbar is not responsive and cannot adapt to the panel width and height.

### Acceptance Criteria

- Right-toolbar panels opened inside the center workbench must adapt to the available workbench width instead of depending on horizontal workbench scrolling.
- Open panels must adapt to the available workbench height, with each panel's own body owning vertical scrolling.
- The repair must use the existing center-workbench and side-activity primitives as the single layout source.
- The repair must not add fallback layout branches, gate logic, a second right-panel state source, or per-panel hardcoded width logic.
- Tests must reject the old behavior where six right-toolbar panels satisfy acceptance by keeping token minimum widths and forcing `.center-workbench-body` to scroll horizontally.
- Visual verification must use a real rendered overlay fixture and screenshot review launched through Node Playwright, without touching the user's running OpenCorvus or overlay process.

### Hard Constraints

- No fallback or compatibility logic.
- No git reset, broad revert, or worktree creation.
- Do not restart, refresh, kill, or otherwise interfere with a running OpenCorvus / overlay process.
- Playwright on Windows must be launched through Node, not Bun.
- Specs and records stay under `specs/`.
- Existing unrelated dirty and staged work must not be reverted or committed as part of this task.

### Sources Read

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/records/2026-07/路线规划.md`
- `specs/records/2026-07/2026-07-06-dynamic-expert-agent-instance-review-plan.md`
- `specs/records/2026-07/2026-07-02-right-toolbar-task-scope-panels.md`
- `specs/records/2026-07/2026-07-05-tool-skill-mcp-vertical-panel-repair.md`
- `specs/records/2026-06/2026-06-22-center-workbench-panel-min-size-contract.md`
- `packages/overlay/src/index.html`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/components/SideActivityToolbar.tsx`
- `packages/overlay/src/styles/surfaces/workspace.css`
- `packages/overlay/src/styles/surfaces/activity.css`
- `packages/overlay/src/styles/surfaces/inspector.css`
- `packages/overlay/src/styles/tokens/design-language.css`
- `packages/overlay/test/workspace-surface-consistency.test.ts`
- `packages/overlay/test/right-panel-tabs-flat.test.ts`
- `packages/overlay/test/center-workbench-size.test.ts`
- `packages/overlay/test/browser/center-workbench-separator-browser.test.ts`
- `packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`

### Whole-Repository Search Evidence

- `rg -n "toolbar|Toolbar|right toolbar|side-toolbar|side panel|panel" packages/overlay packages/opencorvus/src packages/opencorvus/test -S`
- `rg --files packages/overlay | rg "(panel|toolbar|expert|sidebar|drawer|right)"`
- `rg -n "solidRightActivity|rightActivity|right-activity|side-activity|task-scope-panel|extension-activity-panel|right_panel" packages/overlay/src packages/overlay/test -S`
- `rg -n "right-activity|side-activity|task-scope-panel|extension-activity-panel|expert-squad|tool-panel|agent-capability-detail" packages/overlay/src/styles packages/overlay/src -g "*.css" -S`
- `rg -n "centerWorkbench|RIGHT_ACTIVITIES|rightActivities|selectRightActivity|activeRightActivity|isRightActivityOpen|CENTER_WORKBENCH" packages/overlay/src/main.tsx packages/overlay/src -S`
- `rg -n "center-workbench|workbench-view|data-workbench|right activity|right panel" packages/overlay/src/styles packages/overlay/src/main.tsx packages/overlay/test -S`
- `rg -n "center workbench scrolls open panels|workbench body should scroll|bodyScrollWidth|scrollWidth > centerWorkbenchBodyOverflow.clientWidth|flex-shrink: 0|min-width: var\\(--ui-workbench-panel-min-width\\)|ui-workbench-panel-min-width" packages/overlay/test packages/overlay/src/styles packages/overlay/src/main.tsx -S`
- `rg -n "center-workbench|right toolbar|responsive|horizontal scroll|ui-workbench-panel-min-width|right-toolbar-panel" specs/current specs/records/2026-06 specs/records/2026-07 -S`

### Findings

- `workspace.css` currently gives every open `.center-workbench-view` `flex-shrink: 0` and `min-width: var(--ui-workbench-panel-min-width)`.
- `.center-workbench-body` currently owns horizontal overflow, so opening many right-toolbar panels releases pressure by scrolling sideways instead of adapting panels to the available width.
- `main.tsx` keeps an initial-width-cap source for right-toolbar panels through `RIGHT_TOOLBAR_INITIAL_WIDTH_PANELS`, `initialWidthCappedCenterWorkbenchPanels`, and `data-initial-width-capped`.
- `workspace-surface-consistency.test.ts`, `center-workbench-separator-browser.test.ts`, and `side-activity-toolbar-browser.test.ts` explicitly assert the old horizontal-scroll contract.
- The June center-workbench min-size record is now superseded for right-toolbar panel natural layout. Its resize-token ownership remains useful only for explicit separator drag constraints.

### Independent Agent Feedback

No independent subagent was used. The user did not ask for parallel independent agents, and this is a focused overlay layout contract repair.

## Repair Plan

1. Make the center workbench body width-fill and hidden-overflow by default, so open right-toolbar panels share available width instead of creating a horizontal scroller.
2. Remove the open-view natural-layout `flex-shrink: 0` and token minimum width from CSS. Open panels keep `min-width: 0`, `min-height: 0`, and flex growth from the existing weight source.
3. Remove the initial right-toolbar width cap path from `main.tsx` and `workspace.css` because it is a second natural-size constraint that prevents automatic adaptation after opening or resizing.
4. Keep explicit separator drag ownership through `centerWorkbenchPanelWeights`; do not introduce per-panel width state.
5. Update static tests and browser tests so six open panels must fit within `.center-workbench-body` without horizontal overflow, while panel bodies remain vertically scrollable.
6. Re-run focused tests, Node Playwright browser coverage, inspect fresh screenshots, and then self-review the diff.

## Supersession Note

This record supersedes the right-toolbar natural-layout part of the June center-workbench minimum-width contract. The resize token remains a drag/keyboard constraint source, but natural right-toolbar panel layout must now adapt to the available center-workbench width and height rather than preserving fixed token widths through horizontal scrolling.

## Validation Results

- PASS: `bun test packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/workspace-surface-consistency.test.ts packages/overlay/test/right-panel-tabs-flat.test.ts packages/overlay/test/center-workbench-size.test.ts packages/overlay/test/overlay-window-size-contract.test.ts`
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/side-activity-toolbar-browser.test.ts`
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/center-workbench-separator-browser.test.ts`
- PASS: `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/titlebar-menubar.test.ts`
- PASS: `bun run --cwd packages/overlay typecheck`
- PASS: `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- PASS: `git diff --check -- packages/overlay/src/main.tsx packages/overlay/src/styles/surfaces/workspace.css packages/overlay/src/styles/surfaces/composer.css packages/overlay/src/styles/tokens/design-language.css packages/overlay/test/workspace-surface-consistency.test.ts packages/overlay/test/right-panel-tabs-flat.test.ts packages/overlay/test/workspace-composer-density.test.ts packages/overlay/test/browser/center-workbench-separator-browser.test.ts packages/overlay/test/browser/side-activity-toolbar-browser.test.ts packages/overlay/test/browser/titlebar-menubar.test.ts specs/records/2026-07/README.md specs/records/2026-07/2026-07-06-right-toolbar-responsive-panels.md`

## Visual Review

- Reviewed `.scratch/center-workbench-three-panel-min-width-1120.png`: workflow, screenshots, and requirements share the legal-width shell without horizontal workbench overflow or overlap.
- Reviewed `.scratch/right-toolbar-requirements-responsive-width.png`: a freshly opened Requirements panel takes the available workbench width instead of staying capped at the retired `420px` token.
- Reviewed `.scratch/right-toolbar-responsive-six-panels.png`: task, explorer, files, preview, requirements, and notifications are simultaneously visible inside the shell; the workflow composer meta controls stack vertically and no longer clip `OpenCorvus` / external executor selector copy.

## Self Review

- Rechecked the removed path: `RIGHT_TOOLBAR_INITIAL_WIDTH_PANELS`, `initialWidthCappedCenterWorkbenchPanels`, `data-initial-width-capped`, and `--ui-right-toolbar-panel-initial-max-width` no longer exist in runtime source.
- Rechecked the single sizing source: natural layout is CSS flex width-fill; explicit user resizing still persists only through `centerWorkbenchPanelWeights`.
- Rechecked the browser evidence after the composer fix; the six-panel screenshot no longer shows clipped selector text in the narrow workflow panel.
