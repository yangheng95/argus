# Interaction default single-choice repair

## Recall

| Item | Detail |
| --- | --- |
| User request | Fix the Multica import authorization-repair dialog so its two radio options do not both look selected; the first option is selected by default; clicking `Answer` immediately submits that first selection. |
| Acceptance criteria | On first render, exactly the first enabled option of a fixed-choice (`multiple:false`, `custom:false`) Question is checked and visually selected; every other option is visibly unchecked; without any option click, `Answer` submits the first option's stable value; pointer and keyboard replacement selection remain exclusive; multi-select and custom-answer questions keep their existing empty draft; focused tests, a Node-launched real browser fixture, inspected task-scoped screenshot, typecheck/build, document health, second review, commit and legacy remote push pass. |
| Hard constraints | Keep `InteractionCard` as the single question renderer for inline and dialog surfaces; keep native grouped radio semantics and the shared `Radio` primitive; do not add a Multica-specific modal, title/label keyword match, fallback, second selection store, state machine, worktree, Bun-launched Playwright, or refresh/restart of a running OpenCorvus/Overlay process. |
| Sources read | `AGENTS.md`; `browser:control-in-app-browser` Skill; `specs/records/2026-07/2026-07-20-multica-import-repair-dialog.md`; `InteractionCard.tsx`; `InteractionDialogHost.tsx`; `RadioGroup.tsx`; `Checkbox.tsx`; `selection-control.css`; `card.css`; Multica and interaction browser fixtures; selection primitive and Multica surface tests; Question schema/reply route and interaction-reply service. |
| Whole-repository search | `rg` enumerated `InteractionCard`, `submitAnswers`, `interaction.answer`, `answers`, Question `multiple/custom/options`, every `<InteractionCard>` call, all `data-selected`/`data-checked` radio styling, Multica `repair-and-import`/`cancel-import`, reply routes and focused browser assertions. Production rendering has one component with two consumers: `CardParts` for the inline record and `InteractionDialogHost` for the popup. The existing reply service is already the single submission boundary. |
| Independent agent feedback | None. The user did not request sub-agents, and active policy prohibits unrequested delegation. The primary Agent owns the second review. |
| Git baseline | Clean `work-v0.0.12beta-yr-0720` at `624d230e6`, equal to `legacy-remote/work-v0.0.12beta-yr-0720` after the complete pre-push quality hook passed. |

## Root-cause chain

Observable behavior: both repair/cancel rows appear selected when the dialog
opens, while clicking `Answer` without interacting does not submit the intended
recommended repair value.

Direct triggers: `InteractionCard` initializes every question draft as an empty
array, so `submitAnswers()` serializes `[]`; separately, `.oc-radio-indicator`
is always painted even when its owning radio control lacks `data-checked`.

Deeper cause: native `checked`, row `data-selected`, submission drafts, and
painted indicator were not initialized/projected from one canonical selection.
The browser therefore exposes a real unchecked input while the custom chrome
looks checked, and the reply payload agrees with the empty input state rather
than the requested default.

Why the prior path did not root-fix it: the prior Multica repair dialog verified
pointer and keyboard changes only after an explicit click. It did not assert the
initial native state, custom-control paint, or the no-interaction reply body.

## Call-point disposition

| Call point | Decision |
| --- | --- |
| `packages/overlay/src/components/InteractionCard.tsx` | Initialize each fixed-choice single-select question from its first enabled option. Keep multi-select, custom-answer, and free-text-only questions empty so custom-only answers remain possible. Use the same draft for native `checked`, row `data-selected`, and `submitAnswers()`. |
| `packages/overlay/src/components/ui/RadioGroup.tsx` | Keep the native grouped radio primitive and its checked projection unchanged; it already exposes the required `data-checked` signal. |
| `packages/overlay/src/styles/primitives/selection-control.css` | Hide the radio indicator by default and reveal it only below `.oc-radio-control[data-checked]`, so custom chrome exactly follows the native checked state. |
| `packages/overlay/src/components/InteractionDialogHost.tsx` | Retain unchanged. Its keyed shared `InteractionCard` mount already prevents draft leakage between pending interactions. |
| `packages/overlay/src/components/CardParts.tsx` | Retain unchanged. Inline and dialog surfaces must receive the same initial selection from the shared renderer. |
| `packages/overlay/src/services/interaction-reply.ts` and backend reply routes | Retain unchanged. They already forward the supplied ordered answer arrays and are not the source of the empty default. |
| `packages/overlay/test/browser/multica-import-browser.test.ts` | Replace the explicit first/second clicks in the repair case with initial-state assertions, a screenshot, direct `Answer`, and an exact `repair-and-import` request-body assertion. Keep the existing multi-select coverage unchanged. |
| `packages/overlay/test/browser/interaction-card-textarea-browser.test.ts` | Retain its explicit-selection and keyboard path for a `custom:true` question, proving the fixed-choice default does not alter custom-answer semantics. |
| Selection primitive/source tests | Add a regression that the indicator is hidden by default and revealed only by the existing checked attribute; do not create a second CSS owner. |

## Verification plan

1. Commit and push this Recall/plan before implementation.
2. Change the browser regression first and run it to demonstrate the missing
   default/no-interaction submission on the baseline.
3. Implement the shared fixed-choice single-select default and checked-only
   indicator paint.
4. Run focused source tests, the Node-launched Multica and shared InteractionCard
   browser fixtures, Overlay typecheck/build, historical links, document health,
   and `git diff --check`.
5. Inspect the final task-scoped repair dialog screenshot at original resolution,
   exercise the isolated page with the browser-control skill, perform a second
   diff/call-point review, record evidence here, then commit and push to
   `legacy-remote`.

## Result

Implemented and accepted for the requested surface.

### Delivered behavior

- `InteractionCard` now creates the initial draft for a fixed-choice
  single-select question from its first enabled option. Native `checked`, row
  `data-selected`, and the `answers` request body all read that one draft.
- The shared radio indicator is transparent unless its existing
  `.oc-radio-control[data-checked]` owner is present. Unchecked rows no longer
  display a false filled center.
- Multi-select, `custom:true`, and free-text-only questions still start empty.
  No Multica-specific title/label branch, second store, fallback, or submission
  route was added.

### Test-driven and rendered evidence

- Before implementation, the new source regression failed because
  `.oc-radio-indicator` had no unchecked rule. The Node browser regression then
  failed with both native inputs unchecked but both indicator opacities equal to
  `1`, exactly reproducing the reported visual/submission split.
- After implementation,
  `node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/multica-import-browser.test.ts`
  passed. It asserts initial state `[checked, unchecked]`, indicator opacities
  `[1, 0]`, no option click before `Answer`, and the exact reply body
  `answers: [["repair-and-import"]]`.
- The shared custom-answer InteractionCard browser test passed separately,
  preserving explicit pointer and native keyboard radio behavior.
- The final task-scoped screenshot is
  `.scratch/multica-import-repair-dialog.png` (840 by 587 pixels). Original-size
  inspection and an independent in-app Browser load both show one selected
  repair row and one visibly unchecked cancel row. The isolated screenshot
  server was stopped after inspection; no running OpenCorvus/Overlay process was
  restarted or refreshed.
- Four focused Overlay suites passed: 18 tests, 150 assertions. Overlay
  typecheck, i18n, and the production Vite build passed. Historical-link and
  document-health verification plus final `git diff --check` are rerun at the
  final commit boundary.

### Codex second-review correction

The first implementation draft defaulted every single-select question. Review
found that this would make a custom-only answer difficult because a checked
native radio cannot be cleared through normal radio interaction. The final
implementation therefore uses the question contract, not title keywords: only
`custom:false` fixed-choice single-select questions receive the first-enabled
default. The existing `custom:true` browser case remains explicitly selected by
the operator and passes unchanged.
