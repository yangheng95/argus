# Goals Summary Navigation And Row Convergence

Date: 2026-07-28
Status: Complete
Owner: Codex

## Glossary

- UI: User Interface, the visible application surface.
- CSS: Cascading Style Sheets, the browser presentation language.
- DOM: Document Object Model, the rendered browser element tree.
- API: Application Programming Interface, the typed request boundary used by
  clients and tools.

## Recall

### User requirement

- Remove the `Retry` and `Replan` buttons from the Goals workbench.
- Adjust the Goals workbench list typography by using the Environment
  Information floating Goals list as the visual reference.
- Clicking a Goal in the Environment Information floating list must open the
  Goals workbench and navigate to the matching Goal row.
- 2026-07-29 correction: the delivered text and status icon still do not match
  the floating list. The Goal summary row must use the same compact text size,
  compact icon size, and row-height rhythm, and it must not add a resting,
  hover, or programmatic-focus background.

### Acceptance criteria

- The Goals workbench never renders `Retry` or `Replan`, even when the Task
  board advertises `canRetry` or `canReplan`.
- The independent `Cancel` action remains available when the board advertises
  `canCancel`.
- Collapsed Goal rows use the same normal-size, regular-weight, neutral text
  hierarchy as the floating Goals list; status remains carried by the leading
  semantic icon and the compact Goal identifier remains visually secondary.
- Every Goal summary has one stable `data-goal-id` DOM identity.
- Clicking or keyboard-activating a floating Goal opens the existing Goals
  workbench tab, closes the floating panel, scrolls the exact matching summary
  into view, focuses it, and presents a visible focus/highlight treatment.
- Clicking a Goal inside the Goals workbench preserves its current expand and
  execution-record navigation behavior.
- The compact row recipe has one token source for its 13-pixel menu type,
  12-pixel icon, 24-pixel row height, and tight line height.
- Real-page interaction and a task-scoped screenshot verify the final desktop
  presentation and interaction. No UI automation test is added, modified, or
  run under the 2026-07-29 UI automation test prohibition.

### Hard constraints

- Reuse the existing Button, Icon, HoverCard, Tabs, GoalGroup, and
  TaskProgressBar primitives. Add no second Goal projection, fallback, route
  gate, state machine, iframe, query override, or synthetic interaction.
- Preserve the canonical Task retry/replan APIs and orchestrator/panel tool
  surfaces; this request removes only the two Goals-workbench buttons.
- Preserve unrelated staged, unstaged, and untracked work in the shared main
  worktree. Do not reset, restore, stash, or create another worktree.
- Do not restart, refresh, close, or interfere with the operator's running
  OpenCorvus or Overlay processes.
- Browser verification uses Node, not Bun. Desktop is the only visual target.
- UI verification is interactive and visual only; existing UI test files are
  not changed or executed.
- Delivery commits use the `dsw-33987` prefix and push to `legacy-remote`.

### Material read before implementation

- Root `AGENTS.md`.
- Browser control Skill.
- User screenshot
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-decfe390-3df7-4dc1-a6bf-2d4bbcaf01a9.png`.
- `specs/current/architecture/07-panel.md`.
- `specs/current/architecture/07-panel-reactivity.md`.
- Current `Board.tsx`, `GoalGroup.tsx`, `TaskProgressBar.tsx`,
  `TaskDirBar.tsx`, `main.tsx`, `services/goal-locate.ts`, `card.css`, and
  `inspector.css`.
- Existing task-action, Goal typography, Environment keyboard, and browser
  control tests.

### Whole-repository grep evidence

Repository-wide searches covered `Retry`, `Replan`, `retryTask`, `replanTask`,
`TaskActionsPanel`, `GoalsBoardPanel`, `TaskProgressBar`,
`locateGoalExecutionRecord`, `onOpenRightDockPanel`,
`centerWorkbenchGoals`, `gwg-header`, `data-goal-id`, and
`scrollIntoView`.

| Owner / call point                                                             | Current evidence                                                                                                                                                            | Disposition                                                                                                                        |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `Board.tsx::TaskActionsPanel`                                                  | The only Overlay renderer for task-level Retry, Replan, and Cancel.                                                                                                         | Delete Retry/Replan props and buttons; retain the independent Cancel Button primitive.                                             |
| `Board.tsx::GoalsBoardPanel`                                                   | Mounts TaskActionsPanel above the canonical GoalList.                                                                                                                       | Accept only `onCancel`; do not create another action or list surface.                                                              |
| `main.tsx` imports, `retrySelectedTask`, `replanSelectedTask`, and Goals mount | These callbacks exist solely to feed the two deleted workbench buttons.                                                                                                     | Remove the unused imports, callback owners, and props.                                                                             |
| `services/task.ts::{retryTask,replanTask}`                                     | Overlay API wrappers are covered by URL-contract tests; backend routes, SDK generation, panel tools, and Orchestrator lifecycle tools retain the same canonical operations. | Preserve API/tool contracts. UI removal must not mutate backend semantics.                                                         |
| English and Chinese `task.action.retry*` / `task.action.replan*` keys          | Their only live UI caller is TaskActionsPanel.                                                                                                                              | Remove the now-unused UI strings together with the buttons.                                                                        |
| `TaskProgressBar`                                                              | Sole Environment Goals projection. It currently sends Goal-row clicks to the conversation execution locator.                                                                | Give row activation a dedicated `onOpenGoal(goalID)` navigation callback while retaining the heading-level `onOpenGoals`.          |
| `TaskDirBar::ProjectRuntimeStatusPanel`                                        | Owns the floating panel and already knows how to open a Right Dock panel and close itself.                                                                                  | Open the existing Goals tab, close the floating panel, then request exact summary focus by stable Goal identity.                   |
| `GoalGroup` / `GoalList`                                                       | Sole Goals workbench projection; every header is already a shared Button primitive, but the shell exposes no Goal identity.                                                 | Add `data-goal-id` to the Goal shell; keep header expand/execution navigation unchanged.                                           |
| `services/goal-locate.ts` and `GoalGroup`                                      | Canonical execution-record navigation to the conversation timeline.                                                                                                         | Preserve for Goals-workbench header activation; stop using it for the Environment-to-Goals navigation requested here.              |
| `inspector.css` Goal row rules                                                 | Current headers and titles are stronger and larger than Environment Goal rows; revision appears as a filled pill.                                                           | Converge collapsed-row text to the Environment list's body/secondary hierarchy and add a bounded target highlight/focus treatment. |
| Historical UI tests                                                            | Previously asserted Goals controls, source strings, rendered rows, and browser interaction.                                                                                 | Do not add, modify, or run them under the 2026-07-29 UI automation test prohibition.                                               |

No Task-board schema, database model, Goal status, execution history, scheduler,
or backend retry/replan route changes are in scope.

### 2026-07-29 correction grep evidence

| Owner / call point                  | Current evidence                                                                                        | Disposition                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `design-language.css`               | Owns the global font, icon, density, and line-height scales.                                            | Add one compact list-row recipe rather than duplicating values across surfaces.                                                     |
| `conversation.css` Environment menu | Locally derives 13-pixel menu type and 24-pixel Goal rows.                                              | Point those local aliases at the shared compact-row tokens.                                                                         |
| `TaskProgressBar.tsx`               | Renders the reference Goal status icon through the compact Icon tier.                                   | Preserve it as the reference consumer.                                                                                              |
| `GoalGroup.tsx`                     | Renders the same Goal status through a default-size Icon or active dot.                                 | Use the same Goal-state icon mapping and compact Icon tier as TaskProgressBar.                                                      |
| `inspector.css`                     | Uses 14-pixel body text, an 18-pixel filled status circle, surface backgrounds, and a focus background. | Use the shared compact row, remove the status chip fill, and keep focus visible through the canonical outline without a background. |

The repository-wide search also covered `goalState`, `statusIconName`,
`StatusIndicator`, compact Icon sizing, every `.gwg-*` selector, and every
`.task-progress__pill-*` selector. No additional Goal summary renderer or
compact-row owner exists.

### Independent-agent feedback

None. The user did not request delegation, and the active collaboration
boundary forbids unrequested Subagents.

## Root cause

The two unwanted controls are not produced by the Goal list or backend route
contract. They are a presentation-only branch in `TaskActionsPanel`, wired
through two main-entry callbacks. Removing that branch is sufficient and does
not justify deleting the canonical retry/replan operations used by other
surfaces.

The navigation mismatch has a separate cause. The Environment Goal row and the
Goals workbench row project the same board Goal, but the Environment row is
currently wired to the conversation execution locator. The right-side Goal
shell also lacks a stable DOM Goal identity. The correct relationship is direct:
Environment row activation opens the existing Goals tab and locates the matching
canonical GoalGroup; GoalGroup activation continues to own deeper execution
navigation.

The visual mismatch comes from independent typography recipes. Environment rows
use the compact regular-weight menu tier, while the workbench header forces
strong body/title weights and renders the revision as a filled badge. The
workbench should reuse the same semantic type tokens and retain only the layout
needed for its trailing revision metadata.

## Implementation plan

1. Delete Retry/Replan from the Goals workbench presentation and remove their
   now-unused main-entry wiring and localized strings while preserving Cancel
   and every canonical API route.
2. Give GoalGroup a stable Goal identity and change TaskProgressBar row
   activation to call the owning Environment panel with the exact Goal ID.
3. Open the existing Goals tab, close the floating panel, then focus and reveal
   the exact matching Goal summary using the real rendered DOM.
4. Converge Goal-row typography and metadata treatment on the floating list's
   existing tokens; keep status, expansion, and execution navigation intact.
5. Update the current panel architecture without changing UI tests.
6. Run Overlay typecheck/build/i18n checks and documentation health; inspect a
   real desktop page and screenshot manually, then repair any remaining
   mismatch without creating an automated UI fixture or assertion.
7. Perform a second diff/test/screenshot review, commit only task-owned changes,
   reconcile the shared branch, and push to `legacy-remote`.

## Status

- [x] Baseline screenshot diagnosis, material read, and whole-repository search.
- [x] Component, localization, CSS, and architecture changes.
- [x] Focused tests, real browser interaction, and screenshot review.
- [x] Second review, commit, and push.
- [x] 2026-07-29 correction diagnosis and whole-repository compact-row search.
- [x] Shared text/icon/row-height token convergence and background removal.
- [x] Real-page screenshot review and direct floating-Goal navigation check.
- [x] Second diff review.

### 2026-07-29 correction verification

- Overlay typecheck and Vite production build passed.
- Historical documentation link health passed 22/22.
- No UI automation test was added, modified, or run.
- A Node-launched Vite page connected to an isolated real backend rendered the
  canonical twelve-Goal Board. The Environment and workbench projections were
  opened side by side and reviewed in
  `.scratch/goals-row-correction-side-by-side-final.png`.
- Activating floating Goal `#G6` closed the floating panel and focused the
  matching `#G6V1` workbench row. The shared navigation-row focus wash was
  removed after visual review, and
  `.scratch/goals-row-jump-transparent-real-page.png` confirms the focused row
  remains transparent.
