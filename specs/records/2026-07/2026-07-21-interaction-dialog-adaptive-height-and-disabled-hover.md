# Interaction Dialog Adaptive Height and Disabled Hover Repair

## Recall

### User requirement

After selecting an expert squad, the shared Question dialog expands to nearly the full desktop window, leaves a large empty region below its actions, and makes an installed disabled squad row look selected when hovered. The supplied 1500 x 1166 screenshot is the acceptance reference.

### Acceptance criteria

1. A short Question uses its natural content height instead of the dialog's maximum height.
2. At the supported maximum UI scale (`1.6`), the Multica squad picker has no empty region below `Answer` / `Skip`.
3. Long Question content retains the existing scaled `640px` maximum, scrollable content, and fixed header/action regions.
4. An installed disabled squad keeps the default cursor and unchanged background on hover, and remains unchecked.
5. Available squads remain selectable and submit their exact UUID values through the canonical Question reply.
6. Source tests, real Node-launched Playwright checks, fresh screenshots, documentation health checks, and a second review all pass before delivery.

### Hard constraints

- Keep `Question` -> `InteractionDialogHost` -> `InteractionCard` as the single renderer and keep Kobalte Dialog, Checkbox, and RadioGroup primitives.
- Do not add a second squad dialog, compatibility path, fallback, process gate, state machine, or hidden UI-only selection source.
- Preserve the complete Multica roster description and the `installed` disabled contract; the repair is presentation geometry and disabled interaction semantics.
- The 2026-07-15 fixed-size dialog record remains historical evidence. This repair supersedes only its unconditional minimum/fixed height for short content and retains its maximum-height overflow behavior for long content.
- Desktop-only acceptance. Playwright must be launched with Node. Do not restart, refresh, stop, or reuse the user's running OpenCorvus / Overlay process.
- Work in the current worktree, preserve unrelated dirty changes, use `dsw-33987` commit subjects, and push the current delivery branch to `legacy-remote`.

### Evidence read before implementation

- User screenshot: `C:/Users/10132/AppData/Local/Temp/codex-clipboard-d37efefb-3118-4166-a32c-14500d39f3bb.png`.
- `specs/records/2026-07/2026-07-15-task-attention-interaction-dialog.md` for the earlier fixed-size decision.
- `specs/records/2026-07/2026-07-20-multica-question-human-readable-option-title.md` for Multica option identity and disabled-state requirements.
- `packages/opencorvus/src/skill/builtin/multica-import.md` for the required complete squad roster.
- `packages/overlay/src/components/InteractionDialogHost.tsx`, `InteractionCard.tsx`, `primitives/Checkbox.tsx`, and `primitives/RadioGroup.tsx` for the real render and selection path.
- `packages/overlay/src/styles/surfaces/dialog.css`, `surfaces/card.css`, `primitives/selection-control.css`, and `packages/overlay/src/index.html` for ownership and stylesheet order.
- `packages/overlay/test/interaction-dialog-host.test.ts`, `test/browser/interaction-card-textarea-browser.test.ts`, and `test/browser/multica-import-browser.test.ts` for existing source and rendered acceptance coverage.
- Git history `a71f8026ca` and later `3c0d7540c` for the introduction and retention of the unconditional dialog height.

### Repository-wide search

Searches covered `interaction-dialog-form`, `interaction-card__option`, `InteractionDialogHost`, `InteractionCard`, `Question.Option`, Multica import Question construction, `installed`, and browser screenshot names. The relevant call sites and dispositions are:

| Surface | Evidence | Disposition |
| --- | --- | --- |
| Shared host | `packages/overlay/src/components/InteractionDialogHost.tsx` | Keep as the only Dialog owner. |
| Shared renderer | `packages/overlay/src/components/InteractionCard.tsx` | Keep Question data/selection behavior unchanged. |
| Dialog base geometry | `packages/overlay/src/styles/surfaces/dialog.css` | Retain its natural `fit-content` contract. |
| Interaction override | `packages/overlay/src/styles/surfaces/card.css` | Replace the unconditional fixed height with natural height plus the existing maximum. |
| Selection primitive | `packages/overlay/src/styles/primitives/selection-control.css` | Retain canonical disabled opacity/cursor; prevent the later surface stylesheet from overriding it. |
| Primitive components | `Checkbox.tsx`, `RadioGroup.tsx` | Retain native `data-disabled`, checked, and keyboard behavior. |
| Shared source contract | `packages/overlay/test/interaction-dialog-host.test.ts` | Add adaptive-height and disabled-hover ownership assertions. |
| Long-content browser contract | `packages/overlay/test/browser/interaction-card-textarea-browser.test.ts` | Preserve existing exact maximum-height and scroll assertions. |
| Multica browser contract | `packages/overlay/test/browser/multica-import-browser.test.ts` | Add maximum-scale short-content geometry and disabled-hover evidence while preserving unrelated current edits. |
| Multica prompt | `packages/opencorvus/src/skill/builtin/multica-import.md` | No change; complete roster data remains required. |

### Causal chain

- Observable result: the selected-squad dialog fills most of the high-scale desktop viewport and shows a large empty block below the action bar.
- Direct trigger: `surfaces/card.css` overrides the generic dialog's `height: fit-content` with `height: min(640px * scale, viewport allowance)` and makes the card/content grid consume that fixed height.
- Scale effect: at UI scale `1.6`, the scaled maximum is large enough to approach the 1500 x 1166 viewport, so a five-row picker inherits the long-content ceiling as its actual height.
- Disabled-row illusion: the later-loaded surface stylesheet applies the same hover background and pointer cursor to disabled rows, overriding the primitive's interaction affordance. The empty checkbox remains the real state; the gray row is hover paint, not selection.
- Why selection appeared causal: selecting the expert squad opens this Question surface; selection does not create the geometry. The shared dialog CSS exposes both defects as soon as this content is rendered.
- Why the earlier path did not root-fix it: the 2026-07-15 change optimized long-content stability by making the maximum the actual height, but did not preserve the pre-existing short-content `fit-content` invariant or test a short picker at maximum UI scale.

## Implementation plan

1. Add a source regression and extend the real Multica browser test so the current fixed-height/disabled-hover behavior fails visibly.
2. Make the interaction dialog flex to natural content while keeping the current scaled maximum and a single scroll owner for overflow.
3. Restrict hover affordance to enabled options and explicitly preserve the default cursor for disabled options.
4. Run shared source tests, both short- and long-content Node Playwright tests, Overlay typecheck/build, inspect fresh screenshots, and iterate from visual evidence.
5. Update this record with the exact verification ledger, run documentation health checks, perform a second diff/call-site review, fetch the remote baseline, commit, and push.

## Verification ledger

### Regression and implementation evidence

- `bun test packages/overlay/test/interaction-dialog-host.test.ts` failed before the product edit because the interaction form still contained `height: min(...)` instead of `height: fit-content`.
- The first rendered assertion correctly distinguished the disabled hover defect, but exposed two test-calibration errors: equivalent transparent CSS colors serialized as `rgba` and `oklab`, and an absent `data-selected` attribute represented native false state. The final assertion measures rendered pixel alpha and normalizes the absent attribute rather than comparing serialization strings.
- At the fixture's default 1440 x 900 viewport and UI scale `1.6`, five rows are genuinely eight pixels taller than the available content pane. That case correctly retains bounded scrolling and is not a short-content shrink case.
- At the user's 1500 x 1166 reference viewport and UI scale `1.6`, `flex-grow: 1` still forced the form to its 1024px maximum. Changing the card and content to `flex: 0 1 auto` removed that hidden growth source while retaining shrink/scroll behavior above the ceiling.

### Passing checks

- `bun test packages/overlay/test/interaction-dialog-host.test.ts packages/overlay/test/selection-control-primitive.test.ts`: 11 passed.
- `node test/browser-runner.mjs test/browser/multica-import-browser.test.ts` from `packages/overlay`: passed on the final `HEAD` and product diff.
- `node test/browser-runner.mjs test/browser/interaction-card-textarea-browser.test.ts` from `packages/overlay`: passed; long permission content still scrolls inside the bounded dialog, including the 1120 x 720 maximum-scale drag path.
- `bun run typecheck` from `packages/overlay`: passed.
- The Node browser acceptance rebuilt the production Overlay with Vite: 2646 modules transformed and the build completed successfully.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts`: the historical link suite passed on the initial run; after precise staging, the combined document suites passed with 82 tests and 1356 expectations.

### Visual review

- `.scratch/multica-squad-disabled-hover.png`: inspected at original resolution. The first installed row remains transparent and unchecked while hovered; the form ends immediately after its actions with no lower blank panel.
- `.scratch/multica-squad-multi-select.png`: inspected at original resolution. The two enabled rows show native checked state, disabled rows remain visibly non-interactive, and the action bar is directly attached to the content.
- `.scratch/interaction-card/permission-drag-zoom-only-bottom.png`: inspected at original resolution. The long-content scroll region remains bounded and the permission actions stay visible at the bottom.
- The short- and long-content screenshots were regenerated and re-inspected after the latest baseline merge changed Overlay App/base-style files; the accepted geometry remained unchanged.

### Second review

- `git diff --cached --check` passed.
- The staged diff contains exactly the shared dialog stylesheet, the Multica rendered regression, the InteractionDialogHost source contract, this record, and the two required spec indexes: 6 files, 221 insertions, and 10 deletions.
- The review confirmed there is still one Question/InteractionDialogHost/InteractionCard path, one Kobalte selection state, one long-content scroll owner, and no prompt, catalog, roster, squad identity, or runtime process change.
- `git fetch legacy-remote --prune` confirmed the work branch matched `legacy-remote/work-v0.0.12beta-yr-0720`. The three newer `legacy-remote/v0.0.12beta` commits were merged after the implementation commit; only the two spec indexes conflicted, and both sides' records were retained.
- After that merge, Overlay typecheck passed, the focused source suite passed 11 tests, both Node browser suites passed, Vite rebuilt 2646 modules, and the documentation suites again passed 82 tests and 1356 expectations.
