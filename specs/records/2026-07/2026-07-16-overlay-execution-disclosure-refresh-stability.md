# Overlay Execution Disclosure Refresh Stability

## Recall

| Item                       | Detail                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| User requirement           | 1. Reasoning is collapsed by default. 2. Hovering a tool call shows its start time. 3. Expanding Tools/Reasoning must survive left-task data refreshes instead of collapsing again.                                                                                                                                                                                                                                                         |
| Acceptance criteria        | Standalone Reasoning and aggregate Tools/Reasoning controls start collapsed; the existing tool-header hover tooltip visibly includes the persisted Started time; expanding either disclosure survives a component/tree remount for the same selected task; task changes still isolate disclosure state; real desktop browser checks and screenshots pass.                                                                                   |
| Hard constraints           | Keep `CardParts` as the only execution disclosure owner, `ReasoningPart` as the only reasoning renderer, `CardHeader` as the only tool-timing tooltip owner, and `conversation-ui` as the single task-scoped presentation-state owner. No fallback identity, second renderer, custom tooltip, hidden message, state machine, mobile/tablet scope, new worktree, or interference with the user's running Overlay. Browser fixtures use Node. |
| Supplied evidence          | Two screenshots at `C:/Users/10132/AppData/Local/Temp/codex-clipboard-af27d8b8-0943-4e25-af69-083d36a58057.png` and `C:/Users/10132/AppData/Local/Temp/codex-clipboard-64d9c7e2-d4e8-4b1b-b775-6a4c4914c20b.png`, inspected at original resolution.                                                                                                                                                                                         |
| Sources read               | `AGENTS.md`; browser-control skill; `specs/current/architecture/07-panel-reactivity.md`; `specs/current/architecture/12-overlay-card-system.md`; the tool-timing, message-card, chronological-run, and reasoning-ownership records; `Conversation.tsx`, `Card.tsx`, `ChatBubble.tsx`, `CardParts.tsx`, `ReasoningPart.tsx`, `CardHeader.tsx`, `conversation-ui.ts`, `reasoning.ts`, `message-part.ts`, and focused tests.                   |
| Git baseline               | Branch `work-v0.0.6beta-yr-0716` at `21c8cadf0`; `legacy-remote/work-v0.0.6beta-yr-0716` contains the same commit. Pre-change push passed typecheck but the existing `Question.Option.value` generated-OpenAPI drift failed `api:routes-check`; final delivery must regenerate and verify the tracked API artifacts rather than bypass the hook.                                                                                                  |
| Independent agent feedback | None. The user did not request delegation; active collaboration policy forbids unrequested sub-agents.                                                                                                                                                                                                                                                                                                                                      |

## Whole-repository search and call-site disposition

| Surface              | Search result                                                                                                                                                                                                                      | Disposition                                                                                                                            |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Execution grouping   | `partitionMessagePartRenderRuns` has one production caller in `CardParts`; `ExecutionDisclosureRun` is the sole aggregate control.                                                                                                 | Preserve chronology and rendering; replace only its component-local disclosure state.                                                  |
| Production consumers | Three `ChatBubble` call sites and one `Card` call site enable `collapseWorkDetails`; all converge through `CardParts`.                                                                                                             | Repair the shared owner once.                                                                                                          |
| Reasoning            | `ReasoningPart` is rendered only through `CardParts`; self-owned reasoning uses a local `createSignal(false)`, while parent-owned reasoning projects the aggregate state.                                                          | Keep the default false and renderer; move self-owned state to the task-scoped UI store.                                                |
| Tool timing          | `CardHeader` owns one Kobalte Tooltip trigger and `toolTimingRows`; `CardNode.time/timeCompleted` come strictly from `part.state.time.start/end`. Existing unit and browser tests already assert Started/Finished/Duration/Status. | Retain the implementation and strengthen end-to-end regression coverage; do not create a second hover surface.                         |
| Existing UI state    | `conversation-ui.ts` already owns stable card expansion across tree replacement and is loaded/cleared only when selected task identity changes.                                                                                    | Add a disclosure map to the same store so data refresh/remount cannot reset user presentation.                                         |
| Stable identity      | Every rendered production part has a validated part-domain `orderKey`; the first visible execution part remains stable when later adjacent parts stream into the same run.                                                         | Derive the aggregate disclosure key from that first part order key; use the existing reasoning part identity for standalone reasoning. |

## Cause chain

The backend refresh replaces or reconciles conversation data, `partitionMessagePartRenderRuns` emits new run objects, and Solid remounts `ExecutionDisclosureRun` / `ReasoningPart`. Their local signals are recreated with `false`, so the page collapses even though the selected task and the stable message parts did not change. Card folding does not suffer from this because it already reads `conversation-ui`. The root repair is to give execution and standalone-reasoning disclosures the same task-scoped presentation ownership, keyed by canonical part identity; changing hydration, suppressing refreshes, or retaining DOM nodes would only mask the symptom.

## Implementation plan

1. Extend `conversation-ui` with one task-scoped disclosure map plus read/write functions; clear it only on a real selected-task change, alongside the existing card state load.
2. Add a pure execution-run disclosure key derived from the first visible part's validated `orderKey`, and cover stability as later adjacent parts are appended.
3. Replace local disclosure signals in `ExecutionDisclosureRun` and self-owned `ReasoningPart` with the store accessors while keeping both defaults collapsed and parent-owned reasoning single-layered.
4. Extend focused store/source tests and the real chronology fixture to remount the rendered execution tree after expansion, proving the same expanded state and existing Started tooltip survive refresh.
5. Run focused unit tests, Overlay typecheck/i18n/build, Node browser tests, inspect fresh screenshots at original size, perform a second diff review, regenerate the pre-existing API drift, run documentation/API checks, commit with `dsw-33987`, and push `legacy-remote` without bypassing hooks.

## Verification plan

```powershell
bun test packages/overlay/test/card-fold-store.test.ts packages/overlay/test/message-part-render-order.test.ts packages/overlay/test/reasoning-part.test.ts packages/overlay/test/card-duration-single-source.test.ts packages/overlay/test/card-timing.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/message-part-chronology-browser.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/chat-bubble-disclosure-button-browser.test.ts
bun run ./script/generate.ts
bun run api:routes-check
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation and acceptance evidence

- `conversation-ui.ts` now owns a task-scoped `expandedDisclosures` map beside the existing card-fold map. Re-entering the same task leaves it intact; a real task change or explicit conversation clear removes it.
- `ExecutionDisclosureRun` derives its state key from the first visible execution part's validated part-domain `orderKey`. Appending later adjacent tools or reasoning therefore does not change the identity.
- Standalone `ReasoningPart` uses its existing session/message/part identity in the same store and still defaults to `false`. Parent-owned reasoning remains controlled only by the outer aggregate, so the single-layer disclosure contract is preserved.
- `CardHeader`, `toolTimingRows`, `CardDurationChip`, and `part.state.time.start/end` were not changed. Existing unit coverage and the real browser fixture continue to prove `Started`, `Finished`, `Duration`, and `Status` in the Kobalte tooltip.
- Focused unit tests passed: 39 tests, 0 failures, 200 expectations. Overlay TypeScript typecheck, localization validation, and the production Vite build passed; the existing large-chunk advisory remains informational.
- The Node chronology browser test passed after expanding both execution groups, remounting the entire `CardParts` fixture, and observing both controls still at `aria-expanded="true"` with five real tool cards and two parent-owned reasoning parts. Its timing-hover assertions also passed.
- The broader production-shaped chat-bubble browser test passed and continues to prove narrative visibility with reasoning/tools collapsed by default.
- Personally inspected `.scratch/message-part-chronology-collapsed.png`, `.scratch/message-part-chronology-component.png`, and `.scratch/tool-timing-tooltip-hover.png` at original size. The first is cleanly collapsed, the second remains expanded after remount, and the third visibly shows the exact persisted Started time.
- The in-app Browser independently confirmed two real disclosure controls, two reasoning parts, five tool rows, and correct desktop DOM geometry on the isolated fixture. Its screenshot transport rendered text as a false narrow column despite 920px DOM geometry; visual acceptance therefore uses the repository Node/Playwright screenshots above. The user's running Overlay was not touched.
- The pre-change hook's OpenAPI drift was repaired through the repository's real `bun run ./script/generate.ts` entry; `api:routes-check` now passes. The combined document-health run has one unrelated working-tree failure because two concurrent untracked July records are already linked from the shared monthly README; this task neither owns nor stages those records.

## Follow-up Recall: muted compact disclosure typography

| Item | Detail |
| --- | --- |
| User requirement | Render Tools and Reasoning with lower-visibility gray text, one type step below narrative copy, and slightly tighter vertical rhythm above and below adjacent narrative text. |
| Acceptance criteria | Aggregate Tools/Reasoning and standalone Reasoning controls use the muted text tier, the 13px navigation type token versus 14px narrative text, body weight, and a compact control height no greater than 22px; real desktop screenshots confirm the disclosure remains readable and clearly secondary. |
| Hard constraints | Preserve the existing Button primitives, task-scoped disclosure ownership, chronology, keyboard behavior, hover affordance, and expanded content typography. Change only the shared disclosure presentation owner; do not introduce another renderer or local state. |
| Sources and whole-repository search | `.msg-work-details*` is the only aggregate presentation owner; `[data-ui="reasoning-toggle"]` is the only standalone Reasoning control owner; all production callers still converge through `CardParts` and `ReasoningPart`. `--text-muted`, `--ui-font-navigation`, `--ui-font-body`, `--ui-font-weight-body`, and `--ui-line-height-tight` are the existing design-language sources. |
| Concurrent work | The staged five-surface polish already moved the aggregate label to muted 13px body typography. This follow-up preserves that change, aligns standalone Reasoning, and tightens only the shared vertical geometry. |
| Independent agent feedback | None; the user did not request delegation. |

The compact rhythm is defined by the existing scale-aware geometry: aggregate controls move from 26px to 22px, their outer block margin moves from 2px to 1px, and standalone Reasoning internal gap moves from 5px to 3px. Browser coverage compares the rendered disclosure type directly against rendered narrative type and caps the real toggle height, so future token changes cannot silently erase the hierarchy.

Follow-up verification passed the focused CSS/source tests, both Node browser fixtures, Overlay TypeScript check, localization check, and production build. Fresh light/dark standalone screenshots and chronology screenshots were inspected at original size: muted copy remains readable, the 13px/14px hierarchy is visible, adjacent narrative spacing is compact without collision, and focus/hover/expanded chrome remains intact. The broader subtitle typography test has one unrelated concurrent failure because its `.change-directory` selector owner is currently absent; the Reasoning assertion within that same suite passes.
