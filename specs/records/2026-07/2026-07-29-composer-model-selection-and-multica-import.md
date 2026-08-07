# Composer Model Selection And Multica Import

## Recall

### User requirement

- Preserve the Codex-like accent pill only after the Composer has a selected model.
- When no model is selected, the `选择模型` placeholder button must not appear highlighted.
- Clicking `Multica 导入` must first verify that the Composer has a selected model. If not,
  show a clear prompt and do not open the import confirmation or start the Mission.
- Remove the built-in `OpenCorvus / opencorvus/gpt-5-nano` model shown in the Composer model
  selector; this must be removed at the Provider catalog/runtime source rather than hidden by the
  Overlay.
- The current unselected state is shown in
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-dd25e685-639e-4daf-bf3e-63965c8258db.png`.
- The unwanted OpenCorvus model is shown in
  `C:/Users/10132/AppData/Local/Temp/codex-clipboard-98b9f082-1580-4e5b-8890-055617de1f97.png`.

### Acceptance criteria

- The selected-model trigger is a clearly bounded pill with an accent-tinted surface, a visible
  accent-aware boundary, strong readable model text, and an accent-forward chevron.
- The unselected `选择模型` placeholder is a neutral, unhighlighted control at rest.
- Hover and keyboard focus retain the same pill identity instead of reverting to a flat neutral
  wash after a model is selected; the unselected control retains ordinary hover and accessible
  keyboard-focus feedback.
- The button keeps its current Composer-row footprint, truncation behavior, popup placement, and
  interaction semantics.
- With no selected Composer model, clicking `Multica 导入` opens one model-required notice and
  performs no import action.
- With a selected Composer model, clicking `Multica 导入` opens the existing confirmation and an
  accepted confirmation starts the Mission with that exact model.
- The canonical Provider catalog and connected Provider projection do not publish the built-in
  `opencorvus` Provider or `opencorvus/gpt-5-nano`; an existing generated model-catalog cache
  containing that entry is normalized on read so the stale model cannot remain visible.
- Explicitly configured third-party Providers continue to use the generic Provider contract; this
  change removes the product-owned OpenCorvus Provider declaration and public autoload behavior,
  not unrelated models named `gpt-5-nano` under other Providers.
- A real desktop page is opened and the unselected, selected, hover, focus, Popover, missing-model
  notice, and selected-model Multica confirmation states are interacted with, captured, and
  personally inspected. No User Interface (UI) automated test is added, modified, updated, or run.

### Hard constraints

- Root `AGENTS.md` applies.
- Reuse the existing Composer model single source, shared app-dialog primitive, and existing
  Multica confirmation flow. Do not add a second model field, fallback to project configuration,
  custom alert, duplicate button path, or gate/state machine.
- Keep the visual repair Composer-local and tokenized. Preserve the shared `Button`,
  `SegmentedControl`, model Popover, Provider navigation, and model-selection ownership.
- Do not touch the unrelated dirty database, route-context, test, or teardown-record files already
  present in the shared worktree.
- Do not create a worktree. Start browser control with Node.js, never Bun.
- Commit subjects begin with `dsw-33987`; push the completed task-owned commit to `legacy-remote`.

### Hard-disk sources read

- `AGENTS.md`
- `specs/records/2026-07/2026-07-29-composer-model-single-source-repair.md`
- `specs/records/2026-07/2026-07-29-composer-mode-selected-state-contrast.md`
- `specs/records/2026-07/2026-07-29-code-work-composer-and-grouped-references.md`
- `packages/overlay/src/main.tsx`
- `packages/overlay/src/store/app.ts`
- `packages/overlay/src/services/app-dialog.ts`
- `packages/overlay/src/components/WorkLedger.tsx`
- `packages/overlay/src/components/ComposerModelSelector.tsx`
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/ui/SegmentedControl.tsx`
- `packages/overlay/src/styles/surfaces/composer.css`
- `packages/overlay/src/styles/primitives/button.css`
- `packages/overlay/src/styles/primitives/segmented-control.css`
- `packages/opencorvus/src/provider/models.ts`
- `packages/opencorvus/src/provider/provider.ts`
- `packages/opencorvus/src/provider/vendor.ts`
- `packages/opencorvus/test/provider/provider.test.ts`
- `packages/opencorvus/src/provider/models-bootstrap.json`
- Both user-supplied screenshots listed above.

### Whole-repository grep result

Repository-wide searches covered `Choose model`, `选择模型`, `ModelSelector`, `selectedModel`,
`modelLabel`, `composerModel`, `config.model`, `composer-model-selector`,
`composer-model-selector-trigger`, `composer-mode-toggle`, `.oc-button`, `Multica`,
`onStartMulticaImport`, `startWorkLedgerMulticaImport`, `wakeMission`, `showAppDialog`, and every
Multica locale key. The added Provider search covered `opencorvus/gpt-5-nano`, every
`gpt-5-nano` occurrence, the `opencorvus` Provider ID, `withLocalProviders`,
`LOCAL_PROVIDER_IDS`, `CUSTOM_LOADERS`, `smallModelPriority`, `getSmallModel`, Provider catalog
routes, connected-model projection, Provider-specific transforms, and historical specs/commits.

| Owner / call site                                             | Finding                                                                                                                                                                            | Disposition                                                                                                                                       |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ComposerModelSelector.tsx`                                   | The only Composer model trigger reads `appStore.composerModel`, exposes `data-requires-selection`, owns the current label and chevron, and opens the existing model Popover.       | Preserve markup, state ownership, and behavior; use the existing attribute as the CSS state boundary.                                             |
| `styles/surfaces/composer.css`                                | The task-local dirty change currently gives every trigger the accent pill and makes `data-requires-selection` even stronger. This directly causes the new unselected-state defect. | Make the default/required-selection state neutral and scope the accent pill to the exact selected state.                                          |
| `ChatComposer.tsx`                                            | Submission already becomes disabled when the selector reports no Composer model and shows `chat.disabled_model_required`.                                                          | Preserve; Multica is outside this form and therefore needs its own notice at its action boundary.                                                 |
| `WorkLedger.tsx`                                              | The sole Multica shortcut delegates the active project directory to `onStartMulticaImport`.                                                                                        | Preserve the shared navigation action and keep model ownership out of this presentation component.                                                |
| `main.tsx:startWorkLedgerMulticaImport`                       | The sole Multica click handler validates only the directory, opens confirmation immediately, then reads `appStore.config.model`.                                                   | Check `appStore.composerModel` before confirmation, show the shared app dialog when missing, and pass the exact selected value to `wakeMission`.  |
| `main.tsx` ordinary expert-squad submit                       | The other direct `wakeMission` boundary also reads `appStore.config.model` despite the Composer single-source contract.                                                            | Replace it with `appStore.composerModel`; its existing Composer disabled-send behavior remains the missing-selection owner.                       |
| `app-dialog.ts` and Multica locale keys                       | The mature shared modal already supports one-button notices and the existing confirmation.                                                                                         | Reuse it and add Multica-specific model-required copy in both locales.                                                                            |
| Shared Button / SegmentedControl primitives and model Popover | These are product-wide or own popup content rather than the requested state boundary.                                                                                              | Preserve.                                                                                                                                         |
| `provider/models.ts`                                          | `withLocalProviders` injects a product-owned `opencorvus` Provider and the persisted generated catalog requires it, so both fresh and existing caches can publish it.              | Remove its local declaration, exclude it at the canonical catalog ingestion boundary, and retain only Hexin and Kilo as required local Providers. |
| `provider/vendor.ts:CUSTOM_LOADERS.opencorvus`                | The loader autoloads zero-cost OpenCorvus models with a synthetic `public` key even when the user never authenticated the Provider.                                                | Delete the product-specific loader; do not replace it with an Overlay filter.                                                                     |
| `provider/provider.ts:getSmallModel`                          | When the requested Provider has no small model, it silently falls back to `opencorvus/gpt-5-nano`.                                                                                 | Delete the fallback so removal is complete and no runtime path can reintroduce the model.                                                         |
| Provider-specific transform/header code                       | These paths apply only when a caller explicitly configures a Provider whose ID starts with `opencorvus`; they do not register or connect the built-in Provider.                    | Preserve generic explicit-config execution behavior; it is not the source of the unwanted selector entry.                                         |
| UI/browser fixture references                                 | Numerous historical UI fixtures use `opencorvus/gpt-5-nano` as mock data. UI test modification and execution are forbidden for this task.                                          | Do not touch or run them; verify the real Provider contract with a non-UI unit test and the product surface through the real page.                |

### Independent review feedback

- Claude Code `2.1.147` was invoked from the repository root with read-only `Read,Grep,Glob` tools,
  no session persistence, streaming output, and an explicit prohibition on edits, tests, and
  delegation. It returned `Not logged in · Please run /login` before reading the repository, so no
  Claude finding is claimed. The primary agent remains responsible for the exhaustive call-site
  and final rendered review.

## Root cause

The visible button defect was introduced by applying the new accent surface and boundary to the
base `.composer-model-selector`, then strengthening `data-requires-selection`. The placeholder
therefore receives the strongest selected-looking treatment even though that attribute means the
opposite.

The Multica defect is a separate action-boundary ownership error. The shortcut bypasses
`ChatComposer`'s disabled-send calculation, so it never checks the Composer model. Its handler
also reads `appStore.config.model`, even though the recorded single-source contract makes
`appStore.composerModel` the sole frontend selection. The result is both missing feedback and the
possibility of launching import with a project-configured model that the user did not select.

The unwanted OpenCorvus model is not an Overlay rendering defect. `ModelsDev.withLocalProviders`
creates a product-owned OpenCorvus Provider, the generated catalog contract requires that Provider,
and `CUSTOM_LOADERS.opencorvus` connects its zero-cost model with a synthetic public key. The
Composer correctly displays connected Providers, so hiding the row there would leave the Provider
active in every other runtime consumer. Existing generated catalogs also retain the declaration,
which means removing only the fresh bootstrap injection would not fix already-running installs.

## Implementation plan

1. Make the Composer trigger neutral by default and apply the existing tokenized accent pill only
   when `data-requires-selection` is absent.
2. At the start of the sole Multica handler, read and trim `appStore.composerModel`; if empty,
   display the shared model-required notice and return before the existing confirmation.
3. Pass that exact selected value to `wakeMission`, and replace the other direct
   project-config-model Mission handoff with the same Composer source.
4. Add exact Chinese and English Multica model-required notice copy.
5. Remove the product-owned OpenCorvus Provider from canonical catalog ingestion, its public
   autoload loader, and its small-model fallback. Replace the existing non-UI Provider contract test
   with an assertion that fresh and previously populated catalog input omit it.
6. Run formatting, focused Provider tests, Overlay typecheck/build, static integrity, and required documentation-health
   checks without running UI tests.
7. Start the real page, interact with every acceptance state, capture task-scoped screenshots,
   inspect them, and tune if needed.
8. Re-read the final diff and screenshots, fetch/converge, commit only task-owned paths, push to
   `legacy-remote`, and verify local/remote convergence.

## Progress

- [x] Record the revised requirement, current screenshot, constraints, prior decisions, exhaustive
      call sites, causal chain, and implementation plan.
- [x] Invoke and record the unavailable read-only Claude Code review.
- [x] Implement the Composer state styling and Multica model selection boundary.
- [x] Remove the product-owned OpenCorvus Provider declaration, public loader, and small-model
      fallback at their canonical runtime sources.
- [x] Complete static, non-UI contract, build, internationalization, and documentation verification.
- [x] Complete real-page interaction, task-scoped screenshot inspection, and visual correction.
- [x] Complete the second source, contract, and visual-evidence review.
- [x] Commit the task-owned delivery; push and remote convergence are verified immediately after
      the repository hooks accept this commit.

## Verification

### Static and non-UI contract checks

- `bun run --cwd packages/opencorvus typecheck`: passed.
- `bun run --cwd packages/overlay typecheck`: passed after the final source changes.
- `bun run --cwd packages/overlay check:i18n`: passed.
- `bun run --cwd packages/overlay build:vite`: passed across 7,055 modules; only the existing
  large-chunk warnings remained.
- `bun test packages/opencorvus/test/provider/models-bootstrap.test.ts`: 10 passed, 0 failed.
- Focused Provider tests for local-catalog omission and small-model fallback removal: 2 passed,
  0 failed.
- Focused `GET /global/providers` route contract: 1 passed, 0 failed.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`: 22 passed, 0 failed
  after the final record/index update.
- `git diff --check`: passed after the final record update and is rerun against the staged delivery
  before commit.

One earlier mixed-suite command unintentionally selected the pre-existing `GET /ui/ serves overlay
shell` assertion in `app-routes.test.ts`; it returned the known isolated-runtime `404` because the
embedded Overlay asset was absent. No UI assertion or fixture was added, modified, or updated.
The command was not rerun; the subsequent test invocation selected only the non-UI Provider route
contract and passed. The real User Interface (UI) acceptance below did not rely on that assertion.

### Real-page visual and interaction review

An isolated real OpenCorvus server was started from the current source with a fresh temporary home
and a real Provider catalog. `GET /global/providers` returned `200`, connected only the configured
OpenAI Provider, and did not contain the `opencorvus` Provider. The real `/ui/` page was then opened
and personally inspected:

- The unselected Composer model button rendered as a neutral control rather than an accent pill.
- The model Popover contained the OpenAI Provider and no OpenCorvus Provider or
  `opencorvus/gpt-5-nano` row.
- Clicking Multica with no Composer model showed the one-button `Choose a model first` notice and
  did not open the import confirmation or execute an import.
- Selecting `openai/gpt-5` gave the button the intended accent surface, boundary, readable label,
  and accent chevron while preserving its footprint and Popover placement.
- Clicking Multica after selection opened the existing `Import Agent Squads from Multica?`
  confirmation. `Continue` was deliberately not accepted, so the visual acceptance run performed
  no external import.

Task-scoped screenshots of each state were captured through the real browser path and manually
reviewed without creating a baseline or repeatable UI test artifact. The selected/unselected
Composer CSS reached the shared branch in concurrent commit
`836ced9691 dsw-33987 style Composer model selector like Codex`; the final source review confirmed
that the required selected-state boundary remains present. Browser tabs and verification servers
were closed after inspection, and the isolated temporary home was moved to the Windows Recycle Bin.
