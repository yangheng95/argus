# Codex Control Primitives Convergence

## Recall

| Item | Detail |
| --- | --- |
| User request | “当前项目中的组件，参考codex的风格实现；按钮/搜索等组件1比1复刻codex的.统一在primitve内修改” with reference `C:/Users/10132/AppData/Local/Temp/codex-clipboard-fc01d2f0-5305-4767-ada2-cfc633fd01e7.png`. |
| Acceptance criteria | Ordinary buttons, text fields, SearchField, and SelectControl use the Codex reference's compact neutral control language: 32px canonical height, 8px soft corners, quiet white/neutral fill, low-contrast one-pixel border, 500 control weight, no elevation, and one focus ring. True circular/capsule controls (icon buttons, switches, radio controls, slider parts, badges, and segmented choices) retain their semantic geometry. All production callers inherit the change from primitive CSS; feature surfaces do not add replacement recipes. |
| Hard constraints | Desktop-only; preserve Solid/Kobalte component semantics and current component APIs; no fallback, duplicate component, raw per-page color, new worktree, temporary iframe, Bun-launched Playwright, or interference with the user's running OpenCorvus/Overlay. Use the isolated Vite page and in-app Browser for task-scoped screenshots. Every production change receives focused regression coverage, a second review, a `dsw-33987` commit, and push to `myhexin`. |
| Sources read | `AGENTS.md`; Browser skill; the supplied reference at original resolution; `2026-07-16-codex-settings-button-format.md`; `2026-07-16-settings-search-composer-visual-convergence.md`; `2026-07-16-overlay-worktree-shortcuts-chat-files-and-button-system.md`; `2026-07-15-codex-settings-multica-expert-squad-unification.md`; Button/SearchField/TextField/SelectControl sources; primitive and field CSS; focused tests. |
| Baseline visual evidence | The real isolated Vite Settings page at `http://127.0.0.1:5187/` shows SearchField at `31.14px` high with `999px` radius, the shared settings outline/back action at `38px` high and `8px` radius but `600` weight, and Select chrome still owned by `styles/surfaces/field.css`. The supplied reference uses softly rounded rectangular fields/actions and reserves pills for switches/choice capsules. |
| Whole-repository grep | Button has 53 TSX import owners; SearchField has 7; TextField has 10; Select/selection/segmented/slider/tabs/menu primitives have 21 combined owners. Production literal native controls outside `components/ui` are file/hidden inputs only. `button.css` and `text-field.css` are the shared visual owners; `field.css` is the only misplaced owner of `.oc-select-*` and `.search-field-icon`. Searches also enumerated every primitive and surface use of `--oc-radius-pill` so capsule semantics can be preserved deliberately. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Branch `work-v0.0.9beta-yr-0718`; clean `HEAD` `74dd31e55` is synchronized with `myhexin/work-v0.0.9beta-yr-0718` before implementation. |

## Diagnosis

The component architecture is already mostly correct: production JSX routes buttons, search, text entry, and Kobalte selects through shared adapters. The remaining mismatch is visual ownership. `button.css` and `text-field.css` treat the pill radius as the default for ordinary controls, while the supplied Codex reference uses bounded soft corners and reserves pill geometry for switches, radio/slider parts, badges, and segmented choices. Select is a second inconsistency: `SelectControl.tsx` is a primitive, but its entire `.oc-select-*` visual contract lives in the feature-level `surfaces/field.css`. That prevents a primitive-only convergence and leaves one control family on a separate styling source.

## Call-Site Disposition

| Owner set | Decision |
| --- | --- |
| `components/ui/Button.tsx` and all 53 Button import owners | Keep API and JSX unchanged. Update the primitive's ordinary control radius/weight/fill/border; icon-size controls explicitly retain pill geometry and specialized chrome. |
| `components/ui/SearchField.tsx`, `TextField.tsx`, and all 15 external import owners | Keep one SearchField/TextField composition. Make input/search/group chrome use the shared large radius, neutral surfaced fill, medium control weight, and canonical focus ring. Move `search-field-icon` styling into the TextField primitive file. |
| `components/ui/SelectControl.tsx` and all Select callers | Keep the Kobalte adapter and data semantics. Move the full `.oc-select-*` contract from `surfaces/field.css` into a new `primitives/select-control.css`, load it beside TextField, and apply the same bounded control geometry. |
| Switch, Checkbox, RadioGroup, Slider, Badge, and SegmentedControl | Preserve current pill/circle geometry because it is semantic and matches the reference. No surface rewrite. |
| `styles/surfaces/field.css` and Settings search/back specializations | Retain only cross-surface or page-layout rules; remove primitive-owned Select/Search recipes and the Settings search/back chrome overrides completely. |
| Tests | Update Button/TextField/Search expectations, make Select ownership tests read the new primitive, assert load order and absence of `.oc-select-*`/`.search-field-icon` from `field.css`, then verify real General and Appearance Settings screenshots and computed styles. |

## Implementation Plan

1. Converge Button and TextField/Search chrome in their existing primitive styles while preserving semantic capsule exceptions.
2. Move SelectControl visual ownership into one new primitive stylesheet and remove the old surface source.
3. Update focused source regressions for geometry, typography, ownership, and primitive load order.
4. Run focused tests, Overlay typecheck/i18n/build, documentation health, and `git diff --check`.
5. Reload only the isolated verification tab, inspect General and Appearance at the supplied desktop viewport, correct visual discrepancies, perform a second diff review, commit, and push to `myhexin`.

## Verification Plan

```powershell
bun test packages/overlay/test/button-primitive.test.ts packages/overlay/test/button-primitive-chrome.test.ts packages/overlay/test/text-field-primitive.test.ts packages/overlay/test/search-field-unification.test.ts packages/overlay/test/theme-form-control-coverage.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build:vite
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
git diff --check
```

## Result

Implemented one shared Codex-style control language in the primitive layer:

- `Button` now uses the shared 8px large radius, medium control weight, quiet outline fill, and token-owned border states; icon-only buttons remain circular.
- `TextField` and `SearchField` now share the 8px neutral surfaced field, one accent focus ring, and primitive-owned search icon styling.
- `SelectControl` now owns its complete trigger, popup, option, focus, and disabled visual contract in `primitives/select-control.css`; the duplicate surface-level recipe was deleted.
- Settings retains layout/density only and no longer replaces SearchField or Back button chrome. Switches and segmented permission choices retain semantic pill geometry.

### Validation

- Focused primitive/surface regressions after final semantic icon-size correction: 180 passed, 0 failed.
- Focused Settings control regressions: 63 passed, 0 failed.
- Node/Playwright rendered interaction regressions for Settings buttons, Memory SearchField, and Composer actions: 3 passed, 0 failed.
- Overlay i18n revision check: passed.
- Overlay TypeScript check: passed.
- Overlay Vite production build: passed (the existing chunk-size advisory remains non-failing).

### Real-browser visual review

The task-scoped Vite page at `http://127.0.0.1:5187/` was opened in the in-app Browser at the supplied desktop viewport. General Settings was reviewed both idle and with the SearchField focused; Appearance Settings was reviewed with the Theme select closed and expanded.

Measured rendered contracts after the final change:

| Control | Rendered evidence |
| --- | --- |
| Settings SearchField, focused | `31.14px` high, `8px` radius, white neutral fill, accent border, one `2px` low-opacity accent focus ring |
| Back button, idle | `38px` high, `8px` radius, medium (`500`) weight, transparent idle chrome, no shadow |
| Theme Select trigger | `32px` high, `8px` radius, white neutral fill, low-contrast border, body (`400`) weight, no shadow |
| Theme Select popup | `8px` radius, white surface, low-contrast border, shared menu shadow |
| Permission segmented choice | `999px` radius preserved as a semantic choice capsule |
| Notification switch | `999px` radius preserved as a semantic switch |

The final screenshots were inspected directly. Search, button, and Select no longer present the prior all-pill mismatch; spacing and page structure were unchanged; focus, expanded popup, selected option, disabled action, segmented choice, and switch states remained visually coherent.

The first Node/Playwright pass exposed that the square Composer Send/Stop action still declared the ordinary `md` size while depending on the former all-pill default. The production caller and its rendered fixtures now declare the true `icon` size, so the circular action is owned by the Button primitive instead of a surface radius override. The same Playwright command then passed all three cases.

### Second review

The final diff was re-read by ownership boundary rather than file order. Production visual declarations for `.oc-select-*` and `.search-field-icon` now have one primitive source, feature styles retain only composition/layout, and no caller API or Kobalte behavior changed. The unrelated left-dock/titlebar work present in the shared worktree is outside this change and is intentionally excluded from the commit.
