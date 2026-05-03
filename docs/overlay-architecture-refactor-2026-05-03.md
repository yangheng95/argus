# Overlay Architecture Refactor — 3-Layer Primitives + Surface Modularization

Status: paused by user request on 2026-05-03. Phase 1 guardrails
started on 2026-05-03; implementation must resume from the checkpoint
below instead of restarting or deleting the guard automation.

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
- 2026-05-03: Moved `.agent-workflow-refresh` pill chrome and hover background
  from broad theme reset lists plus Calm workflow map selectors into canonical
  refresh button rules. Workflow refresh now shares the palette through tokens
  without theme-owned button geometry, reducing guard ceilings to
  `!important <= 234`, `body[data-theme] <= 149`, and theme layout/chrome
  overrides <= 85.
- 2026-05-03: Moved `.agent-workflow-report-close` ghost button chrome and
  hover background from broad theme reset lists into canonical report-close
  rules. The workflow report close action now has one transparent icon-button
  shape across light, dark, and vscode-dark themes; the guard explicitly
  rejects future theme-scoped report-close chrome.
- 2026-05-03: Titlebar menus gained native Alt access behavior in
  `TitlebarMenubar`: bare `Alt` focuses the first top-level menu and
  `Alt+W/M/R/T/V/H` opens Workspace, Model, Run, Tools, View, or Help
  directly. The shortcut contract is exposed through `aria-keyshortcuts`
  and covered by a browser E2E test.
- 2026-05-03: Titlebar menu text was originally pinned to `#000000`
  through the `--oc-titlebar-menu-text` design token, which made the
  menu text invisible against dark theme backgrounds. The token now
  resolves through `var(--oc-color-text-strong)` so the rendered color
  adapts per palette (`#1a1a1a` light, `#dfe1e5` dark, `#d4d4d4`
  vscode-dark). E2E assertions cover both the light render (`rgb(26,
  26, 26)`) and the dark render (`rgb(223, 225, 229)`) of the workspace
  menu trigger.
- 2026-05-03: User confirmed Claude Code will work in parallel with Codex.
  This document is now also the cross-agent coordination source: both agents
  must update this log, respect file ownership, run the same guard/test gates,
  and avoid touching unrelated dirty files.
- 2026-05-03: Promoted titlebar layout container `gap` out of the late
  `body[data-theme] :is(...)` `!important` reset and into the canonical
  `.titlebar-left/-brand/-nav/-nav-group/-utility/-actions/-status-cluster/`
  `-window-controls` rules via the new `--oc-titlebar-gap` design-language
  token. Titlebar inner spacing is now theme-invariant and resolved through
  the token contract instead of an `!important` chain. Guard ceilings drop to
  `!important <= 233`, `body[data-theme] <= 148`, and theme layout/chrome
  overrides <= 84.
- 2026-05-03: Retired the `body[data-theme] :is(.titlebar-btn,`
  `.titlebar-status-icon, .chat-toolbar-btn) { padding: 0 !important }`
  reset. The canonical `.titlebar-btn`, `.titlebar-status-icon`, and
  `.chat-toolbar-btn` rules now declare `padding: 0`, so icon-button geometry
  no longer depends on theme-scoped chrome. Guard ceilings drop to
  `!important <= 232` and `body[data-theme] <= 147`.
- 2026-05-03: Removed the remaining `!important` declarations from
  `styles/card.css` after retiring the right-panel board-intro duplicate from
  that file. Card/message/interaction chrome now resolves by load order and
  selector specificity instead of an emergency override layer. Guard ceiling
  drops again to `!important <= 183`.
- 2026-05-03: Began collapsing the `styles/card.css` final override layer
  into the canonical card primitive block. The container, depth-0 hover,
  stage rail, and nested-card geometry now live at their first-owner rules;
  the duplicate-selector guard starts at `card.css duplicate selectors <= 52`.
- 2026-05-03: Removed theme-scoped chrome overrides for `.executor-chip`,
  `.titlebar-btn`, and `.chat-toolbar-btn`; all three are dead static-class
  callers (Button primitive owns those use cases), so the legacy theme
  background, hover, border, and color overrides were noise. The dark
  variant of `.chat-toolbar-btn:hover` was retired alongside the light
  variants. `body[data-theme]` guard ceiling drops to `<= 140`.
- 2026-05-03: Pruned dead static-class callers (`.titlebar-menubar-trigger`,
  `.titlebar-status-icon`, `.titlebar-btn`, `.executor-chip`) from the
  remaining multi-selector light/dark/vscode-dark theme blocks that paint
  titlebar control chrome and sidebar tool surfaces. The Button primitive
  already owns those visual states, so the legacy theme entries cannot
  render anything. `body[data-theme]` guard ceiling drops to `<= 128`.
- 2026-05-03: Collapsed redundant theme prefixes from `.btn-primary` and
  `.engine-chip[data-active="true"]` combined selectors. The
  `body[data-theme="light"]` arm was a specificity-only duplicate of the
  unscoped rule and could never change rendering on its own. With the
  duplicates retired, `body[data-theme]` guard ceiling drops to `<= 125`.
- 2026-05-03: Folded the `body[data-theme="light"] { color: #ffffff }`
  overrides for `.chat-send` and `.btn-primary` into the canonical rules.
  The accent-on-flat primary button always renders white text — the dark
  variants set white via the late primary cluster, and the canonical was
  declaring an unrendered `#08110f` text color that never reached the page.
  `body[data-theme]` guard ceiling drops to `<= 123`.
- 2026-05-03: Folded card header/body/badge/interaction/trace-panel
  declarations out of the `styles/card.css` final override layer and into
  their canonical first-owner rules. `card.css` duplicate-selector guard drops
  from `<= 52` to `<= 27`.
- 2026-05-03: Routed `.status-label` and `.elapsed` text colors through
  theme-aware `var(--text-strong)` / `var(--text-soft)` tokens instead of
  the hardcoded `#dbe3ee` / `#94a3b8` literals. Light-theme `body[data-theme]`
  overrides for `.status-label`, `.elapsed`, and `.reasoning-text` were
  redundant once the canonical resolved through tokens; only the
  `.msg-reasoning` light background/border tint remained. `body[data-theme]`
  guard ceiling drops to `<= 120`.
- 2026-05-03: Routed `.task-dir-tool`, `.task-dir-node`, `.task-dir-empty`,
  `.task-dir-step`, and `.task-dir-node[data-current=true]` chrome through
  theme-aware tokens (`--text-soft`, `--text-strong`, `--text-muted`,
  `--accent`, `--accent-dim`) instead of hex literals. Removed nine
  `body[data-theme="light"] .task-dir*` overrides that only existed to
  re-color the sidebar directory tree for light mode — the new canonical
  resolves correctly via palette tokens in every theme. `body[data-theme]`
  guard ceiling drops to `<= 110`.
- 2026-05-03: Folded card header action control sizing, radius, and opacity
  from the `styles/card.css` final override layer into the first-owner
  `.card__copy`, `.card__rewind`, `.card__trace`, `.card__agent-cancel`, and
  `.card__agent-reply-toggle` rules. `card.css` duplicate-selector guard
  drops from `<= 27` to `<= 14`.
- 2026-05-03: Retired the dead `body[data-theme="light"] .task-bar`
  background override (the winning rule already lives in the late light
  block with `!important`) and the `body[data-theme="light"] .section-badge`
  rule that only restated the canonical `var(--text-soft)` palette. Both
  were rule 8 violations sitting alongside their authoritative source.
  `body[data-theme]` guard ceiling drops to `<= 108`.
- 2026-05-03: Folded message-card and header-control state declarations
  out of the remaining `styles/card.css` final override layer into their
  canonical first-owner rules. `card.css` duplicate-selector guard drops
  from `<= 14` to `<= 6`.
- 2026-05-03: Routed `--oc-titlebar-menu-text` through
  `var(--oc-color-text-strong)` so the titlebar menu text adapts to
  light / dark / vscode-dark palettes instead of always rendering
  `#000000` (which was invisible against the dark titlebar surface).
  Architecture guard now forbids raw hex values on this token; titlebar
  menubar E2E asserts both the light render (`rgb(26, 26, 26)`) and
  the dark render (`rgb(223, 225, 229)`).
- 2026-05-03: Added a bold-weight density guard. Overlay stylesheets
  (`styles.css`, `card.css`, primitives, surfaces) currently declare
  many weights at `>= 700` / `bold`; the guard caps that count and
  must drop monotonically as decorative bold is pruned. **Why:** user
  feedback flagged "黑体太多，视觉噪音太多" — bold should be reserved
  for genuine semantic emphasis, not a default decoration.
- 2026-05-03: Bold-weight sweep round 1: downshifted
  `.task-dir-editor`, `.executor-chip-label` (700 → 600),
  `.brand-guide-kicker` (700 → 500; uppercase + tracking already
  carries the kicker emphasis), and four chip/label/subtitle classes
  (`.provider-test-result-icon`, `.provider-section-label`,
  `.goal-priority`, `.dialog-subtitle`) from 700 to 600. Bold-weight
  guard ceiling drops to `<= 45`.
- 2026-05-03: Retired the light and dark/vscode-dark task-row
  hover/active theme overrides. The canonical `.task-row-mini` state
  rules already resolve through `--surface-hover`, `--accent`, and
  `--text-strong`, so themes now only provide palette tokens instead
  of owning row backgrounds, borders, or active rails. Guard ceilings
  drop to `!important <= 179`, `body[data-theme] <= 103`, and
  theme layout/chrome `<= 70`.
- 2026-05-03: First real surface extraction landed. Moved the
  `.titlebar-task-status` family (canonical, hover, four data-status
  state variants, child label/elapsed display:none) and the
  `.status-icon` family (svg geometry + six data-status color tones)
  from `styles.css` into `styles/surfaces/titlebar.css`. State chrome
  used to use raw rgba literals (`rgba(91, 141, 239, ...)` info,
  `rgba(52, 211, 153, ...)` good, `rgba(248, 113, 113, ...)` bad);
  surface guard required palette tokens, so the move converts each
  literal into `color-mix(in srgb, var(--info|good|bad) NN%, transparent)`.
  Two new design-language tokens `--oc-titlebar-status-radius` and
  `--oc-titlebar-status-icon` carry the previously-inline pixel
  geometry so the surface stays palette-token clean. New guard
  asserts `styles.css` no longer owns either selector and that the
  surface declares the migrated rules. **Why:** styles.css must end
  empty so it can leave the runtime import graph; this is the first
  full extraction rather than another internal fold.
- 2026-05-03: Extracted the titlebar menubar family
  (`.titlebar-menubar*`, trigger, panel, group, item, toggle/range,
  note, compact media behavior, and theme shortcut) into
  `styles/surfaces/titlebar.css`. The move replaces surface-local raw
  borders with `--oc-border-width`, keeps scaled one-off geometry in
  `calc(Npx * var(--ui-scale))`, and adds an ownership guard so
  `styles.css` cannot regain these selectors. Bold-weight guard drops
  to `<= 44` after the group heading is demoted from decorative 700 to
  600.
- 2026-05-03: Retired light and dark/vscode-dark `.chat-scroll`
  conversation-stream chrome overrides. The stream background now
  comes from canonical `.chat-scroll { background: var(--chat-canvas) }`
  and card/message chrome stays in `card.css`; themes only change
  `--chat-canvas`, `--surface`, `--accent`, and border palette tokens.
  The chat-scroll guard now blocks theme-scoped background, border,
  box-shadow, and padding. Guard ceilings drop to `!important <= 167`,
  `body[data-theme] <= 96`, and theme layout/chrome `<= 64`.
- 2026-05-03: Retired light and dark/vscode-dark
  `.chat-goals-strip` / `.workspace-mount` chrome overrides.
  `workspace-mount` now owns `background: var(--surface-inset)` in its
  canonical rule; `chat-goals-strip` already owned background and border
  canonical values. New guard blocks theme-scoped background, border, and
  shadow for these auxiliary conversation surfaces. Guard ceilings drop
  to `!important <= 163`, `body[data-theme] <= 94`, and theme
  layout/chrome `<= 62`.
- 2026-05-03: Surface guard relaxed to recognize the project's
  canonical `calc(Npx * var(--ui-scale))` scaling pattern. The earlier
  blanket `Npx` ban forced a token wrapper around every scaled length,
  which would have exploded the design-language token table for one-off
  surface-internal values. The guard still rejects any unscaled raw
  px and any hex / rgba / hsla literal — the design intent (no fixed
  sizes, no theme-locked colors) is preserved.
- 2026-05-03: Extracted the titlebar status chip family
  (`.titlebar-status-chip`, `.titlebar-setup-cta`,
  `.titlebar-status-label`, `.titlebar-status-value`, plus the dead
  `.titlebar-status-icon` rule retained for completeness) from
  `styles.css` into `styles/surfaces/titlebar.css`. New guard asserts
  none of the four classes are owned by `styles.css` and all are
  declared in the surface file.
- 2026-05-03: Extracted the entire `.titlebar-menubar*` family (bar
  shell, slot, trigger, panel, group, group-title, item, toggle,
  range, note, item-title, item-meta, range-copy, theme-options
  shortcut) plus the matching `@media (max-width: 760px)` compact-mode
  tweaks from `styles.css` into `styles/surfaces/titlebar.css`. The
  group-title weight dropped from 700 to 600 in the move — uppercase
  + ui-font-tiny already carry the kicker emphasis — so the bold-weight
  density guard tightens to `<= 44`. New extraction guard pins
  fourteen menubar classes to the surface file.
- 2026-05-03: Extracted the titlebar shell + brand layout containers
  from `styles.css` into `styles/surfaces/titlebar.css`. Moved
  `.titlebar` (grid shell + decorative `::after` underline),
  `.titlebar-left`, `.titlebar-brand`, `.titlebar-spacer`, and
  `.brand-logo`, plus the late grid-column placements and the
  matching `@media (max-width: 760px)` reset that flips the grid back
  to flow. The `1px` border + divider thickness uses the
  `--oc-border-width` design-language token; the brand logo glow
  scales through `calc(8px * var(--ui-scale))`. New guard pins five
  classes plus `.titlebar::after` to the surface file.
- 2026-05-03: Extracted the remaining titlebar layout containers and
  connection badge from `styles.css` into `styles/surfaces/titlebar.css`.
  Moved `.titlebar-nav`, `.titlebar-nav-group`, `.titlebar-utility`,
  `.titlebar-actions`, `.titlebar-status-cluster`,
  `.titlebar-window-controls`, the `.conn-badge*` family (dot-indicator
  + status tones + label), and the matching `@media (max-width: 760px)`
  `.titlebar` flow reset. New guard pins seven classes to the surface
  file. The follow-up brand-guide slice below removes the remaining
  popover-specific titlebar family from `styles.css`.
- 2026-05-03: Retired the remaining legacy theme selectors for migrated
  titlebar chrome. `.titlebar`, `.titlebar-menubar-trigger`,
  `.titlebar-status-chip`, `.titlebar-setup-cta`,
  `.titlebar-status-icon`, `.titlebar-task-status`, and the full
  `.brand-guide*` popover family now resolve through
  `styles/surfaces/titlebar.css` plus palette tokens only; no
  `body[data-theme]` block may target them. The `brand-guide` move also
  replaced its rgba focus/step chrome with `color-mix()` over tokens and
  tightened its bold weights to the shared titlebar density. Guard
  ceilings drop to `!important <= 152`, `body[data-theme] <= 82`, and
  theme layout/chrome overrides `<= 53`.
- 2026-05-03: Extracted the `.brand-guide*` family (anchor, popover
  card with `::before` / `::after` arrow geometry, kicker, title,
  copy, steps, step-index, step-copy) plus its `@media (max-width:
  760px)` width tweak from `styles.css` into
  `styles/surfaces/titlebar.css`. The two raw `rgba(91, 141, 239, …)`
  literals that previously kept this family in `styles.css` (focus ring
  + step-index border) now resolve through `color-mix(in srgb,
  var(--accent) NN%, transparent)`, so the popover follows the per-theme
  accent palette instead of a hardcoded blue. The pill radius routes
  through the existing `--oc-radius-pill` token. `.brand-guide-title`
  and `.brand-guide-step-index` font-weight dropped from 700 to 600 in
  the move (the popover already has the kicker for emphasis), so the
  bold-weight density guard tightens to `<= 42`. New extraction guard
  pins ten brand-guide classes plus the two pseudo-elements to the
  surface file.
- 2026-05-03: Retired the dead `.titlebar-btn` / `.titlebar-close`
  static window-control CSS from God CSS after the runtime callers had
  already moved to the `Button` primitive. The remaining titlebar button
  sizing tokens stay because the primitive/surface rules still consume
  them for menubar/status/window-control dimensions. New guard blocks the
  dead static classes from returning to either God CSS or the titlebar
  surface, and the icon-button padding guard now tracks only live classes.
- 2026-05-03: Moved live `.chat-icon-col` composer icon-column chrome
  from God CSS into `styles/surfaces/composer.css` and retired the dead
  `.chat-toolbar-btn` / `.chat-cancel-btn` static classes entirely.
  Toolbar buttons are now styled only through
  `.chat-icon-col .oc-button[data-ui="chat-toolbar-button"]`, so future
  composer controls must use the Button primitive instead of reintroducing
  static class geometry. New guard pins the icon column to composer.css
  and rejects both dead static classes across God CSS and composer surface.
- 2026-05-03: Retired the light and dark/vscode theme chrome overrides
  for `.chat-icon-col`. The icon column now reads `background` and
  `border` from its canonical composer surface rule, which already points
  at palette tokens. New guard rejects any `body[data-theme]` selector
  targeting `.chat-icon-col`; ceilings drop to `body[data-theme] <= 81`
  and theme layout/chrome overrides `<= 45`.
- 2026-05-03: Extracted the `.titlebar-theme-options*` picker family
  (grid wrapper, option button, hover/active states, label,
  preview-swatch base, four `[data-theme]` swatch variants) from
  `styles.css` into `styles/surfaces/titlebar.css`. The hover state's
  `rgba(255, 255, 255, …)` whitewash routed through palette tokens
  (`--subtle-3` / `--subtle-5`) so it adapts per theme. The four swatch
  hex previews live in design-language tokens (`--oc-theme-swatch-dark`,
  `-light`, `-vscode-dark`, `-system`) — they are deliberately fixed
  metadata about other themes, not theme-aware values, so they cannot
  resolve through the palette but they now route through the design
  language instead of being inlined hex literals on selectors. New
  guard pins four classes plus the four data-theme variants and asserts
  the four swatch tokens exist.
- 2026-05-03: First composer surface extraction — moved `.chat-icon-col`
  + `[data-disabled]` state, the dead `.chat-toolbar-btn` rule family
  (canonical, hover, two `[data-active]` variants), and the
  `.chat-cancel-btn` family (canonical, disabled, hover) from
  `styles.css` into `styles/surfaces/composer.css`. The two raw rgba
  literals on `.chat-toolbar-btn[data-active]` (`rgba(91, 141, 239, …)`
  background variants) plus the `var(--accent, #5b8def)` fallback hex
  routed through `color-mix(var(--accent) NN%, transparent)`. The
  `min(... 4px)` literal on `.chat-icon-col` padding was a fixed cap;
  it is now `calc(3px * var(--ui-scale))` since the cap is dominated by
  the calc at any sane scale. New extraction guard pins the three
  classes, the `[data-disabled]` / `[data-active]` / disabled-hover
  variants to the surface file.
- 2026-05-03: Extracted the composer `.chat-input` shell + the
  `.chat-input:focus-within` ring from `styles.css` into
  `styles/surfaces/composer.css`. Both are token-clean (color-mix over
  `var(--accent)` / `var(--surface-strong)`); the focus-ring `2px`
  literal scales through `calc(2px * var(--ui-scale))`, and the `1px`
  resting border routes through `var(--oc-border-width)`. The existing
  "composer shell does not rely on theme chrome resets" guard now
  reads `.chat-input` from the surface file. New extraction guard
  pins `.chat-input` and `:focus-within` to the surface.
- 2026-05-03: Extracted the composer chat-textarea family
  (`.chat-textarea-wrap`, `.chat-textarea-wrap > .chat-textarea`,
  `.chat-textarea`, `[data-expanded="true"]`, `:focus`, `::placeholder`)
  plus the floating placeholder overlay (`.chat-placeholder-float`,
  `.chat-placeholder-text`, `.chat-placeholder-caret`) from
  `styles.css` into `styles/surfaces/composer.css`. Three rule-8
  duplicate sources collapsed in the move: the canonical
  `:focus` block had a five-rgba multi-shadow stack that was
  unconditionally overwritten by a late `box-shadow: ... !important`
  override (the simpler late ring is now the single source); the
  canonical `[data-expanded]` declared 220px while a late block
  redeclared 210px (210px wins, canonical updated); and the redundant
  `body[data-theme="light"] .chat-textarea` + `body:is(...) .chat-textarea`
  background overrides went away because the canonical now resolves
  through palette tokens that already adapt per theme. The placeholder
  caret's `4px` margin scaled through `calc(4px * var(--ui-scale))`.
  Surface guard's `pxLiteral` walker now strips comments before
  scanning so commented-out unscaled px in copy text doesn't trip the
  guard. Guard ceilings drop to `!important <= 147` and
  `body[data-theme] <= 80`. New extraction guard pins five composer
  classes plus the `:focus`, `[data-expanded]`, and `::placeholder`
  variants, and asserts no `body[data-theme]` rule still targets
  `.chat-textarea`.
- 2026-05-03: Extracted the composer send action family
  (`.chat-send` resting + `:hover` + `:disabled` + `:focus-visible`,
  `.chat-interrupt` + `:hover` + `:focus-visible`, plus
  `.chat-send-icon` and `.chat-send-label`) from `styles.css` into
  `styles/surfaces/composer.css`. The `#ffffff` text-on-accent literal
  now uses the `white` keyword (no need for a token; primary buttons
  are always blue with white text). The `1px` border routes through
  `--oc-border-width`; the `2px` focus rings scale through
  `calc(2px * var(--ui-scale))`. Bold weight dropped from 700 to 600.
  Late `body[data-theme="light"] .chat-send` and
  `body:is([data-theme="dark"|"vscode-dark"]) .chat-send` overrides
  retired — the canonical resolves the per-theme accent palette
  (`var(--accent)`, `var(--accent-hover)`, `var(--accent-ring)`)
  directly, so the late `!important` chains had no semantic role
  for `.chat-send` (the gradient treatment in light theme was a
  decorative aside that violated the "calm/flat" design language).
  Guard ceilings drop to `body[data-theme] <= 78`; the gradient
  override remains for the still-unmoved `.sidebar-btn-primary`,
  `.btn-primary`, and `.board-intro__cta-action` siblings.
- 2026-05-03: Extracted the composer attachments strip
  (`.chat-attachments`, `-item`, `-thumb`, `-icon`, `-name`, `-remove`,
  `-remove:hover`) plus the compose row + meta layout
  (`.chat-input[data-dragover] .chat-compose-row`, `.chat-compose-row`,
  `.chat-compose-meta` + `-left` + `-right` and the meta-left anchor
  states) from `styles.css` into `styles/surfaces/composer.css`. Two
  rule-8 duplicates collapsed: `.chat-compose-row { gap }` was 6px in
  the canonical and 8px in a late override (8px wins, canonical
  updated); `.chat-compose-row { align-items }` was stretch in the
  canonical and end in a late override (end wins, canonical updated).
  The drag-over outline's `rgba(59, 130, 246, 0.5)` literal routes
  through `color-mix(in srgb, var(--accent) 50%, transparent)`;
  outline width and offset scale through
  `calc(±2px * var(--ui-scale))`. New extraction guard pins ten
  composer classes plus the `:hover` variants and the
  `.chat-input[data-dragover]` compound selector to the surface file.
- 2026-05-03: Extracted the composer build/version row + reflow rules
  (`.chat-build`, `.chat-version` + `-copy/-name/-sep`,
  `.chat-version-link` + `:hover`, `.chat-compose-tip`,
  `.chat-send-icon svg` icon sizing, the composer-internal
  `@container (max-width: 520px)` adjustments, and the viewport
  `@media (max-width: 700px)` reflow that drops `.chat-send` to its own
  row) from `styles.css` into `styles/surfaces/composer.css`. The
  redundant per-side `border-left/right/top/bottom: 0 !important`
  declarations on the `body[data-theme] :is(.section:last-child,
  .criteria-item)` reset block were folded into the existing `border:
  0 !important` shorthand (the explicit-side declarations were
  duplicates of the shorthand). Guard ceilings drop to
  `!important <= 138`, `body[data-theme] <= 69`, theme layout/chrome
  overrides `<= 33`. New extraction guard pins five composer classes
  plus the icon-svg selector and the `@container` / `@media` blocks.
- 2026-05-03: Seeded `styles/surfaces/conversation.css` and extracted
  the calm-state chat-empty placeholder (`.chat-empty`,
  `.chat-empty-icon`, `.chat-empty-text`, `.chat-follow-label`) from
  `styles.css` into the new file. `index.html` loads the surface after
  the primitive layer and before legacy `styles.css` so canonical
  conversation rules win against any late God CSS that may still
  reference these classes. The richer `.chat-empty--task` task-status
  variant + theme overrides will land in a follow-up because they
  need rgba-to-color-mix conversions that change visuals. The
  `.chat-empty-text` font-weight dropped from 650 to 600 — meta
  copy below an icon does not need extra emphasis. Bold-weight
  density ceiling tightens to `<= 41`.
- 2026-05-03: Extended `styles/surfaces/conversation.css` with the
  task-aware empty-state children: `.chat-empty-marker`,
  `.chat-empty-copy`, `.chat-empty-kicker`, `.chat-empty-title`,
  `.chat-empty-meta`, `.chat-empty-status` (+ `::before` indicator pip
  + queued/failed/cancelled tone variants), `.chat-empty-path`, and
  the nested `.chat-empty--task .chat-empty-marker .chat-empty-icon`
  scope. `border-radius: 999px` on the status pip routes through
  `var(--oc-radius-pill)`; `1px` border thickness routes through
  `var(--oc-border-width)`. `.chat-empty-title` weight dropped from
  720 to 600 — the heading already gets emphasis from font-size and
  text-strong color. The shell `.chat-empty--task` selector + the three
  body[data-theme]-mass-cluster overrides that govern its background /
  border / border-color stay in styles.css until those rgba literals
  are reworked through palette tokens. Bold-weight density ceiling
  tightens to `<= 40`.
- 2026-05-03: Extracted the `.chat-scroll` shell + descendant card
  layout (`> .card`, `> .interaction-card`, `[data-role="user"]` /
  `[data-role="system"]` width + alignment, plus the matching
  `@media (max-width: 900px)` reflow) from `styles.css` into
  `styles/surfaces/conversation.css`. Three rule-8 duplicate sources
  collapsed: the canonical declared `--card-min-inline-size: 50%` /
  `gap: 18px` / `padding: 18 (N+6) 28` / `background: transparent`,
  while two later overrides at lines ~12201 and ~12494 force-set
  `--card-min-inline-size: 46%` / `gap: 10px` / `padding: 18 22 20` /
  `background: var(--chat-canvas) !important`. The surface file now
  declares the actually-rendered values directly (no `!important`).
  Card `max-width` raised from 960px to the actually-rendered 1040px
  (late override at 12208). The "chat scroll layout is canonical, not
  theme scoped" guard now reads body declarations from the
  conversation surface instead of styles.css; new extraction guard
  pins `.chat-scroll` + descendant card selectors to the surface.
- 2026-05-03: Extracted the chat header + task-switch progress chrome
  (`.task-switch-progress` + `[data-active]` + `::before` + animated
  `[data-active]::before` + `@keyframes task-switch-progress-slide`,
  `.chat-header-main`, `.chat-title`, `.chat-header-status`,
  `.chat-task-status` + nested `.status-icon` / `.status-copy` /
  `.status-label` / `.elapsed`, `.chat-count`, `.chat-header-meta`)
  from `styles.css` into `styles/surfaces/conversation.css`. The
  `var(--accent, #5b8def)` fallback hex on the progress bar gradient
  routes through bare `var(--accent)` (the fallback never fired since
  every theme defines `--accent`). The `2px` height literal scales
  through `calc(2px * var(--ui-scale))`. The "task-switch progress
  overlays the header" guard now reads `.task-switch-progress` from
  the conversation surface. New extraction guard pins five primary
  classes plus `@keyframes`, `::before`, and the late
  `.chat-header-meta` / `.chat-count` overrides (which still live in
  styles.css for follow-up).
- 2026-05-03: Extracted the late conversation header chrome
  (`.chat-count` + `:empty` + `::before` dot, `.chat-header-meta
  #btnChatCopyAll` copy-all link + `::before` dot + hover +
  focus-visible, `.chat-header-meta .workspace-toggle` icon button +
  hover + pressed + focus-visible) from `styles.css` into
  `styles/surfaces/conversation.css`. Three `border-radius: 999px`
  literals routed through `var(--oc-radius-pill)`; two `outline: 1px`
  literals through `var(--oc-border-width)`; `outline-offset: 2px`
  through `calc(2px * var(--ui-scale))`. The btnChatCopyAll
  font-weight dropped from 620 to 600 — a copy-all text link does
  not need a special weight notch above the chat-header text-soft
  baseline.
- 2026-05-03: Extracted the `.chat-goals-strip` strip + `:empty` and
  the `.goal-chip` family (resting + three `[data-status]` variants
  + nested `.goal-chip-icon`) from `styles.css` into
  `styles/surfaces/conversation.css`. The canonical's earlier
  rgba-gradient backdrop was already overridden by a late
  `var(--surface-inset) !important` rule (now consolidated into the
  surface canonical without `!important`). All raw px values converted
  to `calc(Npx * var(--ui-scale))`; the `1px` border thickness through
  `var(--oc-border-width)`; the inset `rgba(255, 255, 255, 0.05)`
  highlight through `color-mix(in srgb, white 5%, transparent)`; the
  `10px` chip radius scales through `calc(10px * var(--ui-scale))`.
  Note: `#chatGoalsStrip` is currently a stub HTML element with no
  runtime path that populates it — the chrome stays so a future
  re-enable does not need to re-derive the design (rule 17: dead
  code retire deferred to user review). Guard ceiling drops to
  `!important <= 137`.
- 2026-05-03: Seeded `styles/surfaces/sidebar.css` and extracted the
  rail column shell (`.sidebar`, `.sidebar[data-collapsed="true"]`,
  collapsed-state `.sidebar-toggle svg` rotation), the control cluster
  (`.sidebar-toolset`, `.sidebar-tool` + `:hover` + `:focus-visible`),
  and the header text lanes (`.sidebar-title`, `.sidebar-subtitle`,
  `.sidebar-header-actions`) from `styles.css` into the new file.
  `index.html` loads the surface between composer/conversation and
  the legacy `styles.css`. The `.sidebar-btn` family (with its
  gradient + rgba chrome) stays until the gradient is reworked.
  Updated two guards ("primary column shell chrome", "directory,
  sidebar, and workspace controls") to read sidebar selectors from
  the surface file. New extraction guard pins six classes plus the
  collapsed-state selectors and asserts `index.html` loads the
  surface before legacy styles.css.
- 2026-05-03: Extended `styles/surfaces/sidebar.css` with the rail
  body / list family: `.sidebar-body`, `.sidebar-footer` (+ anchor
  resting + `:hover`), `.sidebar-list`,
  `.sidebar-list.session-list-panel`, `.task-list-panel`,
  `.sidebar-list-group`, `.sidebar-list-heading`, and
  `.sidebar-list-cluster`. Two rule-8 duplicate sources collapsed in
  the move: the canonical declared `.sidebar-body { padding: 10px }`
  vs a late `padding: 8px` (8px wins, surface keeps that); canonical
  declared `.task-list-panel { gap: 12px }` / `.sidebar-list-group {
  gap: 8px }` / `.sidebar-list-cluster { gap: 2px }` vs a late
  three-class cluster forcing `gap: 6px` (6px wins, surface
  consolidates). `.sidebar-list-heading` weight dropped from 700 to
  600 — the heading is muted-color + 88% font-size, the kicker reads
  without the heavy weight. `1px` border on `.sidebar-footer` and the
  cancelled `border: none` on the session panel routed through
  `var(--oc-border-width)` / `0 solid transparent`. Bold-weight
  density ceiling tightens to `<= 39`.
- 2026-05-03: Extended `styles/surfaces/sidebar.css` with the
  task-row-mini family: `.task-row-mini` shell, `.task-row-drag-handle`
  (+ draggable hover scope), `.task-row-main` (+ `strong` typography),
  `.task-row-head` (+ nested `.mini-badge`), `.task-row-meta`,
  `.task-row-stamp`, `.task-row-badge` (+ `::before` dot + four
  `[data-status]` tone variants + cancelled/idle muted color +
  sr-only `-text` clipper). The badge dot's `border-radius: 999px`
  literals route through `var(--oc-radius-pill)`; the sr-only clipper's
  1px sizing scales through `calc(Npx * var(--ui-scale))`. Note: late
  dupes at styles.css ~11506 / ~11514 / ~11520 / ~11525 / ~11848+
  still partially redeclare `.task-row-main` / `-main strong` /
  `-meta` / `-badge` shapes — those are tracked rule-8 violations to
  fold into the surface canonical in a follow-up. Extraction guard
  verifies surface ownership of eight task-row classes plus the
  `::before` dot, four status-tone variants, and the draggable-handle
  compound selector.

- 2026-05-03: Canonicalized the directory/sidebar/workspace control
  chrome behind `--oc-control-*` tokens. `.task-dir-shell`,
  `.task-cwd-dropdown`, `.sidebar-toolset`, `.sidebar-tool`, and
  `.workspace-toggle` no longer appear in any `body[data-theme]`
  selector, so themes cannot change their margin, border, radius,
  background, hover chrome, or shadow. The guard now rejects any future
  theme selector that targets this control family and pins the canonical
  radius/border/background declarations. Guard ceilings drop to
  `!important <= 138`, `body[data-theme] <= 69`, and theme
  layout/chrome overrides `<= 33` after the guard now strips comments
  before counting real declarations.
- 2026-05-03: Removed `.chat-send` and `.chat-send:hover` from the
  remaining theme reset `:is(...)` chains. This does not move the
  coarse `body[data-theme]` count because the reset blocks still serve
  other unmigrated buttons, but it closes the runtime double-source gap
  for the composer send button: the only rendered background, border,
  spacing, hover, disabled, and focus behavior now comes from
  `styles/surfaces/composer.css`. The composer guard now scans every
  theme selector, including grouped `:is(...)` selectors, and fails if
  `.chat-send` reappears there. The theme-layout counter now strips
  comments before scanning so historical explanation text no longer
  counts as live CSS debt.

## Pause Checkpoint — 2026-05-03

Paused at branch `codex/opencode-upstream-infra-adapt`, HEAD
`5a707e301` (`refactor(overlay): extract chat-empty task-state children
to conversation surface`). That latest local commit continues the
Conversation surface extraction by moving task-state children out of
runtime God CSS into `styles/surfaces/conversation.css` with an
architecture guard update. The refactor is not complete and the God CSS
archive rule remains active: God CSS may be retired from runtime imports
and archived as reference-only backup, but must not be physically
deleted.

Latest verified state before pause:

- Architecture guard: `bun test packages/overlay/test/overlay-architecture-guards.test.ts`
  passed with 70 tests.
- SSE refresh/reconnect guard: `bun test packages/overlay/test/events-refresh.test.ts packages/overlay/test/sse-reconnect.test.ts packages/overlay/test/auth-change-stream.test.ts`
  passed with 14 tests.
- Overlay typecheck: `bunx tsc --noEmit -p packages/overlay/tsconfig.json`
  passed during the final active slice.
- Docs and i18n: `bun run docs:check` and `bun run --cwd packages/overlay check:i18n`
  passed; pushed commits also passed pre-push typecheck, route, docs,
  i18n, and secret-scan hooks.

Known dirty files at pause that are not owned by this checkpoint
commit:

- `CLAUDE.md`
- `packages/overlay/src/utils/time.ts`
- `packages/opencorvus/script/benchmark/assets/web-calculator-request.txt`
- `packages/opencorvus/script/overlay-snap.ts`
- `packages/overlay/script/iter-shots/`
- `specs/chat ui.png`

Do not revert or include those files unless the next user request
explicitly owns them.

Resume TODO, in order:

1. Start with `git status --short --branch`, `git log --oneline -8`,
   and `git pull --ff-only` if origin has advanced.
2. Re-run the focused overlay guard before editing if another agent
   has pushed new UI work.
3. Continue the Conversation surface extraction from the current
   boundary: move the richer `.chat-empty--task` task-aware empty
   state and its status subparts into `styles/surfaces/conversation.css`,
   convert raw `rgba()`/hex chrome to palette-token `color-mix()`,
   remove the matching `body[data-theme]` overrides in the same commit,
   and extend the conversation guard to reject theme selectors for
   `.chat-empty--task`.
4. Retire remaining theme reset clusters by whole surface families,
   not one selector at a time: board intro / section / gwg surfaces,
   primary button siblings (`.sidebar-btn-primary`, `.btn-primary`,
   `.board-intro__cta-action`), badges, executor menu, and settings
   navigation.
5. Keep SSE refresh as a standing regression target for any work that
   touches event, selected-task, sidebar refresh, or task-list surfaces.
6. Do not collapse `main.tsx`'s 18 mount points or remove runtime
   `styles.css` until the active CSS has moved into tokens,
   primitives, surfaces, and palette-only themes with guards proving no
   runtime double source remains.

> 现在的 css 和面板源码太臃肿了，形成了 god module，极其难以维护，
> 也造成设计语言的统一和覆盖难题。我需要重新抽象 UI/UX，打散
> CSS 和面板组件。你觉得最大的问题在哪儿，应该如何设计方案？

Latest user clarification:

> God CSS 只能存档不能删除，作为备份参考。最终目的是设计语言统一，
> 例如不要圆角和非圆角大范围混用，各个栏 header 要统一风格，
> 不要大小不一、形式各异。必须彻底根除所有技术债，不留后患。

Latest execution clarification:

> 不要拖节奏，浪费时间。Claude Code 会与 Codex 一起工作。

Implication: future iterations should prefer larger surface-level
retirements over one-selector cleanup when the risk is bounded by tests.
Parallel agents must coordinate through this document and git history rather
than starting independent rewrites of the same surface.

This doc is the active implementation contract for the overlay
UI/UX refactor. It is not only a file-layout cleanup. The end
state must make design language enforceable: one set of
primitive shapes, one header grammar, one spacing/density scale,
one theme contract, and no runtime God CSS path left behind.

## Quantified current state

| Dimension                              | Value                                                                                   |
| -------------------------------------- | --------------------------------------------------------------------------------------- |
| `packages/overlay/src/styles.css`      | **12,327 lines** and still on the runtime path                                          |
| `packages/overlay/src/styles/card.css` | **1,568 lines**                                                                         |
| Total `!important` in stylesheets      | **138** current guard baseline                                                          |
| `body[data-theme="…"]` theme overrides | **69**                                                                                  |
| Theme layout/chrome overrides          | **33** current guard baseline                                                           |
| `packages/overlay/src/main.tsx`        | **1,621 lines + 18 independent Solid mount points**                                     |
| Largest 5 components                   | Board 857 / ProvidersPanel 819 / SkillMarketPanel 649 / TaskList 648 / ChatComposer 553 |
| Total `.tsx` LOC under `packages/overlay/src` | **14,074**                                                                      |

Early single-source iters proved the per-selector teardown discipline.
The current baseline is materially lower, but the same rule still holds:
each migrated selector must leave a testable single owner and must not
rely on theme-scoped chrome or `!important` defenses.

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

## Parallel Agent Coordination

Codex and Claude Code may now work on the refactor at the same time. The
coordination rule is file/surface ownership per commit, not hidden runtime
fallbacks or temporary duplicate implementations.

Required workflow for both agents:

- Start each slice with `git status --short` and inspect the latest commits
  on the current branch before editing.
- Own a named surface or file set for the slice. Do not edit another agent's
  active surface unless the previous commit is already pushed and the new slice
  explicitly builds on it.
- Keep unrelated dirty files out of commits. Current known unrelated files
  include `packages/overlay/src/utils/time.ts`,
  `packages/opencorvus/script/overlay-snap.ts`,
  `packages/overlay/script/iter-shots/`, and `specs/chat ui.png`.
- Prefer whole-surface retirement when tests bound the risk: move a complete
  selector family from theme/God CSS into canonical primitive or surface CSS,
  then delete the old runtime selector path in the same commit.
- Every implementation slice must update this progress log when it changes
  architecture, guard ceilings, theme behavior, mount structure, or known
  debt inventory.
- Every slice must run the relevant targeted tests, the architecture guard,
  docs check when this file changes, and push without bypassing hooks.

## Slice direction: extract, do not just fold

The end state is `packages/overlay/src/styles.css` removed from the
runtime import graph and archived. Every slice should therefore aim to
**move rules out of `styles.css` and into the new tree** (`styles/
{tokens,primitives,surfaces,themes}/*.css`), not merely tighten or
consolidate rules in place. Internal folds (deduplicating selectors,
canonicalizing values, retiring `body[data-theme]` overrides) remain
useful — but only as preparation for an extraction. A slice that only
collapses rules inside `styles.css` without advancing the extraction
boundary should be the exception, not the default.

Concrete heuristic for picking the next slice:

1. Identify a surface family whose rules are mostly self-contained
   (titlebar, composer, sidebar tree, sections inspector, settings shell).
2. Confirm canonical rules already use palette tokens (do internal
   token folds first if needed).
3. Move the rule set verbatim into the matching `styles/surfaces/*.css`
   file (or create a new one), update `index.html` to load it after
   `styles.css`, delete the rules from `styles.css`, and add a guard
   asserting both that the surface file owns the rules and that the
   matching `styles.css` selectors are gone.
4. The architecture guards (`!important`, `body[data-theme]`, theme
   chrome overrides, bold-weight density) drop naturally as rules
   leave `styles.css` and the new files stay palette-token clean.

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
