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
- 2026-05-03: Hardened `loadConfigInfo` against overlapping SSE refreshes.
  A monotonic load sequence now prevents an older, slower config refresh from
  overwriting a newer completed refresh.
- 2026-05-03: Coalesced `config.changed` SSE bursts before calling
  `loadConfigInfo`, so config event storms trigger one refresh wave instead
  of stacking identical five-route reloads.
- 2026-05-03: Retired the dead `.right-panel-tablist` /
  `.right-panel-tab` rules and theme overrides from runtime CSS. The right
  panel tab chrome is now owned only by the `Tabs` primitive and
  `styles/primitives/tabs.css`.
- 2026-05-03: Moved `.sections-tabs` layout chrome out of God CSS/theme
  resets and into `styles/surfaces/header.css`, backed by the
  `--oc-header-actions-padding` design-language token.
- 2026-05-03: Removed `.chat-icon-col` from the late shared
  gap/padding reset chain so its existing canonical rule remains the single
  source for composer icon-column layout.
- 2026-05-03: Retired the legacy `.sidebar-header`, `.chat-header`, and
  `.sections-header` base chrome blocks from God CSS. The three primary
  column headers now share the runtime `styles/surfaces/header.css`
  surface contract for height, padding, border, background, radius, and shadow.
- 2026-05-03: Moved primary header action spacing fully under
  `.oc-surface-header__actions`, removing local `.sidebar-header-actions` /
  `.chat-header-meta` gap declarations and the theme-scoped
  `.sidebar-header-actions` gap reset.
- 2026-05-03: Moved primary header title typography fully under
  `.oc-surface-header__title`, removing local `.sidebar-title` /
  `.chat-title` / `.sections-title` font, weight, color, line-height, casing,
  and theme typography overrides from God CSS.
- 2026-05-03: Moved primary header main/action flex primitives fully under
  `.oc-surface-header__main` / `.oc-surface-header__actions`, removing local
  `display`, `align-items`, `min-width`, and `gap` declarations from
  `.chat-header-main`, `.chat-header-meta`, and `.sidebar-header-actions`.
- 2026-05-03: Migrated `AgentWorkflowPanel` from its local
  `.agent-workflow-toolbar` / heading / title markup to `SurfaceHeader`,
  retiring the workflow tab's theme-scoped toolbar layout and typography
  overrides from God CSS.
- 2026-05-03: Folded `.delivery-panel-header` and `.criteria-group-head`
  compact spacing into their canonicals and removed both from theme-scoped
  right-panel header reset lists.
- 2026-05-03: Folded `.section-head` and `.gwg-header` compact spacing into
  their canonicals and removed their theme-scoped min-height/gap/padding reset.
- 2026-05-03: Folded `.section-head`, `.gwg-header`,
  `.config-section-head`, and `.config-subsection-head` header backgrounds
  into canonical `--oc-header-bg` chrome, retired their theme-scoped
  background/border reset selectors, and lowered the legacy debt guard.
- 2026-05-03: Folded `.criteria-group` / `.criteria-group-list` compact
  layout and no-border chrome into canonical CSS, then removed all remaining
  criteria group selectors from legacy theme reset blocks.
- 2026-05-03: Reworked `.delivery-panel` verdict accent from `border-left`
  to a pseudo-element rail, preserving verdict scanability while keeping
  right-panel card chrome borderless, and removed all delivery panel selectors
  from legacy theme reset blocks.
- 2026-05-03: Folded `.eval-error` into canonical borderless semantic error
  chrome and removed it from legacy theme reset selector lists so error state
  color is no longer overwritten by theme surface resets.
- 2026-05-03: Folded `.channel-doc-card` and `.detail-card` into canonical
  borderless document-card chrome, removed `.channel-doc-card` from the later
  shared card chrome group, and removed both selectors from legacy theme resets.
- 2026-05-03: Folded `.extension-row` into canonical borderless settings-row
  chrome and removed it from light/dark/vscode theme reset lists plus the local
  `config-content` important hover chain. Settings extension rows now keep one
  background, radius, padding, and border contract across themes.
- 2026-05-03: Folded `.config-section` and `.config-subsection` into canonical
  borderless settings-container chrome, removed both from light/dark/vscode
  theme reset lists, and retired the local `.config-content .config-subsection`
  background/border/radius override. Settings containers now share the same
  shape contract across themes.
- 2026-05-03: Screenshot review caught a real light-theme regression: shared
  column headers rendered as dark bars because `--oc-header-bg` was defined on
  `:root` as `var(--surface-strong)`, capturing the legacy dark root palette
  before `body[data-theme="light"]` overrides. `--oc-header-bg` now resolves
  from the root-scoped `--oc-color-surface-strong` palette token, and the guard
  forbids routing shared header background through legacy body-scoped palette
  variables.
- 2026-05-03: Folded `.chat-input` composer shell chrome into the canonical
  block. Margin, compact gap/padding, accent border, palette background, and
  focus ring no longer live in light/dark/vscode theme selectors or broad
  `!important` compact-reset lists. This lowers `!important` to 324,
  `body[data-theme]` to 213, and theme layout/chrome override count to 239.
- 2026-05-03: Removed the visible 2px gap above the conversation header.
  Root cause was `.task-switch-progress`: it was visually hidden with
  `opacity: 0` but still occupied `height: 2px` in the `.chat` flex flow.
  The progress indicator now overlays the chat header via absolute positioning,
  and a guard pins it out of layout so hidden loading chrome cannot move headers.
- 2026-05-03: Folded duplicated `.chat-scroll` layout padding out of
  light/dark/vscode theme selectors and back into the canonical chat scroll
  rule. Theme blocks now only change chat-scroll background palette for that
  slice, and the architecture guard lowers the allowed theme layout/chrome
  override count to 237.
- 2026-05-03: Folded `.panel` shell padding out of light/dark theme selectors
  and their mobile media duplicates. `.panel` now owns its zero-padding layout
  in the canonical rule, and the theme layout/chrome override ceiling drops to
  234.
- 2026-05-03: Folded `.panel-body` shell layout/chrome out of light/dark
  theme selectors. Gap, padding, margin, border, radius, and shadow now live in
  the canonical panel-body rule; theme-specific blocks only keep background and
  backdrop palette behavior. The guard ceiling drops to 220.
- 2026-05-03: Folded `.task-bar` shell layout out of light/dark theme selectors
  and their mobile/compact resets. Margin, padding, bottom-border geometry, and
  radius now live in the canonical task-bar rule; theme blocks keep only
  unresolved color/backdrop differences. The guard ceiling drops to 207, while
  `!important` drops to 322 and `body[data-theme]` to 212.
- 2026-05-03: Folded primary column shell chrome for `.sidebar`, `.chat`, and
  `.sections` out of light/dark theme resets. Border, radius, shadow, and
  backdrop behavior now live in the canonical column rules; remaining
  theme-scoped column rules are palette backgrounds only. Guard ceilings drop
  to `!important <= 311`, `body[data-theme] <= 201`, and theme layout/chrome
  overrides <= 198.
- 2026-05-03: Folded `.workspace-main` and `.sections-stack` spacing out of
  light/dark theme resets. Their gap/margin/padding now live in canonical
  layout rules, reducing guard ceilings to `!important <= 306`,
  `body[data-theme] <= 199`, and theme layout/chrome overrides <= 193.
- 2026-05-03: Folded `.section`/`.gwg` radius and
  `.section-body`/`.gwg-body` padding out of light/dark theme resets. Right
  panel card shape and density now live in canonical component rules, reducing
  guard ceilings to `!important <= 304`, `body[data-theme] <= 197`, and theme
  layout/chrome overrides <= 191.
- 2026-05-03: Folded the `.board-intro*` density, typography, card radius,
  grid sizing, and text clamp rules out of light/dark theme resets. The right
  panel empty-state design language now lives in canonical component rules,
  reducing guard ceilings to `!important <= 279`, `body[data-theme] <= 184`,
  and theme layout/chrome overrides <= 175.
- 2026-05-03: Folded titlebar shell layout/chrome out of light/dark theme
  selectors and mobile/compact resets. Gap, margin, padding, border geometry,
  radius, and shadow now live in the canonical titlebar rule; theme selectors
  only keep titlebar palette/backdrop differences. Guard ceilings drop to
  `!important <= 275`, `body[data-theme] <= 182`, and theme layout/chrome
  overrides <= 159.
- 2026-05-03: Folded `.task-dir-shell`, `.task-dir-shell.task-cwd-dropdown`,
  and `.sidebar-toolset` spacing out of light/dark/vscode theme resets and the
  late global `!important` compact reset. Directory chrome and sidebar toolset
  density now live in canonical rules, reducing guard ceilings to
  `!important <= 263`, `body[data-theme] <= 175`, and theme layout/chrome
  overrides <= 151.
- 2026-05-03: Moved right-panel empty hint density for
  `.section-body > .empty-hint` and `#solidChangesPanel > .empty-hint` from the
  light/dark/vscode `!important` reset into the canonical empty-state rule. The
  compact panel hint shape is no longer theme-dependent, tightening guard
  ceilings to `!important <= 259`, `body[data-theme] <= 174`, and theme
  layout/chrome overrides <= 147.
- 2026-05-03: Consolidated `.agent-workflow-panel` shell chrome and its grid
  backdrop pseudo-element into the canonical workflow panel rule, removing both
  the early compact theme reset and the later Calm workflow map panel override.
  Themes no longer own workflow panel display, spacing, padding, overflow,
  isolation, or backdrop geometry; guard ceilings are now `!important <= 259`,
  `body[data-theme] <= 171`, and theme layout/chrome overrides <= 137.
- 2026-05-03: Moved `.agent-workflow-canvas` display and padding from the
  compact theme reset plus Calm workflow map override into the canonical canvas
  rule. Workflow body spacing is now theme-invariant, reducing guard ceilings to
  `!important <= 256`, `body[data-theme] <= 169`, and theme layout/chrome
  overrides <= 133.
- 2026-05-03: Promoted `.agent-workflow-row` lane shift, rail column, gap,
  min-height, and row spacing from the Calm workflow map theme override into the
  canonical row rule. Workflow row geometry is no longer theme-controlled,
  reducing guard ceilings to `!important <= 256`, `body[data-theme] <= 168`,
  and theme layout/chrome overrides <= 127.
- 2026-05-03: Moved `.agent-workflow-rail` placement, width, min-height, and
  transparent background from the Calm workflow map theme override into the
  canonical rail rule. The workflow timeline rail no longer changes geometry by
  theme, lowering guard ceilings to `!important <= 256`,
  `body[data-theme] <= 167`, and theme layout/chrome overrides <= 122.
- 2026-05-03: Promoted `.agent-workflow-stack` display, gap, min-width, and
  bottom stack padding from the Calm workflow map theme override into the
  canonical stack rule. Workflow card stacking density is now theme-invariant,
  reducing guard ceilings to `!important <= 256`, `body[data-theme] <= 166`,
  and theme layout/chrome overrides <= 117.
- 2026-05-03: Promoted `.agent-workflow-card` chrome, status tone variables,
  running dashed state, and hover/focus elevation from theme-scoped Calm
  workflow overrides into canonical card rules. Workflow card radius, density,
  border, shadow, and semantic tone now follow one component source, reducing
  guard ceilings to `!important <= 241`, `body[data-theme] <= 158`, and theme
  layout/chrome overrides <= 97.
- 2026-05-03: Moved `.agent-workflow-agent` and `.agent-workflow-card-body`
  typography/density from theme selectors into canonical text rules. Workflow
  card text weight, body min-height, color, font size, and line-height no longer
  vary by theme, reducing guard ceilings to `!important <= 241`,
  `body[data-theme] <= 156`, and theme layout/chrome overrides <= 96.
- 2026-05-03: Moved `.agent-workflow-attempt` chip border, background, and text
  color from theme selectors into the canonical attempt chip rule. Attempt chips
  now inherit semantic tone through component variables, reducing guard ceilings
  to `!important <= 241`, `body[data-theme] <= 155`, and theme layout/chrome
  overrides <= 95.
- 2026-05-03: Moved `.agent-workflow-report-popover` and
  `.agent-workflow-report` alignment, padding, backdrop, border, radius, and
  shadow from theme selectors into canonical report shell rules. Workflow report
  modal geometry and chrome are now theme-invariant, reducing guard ceilings to
  `!important <= 241`, `body[data-theme] <= 153`, and theme layout/chrome
  overrides <= 90.
- 2026-05-03: Moved `.agent-workflow-report-head` and
  `.agent-workflow-report-section` divider borders from theme selectors into
  canonical report content rules. Workflow report internal separators now follow
  one source, reducing guard ceilings to `!important <= 239`,
  `body[data-theme] <= 151`, and theme layout/chrome overrides <= 88.

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
| Total `!important` in stylesheets      | **324** current guard baseline                                                          |
| `body[data-theme="…"]` theme overrides | **213**                                                                                 |
| Theme layout/chrome overrides          | **239** current guard baseline                                                          |
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
- Visual UI work requires a rendered screenshot before delivery. CSS count
  reductions and structural tests are not enough; computed styles and screenshots
  must confirm the active theme renders the intended design language.

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
