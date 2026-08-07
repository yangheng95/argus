# Task Progress Empty Goal Body Repair

## Recall

### User request

- Diagnose why switching between tasks appears to keep showing eight goals while the GOALS window body is empty.
- Repair the problem rather than only reporting the diagnosis.
- Follow-up: the current component does not match the application's unified visual language; repair the visual surface as part of this task.

### Acceptance criteria

1. A GOALS window whose board contains at least one goal must render at least one goal pill at every legal floating-window size when the containing panel has room for the goal window.
2. The legal minimum window height and goal-grid capacity must be derived from the same geometry contract; `0/N` with an empty pill body must not be a legal resize result for `N > 0`.
3. Switching from an eight-goal task must synchronously clear that task's board projection before the next task hydrates, so the old count and pills cannot remain visible.
4. Preserve the existing vertical-first pill fill, density collapse, task-scoped backend board source, and `+N more` behavior.
5. Focused unit tests, Node-driven browser interaction, a bound screenshot, Overlay typecheck, and documentation-health tests must pass. The visual result must be inspected rather than inferred from DOM assertions alone.
6. The GOALS surface must use the current neutral Codex-like language: quiet elevation, normal-case hierarchy, neutral progress chrome, flat goal rows, token-owned hover/focus feedback, and semantic color confined to meaningful status indicators.

### Hard constraints

- No fallback, compatibility branch, gate, state machine, duplicate source, or keyword patch.
- Do not restart, refresh, close, or otherwise disturb the user's running OpenCorvus/Overlay process.
- Browser validation runs through Node on Windows in an isolated page.
- Preserve unrelated dirty worktree changes; stage and commit only files owned by this repair.
- Do not rewrite the existing unpushed checkpoint commit whose subject predates the current `dsw-33987` rule.

### Sources read from disk

- `AGENTS.md`
- `specs/README.md`
- `specs/records/2026-07/README.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/07-panel-reactivity.md`
- `specs/records/2026-07/2026-07-09-task-progress-floating-overlay-repair.md`
- `specs/records/2026-07/2026-07-15-composer-authority-and-goal-vertical-fill.md`
- `specs/records/2026-07/2026-07-15-message-transcript-visual-language-repair.md`
- `specs/records/2026-07/2026-07-14-overlay-neutral-codex-chrome-repair.md`
- `specs/records/2026-07/2026-07-14-overlay-workspace-surface-continuity.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `C:/Users/chuan/Downloads/screenshots.png` (current Codex visual reference recorded by the existing neutral-chrome plan)
- `packages/overlay/src/components/TaskProgressBar.tsx`
- `packages/overlay/src/components/task-progress-floating-frame.ts`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/src/services/task.ts`
- `packages/overlay/src/store/board.ts`
- `packages/overlay/test/task-progress-floating-frame.test.ts`
- `packages/overlay/test/task-progress-collapse.test.ts`
- `packages/overlay/test/task-selection-dead-task.test.ts`
- `packages/overlay/test/browser/task-progress-floating-window-browser.test.ts`

### Whole-repository search evidence

- `taskProgressFloatingGoalGrid` is defined only in `task-progress-floating-frame.ts`, consumed by `TaskProgressBar.tsx`, and covered by the floating-frame and task-progress browser tests.
- `--task-progress-grid-rows` is written only by `TaskProgressBar.tsx` in production and consumed by `.task-progress__pills` in `card.css`; the browser fixture mirrors that contract.
- The only production `TASK_PROGRESS_FLOATING_MIN_HEIGHT` is `96`, while the same module requires `78` pixels of vertical chrome plus one `26` pixel goal row. At the legal `96` pixel height the grid deliberately returns `{ rows: 0, visibleCapacity: 0 }` for a non-empty goal list.
- The browser acceptance test currently codifies the defect by asserting zero visible pills and `+15 more` after resizing to the legal minimum.
- Task selection call sites use the shared `selectTask` service. That service synchronously calls `clearBoard()` inside the selection batch before asynchronous hydration and guards hydration with `selectEpoch`; there is no separate task-progress task cache.
- `TaskProgressBar` reads its header counts, progress segments, and pills from the same `boardStore.board.goals` array. Therefore a header with `N > 0` and no pills is caused by zero layout capacity, not by two goal data sources.
- `.task-progress` visual ownership is confined to the task-progress block in `card.css`; no second production stylesheet defines the floating surface.
- The current block explicitly creates the visual mismatch: uppercase spaced heading, four colored count dots, saturated multi-color segments, individually outlined pill buttons, state-tinted pill borders, blur plus heavy shadow, and an inset highlight.
- The current unified chrome sources already provide `--hover-wash`, `--selected-wash`, neutral surface/border tokens, shared radius tiers, ghost `Button`, and focus-visible outline ownership. No new color, shadow, radius, or button primitive is needed.

### Runtime and database evidence

- The screenshot-era task inspected in the runtime database genuinely had eight goals, so the numeral `8` is valid for that task rather than a hard-coded UI constant.
- A real same-runtime switch from that eight-goal task to a different project task changed the GOALS window to the destination task's one goal, showing that selection is not globally stuck.
- The captured empty-body state could not be re-read after the sidecar was externally restarted, but the source and existing browser test reproduce its exact legal state: non-empty header/segments with zero pill capacity.

### Independent agent feedback

- None. The user did not request sub-agents, and the active collaboration rules prohibit delegation otherwise.

## Root cause

The floating-frame resize contract and the goal-grid content contract disagree. Resize permits a height of `96 * uiScale`, while the grid needs `(78 + 26) * uiScale` before it can render its first row. `TaskProgressBar` consequently slices a non-empty board goal array to zero visible goals while continuing to render the header count and progress segments from the full array. This produces the exact empty GOALS body.

The repeated value eight is a separate observation: the inspected Mirror Watch tasks each persisted eight real goals. The task-switch service already clears board state synchronously. A regression assertion will make that ownership explicit without adding another reset path.

## Implementation plan

1. Make the minimum floating height equal the vertical chrome plus one pill row in the existing geometry owner.
2. Update frame-resize and grid unit tests so every normal legal minimum for a non-empty goal list has capacity one.
3. Update the existing Node browser interaction fixture to use the production geometry contract and require one visible pill at minimum size; capture the corrected minimum-size screenshot.
4. Add a service regression that starts with an eight-goal board and proves `selectTask` clears it synchronously before destination hydration completes.
5. Run focused tests, browser validation, screenshot inspection, Overlay typecheck, documentation-health tests, and a final diff review.
6. Redesign the existing CSS owner in place: normal-case heading, restrained surface elevation, neutral status overview, flat goal rows, wash-based interaction, and semantic color only on running/failed status cues. Update visual contract tests and inspect light/dark bound screenshots.

## Call-site disposition

| Surface | Disposition |
| --- | --- |
| `taskProgressFloatingBounds` | Replace the inconsistent 96px minimum with the existing content geometry sum. |
| `resizeTaskProgressFloatingFrame` | Keep; it consumes `bounds.minHeight` and automatically enforces the corrected contract. |
| `taskProgressFloatingGoalGrid` | Keep; its zero-capacity result remains valid only for truly undersized external frames or zero goals, not for a normal legal resize result. |
| `TaskProgressBar.visibleGoalGrid` / `visibleGoals` | Keep; one board source and the existing density projection remain authoritative. |
| `.task-progress__pills` | Keep the vertical-first CSS layout. |
| Browser fixture `clamp` / `resizeFromHandle` | Replace the independent 96px value with the production bounds result injected into the isolated fixture. |
| `selectTask` / `clearBoard` | Keep production code; add direct regression evidence for the existing synchronous ownership. |

## Implementation summary

- The floating minimum height is now derived in the geometry owner as vertical chrome plus one goal-row height. The normal legal minimum is `104 * uiScale`, so a non-empty goal list has at least one visible slot at scales 1, 1.25, 2, and 3.
- Production task switching remains single-source. A new regression starts with an eight-goal board, calls `selectTask` for a different task, and proves the old board is null synchronously before destination hydration completes.
- The existing task-progress CSS owner was redesigned in place. The surface now uses the standard elevated surface, border, large radius, and medium shadow without glass blur or an inset highlight. The heading uses normal case and the shared hierarchy.
- Goal rows are flat ghost buttons with no resting or state-tinted border. Hover, pointer-linked hot state, and keyboard focus use the shared neutral wash; the shared Button primitive continues to own the visible focus outline.
- Completed goal chrome is neutral. Semantic color remains only for running/blocked, failure, and the corresponding compact overview indicators. The vertical-first layout, state icons, progress segments, `+N more`, and goal locate action are preserved.
- The Node browser fixture now obtains its minimum height from production `taskProgressFloatingBounds` rather than maintaining the defect-prone independent number. The light focus fixture was also repaired to render the real frame/body/grid structure, producing useful region evidence instead of a blank strip.

## Visual review

- Dark full-area evidence: `packages/overlay/.scratch/task-progress-floating-window/dark-window-vertical-first-full-area.png`.
  - Reviewed after the final browser run: normal-case title, quiet elevated surface, neutral completed states, flat rows, restrained running/failure cues, readable two-column vertical-first fill, and no nested pill borders.
- Dark minimum-area evidence: `packages/overlay/.scratch/task-progress-floating-window/dark-window-min-area-one-goal-region.png`.
  - Reviewed after the final browser run: one goal remains visibly rendered with `+14 more`; the empty-body defect is absent.
- Light keyboard-focus evidence: `.scratch/task-progress-pill-focus-light.png`.
  - Reviewed after repairing the fixture: the surface hierarchy matches the neutral light chrome, rows remain flat, and the focused goal has an explicit shared focus outline without restoring a resting capsule border.

## Validation

- Focused Overlay unit tests: 25 passed, 0 failed.
- Node browser tests (`task-progress-floating-window-browser` and `task-progress-pill-focus-browser`): 2 passed, 0 failed. The runner proved it was Node-owned and allowed both isolated browser processes to finish naturally.
- Overlay TypeScript typecheck: passed.
- Overlay Vite production build: passed, 2,445 modules transformed.
- Spec/document health: 78 passed, 0 failed after the new record was staged so the tracked-file index check could evaluate the intended repository state.
- Scoped `git diff --check`: passed.
- The broader `owner-surface-consistency.test.ts` currently has one unrelated failure because a concurrent dirty-worktree change removed or renamed the `.integrity__issue, .integrity__correction, .integrity__missing` selector group. Its GOALS-specific flat-owner assertion passed; this repair did not modify or conceal the unrelated Inspector surface.

## Second review

- The production diff changes one geometry owner and one visual CSS owner. It adds no store, task cache, renderer, fallback, compatibility selector, gate, state machine, literal color, or new UI primitive.
- Header counts, segments, and pills still read the same task-scoped `boardStore.board.goals`. The task-switch regression verifies existing synchronous clearing rather than adding a second cleanup path.
- The legal frame minimum and browser resize acceptance now share the production bounds calculation. Unit coverage challenges multiple UI scales, preventing the original 96-versus-104 drift from returning silently.
- Final dark full-area, dark minimum-area, and light focus screenshots were generated after the final CSS and fixture changes and personally inspected.
- Unrelated dirty worktree files were neither staged nor reverted. The user's running OpenCorvus/Overlay was not restarted, refreshed, closed, or otherwise manipulated.

## Follow-up Recall: translucent right-side vertical default

### User requirement

- Make the GOALS component semi-transparent.
- Default to one vertical column attached to the right edge of the message panel.
- Treat rendering and interaction performance as an explicit acceptance concern.

### Acceptance criteria

1. The initial frame uses the existing minimum width, which admits exactly one goal column at the current scale, and is positioned at the message-panel right inset.
2. The initial height is a bounded proportion of available panel height, producing a useful vertical rail without encoding a goal-count constant or consuming the full panel height.
3. The panel background is visibly translucent while text/icons remain fully opaque; no `opacity` reduction is applied to the component.
4. `backdrop-filter` remains disabled. Drag position uses a compositor transform, the surface contains layout/paint/style invalidation, and `will-change` is active only during drag/resize rather than permanently reserving a layer.
5. Existing drag, resize, vertical-first capacity, minimum-one-goal, keyboard focus, task switching, and `+N more` behavior remain intact.
6. Node browser evidence proves right-edge placement, one-column initial flow, translucency, containment, transient compositor hinting, and final visual quality in the isolated page.

### Hard constraints and recalled sources

- Re-read this record's original Recall, implementation, validation, and second review before modifying code.
- Re-read the Browser skill before browser work; repository visual acceptance continues to use the project Node browser runner required by `AGENTS.md`.
- Full-repository grep confirms `taskProgressFloatingBounds` and `initialTaskProgressFloatingFrame` are the only production default-size/placement owners; `TaskProgressBar.floatingStyle` is the only producer of the four frame CSS variables; `card.css` is the only production task-progress positioning/visual owner.
- Do not add persisted frame state, goal-count-derived defaults, a second dock mode, backdrop blur, permanent `will-change`, or pointer-event timers.
- Preserve unrelated dirty worktree files and do not restart or refresh the user's running Overlay.
- No sub-agent was started because the user did not request delegation and the active collaboration policy prohibits it otherwise.

### Implementation plan

1. Replace the width-ratio default with `minWidth`, introduce a height ratio based on available panel height, and initialize against the right/top inset in the existing frame module.
2. Move the absolute surface from layout-driven `left/top` placement to `translate3d` while preserving the same frame variables, then add containment and interaction-scoped `will-change`.
3. Make only the background semi-transparent through existing surface tokens; keep content opacity at full and backdrop blur disabled.
4. Update unit and Node browser tests to assert right docking, one initial column, translucency, compositor positioning, containment, and transient `will-change`; capture and inspect new right-rail screenshots.
5. Run focused tests, typecheck, production build, document health, scoped diff review, commit with `dsw-33987`, and attempt the required git-cc push without rewriting the pre-existing nonconforming checkpoint.

### Follow-up implementation

- `taskProgressFloatingBounds` now uses the existing minimum width as the default width and derives default height from 72% of available panel height, bounded by the existing minimum and maximum. No goal count participates in frame sizing.
- `initialTaskProgressFloatingFrame` now opens at the top/right inset. At the representative 900×520 panel it produces `{ x: 572, y: 8, width: 320, height: 363 }`, and eight goals occupy one vertical column.
- The floating surface now positions with `translate3d` from the existing frame variables instead of changing CSS `left/top`. It owns `contain: layout paint style`; the browser normalizes this to computed `contain: content`.
- `will-change` is `auto` while idle and becomes `transform` only for the existing dragging/resizing states. No new timer, animation-frame loop, pointer state, or persisted dock mode was added.
- The background uses a 90% theme surface / 10% transparent mix. Component opacity remains full and `backdrop-filter` remains disabled, so text is crisp and the compositor does not repeatedly blur the transcript beneath it.
- The browser fixture now imports both production bounds and production initial-frame functions. It proves one initial column, right/top 8px inset, 90% alpha, compositor transform, containment, transient `will-change`, drag/resize behavior, and the minimum-one-goal contract.

### Follow-up visual review

- Full dark default: `packages/overlay/.scratch/task-progress-floating-window/dark-window-right-rail-translucent.png`.
  - Reviewed: the component is a narrow right-side rail, aligns to the message-panel boundary, shows eleven goals in one vertical column with `+4 more`, and preserves visible transcript context through the material.
- Bound component region: `packages/overlay/.scratch/task-progress-floating-window/dark-window-right-rail-translucent-region.png`.
  - Reviewed after raising the surface mix from 86% to 90%: translucency remains visible, but underlying transcript text no longer dominates the goal labels; status and focus affordances remain legible.
- Existing light focus evidence was regenerated by `task-progress-pill-focus-browser` and remains valid for keyboard interaction. An attempted in-place theme switch in the dark fixture was discarded because body-scoped derived theme variables retained the initial theme in that fixture; it was not used as production evidence or patched around.

### Follow-up validation

- Focused task-progress, geometry, task-switch tests: 25 passed, 0 failed.
- Performance-related animation-frame/ResizeObserver assertions relevant to `TaskProgressBar`: 3 passed. The same shared test file has two unrelated failures because concurrent work removed or renamed center-workbench resize functions; this task did not edit that surface.
- Node browser tests: 2 passed, 0 failed.
- Overlay TypeScript typecheck: passed.
- Overlay Vite production build: passed, 2,445 modules transformed.
- Spec/document health: 78 passed, 0 failed.
- Scoped `git diff --check`: passed.
- Final screenshot review: passed after the 90% material adjustment.

### Follow-up second review

- Default placement remains owned only by the frame module; visuals and compositor behavior remain owned only by `card.css`; the component still emits the same four frame variables.
- The default single column is a consequence of the existing scaled minimum width and grid formula, not a second CSS column limit or goal-count rule.
- The performance changes remove layout-driven movement and expensive backdrop blur without introducing a permanent compositing layer or JavaScript scheduling mechanism.
- The user's running Overlay was not restarted, refreshed, closed, or otherwise manipulated.
