# Goal retry projection and running icon repair

## Recall

### User requirements

- Determine whether the `retry: 1` values and `#G…·2` labels on first-run Goals represent real retries.
- Repair the misleading Goal retry/revision projection.
- Replace the visually inappropriate in-progress Goal icon; the current Activity zigzag does not belong in this status language.

### Acceptance criteria

- A Goal with no attempt or exactly one first attempt projects `retryCount=0` and renders revision `V1` / compact Goal number without a retry suffix.
- A real second attempt with persisted `retry_count=1` projects `retryCount=1` and renders revision `V2` / compact `·2`.
- Task clipboard debug prints the same persisted retry index and no longer reports a first attempt as `retry: 1`.
- The Goal list uses one coherent status sequence: empty circle for pending, a restrained solid status dot plus visible running label for active execution, check-circle for passed, and x-circle for failed.
- The active Goal does not render the Lucide Activity zigzag or duplicate two active dots.
- Focused engine, board, Overlay, browser, type, i18n, document-health, and real Vite screenshot verification pass.

### Hard constraints

- Keep immutable `goal_attempt.payload.retry_count` as the single retry/revision authority; do not restore `engine_goal.retry_count`.
- Keep attempt creation based on the count of prior immutable attempts; this repair changes read projection, not attempt identity allocation.
- Reuse the canonical `StatusIndicator` primitive and existing status tokens; do not draw a custom icon or introduce another icon registry.
- Preserve Goal status/result derivation and active execution evidence ownership.
- Preserve unrelated concurrent left-Dock tooltip changes and stage only task-owned differences.
- Do not restart, refresh, close, or otherwise interfere with the user's running OpenCorvus/Overlay process.
- Commit subjects use the `dsw-33987` prefix and delivery pushes only the current main worktree branch to `myhexin`.

### Read sources

- `AGENTS.md`
- `specs/current/architecture/02-data.md`
- `specs/records/2026-07/2026-07-22-task-contract-repair-and-cancellation-convergence.md`
- `packages/opencorvus/src/engine/store.ts`
- `packages/opencorvus/src/engine/persist.ts`
- `packages/opencorvus/src/workbench/board.ts`
- `packages/opencorvus/src/orchestrator/tools.ts`
- `packages/opencorvus/src/orchestrator/goal-diagnostics-tool.ts`
- `packages/overlay/src/components/GoalGroup.tsx`
- `packages/overlay/src/components/ui/Icon.lucide.ts`
- `packages/overlay/src/components/ui/StatusIndicator.tsx`
- `packages/overlay/src/utils/goal-label.ts`
- `packages/overlay/src/utils/status-mapping.ts`
- `packages/overlay/src/utils/debug-info.ts`
- `packages/overlay/src/styles/surfaces/inspector.css`
- Focused engine, board, Goal label, debug-info, architecture, and browser tests

### Full-repository grep

`rg -n "getGoalRetryCount|retryCount|retry_count|goalRevisionLabelFromIndexes|goalCompactLabelFromIndexes|gwg-status-icon|presentationIconStatus|statusIconName\(" packages specs`
returned 181 matches after generated SDK and the compiled built-in payload were excluded.

| Surface / caller | Current fact | Disposition |
| --- | --- | --- |
| `engine/store.ts::getGoalRetryCount` | Returns `listGoalAttemptsByGoal(goalID).length`, although its schema-era tests and `engine.sql.ts` state that the latest attempt payload owns the projected value | Read `findLatestTipGoalAttempt(goalID)?.retry_count ?? 0` |
| `engine/persist.ts::startNewAttempt`, manual completion, and `beginBuildAttempt` | Count prior attempts to allocate the new immutable attempt's `payload.retry_count` | Preserve; these are writers allocating the next attempt index |
| `engine/store.ts::viewGoal`, `workbench/board.ts`, Task API | Consume `getGoalRetryCount` | Keep call sites; corrected single reader fixes all projections |
| Orchestrator continuation and diagnostics | Consume `getGoalRetryCount` to expose retry index and `V` label | Keep call sites; they should describe the latest real attempt |
| Overlay debug info | Prints `goal.retryCount` as `retry` | Keep format; corrected Board data makes the value truthful |
| Overlay Goal labels, diff services, file-change summaries, conversation badges | Convert zero-based persisted retry index to one-based `V` display | Preserve `+1`; it is correct once backend projection is corrected |
| `GoalGroup` active leading icon | Maps running to global `status-active`, whose Lucide glyph is `Activity` | Use `StatusIndicator appearance="dot"` only for active Goal execution |
| `GoalGroup` running meta pill | Renders a second `StatusIndicator` dot next to Running | Keep visible label but remove the duplicate dot |
| Global `status-active` mapping | Used by non-Goal status surfaces | Preserve; this repair is scoped to the Goal list |
| Goal status CSS | Owns the 18px status chip and semantic colors | Reuse; add only primitive-alignment styling needed by the active dot |

### Independent-agent feedback

- No sub-agent was requested or used.

## Root cause

The immutable first attempt correctly stores `retry_count=0`, `retry_reason=null`, and
`supersede_of=null`. The read helper discards that value and instead returns the number
of attempt rows. Therefore the moment V1 exists, the Board reports `retryCount=1`; every
Overlay label correctly adds one to a zero-based retry index and consequently displays
the nonexistent V2. The same incorrect projection reaches Task clipboard debug.

The running Goal icon is a separate visual-language defect. `GoalGroup` routes active
execution through the global `status-active` icon, currently Lucide Activity. Inside the
small circular Goal chip it reads as a lightning-shaped gesture rather than a lifecycle
state, while the adjacent Running pill repeats the status with a second dot.

## Implementation plan

1. Correct `getGoalRetryCount` to project the newest immutable attempt's persisted retry index.
2. Add engine and Board regressions covering zero attempts, first attempt, and real retry.
3. Render the active Goal's leading state through the canonical dot appearance and keep only one visible dot.
4. Extend source/browser regressions to assert no Activity icon and correct Goal revision labels.
5. Run focused tests, OpenCorvus and Overlay type checks, i18n and document-health checks.
6. Start an isolated Vite fixture with Node, inspect desktop screenshots, refine if necessary, then perform a second diff review.

## Verification record

- `bun test packages/opencorvus/test/engine/start-new-attempt.test.ts packages/opencorvus/test/engine-goal-retry-count-derived.test.ts packages/opencorvus/test/workbench/board.test.ts packages/overlay/test/goal-label.test.ts packages/overlay/test/goal-running-status.test.ts` — passed.
- `bun test packages/overlay/test/task-debug-info.test.ts -t "task debug info"` — 6 passed.
- `bun run typecheck` in `packages/opencorvus` — passed.
- `bun run typecheck` in `packages/overlay` — passed.
- `bun run check:i18n` in `packages/overlay` — passed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` — 22 passed.
- `bun test packages/opencorvus/test/script/document-health.test.ts` — 62 passed; the single tracked-record-index failure is caused by three unrelated concurrent untracked July records. This record is intentionally indexed and becomes tracked in the delivery commit.
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/goal-group-css-residue-browser.test.ts` — passed under the required Node runner after repairing the fixture's missing canonical `/chat/capability` response.
- Inspected desktop screenshots:
  - `.scratch/goal-group-compact-rows.png`
  - `.scratch/goal-group-header-button-primitive.png`
- Screenshot review confirmed one restrained blue leading dot, one Running text pill with no duplicate dot, `#G1V1` on the first attempt, and aligned pending/passed/failed status geometry.
- `git diff --check` — passed.
