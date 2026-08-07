# Codex Form Control Single Source

## Recall

| Item | Detail |
| --- | --- |
| User requirement | “搜索框，下拉框，按钮 switch 等 codex都有；在当前项目中调整下这些组件，统一在primitve内调整；禁止外部自定义组件” with reference `C:/Users/10132/AppData/Local/Temp/codex-clipboard-2a475735-281d-4aec-bbab-7e14f2fda197.png`. |
| Acceptance criteria | Search, Select, Button, Switch, and segmented choices render through the canonical `components/ui` catalog and `styles/primitives` recipes only. Settings must not retain `SettingsSelect`, `SettingsSegmented`, or feature-local control wrappers. Search and Select must not expose internal class-injection APIs that let features replace primitive chrome. Search/Select/Button use the reference's compact 32px, 8px, quiet neutral geometry; Switch uses the reference's 40×24 track, white 18px thumb, accent checked state, neutral unchecked state, and one focus ring. Surface CSS may position a control but may not redefine its reusable chrome. |
| Hard constraints | Desktop-only; preserve Kobalte semantics, keyboard/focus behavior, current data writes, and hidden file/ID transport inputs; no fallback, compatibility alias, duplicate wrapper, hand-written native visible control, state machine, worktree, temporary iframe, Bun-launched Playwright, or interference with the user's running OpenCorvus/Overlay. Visual acceptance uses the isolated Vite target and the in-app Browser. Every behavior change receives regression coverage, second review, a `dsw-33987` commit, and push to `myhexin`. |
| Sources read | `AGENTS.md`; Browser skill; the supplied reference at original resolution; `2026-07-17-overlay-primitive-system-convergence.md`; `2026-07-18-codex-control-primitives-convergence.md`; all SearchField, TextField, SelectControl, Button, Switch, Checkbox, RadioGroup, SegmentedControl sources and primitive CSS; Settings layout, Appearance, Permissions, General, Agent Models, Expert Squad, Skill Market, Composer, App Dialog, Log Viewer, Memory, and focused tests. |
| Whole-repository grep | 53 production TSX owners import Button. SearchField has 7 production owners; TextField/SearchField together have 14 owner files. Select/selection controls have 11 owner files; Kobalte Select/Switch/Checkbox/ToggleGroup imports outside `components/ui` are zero. Raw production controls outside `components/ui` are five hidden file/ID transport inputs only. Remaining alternative abstractions are `SettingsSelect` (five rendered call sites), `SettingsSegmented` (one component rendering five permission rows), Skill Market `FormSelect` (five call sites), and `PanelActionButton`; SearchField exposes two internal class props used by four owners, while SelectControl exposes seven internal class props used by App Dialog, Composer, Log Viewer, and Settings wrappers. Settings CSS still owns semantic segmented colors and global Button size overrides. |
| Baseline visual evidence | The real General Settings page at `http://127.0.0.1:5187/` renders Search at `31.14px × 8px`, checked Switch at `40×24px` but with a mixed-color border/track rather than the reference's flat accent track, and Settings `sm` Buttons at `34px` because a surface rule overrides the primitive size. The screenshot confirms the overall shape is close while ownership remains open and duplicated. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Clean branch `work-v0.0.9beta-yr-0718` at `3c979d598`, equal to `myhexin/work-v0.0.9beta-yr-0718`. |

## Diagnosis

The rendered controls are already mostly routed through Kobalte-backed primitives, but the API boundary is not closed. Settings exports `SettingsSelect` and `SettingsSegmented` as a second catalog; Skill Market adds two more control wrappers; SearchField and SelectControl let features inject internal element classes; and Settings CSS changes Button density and segmented semantic chrome. These are not naming problems. They are ownership leaks that permit a feature to create a new visual version without changing the primitive.

The causal chain is: **visible near-parity** → **feature wrapper/class hook remains available** → **surface CSS can replace control internals** → **future screens drift despite sharing the same underlying Kobalte behavior**. The root repair is to delete the outer control components and close the primitive APIs, then encode the one legitimate Composer Select difference as a finite primitive variant.

## Exhaustive Call-Site Disposition

| Owner set | Decision |
| --- | --- |
| `SearchField` and its seven owners | Keep root `class` for placement only. Delete `inputClass` and `iconClass`; remove those props from File Changes, File Explorer, Memory, and Providers. Input/icon chrome stays in `text-field.css`. |
| `SelectControl`: App Dialog, Composer, Log Viewer | Delete trigger/content/listbox/option/copy/indicator/icon class injection and icon replacement props. App Dialog and Log Viewer use the default primitive. Composer declares a closed `variant="composer"`; its trigger/popup geometry moves from `composer.css` into `select-control.css`, while domain option data remains feature-owned. |
| Settings Select users: Appearance (2), Agent Models, Expert Squad, Skill Market (5 form locations) | Move the value/option adapter into canonical `ui/SelectField`; delete `SettingsSelect` and Skill Market `FormSelect`. Root classes may retain width/flex placement, but no internal control class is exposed. |
| Permissions segmented choices | Delete `SettingsSegmented`; use `SegmentedControl` directly. Move size and semantic pressed tones from `settings.css` into `segmented-control.css` and expose a closed primitive `size` prop. |
| Switch users: General (1), Channels (1), Network (2) | Keep the Kobalte `Switch` API. Update only `selection-control.css` to the reference track/thumb/focus contract; delete no behavior. |
| Settings Buttons | Convert Settings' surface-enlarged `sm` callers to the canonical `md` density, then delete the global `.config-content` Button size overrides. Replace Skill Market `PanelActionButton` with direct Button composition. Existing icon-only actions continue to use `size="icon"`. |
| Hidden native inputs | Preserve Composer file/folder, File Explorer upload, Expert Squad archive, and Goal ID inputs because they render no control; their visible launch actions already use primitives. |
| Tests | Replace wrapper-positive assertions with wrapper-absence and closed-API assertions; add exact Switch/Select/Segmented/Button primitive ownership checks; update affected source contracts; run real Node/Playwright control paths and final in-app Browser screenshots. |

## Implementation Plan

1. Add the canonical value-based `SelectField` adapter under `components/ui`, remove Settings/Skill wrappers, and migrate every enumerated caller.
2. Close SearchField and SelectControl internal class hooks; add the finite Composer Select variant and move its reusable chrome into primitive CSS.
3. Move permission segmented tones and the Codex Switch recipe into primitive CSS; remove Settings Button size overrides and use primitive size props.
4. Update ownership, API, behavior, and rendered-browser tests; run typecheck, i18n, Vite build, documentation health, and diff checks.
5. Reload only the isolated verification page, inspect General, Appearance, Network, and representative Select popup/focus/checked/unchecked/disabled states, perform a second diff review, commit, and push.

## Result

Implemented the closed primitive boundary and removed the alternative settings control catalog:

- Added canonical `ui/SelectField`; Appearance, Agent Models, Expert Squad, and all five Skill Market value-select owners now consume it directly. `SettingsSelect`, `SettingsSegmented`, Skill Market `FormSelect`, `PanelActionButton`, and the Agent Models `ModelSelect` wrapper are deleted.
- `SearchField` no longer exposes `inputClass` or `iconClass`. `SelectControl` no longer exposes trigger/content/listbox/option/copy/indicator/icon injection, arbitrary icon replacement, or `beforeTrigger`; Composer is represented by the finite `variant="composer"` recipe in `select-control.css`.
- Segmented size and semantic pressed tones moved to `segmented-control.css`. Settings no longer styles `.s-segmented*`. Switch is a flat `40x24` track with an `18px` white thumb and primitive-owned checked/focus states. Settings no longer declares any `--oc-button-*` override; its text actions use canonical `md`, while icon actions retain `icon`.
- Search/Select/Segmented/Switch/Button owner tests now assert the closed APIs and wrapper absence. Browser selectors were migrated from deleted feature-local internal classes to canonical primitive classes and stable data attributes.

Real-browser review used the existing task-isolated Vite target at `http://127.0.0.1:5187/` without restarting or touching the user's OpenCorvus/Overlay process. General and Appearance screenshots were inspected at the browser's default desktop viewport, including an open Select popup and the lower General panel. Measured rendered contracts were: settings Search `31.14px` high with `8px` radius; Select trigger `32px` high with `8px` radius; Select popup `8px` radius; Segmented root `32px` high; checked Switch `40x24`, zero border, `18px` thumb; Reset DB Button `32px` high with `8px` radius. A second Node/Playwright screenshot (`.scratch/settings-compact-menu-rows.png`) was inspected and confirmed the same compact search/button rhythm in the full desktop settings shell.

Verification:

- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- 283 focused unit/architecture tests: one stale size assertion was corrected, then the focused primitive suite finished `43 pass / 0 fail`; all other 282 cases in the first run passed.
- Node browser regressions: Select popup contrast, Memory Search, Composer buttons (`3 pass`); Agent Models (`3 pass`); Provider, projected Skill/MCP, and expert-squad Select paths (`10 pass`, with the expert-squad cleanup case rerun alone and passing after the deleted-selector update).
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` (`21 pass / 0 fail`).
- `git diff --check`.

## Follow-up 2026-07-19: Codex settings action hierarchy

### Recall

| Item | Detail |
| --- | --- |
| User requirement | Adjust the settings controls shown in `codex-clipboard-c599dcb8-6f39-4263-8e91-c841812f432e.png`, `codex-clipboard-9c7a854c-e74d-4a62-b083-a33b20af68d7.png`, and `codex-clipboard-28ae3605-80b6-44e4-8d3a-27b3547e5c5f.png` because their buttons do not match Codex. The earlier requirement still applies: reusable control chrome belongs only to canonical primitives; settings panels may not add custom control components or internal chrome overrides. |
| Acceptance criteria | Permission choices use one quiet neutral segmented recipe with no green/yellow/red selected capsules. Primary settings actions no longer use the bright blue brand fill and instead use the Codex strong-neutral action treatment. Status and policy text is visibly non-interactive, compact, and rendered by canonical `Badge`, not the settings-local `SettingsPill`. Button, Badge, and SegmentedControl keep their existing semantics, focus behavior, disabled behavior, and density. |
| Hard constraints | Desktop-only; preserve Kobalte toggle semantics and all settings writes; no surface-local button/badge/segmented chrome, fallback, alias, second primitive, state machine, worktree, temporary iframe, Bun-launched Playwright, or interference with the running OpenCorvus/Overlay process. Verify with the existing isolated Vite page and Node/Playwright fixtures, then commit with `dsw-33987` and push to `myhexin`. |
| Sources read | Current Button, Badge, SegmentedControl, settings layout, Permissions, Channels, Skill Market, Providers, Archive, and Expert Squad sources; primitive and settings CSS; focused architecture and browser tests; all three supplied screenshots at original resolution; the live General, Channel, and Skill Market pages at `http://127.0.0.1:5187/`. |
| Whole-repository grep | `SettingsPill` renders 33 times across Archive, Channels, Expert Squad, Providers, and Skill Market, with its implementation in settings `layout.tsx`; `.s-pill` owns six settings-surface recipes plus two layout selectors and one browser selector. Production SegmentedControl has exactly three owners: File Changes, Mailbox, and Permissions. Settings Button has nine owner files; settings declares primary `solid + accent` actions in Channels, Expert Squad, Network, Providers, Server Connection, and Skill Market. Across all production components, 14 files use `tone="accent"`. |
| Baseline visual evidence | The real General page shows every pressed permission choice as a colored semantic capsule; the live Channel page shows its Save action in bright blue; the live Skill Market shows tan bordered `Ask on use` pills and bright blue `Install Skill` buttons. The canonical settings control height remains 32px and 14px text, so the mismatch is emphasis/chrome ownership rather than density. |
| Independent agent feedback | None. The user did not request sub-agents, and the active collaboration policy forbids unrequested delegation. |
| Git baseline | Clean `work-v0.0.9beta-yr-0718` at `9a9c80d5f`, equal to `myhexin/work-v0.0.9beta-yr-0718`. |

### Diagnosis

The screenshots expose two remaining ownership leaks from the earlier convergence. First, SegmentedControl still treats option tone as selected-state decoration, turning a setting choice into a traffic-light status control. Second, `SettingsPill` is still a settings-local status primitive whose border, capsule geometry, and semantic washes make static metadata look like an action. The bright blue primary buttons are not a page override: canonical Button maps every `solid + accent` action directly to the accent blue.

The causal chain is: **semantic data is mapped directly to saturated control chrome** -> **selection/status/primary-action hierarchy collapses into similarly prominent colored pills** -> **settings rows no longer match Codex's quiet neutral controls**. The repair belongs in the canonical primitives: neutralize SegmentedControl selection, route all settings status metadata through Badge, and make Button primary emphasis strong-neutral while retaining accent for focus and non-button selection controls.

### Follow-up implementation plan

1. Replace every `SettingsPill` render and tone type with canonical `Badge`/`BadgeTone`, delete the layout export and `.s-pill` recipes, and update the two layout selectors to target `.oc-badge`.
2. Make Badge a quiet, borderless metadata chip and keep tone differences subtle; make SegmentedControl a transparent group with one neutral selected wash and medium text weight.
3. Change canonical `solid + accent` Button fill/hover to the strong-neutral Codex action treatment; keep danger actions red and outline/ghost actions unchanged.
4. Update architecture, primitive, and browser tests to assert the new single source and visual hierarchy; run typecheck, i18n, Vite build, focused unit tests, and Node/Playwright settings paths.
5. Reload only the isolated Vite page, inspect General, Channel, and Skill Market plus fixture-backed Channel rows, then perform a second diff review before commit and push.

### Follow-up result

- Removed the settings-local `SettingsPill` export and all 33 call sites. Archive, Channels, Expert Squad, Providers, and Skill Market now render status metadata directly through canonical `Badge`; `.s-pill` no longer exists in production CSS.
- Canonical `Badge` now owns a compact borderless metadata treatment with quiet semantic washes. Canonical `SegmentedControl` now owns a transparent group and one neutral pressed wash regardless of semantic option tone. Canonical solid neutral/accent Buttons now share the Codex strong-neutral fill and hover treatment, while danger remains semantic red.
- Updated primitive, architecture, settings, and rendered-browser contracts to prevent settings-local pills, colored permission selections, or bright-blue primary settings actions from returning. Browser fixtures were also aligned with the canonical segmented selectors and current Mailbox startup requests.
- Real visual review used only the isolated Vite target at `http://127.0.0.1:5187/`. General shows a neutral `Allow` selection without a colored group capsule; Channel shows a strong-neutral `Save`; Skill Market shows strong-neutral `Install Skill` actions and quiet `Ask on use` badges. Fixture screenshots also confirmed borderless Channel status badges with strong-neutral `Edit` actions.

Verification:

- `bun run --cwd packages/overlay typecheck`
- `bun run --cwd packages/overlay check:i18n`
- `bun run --cwd packages/overlay build:vite`
- Focused primitive/settings/architecture suite: `209 pass / 0 fail`.
- Node/Playwright browser paths cover the button/badge/segmented visual contract, Channel status rows, global permission persistence, and installed Skill Market actions.
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` (`21 pass / 0 fail`).
- `git diff --check`.
