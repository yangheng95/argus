# 2026-07-20 Goal Status Color Semantics

## Recall

User request: `goals的状态颜色不对；调整下`

Current objective:

- Correct the semantic colors used by every rendered Goal status surface.
- Keep the existing theme palette as the single color source instead of introducing Goal-only hard-coded colors.

Acceptance criteria:

- Pending Goals are neutral, running Goals use the accent blue, passed Goals use the success green, failed Goals use the danger red, and blocked Goals use the warning amber.
- The Right Dock Goal rows and Environment Information Goal progress use the same semantic hue for the same status.
- The focused Node-launched browser regression renders all Goal states, verifies their computed theme colors, saves a task-scoped screenshot, and remains console-clean.
- Existing unit, type, build, document-health, and historical-link checks pass.

Hard constraints:

- Reuse the canonical `--text-muted`, `--accent`, `--good`, `--bad`, and `--warn` theme tokens; do not add hard-coded colors, fallback aliases, a second palette, or status-flow logic.
- Do not touch or restart an existing OpenCorvus or Overlay process. Browser validation uses the existing isolated Node fixture runner.
- Preserve unrelated worktree changes and stage only this repair.
- Do not create a worktree or delegate to a sub-agent; the user did not request either.

Sources read before implementation:

- `AGENTS.md`
- `specs/README.md`
- `specs/current/architecture/07-panel.md`
- `specs/current/architecture/12-overlay-card-system.md`
- `specs/records/2026-07/README.md`
- `packages/overlay/src/components/GoalGroup.tsx`
- `packages/overlay/src/components/TaskProgressBar.tsx`
- `packages/overlay/src/utils/goal-state.ts`
- `packages/overlay/src/utils/status-mapping.ts`
- `packages/overlay/src/styles/tokens/design-language.css`
- `packages/overlay/src/styles/cascade/{light,dark,vscode-dark}.css`
- `packages/overlay/src/styles/surfaces/inspector.css`
- `packages/overlay/src/styles/surfaces/card.css`
- `packages/overlay/test/browser/goal-group-css-residue-browser.test.ts`
- `packages/overlay/test/task-progress-collapse.test.ts`
- `packages/overlay/test/owner-surface-consistency.test.ts`
- `packages/overlay/test/overlay-architecture-guards.test.ts`

Whole-repository search evidence:

- `rg -n "goalStatus|goal\\.status|data-goal-status|gwg-status-icon" packages/overlay/src packages/overlay/test`
- `rg -n "task-progress__(count|segment|pill)|data-state=\\\"(passed|running|pending|failed)\\\"" packages/overlay/src packages/overlay/test`
- `rg -n "--good|--bad|--warn|--accent|good-dim|bad-dim|warn-dim|accent-dim" packages/overlay/src/styles`
- Goal row color ownership is in `surfaces/inspector.css`; Environment Information Goal progress color ownership is in `surfaces/card.css`; theme values are owned by the three cascade theme files.
- Existing tests that constrain these selectors are `goal-group-css-residue-browser.test.ts`, `task-progress-collapse.test.ts`, `owner-surface-consistency.test.ts`, and `overlay-architecture-guards.test.ts`.

Independent-agent feedback:

- None. The user did not request independent or parallel agent work.

## Diagnosis

The status data is correct; its rendering is not. The Right Dock maps `passed` to `--accent`, while Environment Information maps the same state to muted gray. Environment Information also maps a blocked progress segment to the running accent even though the blocked pill uses `--warn`. These duplicated surface declarations drifted away from the canonical semantic palette, so equal Goal states no longer read consistently.

## Implementation Plan

1. Change the existing Goal row modifiers to the canonical semantic theme tokens and add the already-supported blocked state to the same selector family.
2. Change Environment Information passed and blocked indicators to the matching canonical theme tokens while preserving neutral pending, accent running, and danger failed behavior.
3. Extend the focused browser fixture to render every Goal state, assert computed colors against the active theme variables, capture the Goal region, and visually review it.
4. Add a focused static regression for the compact progress color contract, then run targeted tests, typecheck, build, document checks, and a second visual review.

## Validation

- `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/owner-surface-consistency.test.ts packages/overlay/test/goal-state.test.ts` — 17 passed.
- `bun test packages/overlay/test/overlay-architecture-guards.test.ts -t "gwg"` — 6 Goal-group ownership guards passed.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/goal-group-css-residue-browser.test.ts` — passed with real light-theme rendering, computed token checks for all five states, console-clean fixture responses, and screenshots at `.scratch/goal-status-environment-progress.png` plus `.scratch/goal-group-header-button-primitive.png`.
- Visual review confirmed the intended blue/green/red/amber/gray hierarchy in both rendered Goal surfaces without changing row density or layout.
- `bun run --cwd packages/overlay typecheck` — passed.
- The focused browser runner rebuilt the production Vite bundle successfully before rendering.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts` — 86 passed; after staging this Goal record, the tracked-record check remains blocked only by the unrelated, concurrently untracked `2026-07-20-left-sidebar-mailbox-mark-all-read.md` referenced from the shared July index.
