# Overlay Architecture Refactor — 3-Layer Primitives + Surface Modularization

Status: active. Phase 1 guardrails started on 2026-05-03.

Progress log:

- 2026-05-03: Phase 1 directory tree, single-root `App.tsx`
  shell, SSE reconnect guard, legacy debt baselines, and God CSS
  archive isolation guard landed.
- 2026-05-03: New theme layer now has palette-only stubs
  (`dark.css`, `light.css`, `vscode-dark.css`) using
  `--oc-color-*` tokens only. Architecture tests reject chrome
  tokens such as radius, spacing, shadow, border, size, and motion
  inside new theme files.
- 2026-05-03: SSE refresh guard extended to the global task-list
  stream. Transport errors now close the task-list handle so the
  existing `onClose` reconnect path restarts sidebar refresh instead
  of leaving non-selected task changes stale until manual reload.
- 2026-05-03: Design-language token contract started with explicit
  header, radius, and density tokens plus a root-scoped
  `header.css` surface grammar. Architecture tests now require token
  files to stay `:root`-only and prove the header/radius/density
  vocabulary exists before surface migration begins.
- 2026-05-03: Phase 2 Button primitive contract started with
  `components/ui/Button.tsx` and `styles/primitives/button.css`.
  Primitive CSS is guarded against `!important`, raw color/pixel
  literals, theme selectors, and non-`data-*` variant drift. Overlay
  tsconfig validation also uncovered and fixed the existing missing
  `AgentInfo` type import in `AgentModelsPanel`.
- 2026-05-03: Button migration now has a caller budget guard:
  legacy static button-class callers (`.btn`, `.chat-send`,
  `.titlebar-btn`, `.right-panel-tab`, `.executor-chip`, etc.) are
  capped at the measured baseline of 95 and must move downward as
  each caller group migrates to the `Button` primitive.
- 2026-05-03: The legacy button budget is now per-class, not just
  aggregate. Individual old families such as `.btn`, `.btn-primary`,
  `.chat-send`, `.executor-chip`, and `.right-panel-tab` cannot rise
  even if another family falls, and the `Button` primitive test rejects
  legacy class leakage into the new wrapper.
- 2026-05-03: Button primitive variants are now single-sourced as
  exported const tuples (`BUTTON_VARIANTS`, `BUTTON_SIZES`,
  `BUTTON_TONES`) with types derived from them. Tests compare those
  tuples against `button.css` `[data-variant]`, `[data-size]`, and
  `[data-tone]` selectors so TS API and CSS variants cannot drift.
- 2026-05-03: Button primitive no longer accepts arbitrary
  `class` / `classList` passthrough. It always emits `oc-button`;
  every visual difference must go through `variant`, `size`, and
  `tone`, preventing legacy button classes from riding through the
  new wrapper.
- 2026-05-03: Legacy button caller budget counting was corrected to
  match complete class tokens instead of substring word boundaries.
  The accurate baseline is 78 total TSX callers (`.btn` is 54, not
  63; `.chat-send` is 0 because only child icon/label classes
  remain in TSX; `.executor-chip` is 1, not 7).
- 2026-05-03: First real Button migration landed for
  `WindowControls`. The titlebar window buttons now render through
  `Button`, `styles/tokens/design-language.css` and
  `styles/primitives/button.css` are on the runtime path, and the
  `titlebar-btn` TSX caller budget dropped from 3 to 0
  (aggregate legacy button budget 78 to 75).
- 2026-05-03: Titlebar menu triggers and the logs icon now render
  through `Button`, with `styles/surfaces/titlebar.css` owning only
  the titlebar-specific compact/status behavior. This removes the
  final `titlebar-menubar-trigger` and `titlebar-status-icon` TSX
  callers and drops the aggregate legacy button budget from 75 to 73.
- 2026-05-03: Chat composer toolbar icons (attach, web search,
  expand/collapse) now render through `Button`, with
  `styles/surfaces/composer.css` owning only composer-specific icon
  sizing and active state. This removes all `chat-toolbar-btn` TSX
  callers and drops the aggregate legacy button budget from 73 to 70.
- 2026-05-03: The composer executor chip shell now renders through
  `Button`; `TitlebarMenubar` focuses it via `data-ui="executor-chip"`
  instead of the legacy class. This removes the final `executor-chip`
  TSX caller and drops the aggregate legacy button budget from 70 to 69.
- 2026-05-03: `GeneralPanel` settings save now renders through the
  canonical `Button` primitive instead of `.btn.btn-primary.mini`.
  This drops `.btn` callers from 54 to 53, `.btn-primary` callers from
  12 to 11, and the aggregate legacy button budget from 69 to 67.
- 2026-05-03: `PromptCatalog` reset/save actions now render through
  `Button` (`ghost` reset, `solid` save) instead of `.btn` variants.
  This drops `.btn` callers from 53 to 51, `.btn-primary` callers from
  11 to 10, and the aggregate legacy button budget from 67 to 64.
- 2026-05-03: `AgentModelsPanel` refresh/retry actions now render
  through `Button` (`ghost`, small) instead of `.btn.btn-ghost.mini`.
  This drops `.btn` callers from 51 to 49 and the aggregate legacy
  button budget from 64 to 62.
- 2026-05-03: `ChannelsPanel` public URL, tutorial, edit, cancel,
  and save actions now render through `Button`. This drops `.btn`
  callers from 49 to 43, `.btn-primary` callers from 10 to 8, and the
  aggregate legacy button budget from 62 to 54.
- 2026-05-03: `MemoryPanel` search, refresh, close, and delete actions
  now render through `Button`; nowrap moved into the primitive so the
  former `.knowledge-delete` label constraint is not a one-off class.
  This drops `.btn` callers from 43 to 38 and the aggregate legacy
  button budget from 54 to 49.
- 2026-05-03: `LogViewer` load, refresh, copy, clear, and close actions
  now render through `Button`, preserving stable ids for copy/log tests.
  This drops `.btn` callers from 38 to 33 and the aggregate legacy
  button budget from 49 to 44.
- 2026-05-03: Central task action buttons in `Board` and
  permission/question actions in `InteractionCard` now render through
  `Button`, while preserving `data-task-action` / `data-action` hooks.
  This drops `.btn` callers from 33 to 26, `.btn-primary` callers from
  8 to 5, and the aggregate legacy button budget from 44 to 34.
- 2026-05-03: `ProvidersPanel` refresh, add, auth, test, edit,
  delete, API-key save, and form actions now render through `Button`,
  preserving provider auth test ids. This drops `.btn` callers from 26
  to 16, `.btn-primary` callers from 5 to 3, and the aggregate legacy
  button budget from 34 to 22.
- 2026-05-03: `SkillMarketPanel` skill, MCP, and marketplace actions
  now render through `Button`. The primitive now defines solid tone
  foreground and hover chrome explicitly so primary actions do not inherit
  low-contrast accent text. This drops `.btn` callers from 16 to 0,
  `.btn-primary` callers from 3 to 0, and the aggregate legacy button
  budget from 22 to 3.
- 2026-05-03: The right-panel workflow / inspector / preview tabs now
  render through the new `Tabs` / `Tab` primitive. The runtime nodes no
  longer use `.right-panel-tab` classes; tab shape is governed by
  `styles/primitives/tabs.css` and the legacy button-class budget drops
  from 3 to 0.
- 2026-05-03: Palette-only theme files are now on the runtime path and
  `applyTheme` writes the effective theme to both `documentElement` and
  `body`. The root attribute activates the new `:root[data-theme]`
  palette contract; the body attribute exists only for legacy God CSS
  until that file is retired from runtime.
- 2026-05-03: The sidebar, conversation, and right-panel headers now
  share `oc-surface-header` chrome from `styles/surfaces/header.css`,
  loaded after legacy `styles.css` so the surface layer owns height,
  spacing, background, border, radius, and shadow. Header-specific
  God CSS `!important` and theme override blocks were retired from the
  runtime stylesheet. This lowers the `!important` guard baseline from
  381 to 373, `body[data-theme]` selectors from 262 to 255, and theme
  layout/chrome overrides from 278 to 273.
- 2026-05-03: `SkillMarketPanel` group headers now share
  `oc-surface-header` / `oc-surface-header__title` /
  `oc-surface-header__actions` instead of keeping separate
  `.ext-group-head*` typography and action-cluster CSS in God CSS.
- 2026-05-03: Added `SurfaceHeader` as the component-level owner for
  shared header markup. `SkillMarketPanel` no longer hand-writes
  `oc-surface-header` title/action structure; it renders three
  `SurfaceHeader` instances with the `settings-group` surface variant.
- 2026-05-03: Migrated `GeneralPanel` section headings to
  `SurfaceHeader`, removing two remaining `.config-panel-group-title`
  call sites from the runtime component tree.
- 2026-05-03: Migrated `AgentModelsPanel` to `SurfaceHeader` with an
  action slot for the Hexin refresh button, retiring its local
  `.config-panel-group-head` / `.config-panel-group-title` header markup.
- 2026-05-03: Migrated `ProvidersPanel` toolbar chrome to
  `SurfaceHeader`. Provider count remains part of the title content, while
  refresh/add controls now use the shared header action slot and the search
  field stays below the canonical header row.
- 2026-05-03: Fixed a config refresh split that affected SSE freshness:
  `updateConfig` now writes the PATCH response into `appStore.config`, so
  Provider/Channel settings no longer issue a second manual `GET /config`
  after local writes. `config.changed` remains the cross-client refresh path.

Trigger: user feedback (2026-05-03):

> 现在的 css 和面板源码太臃肿了，形成了 god module，极其难以维护，
> 也造成设计语言的统一和覆盖难题。我需要重新抽象 UI/UX，打散
> CSS 和面板组件。你觉得最大的问题在哪儿，应该如何设计方案？

Latest user clarification:

> God CSS 只能存档不能删除，作为备份参考。最终目的是设计语言统一，
> 例如不要圆角和非圆角大范围混用，各个栏 header 要统一风格，
> 不要大小不一、形式各异。必须彻底根除所有技术债，不留后患。

This doc is the active implementation contract for the overlay
UI/UX refactor. It is not only a file-layout cleanup. The end
state must make design language enforceable: one set of
primitive shapes, one header grammar, one spacing/density scale,
one theme contract, and no runtime God CSS path left behind.

## Quantified current state

| Dimension                              | Value                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/overlay/src/styles.css`      | **15,212 lines / 2,070 top-level rules / 490 nested rules**                             |
| `packages/overlay/src/styles/card.css` | 2,022 lines / 336 top-level rules                                                       |
| Total `!important` in stylesheets      | **373** current guard baseline                                                          |
| `body[data-theme="…"]` theme overrides | **255**                                                                                 |
| Theme layout/chrome overrides          | **273** current guard baseline                                                          |
| `packages/overlay/src/main.tsx`        | **1,621 lines + 18 independent Solid mount points**                                     |
| Largest 5 components                   | TaskList 696 / LogViewer 579 / CardHeader 544 / MemoryPanel 444 / GoalWorkflowGroup 206 |
| Total `.tsx` LOC across overlay        | 28,700                                                                                  |

53 single-source iters (iter5 / iter8 / iter14 / iter15 /
iter16 / iter17 / iter20 / iter22 / iter23 / iter25 / iter26 /
iter27 / iter28 / iter29 / iter30 / iter33 / iter36 / iter37 /
iter40 / iter47 / iter52 / iter53 / iter54) retired roughly
**~30 of the 380 `!important`** — 8% in 53 iters. The current
slope means clearing the `!important` debt at the per-selector
pace would take ~600 more iters.

## Top problems (severity order)

### 1. `styles.css` is a god file stacked by add-order

The same selector's canonical / `:hover` / `body[data-theme]` /
`@media` / `!important` reset are scattered thousands of lines
apart. iter21's 5-prefix grep checklist exists precisely
because the file structure offers no co-location guarantee.
Per rule 8 ("禁止双源设计"), the file structurally invites
every new selector to violate the rule.

### 2. `!important` debt is masking specificity collapse

380 `!important` declarations means the selector hierarchy has
broken down — devs reach for `!important` because cascade
ordering doesn't communicate intent. Each `!important` then
forces the next override to also use `!important`, compounding
debt. iter53 caught a `border: 1px !important` shorthand
silently overwriting a `border-left: 4px` accent rail — the
shorthand wiped a semantic visual signal.

### 3. Themes overstep — change chrome shape, not just palette

262 `body[data-theme]` overrides include padding / radius /
border / shadow declarations. iter17's CRON audit found theme
overrides re-introducing `border-radius: 18px` after the
canonical declared `0` — the user's "remove rounded corners"
request was nominally fixed but the rendered visual stayed
rounded. Themes should swap palette tokens only.

### 4. Tokens and component-private values share `:root`

`--card-stage-*`, `--gwg-*`, `--section-*`, `--ui-titlebar-*`
all live in the global token pool. Surface-private values leak
to every consumer; renaming any of them risks breaking
unrelated surfaces.

### 5. Zero shared primitives — every surface re-implements basics

Button has 8+ implementations (`.btn`, `.chat-send`,
`.titlebar-menubar-trigger`, `.executor-chip`, `.workspace-tab`,
`.right-panel-tab`, `.sidebar-tool`, `.titlebar-status-icon`).
Each declares its own hover / focus / active. iter4 (calm/flat
button uppercase removal) only touched `.btn`; the other 7
button-like surfaces went untouched.

### 6. main.tsx renders 18 separate Solid trees

`index.html` carries 18 `<div id="solid…">` mount points;
`main.tsx` runs 18 `render(() => <…/>, mountEl)` calls;
`dom.ts` exposes 18 accessors. Adding a component requires
editing all three. iter31 caught a real bug here:
`#deliverySection` id missing from the rendered DOM caused
`syncSectionPhases` to silently no-op and the operator never
saw the delivery phase highlight transition.

### 7. Design language has no enforceable contract

The current UI mixes rounded and square treatments, multiple
header heights, unrelated tab/button shapes, and theme-specific
chrome differences. That makes a surface look "fixed" in one
theme while still drifting in another. The refactor is not done
until these visual decisions are encoded as shared primitives
and tests, not as scattered selector overrides.

Concrete acceptance targets:

- Column headers use one shared surface/header grammar: same
  height scale, typography, alignment, border treatment, and
  action placement across titlebar/sidebar/conversation/right
  panel/settings where the semantic role is the same.
- Radius policy is global and explicit. Large-scale mixing of
  rounded and non-rounded chrome is forbidden; exceptions must
  be named primitive variants, not ad hoc per-surface CSS.
- Control density is tokenized. Buttons, tabs, pills, inputs,
  chips, and menus must derive size from primitive tokens so
  one theme cannot silently change layout.
- Theme files only swap palette tokens. They cannot change
  layout, spacing, radius, borders, shadows, display, or
  responsive behavior.

## Proposed architecture

```
packages/overlay/src/styles/
├── tokens/                  # PURE tokens. No selectors except :root.
│   ├── color.css
│   ├── typography.css
│   ├── spacing.css
│   └── motion.css
├── primitives/              # Reusable, surface-agnostic components.
│   ├── button.css           # .ui-btn[data-variant=primary|ghost|danger][data-size=sm|md]
│   ├── pill.css             # .ui-pill[data-tone=info|success|warn|danger]
│   ├── card.css             # .ui-card[data-elevation=flat|raised]
│   ├── tab.css              # .ui-tabs / .ui-tab[data-active]
│   ├── input.css            # .ui-input + textarea
│   ├── menu.css             # .ui-menu (listbox/dropdown)
│   └── empty.css            # .ui-empty-hint
├── surfaces/                # Layout-only. Each surface = 1 file.
│   ├── titlebar.css
│   ├── sidebar.css
│   ├── conversation.css
│   ├── inspector.css        # right panel
│   ├── composer.css
│   └── settings.css
└── themes/                  # PALETTE ONLY — :root selector only.
    ├── light.css
    ├── dark.css
    └── vscode-dark.css

packages/overlay/src/components/
├── ui/                      # Primitive Solid wrappers.
│   ├── Button.tsx
│   ├── Pill.tsx
│   ├── Card.tsx
│   ├── Tabs.tsx
│   ├── Menu.tsx
│   └── EmptyHint.tsx
├── surfaces/
│   ├── Titlebar/
│   ├── Sidebar/             (split TaskList 696 → list + row + sectioning)
│   ├── Conversation/        (split CardHeader 544 + Card.tsx)
│   ├── Inspector/           (board → workflow / inspector / preview)
│   └── Composer/
└── App.tsx                  # ONE Solid root replacing main.tsx's 18 mounts.
```

## Hard rules enforced by tests + lint

| Rule                                                                                   | Enforcement                                                                                                                   |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Surface CSS files declare NO raw `px` / `#hex` / `rgba()` values — only `var(--token)` | Regex test walks `styles/surfaces/*.css`, fails on raw values                                                                 |
| Theme CSS files contain ONLY `:root` selector — no other selector allowed              | Regex test walks `styles/themes/*.css`                                                                                        |
| Legacy theme selectors cannot gain layout/chrome overrides                             | Regex test counts `body[data-theme]` and `body:is([data-theme])` blocks touching layout, border, radius, or shadow properties |
| Repo-wide `!important` count is monotonically non-increasing                           | Pre-push hook: `grep -c '!important' styles/**/*.css` ≤ `HEAD~1`'s count                                                      |
| Component files > 300 lines must split into a subdirectory                             | `wc -l` lint walking `components/**/*.tsx`                                                                                    |
| Primitive selectors use `data-*` attributes for variants, NOT `!important`             | Regex test on `styles/primitives/*.css`                                                                                       |

## Migration phases

| Phase | Scope                                                                                                                                                                     | Estimated iters |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| **1** | Land empty directory tree, the 5 lint rules, and an empty `App.tsx` shell. Existing code untouched.                                                                       | 1 iter          |
| **2** | Button primitive ships first. Migrate 8+ existing button-like impls one at a time, each its own commit.                                                                   | 8–12            |
| **3** | Pill / Tab / Card / Menu / Input / EmptyHint primitives ship. Existing surfaces consume them progressively.                                                               | 30+             |
| **4** | Surface migration — Titlebar → Sidebar → Conversation → Inspector → Composer → Settings, each surface one PR.                                                             | 50+             |
| **5** | Retire legacy God CSS from runtime imports, archive it as reference-only backup, collapse `main.tsx` 18 mounts into single `App.tsx`, and remove dead mount placeholders. | 5–10            |

Total: **100–120 iters** within the 1000-iter target.

## Replacement strategy

Phases 2–4 must not leave parallel runtime sources. Each primitive
migration replaces one caller group in the same commit that removes
the matching legacy CSS selectors from the runtime stylesheet. The
temporary coexistence is only file-level scaffolding: empty
directories and unused primitives may exist before a surface consumes
them, but once a runtime caller moves, its old runtime selector path
is removed with a regression test proving the old class is no longer
referenced.

- Each primitive ships with a regression test that asserts the
  matching legacy classes have zero JSX callers.
- The same commit that switches a caller to the primitive removes
  the legacy runtime selectors for that caller group.
- Pre-push checks track legacy `styles.css` debt so the count cannot
  increase between iterations.

## God CSS Archive Rule

`packages/overlay/src/styles.css` and other God CSS sources must not
be physically deleted as historical artifacts. They must be retired
from all runtime imports and moved to an archive/reference location
with an explicit name such as
`docs/archive/overlay-god-css/styles.legacy-YYYY-MM-DD.css`.

The archive has exactly one purpose: backup and comparison during
review. It is forbidden for production code, tests, Vite, or any
runtime import path to consume archived CSS. The archive therefore
does not create a dual source of truth: the active source remains the
token/primitive/surface/theme tree, while the God CSS is a read-only
reference.

Completion requires all of the following:

- No runtime import of archived God CSS.
- No new selector may be added to archived God CSS.
- Tests prove migrated legacy classes have zero runtime callers.
- The active styles tree encodes every surviving visual decision via
  tokens, primitives, surfaces, and palette-only themes.

## What this is NOT

- **Not** a decorative redesign pass. The goal is deeper:
  normalize the design language so headers, radius, density,
  borders, shadows, and interaction states are consistent and
  testable across surfaces and themes.
- **Not** a runtime behavior change. Same DOM contract for
  external integrations (`dom.ts` accessors stay live during
  Phase 1–4; deleted in Phase 5 per the migration map).
- **Not** a switch to React / Vue / etc. Solid stays the
  framework. Only file layout + primitive abstraction.

## Risks + mitigations

| Risk                                                                 | Mitigation                                                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| 17K line CSS rewrite blast radius                                    | Per-selector / per-primitive iters; never bulk rewrite                                                 |
| Visual regression during phase migration                             | Each iter runs `agent-models-panel` puppeteer e2e + adds visual snapshot tests for the touched surface |
| Temporary rule-8 violation (legacy + new co-existing)                | Bounded by Phase 5 runtime retirement + per-iter regression tests asserting legacy callers reach zero  |
| `index.html` 18-mount → single `App.tsx` breaking `dom.ts` consumers | Phase 5 only; `dom.ts` accessors stay live through Phase 4                                             |
| 100+ iters of refactor competing with user feature requests          | User feature feedback preempts refactor iter; refactor runs as background autonomous-loop work         |

Update: Phase 5 does not delete God CSS artifacts. It archives them
outside runtime imports. The risk is therefore stale archive
confusion, not data loss; mitigation is a test that fails if archived
CSS is imported by app code.

## Recommendation

Phase 1 starts by landing the directory tree, architecture guard
tests, and empty `App.tsx` shell. Runtime mount consolidation waits
until Phase 5 so the existing panel stays stable while selector debt
is removed one caller group at a time.

## Reference iters this builds on

- iter3 — `.empty-hint--card` shared primitive
- iter4 — `.btn` typography unification
- iter13 — `docs/overlay-design-language-tier-hierarchy-2026-
05-02.md` (typography hierarchy spec)
- iter21 — 5-prefix grep checklist (folding discipline)
- iter32 — `docs/overlay-message-card-redesign-2026-05-03.md`
  (card visual spec)
- iter28-54 — 9-iter shell `!important` reset chain teardown
  (proves per-selector progress is exhausting)
