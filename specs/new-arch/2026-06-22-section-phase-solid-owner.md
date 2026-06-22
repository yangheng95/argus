# Section Phase Solid Owner

Date: 2026-06-22
Status: Implemented

## Acronyms

- DOM: Document Object Model, the browser element tree.
- GUI: Graphical User Interface, the rendered overlay surface.
- UI: User Interface, the visible controls and panels.

## Task Definition

Remove the active section phase double source that writes workflow section
`data-phase-state` from `loadConversation()`. Section highlighting must be owned
by the Solid Board tree through store-derived props.

## Recall

| Source | Constraint carried forward |
| --- | --- |
| `AGENTS.md` | No fallback, no duplicate source, recall disk plans before edits, test every change, and visually inspect UI changes. |
| `2026-06-18-retire-eval-shell-residue.md` | `syncSectionPhases` still had non-evaluation callers in that round, so only evaluation branches were retired then. |
| `2026-06-22-retire-solid-changes-panel-empty-state.md` | Do not delete `FilesSection` or `#changesSection` in this round; it remains a separate component path. |
| `Board.tsx` current source | Board comments and implementation derive section phase state from Solid workflow data through `phaseFor(...)`. |

## Call Point Inventory

| Sweep | Result | Decision |
| --- | --- | --- |
| `rg -n "syncSectionPhases" packages/overlay/src packages/overlay/test specs` | The only production caller is `packages/overlay/src/store/messages.ts`; `packages/overlay/src/utils/section.ts` owns the old imperative DOM implementation. | Remove the `messages.ts` import and call. |
| `rg -n "data-phase-state|phaseFor" packages/overlay/src/components packages/overlay/test` | `Board.tsx` passes `phaseState={phaseFor(...)}` into section primitives and tests already pin that shape. | Keep Board as the live owner. |
| `rg -n "acceptanceSection|specSection|planSection|goalsSection|executorSection|changesSection" packages/overlay/src packages/overlay/test specs` | `utils/section.ts` still depends on legacy DOM refs; `FilesSection/#changesSection` has an explicit do-not-delete record for the current round. | Do not delete old DOM registry fields in this scoped fix. |

## Root Cause

The overlay migrated section highlighting to Solid Board props, but
`loadConversation()` still called `syncSectionPhases()` after every transcript
load. That legacy path reads the card tree, looks up hard-coded DOM refs, and
mutates `dataset.phaseState` outside Solid. The result is two independent
writers for the same visible state, which makes phase highlighting hard to
reason about during long task loads and toolbar/panel interactions.

## Fix Plan

1. Remove the `syncSectionPhases` import from `messages.ts`.
2. Remove the `loadConversation()` call that mutates DOM phase state after
   `setMessages()`.
3. Add a focused regression test proving `loadConversation()` does not call the
   legacy section phase writer.
4. Add an architecture guard that prevents `messages.ts` from importing or
   calling `syncSectionPhases` again.
5. Verify tests, typecheck, and real 7878 visual behavior.

## Acceptance

- `loadConversation()` updates message stores only; it does not write workflow
  section DOM phase attributes.
- Board remains the single live owner of `data-phase-state` props.
- No fallback, compatibility path, hidden alternate writer, or second phase
  store is introduced.
- Focused tests and overlay typecheck pass.
- Visual QA on the real `/ui/` page still shows the workflow and screenshots
  panels usable after task selection.

## Verification

- `bun test packages/overlay/test/message-load-section-phase-single-source.test.ts packages/overlay/test/overlay-architecture-guards.test.ts --timeout 30000`
- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay build:vite`
- Node Playwright visual/performance probe against `http://127.0.0.1:7878/ui/`:
  `node packages/overlay/.scratch/gui-perf-benchmark.mjs`
- Visual screenshots reviewed:
  `.scratch/gui-benchmark-selected-tsk_ede365286001jVdoQNtGUsklYd-screenshots.png`,
  `.scratch/gui-benchmark-selected-tsk_ee0f11c510011D4AnsTMGr0bh7-screenshots.png`,
  and `.scratch/gui-benchmark-selected-tsk_edc1eeb470011vW1ZfiEsw7ijo-workflow.png`.

## Self Review

- Rechecked `messages.ts`; the `syncSectionPhases` import and post-load call
  are gone.
- Rechecked `Board.tsx`; section `data-phase-state` still flows through
  `phaseFor(...)` and section props.
- Kept `utils/section.ts`, `dom.ts` legacy refs, and `FilesSection/#changesSection`
  untouched in this round because existing history explicitly preserves the
  file changes component path.
- The live probe still shows task selection as the dominant slow operation
  (multi-second load for long tasks); screenshot capture itself remains
  roughly 65-118 ms in Node Playwright.
