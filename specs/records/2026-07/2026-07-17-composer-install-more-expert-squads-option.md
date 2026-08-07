# Composer Install-More Expert Squads Option

## Recall

### User requirement

- Add a virtual “Install more expert squads…” option at the very bottom of the Chat / expert-squad selector shown in the supplied screenshot.

### Acceptance criteria

- The action is always the final visible option after Chat and every installed expert squad.
- It is an action, not a selectable or runnable expert squad: invoking it must not change Composer mode, `expertSquadID`, `prompt_profile.active`, the current draft, or attachments.
- Invoking it closes the selector and opens the existing `expert-squad-install` Settings surface, which already owns market and local-package installation.
- The action is visually separated from installed squads while reusing the existing Kobalte Select option primitive, typography, focus, keyboard navigation, and popup scrolling.
- English and Chinese labels/descriptions are localized. Static tests, a real Node browser interaction, screenshot review, typecheck, i18n, build, and document health pass.

### Hard constraints

- Preserve the strict expert-squad identity/catalog contract. Do not fabricate an `ExpertSquadOption`, add an alias ID, mutate `prompt_profile.active`, duplicate the install UI, or add a second marketplace source.
- Reuse `openConfigDialog("expert-squad-install")`, `SelectControl`, and the existing `ExpertSquadPanel` install tab.
- Do not restart, refresh, close, or interfere with the user's running Overlay. Visual verification uses the isolated Node browser fixture.
- Commit subjects use `dsw-33987` and push `v0.0.8beta` to `legacy-remote`.

### Sources read

- `AGENTS.md`
- Supplied Composer selector screenshot
- `packages/overlay/src/components/ChatComposer.tsx`
- `packages/overlay/src/components/ui/SelectControl.tsx`
- `packages/overlay/src/services/config-dialog-control.ts`
- `packages/overlay/src/store/dialog.ts`
- `packages/overlay/src/components/ConfigDialogHost.tsx`
- `packages/overlay/src/components/settings/ExpertSquadPanel.tsx`
- `packages/overlay/src/styles/surfaces/composer.css`
- `packages/overlay/src/i18n/{en-US,zh-CN}.json`
- `packages/overlay/test/mission-launcher-component.test.ts`
- `packages/overlay/test/browser/expert-squad-selector-browser.test.ts`

### Whole-repository search evidence

- `ChatComposer.tsx` is the only owner of `composerIntentOptions` and the `composer-intent-selector`; it currently maps Chat plus `props.expertSquads` directly into one array.
- `selectComposerIntent` is the single selection handler. Its current union has only `chat` and `expert-squad`, so an explicit action variant is required to avoid misrepresenting the install affordance as a squad.
- `openConfigDialog("expert-squad-install")` is the established entry point. `CONFIG_SECTIONS` and `ConfigDialogHost` route that tab to the existing Expert Squad installation panel, including market and local sources.
- `SelectControl` already exposes option-specific data attributes, labels, descriptions, Kobalte focus, and keyboard behavior; no new menu primitive is needed.
- `composer.css` owns the selector popup and option copy. One exact action attribute selector can add a separator without changing general Select styling.
- `expert-squad-selector-browser.test.ts` is the real application fixture for both locales and already verifies selection, draft preservation, Settings navigation, and screenshots.
- No sub-agent was started because the user did not request delegation and current collaboration policy forbids unrequested sub-agents.

## Root cause and design

The selector currently models only execution choices. Installation is reachable elsewhere in Settings, but the selector offers no terminal discovery action. The correct design is a discriminated `install-more` action appended after the catalog mapping. Selecting it delegates to the canonical install tab and leaves the controlled selector value unchanged, so it cannot become active execution state.

## Implementation plan

1. Add the explicit action variant, localized copy, terminal option, and `openConfigDialog("expert-squad-install")` branch in `ChatComposer`.
2. Add a subtle top separator for that exact action option using the canonical Composer surface stylesheet.
3. Extend static and real browser coverage to prove final ordering, keyboard/click activation, install-panel routing, unchanged Chat selection/draft, and both locales; capture and inspect the open selector.
4. Run focused tests, typecheck, i18n, build, docs health, and diff review; record evidence here, commit, and push.

## Verification plan

```sh
bun test packages/overlay/test/mission-launcher-component.test.ts packages/overlay/test/executor-settings.test.ts packages/overlay/test/work-ledger-consolidation.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/expert-squad-selector-browser.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build
bun test packages/opencorvus/test/script/historical-docs-links.test.ts packages/opencorvus/test/script/document-health.test.ts packages/opencorvus/test/script/product-docs-single-source.test.ts
git diff --check
```

## Implementation summary

- `ComposerIntentOption` now has an explicit `install-more` action variant. `composerIntentOptions` appends it only after mapping every installed squad, so it remains the terminal option for populated and empty catalogs.
- `selectComposerIntent` routes that variant directly to `openConfigDialog("expert-squad-install")` and returns before either Composer mode or expert-squad selection callbacks can run.
- The existing Select primitive renders the localized label and description. One exact `data-composer-intent="expert-squad-install-more"` rule adds the terminal separator; no parallel menu or marketplace renderer was added.
- English uses “Install more expert squads…” / “Browse or import additional expert squads.” Chinese uses “安装更多专家团…” / “浏览或导入更多专家团。”.

## Follow-up Recall: animated action and Settings density

### User correction

- Make the new install-more action's color visibly blink/pulse.
- Reduce the excessive row height in the Settings sidebar shown beside the supplied Codex reference. Preserve the existing group order, labels, icons, selected state, search, and Settings routing.

### Evidence and corrected acceptance

- The install action has an exact `data-composer-intent="expert-squad-install-more"` identity, so its primary label can own a scoped color animation without affecting installed squads or the stable description.
- `composer.css` already owns that action's separator. Add one token-timed color keyframe there and disable the loop under `prefers-reduced-motion: reduce`; do not add JavaScript timers or component state.
- `settings.css` is the canonical sidebar row owner. `.config-sidebar .oc-tab` currently enforces a 40-pixel minimum with 8-pixel block padding, while the reference uses a substantially tighter navigation rhythm. Reduce the row to a 32-pixel minimum with 4-pixel block padding and tighten tab/group gaps; keep the shared Kobalte Tab primitive and existing hit width.
- The real install-more browser path must measure every visible Settings navigation row at the compact height, capture the Settings sidebar, and continue proving that returning to the app preserves the Composer selection and draft.

### Follow-up implementation plan

1. Add the scoped token-driven label color pulse plus reduced-motion rule in `composer.css`.
2. Tighten only Settings sidebar row/group vertical rhythm in `settings.css` and update its canonical source contracts.
3. Extend the existing real browser action path with Settings row geometry and a screenshot, inspect both the animated selector frame and compact Settings navigation, then rerun all prior verification.

## Validation

- Focused Composer, executor, and Work Ledger source tests: 52 passed, 0 failed.
- Overlay TypeScript typecheck, i18n check, and Vite production build: passed.
- Real Node browser fixture: 3 passed, 0 failed. It proves the action is last in English and Chinese, remains present when the squad catalog later becomes empty, opens `[data-config-panel="expert-squad-install"]`, keeps Chat selected, and preserves the typed draft plus staged attachment.
- `.scratch/composer-install-more-expert-squads.png` was personally reviewed at 1902×1314. The action is visibly separated beneath installed squads, uses the same two-line Select typography, and remains inside the existing popup's scroll/width surface.
- The user's running OpenCorvus/Overlay was not refreshed, restarted, closed, or otherwise manipulated; all interaction evidence came from the isolated fixture.

## Follow-up validation

- The install-more primary label now cycles between the shared accent and positive-action colors using `--ui-duration-loop-pulse`; the description does not animate. The real browser sampled two distinct computed colors 500 milliseconds apart and proved the animation has a non-zero duration. Reduced-motion mode resolves to one static accent color.
- Settings sidebar navigation rows now measure exactly 32 pixels in the real application, down from the prior 40-pixel owner. Block padding is 4 pixels, inter-row gap is 1 pixel, and group-title bottom spacing is 4 pixels; horizontal hit width and Kobalte Tab semantics are unchanged.
- Focused source tests including the canonical Settings sizing contract: 71 passed, 0 failed. Typecheck, i18n, production build, and all three real browser scenarios passed.
- `.scratch/settings-compact-menu-rows.png` was personally reviewed at 1902×1314. Every Settings row now follows the compact reference rhythm, the selected Install row remains legible, and the complete grouped menu fits without the previous oversized vertical cadence.
- `.scratch/composer-install-more-expert-squads.png` was regenerated and reviewed after the color pulse. The terminal action retains its separator and stable two-line layout while the primary label receives the requested changing color.

## Follow-up Recall: mention, model, and single-line squad discovery

### User requirements

- Emphasize the literal `@skill` and `@squad` affordances with the same pulsing color language.
- Apply that discovery-action language to the Composer model picker and append a virtual “Configure Provider…” action at the very bottom of the model list.
- Compress installed expert-squad choices to one line. Their functional description must appear on hover instead of occupying a permanent second row.

### Acceptance criteria and constraints

- One CSS keyframe/token contract owns all discovery pulses: install-more squads, mention-kind badges, and Configure Provider. Reduced-motion mode keeps a static accent.
- Only the `@skill` / `@squad` badges pulse; mention labels and descriptions remain stable.
- Configure Provider is a terminal action outside provider/model catalog data. It closes the model popover, opens the canonical `providers` Settings section, and never changes the selected model.
- Installed expert-squad options render one visible text row. Their existing manifest description is exposed through the option's hover title; Chat and the install-more action keep their existing descriptions.
- Reuse `ComposerMentionMenu`, `ComposerModelSelector`, `SelectControl`, `openConfigDialog("providers")`, and the canonical Providers panel. Do not create a fake model/provider, a second catalog, JavaScript animation state, or another Settings route.
- Preserve the user's unrelated `packages/overlay/src/components/App.tsx` working-tree edit. Do not restart or refresh the user's running Overlay; use isolated Node browser fixtures.

### Sources and whole-repository search evidence

- `ComposerMentionMenu.tsx` is the single renderer of both category and entity mention items; `.composer-mention-option-kind` owns the literal `@skill` / `@squad` badge.
- `ExecutorSelector.tsx::ComposerModelSelector` is the single Composer OpenCorvus model popover. Its catalog body renders `mirrorProviderGroups`; the terminal action must be a sibling after that body so it cannot become model data.
- `openConfigDialog("providers")` and `CONFIG_SECTIONS[id="providers"]` are the canonical Provider Settings route and panel owner.
- `ChatComposer.tsx::composerIntentOptions` is the only Chat/expert-squad selector model. `SelectControl` already forwards per-option `title`, so the package description can remain the single hover-copy source without adding a tooltip store or duplicate renderer.
- `composer.css` owns all three affected Composer surfaces and currently contains the install-more pulse. Rename that keyframe to a generic discovery pulse and reuse it.
- Real fixtures already exist in `composer-mention-browser.test.ts`, `expert-squad-selector-browser.test.ts`, and `executor-selector-redesign.test.ts`; extend those rather than creating mocked E2E coverage.
- No sub-agent was started because the user did not request delegation and current collaboration policy forbids unrequested sub-agents.

### Implementation and verification plan

1. Generalize the existing pulse keyframe; apply it to mention-kind badges and the terminal model action with a shared reduced-motion contract.
2. Add localized Configure Provider copy and route its button to the canonical Providers Settings section without touching selection state.
3. Hide installed squad descriptions from the option body while forwarding the same description as hover title; keep other option descriptions unchanged.
4. Extend static and real browser assertions for animation, terminal ordering, unchanged model, Provider routing, single-line squad geometry, and hover copy; capture and inspect mention, squad, model, and Settings screenshots.
5. Run focused tests, typecheck, i18n, build, document health, diff review, commit with `dsw-33987`, and push `v0.0.8beta` to `legacy-remote`.

### Follow-up validation

- `@skill` and `@squad` badges, install-more squads, and Configure Provider now share `composer-discovery-color-pulse`; computed-color sampling proved each animation changes color, while the shared reduced-motion rule resolves to a static accent.
- Configure Provider is the final child of the real model popover, remains available independently of model catalog contents, opens `[data-config-panel="providers"]`, and preserves the selected `openai/gpt-5.5-pro` model.
- Installed expert-squad options render one copy row at no more than 34 pixels high. Hovering that row exposes the exact package description through the shared Kobalte Tooltip; Chat and install-more retain their two-line explanatory copy.
- Visual review passed for `.scratch/composer-mentions/category-light.png`, `.scratch/expert-squad-selector-runtime-highlighted-en-US.png`, `.scratch/composer-expert-squad-description-tooltip.png`, `.scratch/composer-model-configure-provider.png`, and `.scratch/composer-model-provider-settings.png`.
- The hover review exposed a real elevation defect: Tooltip content at `--ui-z-titlebar` was painted under the Select portal. The canonical Tooltip primitive now uses `calc(var(--ui-z-dialog) + 2)`, above Select/Dialog content and below toast, so the functional description is visible and does not intercept the option click from the chosen left placement.
- Static contracts: 119 passed. Real Node browser scenarios: 5 passed. Overlay TypeScript typecheck, i18n check, production build, document health (81 tests), and `git diff --check` passed.
- The user's unrelated `packages/overlay/src/components/App.tsx` edit remained untouched and unstaged. The running OpenCorvus/Overlay was not refreshed, restarted, closed, or otherwise manipulated.
