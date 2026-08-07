# Task Progress Floating Window Visual Redesign

## Recall

- User request on 2026-07-09: the newly landed GOALS floating window (commit `9ce78b90d7`) looks unpolished ("该怎么设计才有设计美感"). An interactive before/after mockup was reviewed and accepted by the user ("帮我改一下"). Apply the accepted redesign to the real component.
- Acceptance criteria (from the accepted proposal, priority order):
  1. **P0 dead space** — window height follows content: the resize frame height becomes a height *budget* (`max-height`), not a fixed height. Content shorter than the budget shrinks the window; content taller scrolls inside the body.
  2. **P0 elevation** — the window reads as a floating glass layer at rest: always-on `var(--shadow)` (not only while dragging/resizing), `backdrop-filter: blur + saturate`, background opacity raised from 84% to ~88%, subtle inset top highlight.
  3. **P1 segmented minimap bar** — the continuous passed/failed bar is replaced by one segment per goal, colored by `goalState` (passed=good, failed=bad, running=warn with pulse, blocked=warn, pending=neutral). Hovering a segment highlights its pill and vice versa (component-local signal, no store writes). Segments stay `aria-hidden`; pills keep all semantics.
  4. **P1 pill noise reduction** — pills move from ragged `flex-wrap` to an aligned CSS grid (`repeat(auto-fill, minmax(...px, 1fr))`, scaled by `--ui-scale`); pill body becomes neutral with the *state icon* carrying the color (check / spinning refresh / hollow pending / failed mark via existing `Icon` names only); pill id uses a new compact label (`#G6`, retry shown only when >0 as `#G6·2`) that lives in `utils/goal-label.ts` as the single label source next to the existing full label. Full label remains in `title`/`aria-label`.
  5. **P2 header summary** — bare `5/15` gains colored dot counts (passed / running / failed / pending; render non-zero only, `tabular-nums`), localized tooltips.
  6. **P2 resize grip** — the boxed icon button becomes a corner diagonal grip: stays a `Button` with `data-ui="task-progress-resize"` for a11y and pointer wiring, restyled borderless/transparent, revealed on window hover/focus-within.
- Hard constraints:
  - `AGENTS.md`: no fallback/double source (rule 7/8), no hardcoded values outside token layer (rule 10), tests for every change (rule 36), whole-repo grep before edits (rule 35), visual acceptance with real render + screenshot, do not touch the user's running overlay process (rule 39), commit prefix `dsw-33987` (rule 33.0).
  - Preserve unrelated dirty worktree files (other sessions own: `ConversationAgentRail.tsx`, `WorkLedger.tsx`, `BrowserPreviewPanel.tsx`, composer/conversation css, i18n hunks for `work_ledger.kind_description.*` / `agent_rail.detail.summary`, several tests, other spec records). Stage only files/hunks owned by this task.
  - Playwright/browser verification through Node, not Bun (`node packages/overlay/test/browser-runner.mjs ...`).
  - `TaskProgressBar` remains the single conversation goal progress surface; no persisted layout source, no store writes from hover linking.
- Sources read before implementation:
  - `AGENTS.md`
  - `specs/records/2026-07/2026-07-09-task-progress-floating-window.md` (parent record; this record refines its visual layer only)
  - `packages/overlay/src/components/TaskProgressBar.tsx`
  - `packages/overlay/src/components/task-progress-floating-frame.ts`
  - `packages/overlay/src/styles/surfaces/card.css` (`.task-progress*` block, lines ~1520–1793)
  - `packages/overlay/src/styles/cascade/dark.css` / `vscode-dark.css` / `light.css` (theme tokens: `--good/--warn/--bad`, `--shadow`, surfaces)
  - `packages/overlay/src/utils/goal-label.ts`
  - `packages/overlay/src/i18n/en-US.json` (`progress.*` keys, lines 1228–1242)
  - `packages/overlay/test/task-progress-collapse.test.ts`
  - `packages/overlay/test/task-progress-floating-frame.test.ts`
  - `packages/overlay/test/browser/task-progress-floating-window-browser.test.ts`
- Whole-repository grep evidence:
  - `rg -n "goalRevisionLabelFromIndexes"` → 4 call sites: `TaskProgressBar.tsx:561` (this task), `GoalWorkflowGroup.tsx:137`, `services/diff.ts:186`, `utils/file-change-summary.ts:187` (all keep the full label; compact variant is additive in the same module, no fork).
  - `rg -n "task-progress" packages/overlay/src/styles` → only `surfaces/card.css`.
  - `rg -n "task-progress" packages/overlay/test` → `task-progress-collapse.test.ts`, `task-progress-floating-frame.test.ts`, `browser/task-progress-floating-window-browser.test.ts`, plus guards in `agent-workflow-css-guards.test.ts` (dirty, other session — read before touching; do not absorb).
  - `rg -n '"progress\.' packages/overlay/src/i18n/en-US.json` → keys 1228–1242; new keys are additive under `progress.count.*`.
  - Icon names available: `check`, `refresh`, `maximize`, chevrons (grep `Icon.tsx`); pending/failed glyphs must reuse existing registry names — check `Icon.tsx` icon map before picking; do not add new SVG sources if a fitting name exists.
- Independent agent feedback:
  - Implementation delegated to codex exec (rule 37); result re-reviewed here (rule 24).

## Diagnosis

The functional floating window landed in `9ce78b90d7` but its visual grammar undermines it:

1. The frame `height` is applied as a fixed CSS `height`, so a mostly-empty window shows ~60% dead space — the dominant aesthetic defect.
2. Elevation cues (`box-shadow`) exist only in `data-window-state="dragging"/"resizing"`; at rest the 84%-transparent panel has no blur, so underlying message text bleeds through as visual noise instead of frosted material.
3. The continuous progress bar answers only "how much"; it cannot show *which* goal failed or runs, and reads as a stray underline below the GOALS heading.
4. `flex-wrap` pills with fully tinted bodies and repeated long titles produce a ragged, noisy block; `#G12V1` spends width on a revision digit that is almost always `V1`.

## Plan

1. `task-progress-floating-frame.ts`: document `height` as the height budget (name kept — the frame math is unchanged; only CSS consumption changes). No behavioural change to clamp/move/resize.
2. `card.css`: `height` → `max-height` + `height: auto`; always-on shadow + backdrop-filter + 88% background; segmented bar styles; pills grid; neutral pill + icon state colors; header count dots; corner grip restyle. All values via existing tokens and `--ui-scale` arithmetic.
3. `TaskProgressBar.tsx`: render per-goal segments; hover-link signal `hotGoalID`; state icon inside pill; compact pill id; header dot counts. No new store writes; fold/locate/drag/resize logic untouched.
4. `utils/goal-label.ts`: add compact label pair (`goalCompactLabel`, `goalCompactLabelFromIndexes`) beside the full label.
5. i18n: add `progress.count.passed|running|failed|pending` to `en-US.json` / `zh-CN.json` (additive keys only; do not touch other pending hunks).
6. Tests: update `task-progress-collapse.test.ts` CSS regexes; extend `task-progress-floating-frame.test.ts` only if signatures change (they should not); extend the Node browser test to assert content-fit height (window height < frame budget with few goals) and capture screenshots; add unit coverage for compact label and segment/count rendering.
7. Visual acceptance: run the Node browser test fixture, inspect emitted screenshots, iterate until the rendered window matches the accepted mockup's grammar.

## Validation Targets

- `bun test packages/overlay/test/task-progress-collapse.test.ts packages/overlay/test/task-progress-floating-frame.test.ts`
- `bun test packages/overlay/test/goal-*.test.ts` (or wherever goal-label coverage lives)
- `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/task-progress-floating-window-browser.test.ts` + screenshot review
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`
- `git diff --check`
