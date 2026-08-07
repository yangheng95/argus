# Overlay Primitive System Convergence

Status: capsule-control follow-up implemented, visually verified, and ready for delivery

## Follow-up Recall — capsule control convergence

| Item | Detail |
| --- | --- |
| User requirement | “现在所有的按钮都不合格，跟药丸形状的开关不是一个体系，对于药丸体系的控件，现在要怎么改？”并要求“继续完善”。 |
| Acceptance | 普通 action 使用 capsule；icon action 使用 circle；segmented/toggle 使用 pill shell；navigation row 与 suggestion tile 明确为容器 recipe，不能被粗暴改成长药丸。Button、Switch、Select、TextField 和 segmented control 共享高度、边框、状态与 focus 语言；真实桌面浅/深色截图通过。 |
| Hard constraints | 不新增任意 feature shape 自由度，不通过 `data-ui` 继续改 control 圆角，不把导航行/卡片误归类成 pill；不操作用户运行中的 overlay；Playwright 继续由 Node sidecar 启动；提交使用 `dsw-33987` 并 push `myhexin/v0.0.7beta`。 |
| Sources reread | 当前 Vite 首页；`components/ui/Button.tsx`；`styles/primitives/{button,selection-control,text-field,tabs}.css`；design-language tokens；全部 surface button/radius owners；本记录前序 primitive/icon 验收。 |
| Whole-repository grep | 171 个 JSX Button mounts；5 个 generated HTML Button escapes，均已有 `oc-button` recipe attributes；12 个 surface CSS 文件仍在 `.oc-button` block 中声明圆角；全 surface 有 97 个 pill、50 个 large、119 个 soft radius 声明；118 个测试文件覆盖 Button/圆角相关契约。 |
| Runtime evidence | 当前首页同屏存在 titlebar `22×22/r4`、menubar `22/r8`、workspace search `30/r8`、sidebar row `36/r8`、composer attachment `32/r999`、intent/model `32/r8`、send `38/r999`、suggestion tile `228×108/r8`。Switch primitive 是 `40×24/r999`。这证明缺陷是 shape responsibility 分散，而不是单一颜色或 token 数值错误。 |
| Independent agent feedback | None；用户未要求子 Agent，当前协作规则禁止主动委托。 |
| Git baseline | `fcb930ee3`，与 `myhexin/v0.0.7beta` 一致；仅有未跟踪构建产物 `packages/overlay/dist-artifacts/darwin-arm64/`，禁止纳入交付。 |

### Follow-up causal chain

1. **Observable:** 开关形成完整 capsule，但按钮在同一控制层呈现 4px、8px、pill 三套形状与 22/30/32/36/38px 多套密度。
2. **Direct trigger:** Button primitive 默认 `--oc-radius-large`，feature surfaces 再通过 class、`data-ui` 和局部变量覆盖高度/圆角。
3. **Deep cause:** `size` 只表达机械尺寸，没有关闭 control 与 container 的形状责任；导航行、tile、icon action 和 ordinary action 都复用同一无语义 shell。
4. **Root repair:** primitive 根据封闭 recipe 投影 capsule/circle；navigation/tile 通过明确的容器 recipe 保持非 pill；surface 只能布局，不能重写 control geometry。

### Follow-up implementation batches

1. 在 primitive token/recipe 中统一 compact 24px、standard 32px、capsule、circle、focus ring 和 control state；删除 titlebar/composer 等当前桌面面上的局部 shape/height owner。
2. 给 navigation row 与 suggestion tile 明确 primitive-owned container recipe，防止普通 Button capsule 规则污染容器交互。
3. 穷举剩余 `.oc-button` radius owner；可复用 control 必须迁移到 recipe，真实 section/header/row/tile 只能保留已命名容器语义。
4. 用当前 Vite 首页、Settings switch/segmented、Composer、Work Ledger、Right Dock 做浅/深色桌面截图和键盘 focus 验收；再跑全量 unit/typecheck/i18n/build/docs。

### Follow-up outcome — capsule control convergence

- `Button` now owns capsule geometry for ordinary actions and circular geometry for icon actions. Compact and standard controls converge on 24px and 32px densities; focus-visible uses one 2px accent ring.
- `TextField`, `SearchField`, `SelectControl`, and single-line inputs use the same capsule language. Multiline textareas retain a large container radius because they are content surfaces rather than one-line controls.
- Added canonical `SegmentedControl`, `ActionTile`, and navigation-row recipes. Settings, Mailbox, and File Changes use the segmented recipe; suggestion cards and navigation rows retain explicit container geometry instead of being misclassified as ordinary pill buttons.
- Removed feature-owned button radius declarations from the current titlebar, Composer, Work Ledger, task progress, settings, workspace, card, and generated directory-action surfaces. Split workspace launchers retain only the primitive-owned joined half-pill geometry.
- Real desktop computed-style evidence at `http://127.0.0.1:4317/` shows titlebar actions, menu triggers, workspace search, Composer controls, selects, send, and diagnostics actions at `border-radius: 999px`. Navigation rows remain `36px/r4` and suggestion tiles remain `108px/r8` by their named container recipes.
- Manually reviewed `.scratch/button-format-light.png`, `.scratch/button-format-dark.png`, `.scratch/chat-composer-button-primitives.png`, `.scratch/settings-segmented-aria-label.png`, and `.scratch/work-ledger-search-icon-compact.png`. Light/dark capsule geometry, selected segments, icon centering, labels, and keyboard focus are visually coherent without clipping.
- Verification passed: `bun run --cwd packages/overlay test:unit`; focused Node Playwright button/Settings/Composer/titlebar paths; `bun run typecheck`; `bun run --cwd packages/overlay check:i18n` at panel revision `8086d1b8b04d6219`; `bun run --cwd packages/overlay build`; and `bun test packages/opencorvus/test/script/historical-docs-links.test.ts` (21 tests).

## Recall

| Item | Detail |
| --- | --- |
| User request | “现在的UI的primitive狗屎一坨，帮我整理问题，定一个goal解决”。补充终态：“最终目标是不存在任何不基于 primitive 的手搓组件和样式。” |
| Goal | 根治 Overlay 基础控件只有统一标签、没有统一视觉与语义的问题；保留 Solid 与现有产品信息架构，以一套 Kobalte-backed primitive catalog、一套 recipe、一个视觉验收矩阵替换并行目录与 surface 私有 chrome。最终全仓不存在脱离 canonical primitive 的手搓交互组件或控件视觉样式。 |
| Acceptance | 桌面首页、Settings、Work Ledger、conversation/composer、dialog/menu 五个代表面必须共享可辨认的一套 control geometry、state、focus、disabled 与 density；primitive gallery 和真实页面均须由 Node 启动的 Playwright 截图并人工复核；键盘、焦点、ARIA（Accessible Rich Internet Applications，无障碍富互联网应用）和现有业务行为回归通过；二次 review 后提交并 push `myhexin`。 |
| Hard constraints | 不新增 gate、fallback、兼容 alias、第二套 design system 或手写 ARIA；不把 Kobalte 这种 unstyled behavior primitive 冒充视觉系统；不创建 worktree；不操作用户正在运行的 OpenCorvus；桌面端单端验收；保留当前未提交的 Notification UI retirement 等用户改动；新提交以 `dsw-33987` 开头。 |
| Sources read | `AGENTS.md`; `specs/current/architecture/07-panel.md`; `2026-06-01-overlay-mature-ui-primitives-refactor.md`; `2026-06-09-overlay-ui-tech-debt-consensus.md`; `2026-07-14-overlay-neutral-codex-chrome-repair.md`; `2026-07-16-codex-settings-button-format.md`; current `components/{ui,primitives,settings/primitives.tsx}` and `styles/{tokens,primitives,surfaces}`; Kobalte official introduction/styling docs; Park UI official Solid overview; Solid styling docs. |
| Whole-repository grep | Production currently has 55 files importing `ui/Button`, 172 `<Button>` mounts, 11 Settings owners importing the Settings composite file, 22 Kobalte-owning source files, and only five raw `<button>` escape hatches. Fifteen surface CSS files contain 500 `--oc-button-*` override declarations; `sidebar.css` alone has 92, `card.css` 82, `conversation.css` 78. Primitive sources are split between `components/ui/*`, `components/primitives/*`, and `components/settings/primitives.tsx`. |
| Visual evidence | Isolated current-source Vite page `http://127.0.0.1:4317/` was inspected in the in-app Browser at the real desktop viewport. Home combines plain sidebar actions, a bordered model capsule, a circular send action, and oversized suggestion-card buttons. General Settings combines a full-width outlined Back action, a separately styled Search field, navigation tabs, a bordered content card, and segmented controls with a second state/chrome language. The existing `button-format-browser.test.ts` passes, proving its computed-style assertions preserve the current design rather than judge cross-surface coherence. |
| Independent agent feedback | None. The user did not request sub-agents; current collaboration rules forbid unrequested delegation. |
| Git baseline | `v0.0.7beta` at `ba6db427b3`, synchronized with `myhexin/v0.0.7beta` at audit start. The worktree already contains broad uncommitted Notification UI retirement changes; primitive source/style directories are clean and must remain separably reviewable. |

## Diagnosis

### Causal chain

1. **Observable:** controls with the same mechanical type do not look or behave like one family across Home, Settings, Work Ledger and Composer.
2. **Direct trigger:** callers pass low-level `variant + size + tone`, then surface selectors keyed by `data-ui`, ancestry and CSS (Cascading Style Sheets) variables rewrite geometry and chrome.
3. **Deep cause:** `Button.tsx` owns only the HTML element and three data attributes. The 500 downstream `--oc-button-*` declarations make every surface a partial primitive author. Kobalte correctly owns accessible behavior but is unstyled by design, so adopting it did not create a visual source of truth.
4. **Why previous work did not close it:** previous records fixed individual screenshots and asserted chosen computed values. They preserved class contracts and local overrides, so each repair improved one surface while retaining the architecture that permits the next surface to diverge.

The root problem is therefore not a lack of primitive libraries. The project already uses the appropriate mature behavior layer. The missing layer is a semantic, closed visual recipe owned by the primitive catalog.

## Current Primitive Inventory and Disposition

| Source | Owners found by repository-wide search | Decision |
| --- | --- | --- |
| `components/ui/Button.tsx` | 55 production owners and `main.tsx`; 172 mounts. Owner groups: app/dialog (`App`, `AppDialogHost`, `ConfigDialogHost`, `GoalDialogHost`, `SessionDialogHost`), message/composer (`ChatBubble`, `ChatComposer`, `Conversation`, `InteractionCard`, `InlineToolPart`, `ReasoningPart`), work/navigation (`WorkLedger`, `ProjectLedgerGroup`, `TaskDirBar`, `TaskProgressBar`, titlebar), workspace/right Dock, file/browser panels, and nine Settings panels. | Keep as the single JSX button authority. Replace mechanical styling freedom with semantic recipes (`primary`, `secondary`, `quiet`, `destructive`, `icon`) and a bounded density axis. Surface CSS may position a button but may not redefine its chrome. |
| `components/ui/{Badge,ArmedConfirmButton,ComboboxControl,FileRow,SearchField,SegmentedControl,SelectControl,SurfaceHeader,Tabs}.tsx` | Badge: `ArchitectPanel`, `IntegrityCard`, `MailboxPanel`; confirm: `ArchivePanel`; combobox: `CommandPalette`; file row: Explorer/Changes; Search: Config, Explorer/Changes, Mailbox/Memory, Expert Squad/Providers; segmented: Changes/Mailbox/Settings; select: App dialog, Composer, Logs, Settings; header: Board/Explorer/Screenshot Browser; tabs: Config/Executor. | Keep under the canonical catalog. Give each one primitive-owned visual states and remove consumer-provided class hooks that currently allow replacement chrome. |
| `components/primitives/AutoGrowTextarea.tsx` | Agent reply, Composer, Goal, Interaction, Providers. | Move to the canonical catalog; retain behavior and metrics, add one field recipe. |
| `components/primitives/CodeEditor.tsx` | File editor. | Move to catalog as the CodeMirror adapter; editor theme remains component-owned. |
| `components/primitives/Dialog.tsx` | App/Command/Config/Goal/Image/Interaction/Log/Session/Channels. | Move to catalog; Kobalte remains the single behavior owner. Split only semantic slots, not another dialog implementation. |
| `components/primitives/Panel.tsx` | Diff Preview and Trace. | Move to catalog and converge with `SurfaceHeader`; panel chrome must not be reauthored by descendants. |
| `components/primitives/Section.tsx` | Board plus acceptance/architecture tests. | Move to catalog; replace direct native disclosure styling only if keyboard/semantics evidence requires Kobalte. |
| `components/settings/primitives.tsx` | Eleven Settings panels. | Rename/reframe as Settings layout composites, not primitives. `SettingsSelect` and `SettingsSegmented` remain thin domain presets of canonical controls; rows/groups/layout do not claim global primitive status. |
| `styles/primitives/*.css` | Canonical CSS entry files. | Keep as recipe owners. Reduce exposed override variables to layout-safe values only. |
| Surface button override owners | `activity.css`, `card.css`, `chat-bubble.css`, `composer.css`, `conversation.css`, `field.css`, `inspector.css`, `mailbox.css`, `markdown.css`, `messages.css`, `settings.css`, `sidebar.css`, `titlebar.css`, `work-ledger.css`, `workspace.css`. | Enumerate every declaration during migration. Preserve layout/placement; replace chrome overrides with a semantic recipe at the JSX owner; delete the old declaration in the same change. |
| Generated HTML button escape hatches | `utils/dom-utils.ts` (directory actions), `utils/markdown.ts` (code copy and image trigger). | Keep generated HTML only where Solid cannot own the subtree; generate the same canonical recipe attributes from one exported non-JSX recipe contract, with no parallel colors/geometry. |

## Goal Contract

**Goal:** one Kobalte-backed, visually closed Overlay primitive system in which feature surfaces select semantic intent and layout only; no feature surface is allowed to become a second author of control chrome.

The goal is complete only when all of the following are true:

1. One catalog path owns all reusable primitives; `settings/primitives.tsx` is no longer presented as a competing primitive catalog.
2. Buttons, fields, selects, segmented controls, tabs, menus and dialogs use semantic recipes with shared geometry/state/focus/disabled rules.
3. The current 500 surface `--oc-button-*` declarations are dispositioned. Layout-only declarations may remain under explicit layout names; visual chrome declarations must be removed rather than aliased.
4. Home, General Settings, Work Ledger, populated conversation/composer, and a dialog/menu state are visually reviewed in both light and dark themes at desktop size.
5. A task-scoped primitive gallery covers rest, hover, active/pressed, focus-visible, disabled, destructive, loading, long text and Chinese text. Screenshots are evidence only after human review; computed-style assertions remain supporting evidence.
6. Keyboard and accessibility tests prove Kobalte remains the owner of popup, listbox, tabs, toggle group, menu and dialog behavior.
7. Overlay typecheck, i18n, Vite build, focused unit/browser tests, docs health and second review pass; task-owned commits are pushed to `myhexin`.
8. 全仓 TSX（TypeScript XML，带 JSX 的 TypeScript）、生成 HTML 和 CSS 调用面逐项归属到 canonical primitive；任何保留的裸元素只承担不可复用的文档语义或布局，不得自行实现交互状态、ARIA、焦点、弹层、选择、按钮、输入框或控件 chrome。

## Implementation Phases

### Phase 1 — Canonical recipe and representative surfaces

- Define the semantic Button and field recipe without changing business behavior.
- Convert Home/Composer and General Settings first because the baseline screenshot exposes their contradictions side by side.
- Add the primitive gallery browser fixture and screenshot matrix before broad migration.

### Phase 2 — Catalog convergence

- Move `components/primitives/*` into `components/ui/*` and update every owner/test listed above in the same commit.
- Rename Settings primitives to layout composites and delete the old primitive naming/source; no re-export alias.

### Phase 3 — Surface override removal

- Migrate the fifteen CSS owners in bounded visual batches: navigation/work ledger; conversation/composer/cards; settings/fields; workspace/right Dock/dialog/titlebar.
- For every removed `--oc-button-*` declaration, choose a semantic recipe or prove it is layout-only and rename it accordingly.

### Phase 4 — Full visual and interaction acceptance

- Run the five real-page scenarios and primitive gallery in light/dark desktop themes through Node Playwright.
- Inspect screenshots, correct visual failures, rerun keyboard/focus state paths and perform an independent second code/diff review in the main agent.
- Commit with `dsw-33987` prefix and push the current main delivery branch to `myhexin`.

## Initial Verification Commands

```sh
bun test packages/overlay/test/button-primitive.test.ts packages/overlay/test/settings-layout-composites.test.ts packages/overlay/test/tabs-primitive.test.ts packages/overlay/test/dialog-primitive.test.ts
node packages/overlay/test/browser-runner.mjs packages/overlay/test/browser/button-format-browser.test.ts
bun run --cwd packages/overlay typecheck
bun run --cwd packages/overlay check:i18n
bun run --cwd packages/overlay build:vite
bun test packages/opencorvus/test/script/historical-docs-links.test.ts
bun test packages/opencorvus/test/script/document-health.test.ts
```

## Rejected Directions

| Direction | Reason |
| --- | --- |
| Add Park UI/Panda next to the existing system | It would introduce a second styling/toolchain source before retiring the first. Park UI is a useful visual reference, not an authorized parallel runtime. |
| Replace Kobalte | Kobalte already supplies the correct accessible Solid behavior layer; the defect is visual ownership, and Kobalte is explicitly unstyled. |
| Add more CSS coverage gates | A selector-count gate would only freeze or police symptoms. The migration deletes the second authors and verifies rendered behavior directly. |
| Fix another isolated screenshot | Previous records prove this yields local improvement while retaining the divergence mechanism. |
| Broad shell rewrite | Primitive ownership can be repaired without changing product information architecture or business state. |

## Implementation Progress

### 2026-07-17 — single catalog convergence

- Moved `AutoGrowTextarea`, `AutoGrowTextareaMetrics`, `CodeEditor`, `Dialog`, `Panel`, and `Section` from the deleted `components/primitives/` directory into `components/ui/`.
- Renamed `components/settings/primitives.tsx` to `components/settings/layout.tsx` and rewrote its contract as Settings-only layout composites over canonical UI controls.
- Updated every production owner and source-level regression in the repository-wide call-site inventory; no compatibility barrel, alias, fallback import, or old source path remains under `packages/overlay/src` or `packages/overlay/test`.
- Verification passed: 163 focused assertions, Overlay TypeScript, i18n, and the production Vite build (2,460 modules transformed).
- Real isolated desktop review passed for Home and General Settings. This batch is intentionally structure-preserving, so the screenshots remain visually unchanged while proving the moved Kobalte Dialog, Tabs, segmented controls, fields, and Composer render through the canonical catalog.
- A broader 320-test diagnostic run reported 15 failures in concurrently dirty window-size, architecture-guard and resize fixtures. The focused catalog tests and typecheck prove no failure in the moved sources; the broader failures remain unclaimed until their current dirty owners settle or are root-repaired in later goal work.

### 2026-07-17 — canonical Tooltip ownership

- Added `components/ui/Tooltip.tsx` as the only Kobalte Tooltip adapter and `styles/primitives/tooltip.css` as the only reusable Tooltip surface recipe. `Content` always applies `.oc-tooltip`; callers may arrange domain copy but cannot recreate border, radius, background, foreground, shadow, or stacking chrome.
- Migrated all six feature owners (`CardHeader`, `CardHeaderChrome`, `ConversationAgentRail`, `ExecutorSelector`, `SidebarVersionLabel`, and `WorkLedger`) away from direct `@kobalte/core/tooltip` imports. Repository-wide regression coverage proves no feature source imports the behavior package directly.
- Deleted the duplicated card metadata and Agent rail Tooltip surface chrome. Their remaining surface selectors only own domain content layout and bounded dimensions.
- Concurrent Mailbox work exposed a newly introduced raw item `<button>` during the global Button ownership test. It now renders through the canonical `Button`; the Mailbox stylesheet retains row layout only and no longer reimplements appearance, focus, border, background, font, or cursor behavior.
- Browser fixtures now model the Mailbox startup dependency explicitly, so UI tests retain clean console/network evidence instead of accepting new 404 noise. The Agent rail fixture also matches the current visible-tick token contract and proves hover still increases width without changing thickness.
- Verification passed: 28 focused primitive/owner tests, Overlay TypeScript, production Vite build (2,462 modules), and three Node Playwright browser paths for card metadata focus, Agent rail hover, and sidebar version hover.
- Manually inspected `.scratch/sidebar-version-tooltip-hover.png`, `.scratch/card-header-metadata-tooltip-focus.png`, and `.scratch/conversation-agent-rail-hover-context/input-output-tooltip.png`. The three density variants share border/radius/elevation/type chrome; the long Agent rail tooltip remains left of the transcript, card rows remain legible, and the compact sidebar tooltip does not obscure navigation.

### 2026-07-17 — canonical Popover ownership

- Added `components/ui/Popover.tsx` as the only Kobalte Popover adapter and `styles/primitives/popover.css` as the single reusable disclosure-surface recipe. Feature content may own dimensions, overflow, padding and internal layout; border, radius, outline, background, foreground, elevation and stacking belong to `.oc-popover`.
- Migrated every direct Popover owner: `ExecutorSelector`, `TaskDirBar`, and `TitlebarBrandGuide`. No production feature source imports `@kobalte/core/popover` directly.
- Deleted duplicated surface chrome from `.executor-popover`, `.project-runtime-panel-shell`, and `.brand-guide-card`. The runtime panel browser assertion now measures the actual Popover Content instead of its retired inner surface, preventing a visually duplicated shell from returning.
- Routed the brand guide trigger through canonical `Button` and removed its hand-written appearance, pointer, focus, border, background, shadow, typography, height and padding rules. The feature stylesheet retains only titlebar placement and text composition.
- Updated the shared TaskDirBar and brand browser fixtures for the Mailbox startup dependency. This preserves strict console/network acceptance without filtering or accepting 404 noise.
- Verification passed: 74 focused primitive/owner tests, Overlay TypeScript, i18n revision `09b320cecaefbfdb`, production Vite build (2,464 modules), and Node Playwright paths for the Executor picker, titlebar brand guide and project runtime environment panel.
- Manually inspected `.scratch/titlebar-brand-guide-popover-1280.png`, `.scratch/task-dirbar-runtime-status-panel-merged.png`, and `.scratch/executor-selector-current-model-listbox.png`. All three share one surface language while remaining within the desktop viewport; the runtime hierarchy, executor highlighted row and long brand copy remain legible without clipping or secondary surface borders.

### 2026-07-17 — canonical Dropdown Menu ownership

- Added `components/ui/DropdownMenu.tsx` as the only Kobalte Dropdown Menu adapter and `styles/primitives/dropdown-menu.css` as the single reusable menu surface, item, highlighted, disabled and separator recipe.
- Migrated all five direct owners (`ChatComposer`, `ProjectLedgerGroup`, `RightDock`, `TerminalPanel`, and `WorkspaceSplitLauncher`) away from direct `@kobalte/core/dropdown-menu` imports. Separators and behavior slots now come from the canonical adapter rather than feature-authored markup.
- Deleted duplicate menu surface chrome and common item behavior from Composer, Sidebar, Conversation and Workspace surface styles. Feature selectors retain only domain layout, bounded dimensions and semantic danger/icon color where required.
- Updated browser fixtures for the real Mailbox startup dependency and strengthened the project action menu assertion to prove every row resolves to the same 32–34px canonical density rather than preserving the former 34px local exception.
- Focused primitive/owner tests, Overlay TypeScript, i18n revision `870bc559da2fe039`, production Vite build (2,466 modules), and five Node Playwright menu paths passed during implementation; the final regression run is recorded by the delivery commit.
- Manually inspected `.scratch/composer-plus-runtime-menu.png`, `.scratch/project-actions-secondary-menu-surface.png`, `.scratch/right-dock-add-menu-open.png`, `.scratch/terminal-profile-menu.png`, and `.scratch/workspace-editor-file-manager-option.png`. Light/dark surfaces share border, radius, elevation, typography, item density and disabled treatment; icon/text baselines are aligned and no menu clips its content or viewport.

### 2026-07-17 — canonical Listbox ownership

- Added `components/ui/Listbox.tsx` as the only Kobalte Listbox adapter and `styles/primitives/listbox.css` as the single reset, density, hover, keyboard-focus, selected and disabled recipe. Density is explicit rather than caller-authored: normal options use the shared 32px control height and rich two-line mention options use 44px.
- Migrated all three direct owners (`ComposerMentionMenu`, `ExecutorSelector`, and `FileChangesView`) away from `@kobalte/core/listbox`. The file changes list composes Listbox behavior with the existing canonical `FileRow` visual primitive rather than creating another row implementation.
- Deleted feature-authored Listbox chrome from Composer and Changes surfaces. Executor retains only provider grouping and label truncation; model option reset, padding, row height, hover, focus and selected state now come from the canonical primitive.
- Reused the canonical Popover surface recipe for the Composer mention popup and removed its duplicate border, radius, background, shadow and stacking declarations.
- Repaired two browser fixtures exposed by the real Mailbox startup dependency: the mention fixture switches theme without reloading and aborting healthy SSE connections, while the file changes fixture supplies the Mailbox contract and reissues the explicit diff request before asserting its visual state.
- Verification passed: 76 focused primitive/owner assertions, the focused architecture ownership assertion, Overlay TypeScript, i18n revision `f871ce190ce594d4`, production Vite build (2,468 modules), 77 docs-health assertions, and Node Playwright paths for Composer mentions, Executor models and File Changes keyboard/filter/diff behavior.
- Manually inspected light/dark Composer mention screenshots, current/keyboard-highlighted Executor model screenshots, and three File Changes list states. Rich and normal densities are internally consistent, focus and selection remain distinguishable, text/icon baselines align, and no option content clips.

### 2026-07-17 — canonical Context Menu ownership

- Added `components/ui/ContextMenu.tsx` as the only Kobalte Context Menu adapter. Its content, items and separators compose the existing canonical menu recipe, so context menus and dropdown menus share one border, radius, elevation, density, focus, disabled and separator language instead of maintaining visually parallel implementations.
- Migrated the sole direct owner, `FileExplorerPanel`, away from `@kobalte/core/context-menu`. The File Explorer stylesheet now retains only fixed positioning, bounded width, two-line domain content layout and destructive semantic color; it no longer owns reusable menu chrome or interaction states.
- Strengthened the real browser fixture instead of filtering failures: Mailbox startup endpoints are modeled, the server-sent event stream remains durably open, multi-selection dispatches an actual control-modified mouse event across platforms, and outside-dismiss clicks a non-titlebar point.
- Verification passed: 10 focused primitive/owner tests with 460 assertions, Overlay TypeScript, i18n revision `f871ce190ce594d4`, production Vite build (2,469 modules), 77 docs-health assertions and the full Node Playwright File Explorer accessibility path. The browser path covers right-click opening, outside dismissal, separators, disabled rows, keyboard-visible menu state, multi-select detail text, create/rename/copy/move/delete dialogs and drag-and-drop behavior.
- Manually inspected `.scratch/file-explorer-context-menu.png` and `.scratch/file-explorer-context-menu-multiselect.png`. Single- and multi-selection menus use the same panel geometry, row rhythm and typography; destructive and disabled meanings remain distinct, helper text is legible, and neither surface nor content clips against the desktop viewport.

### 2026-07-17 — canonical Slider ownership

- Added `components/ui/Slider.tsx` as the only Kobalte Slider adapter and `styles/primitives/slider.css` as the single owner of reusable track, fill, thumb, focus and disabled-state chrome.
- Migrated the sole direct owner, `ChatComposer`, away from `@kobalte/core/slider`. Composer retains only the parallelism form layout, heading typography, explanatory copy and popup dimensions; it no longer implements Slider interaction visuals.
- Corrected stale density tests that still required Composer to duplicate canonical Dropdown Menu font/background declarations. Those assertions now inspect the actual Dropdown Menu and Slider recipes, preserving single-source ownership instead of reintroducing surface overrides to satisfy an obsolete test.
- Verification passed: 18 focused primitive/Composer tests with 138 assertions, Overlay TypeScript, i18n revision `82b60912499e606e`, 77 docs-health assertions and the Node Playwright Composer resize/runtime-control path. The browser path built 2,471 modules and proved popup opening, pointer selection, keyboard adjustment, committed config changes and continued unattended-toggle behavior.
- Manually inspected `.scratch/composer-parallelism-slider.png`. The nested popup remains within the desktop viewport; title/value baselines, track/fill/thumb geometry, focusable control scale and explanatory copy are legible and consistent with the surrounding canonical menu surfaces.

### 2026-07-17 — canonical Menubar ownership

- Added `components/ui/Menubar.tsx` as the only Kobalte Menubar adapter. Content, item, radio-item and separator slots compose the same canonical menu recipe as Dropdown Menu and Context Menu; the shared recipe now also owns checked-row treatment.
- Migrated `TitlebarMenubar` away from direct `@kobalte/core/menubar` use and deleted its second implementation of panel border/radius/background/elevation, common item density/reset/highlight/disabled behavior, separators and theme-radio chrome. Titlebar CSS retains only menu dimensions/scrolling, trigger placement, group/copy layout and theme swatches.
- Replaced the remaining native Zoom `input[type=range]` with the canonical Slider. A real screenshot review found that the inherited two-column theme grid and horizontal Zoom layout clipped “VS Code Dark” and the Zoom description; theme rows now use a single canonical column and Zoom uses a content-driven two-tier label/track layout. Browser assertions explicitly reject label and description overflow.
- Updated the titlebar browser fixture to the current RightDock architecture instead of the deleted SideActivityToolbar DOM, modeled Mailbox startup and durable event streams, and limited accepted `ERR_ABORTED` failures to teardown of the two known server-sent event streams. Theme validation now clicks real radio items and waits for palette transitions rather than mutating theme datasets.
- Verification passed: 28 focused ownership tests with 406 assertions, Overlay TypeScript, i18n revision `82b60912499e606e`, 77 docs-health assertions and all five Node Playwright titlebar paths. The browser run built 2,472 modules and covered fourteen desktop width/locale combinations, real theme changes, Alt access keys, radio/Slider focus, no-project startup, project close and current RightDock/resizer behavior.
- Manually inspected `.scratch/titlebar-view-radio-focus.png`, `.scratch/titlebar-view-zoom-range-focus.png` and `.scratch/titlebar-help-sidebar-font-parity.png`. Menu surfaces now share canonical density/chrome, all theme and Zoom copy is visible, focus/checked states are distinct, and the light Help menu preserves sidebar typography parity without clipping.

### 2026-07-17 — canonical Checkbox and Switch ownership

- Added `components/ui/Checkbox.tsx` and `components/ui/Switch.tsx` as the only reusable Kobalte-backed boolean selection controls, with `styles/primitives/selection-control.css` owning their geometry, checked, focus and disabled chrome. The Checkbox indicator reuses the canonical `check` icon rather than drawing a parallel glyph.
- Migrated immediate Settings booleans in General, Network and Channels to `Switch`; migrated File Changes filtering and Expert Squad replacement confirmation to `Checkbox`. Settings no longer contains visible native `type="checkbox"` controls or its two hand-written switch implementations.
- Preserved controlled rollback semantics in General Settings: a failed notification save returns the Kobalte Switch to the persisted value without direct DOM mutation. The real fail-fast browser path clicks the visible control and proves that rollback.
- A screenshot review exposed that focusing the File Changes Checkbox scrolled the entire status row and clipped its first option. The status filters now own their bounded horizontal overflow while the Checkbox remains a fixed sibling; the corrected screenshot keeps the first status visible and the complete checked control visible at the narrow desktop dock width.
- Verification passed during implementation: 48 focused tests with 327 assertions, Overlay TypeScript, real General failure rollback, the full Settings desktop screenshot matrix, and the File Changes filter/diff/keyboard browser path. The browser build transformed 2,479 modules.
- Manually inspected `.scratch/settings-general-light.png`, `.scratch/settings-general-dark.png`, `.scratch/settings-network-light.png`, and `.scratch/file-changes-filter-toolbar.png`. Switches share one 40×24 geometry in both themes, checked and unchecked states remain legible, Checkbox geometry is 16×16 with the canonical indicator, labels align, and the corrected narrow toolbar no longer clips the leading filter after Checkbox interaction.

### 2026-07-17 — canonical Interaction choice ownership

- Added `components/ui/RadioGroup.tsx` as the canonical native radio adapter and extended the shared selection-control recipe with one radio geometry, checked indicator, focus and disabled treatment. The browser remains the single owner of native same-name radio arrow-key behavior; no feature code implements roving focus or selection state transitions.
- Migrated `InteractionCard` single-choice questions to `RadioGroup`/`Radio` and multi-choice questions to the canonical Kobalte `Checkbox`. The feature no longer emits a dynamic raw checkbox/radio branch or authors native input dimensions and accent chrome.
- Kept fieldset/legend grouping and repaired option description ownership: radio and checkbox inputs both retain explicit `aria-describedby` links after composition through their canonical adapters.
- The installed Kobalte 0.13.11 `radio-group` subpath was evaluated first but its emitted declaration file incorrectly applies `typeof` to type-only exports and fails repository TypeScript before application code. The batch therefore uses the browser's mature native radio interaction behind a single adapter instead of adding `skipLibCheck`, patching installed dependencies or rebuilding keyboard behavior.
- Repaired the two real browser fixtures' missing Mailbox startup contracts and durable event streams. No 404, SSE (Server-Sent Events, a one-way HTTP event stream) failure or console filter was accepted.
- Real browser validation covers radio click plus ArrowDown selection, multi-select pointer plus Tab/Space selection, long descriptions, overflow containment and reply behavior. Manually inspected `.scratch/interaction-card/long-content-keyboard-selected.png` and `.scratch/multica-squad-multi-select.png`: single and multiple choices share 16×16 control geometry, selected/focus states remain distinct, descriptions align, and no duplicate user-agent control is visible.

### 2026-07-17 — canonical vertical Tabs recipe and Skill mounts

- Extended `components/ui/Tabs.tsx` with composable feature classes and an explicit `rail` layout variant. Kobalte remains the sole owner of tablist/tab/tabpanel roles, selected state, trigger/content IDs, `aria-controls`, roving focus and manual activation; `styles/primitives/tabs.css` owns the vertical rail control chrome.
- Migrated the Skill mounts agent selector from hand-written Button roles, `aria-selected`, `aria-expanded`, click toggling and surface-authored tab chrome to canonical `Tabs`, `TabList`, `Tab` and `TabPanel`. Clicking an already selected tab no longer collapses a tab interface into an invalid no-selection state.
- The feature stylesheet now owns only the two-column matrix, rich label/count layout and bounded scrolling. Common appearance, border, selected/hover/focus treatment, density, padding, typography and cursor behavior moved to the shared rail recipe.
- Repaired the browser fixture's real Mailbox startup contract and persistent event stream rather than accepting 404/console noise. The keyboard path proves ArrowDown moves focus without changing selection in manual activation mode and Enter commits selection.
- Screenshot review found four projected agents unnecessarily scrolled inside a 170px rail and clipped the first row. The matrix now reserves the measured 250px content height; the browser asserts `scrollHeight <= clientHeight` for the four-row desktop fixture.
- Verification passed during implementation: 10 Tabs ownership tests with 110 assertions, Overlay TypeScript, production browser build (2,299 kB application bundle), and the full Tool/Skill/MCP projection browser path. Manually inspected `.scratch/settings-skill-mounts.png`: all four agent rows are fully visible, selected state aligns with the mounted-skill panel, text/count baselines remain consistent, and no label or panel content clips.

### 2026-07-17 — canonical Terminal session Tabs

- Wrapped the Terminal toolbar and live xterm viewport in canonical `Tabs`; session selectors now use `TabList`/`Tab` and the persistent xterm host is the real `TabPanel`. Its dynamic value tracks the active PTY (Pseudo Terminal, a programmatic terminal device) while `forceMount` preserves the mature xterm instance and stream lifecycle.
- Deleted feature-authored tablist/tab roles, `aria-selected`, active wrapper state, pill border/background, focus ring, button reset, typography and cursor rules. The shared Tabs/Button recipes own session selection, focus, density and close-action chrome; Terminal CSS retains only toolbar, overflow, label truncation and close-button placement.
- Standardized the session trigger to the canonical 32px medium control density instead of the former local 38px pill. The real browser assertion now measures that shared density and the zero-radius strip recipe rather than preserving the retired exception.
- A screenshot initially retained focus on the Add menu trigger because Kobalte correctly restores trigger focus asynchronously after Escape and the fixture raced it with programmatic xterm focus. The path now waits for restoration, then moves focus to the real xterm textarea and waits two animation frames before capture; assertions prove the Add button is no longer `:focus-visible`.
- Verification passed during implementation: 13 focused Terminal/Tabs tests with 170 assertions, Overlay TypeScript, live PTY output/input and profile-menu browser behavior. Manually inspected `.scratch/terminal-reference-visual-parity.png` and `.scratch/terminal-profile-menu.png`: the session row uses canonical tab density, the Add action no longer shows stale focus, terminal text remains readable, and toolbar/viewport content does not clip.

### 2026-07-17 — RightDock Tabs migration design

- Full-repository call-site review found one remaining hand-written tab system: `RightDock.tsx` authors `tablist`/`tab`/`aria-selected`, nests a role-button close control inside each tab button, and styles its own selected/focus/density chrome. Its ten mounted tool bodies are created in `main.tsx`; `workspace.css` separately hides them through a manually written `data-selected="false"` projection.
- The canonical mapping is one controlled `Tabs` root around the dock header and body, one `TabList`/`Tab` trigger set, and ten force-mounted `TabPanel` bodies. The existing `centerWorkbenchPanels` signal remains the only selection source. Kobalte owns trigger/content IDs, ARIA, manual keyboard activation and `data-selected`; the imperative main effect retains `data-open` and diagnostic `data-active` only, neither of which owns selected chrome.
- Close controls become sibling canonical icon `Button`s inside a non-interactive layout shell, removing invalid nested interaction. Overflow measurement moves to that shell so it includes the close-action footprint; overflowed triggers remain absent from keyboard navigation and are selected through the existing canonical dropdown menu.
- Feature CSS may retain only dock grid, overflow positioning, label truncation and close-action placement. Shared Tabs/Button recipes own density, typography, selected/hover/focus colors, borders, radii and cursor behavior. Browser validation must cover trigger/content ARIA linkage, Arrow-key focus with manual Enter activation, close focus behavior, overflow, empty launcher, light/dark screenshots and mounted browser/terminal preservation.

### 2026-07-17 — canonical RightDock Tabs implementation

- Replaced the remaining hand-authored RightDock `tablist`/`tab`/`aria-selected` surface with canonical `Tabs`, `TabList`, `Tab` and ten force-mounted `TabPanel` bodies. Kobalte now owns trigger/content IDs, roles, `aria-controls`, `aria-labelledby`, manual activation and selected visibility; `main.tsx` no longer writes `dataset.selected`.
- Converted each invalid nested role-button close affordance into a sibling canonical icon `Button`. Pointer and keyboard events stop at the close-action boundary so the surrounding roving tab collection cannot reinterpret a close as selection. RightDock CSS now owns only shell overflow, label truncation and close placement; selected/focus/hover/density/typography come from Tabs and Button primitives.
- Removed RightDock-local 26px add/close overrides, button resets, radii, hover fills, typography and the 40px empty-launcher recipe. Add/close use the canonical icon-action contract, More uses the canonical small text control, and empty launch actions use canonical medium Buttons. Real geometry asserts the icon buttons equal `--oc-density-icon-button` instead of another feature number.
- The first dynamic-add browser run exposed a Kobalte collection race: controlled selection could advance before the newly mounted trigger registered, causing Kobalte to restore the prior key. RightDock now keeps the finite catalog trigger collection mounted and disables/hides closed items while projecting opened items in business order. This preserves one business selection source and avoids timers, retries or duplicate selected state.
- Closing Review exposed a deeper pre-existing responsibility error: RightDock selection special-cased Diff through `openDiffActivity`, so a stale collection selection could reopen a just-closed panel. `selectRightDockPanel` now only activates already-open panels; opening remains the responsibility of explicit open/add entry points. The real browser assertion proves the final Diff closes to an empty dock without resurrection.
- Updated all affected browser fixtures to distinguish stable collection membership from `data-open="true"`. The Diff fixture now sends an initial SSE (Server-Sent Events, a persistent server-to-browser event stream) comment before keeping Mailbox events open, preventing a false connection timeout while retaining a real durable stream.
- Verification passed during implementation: 59 focused ownership/Tabs/chrome/panel tests with 795 assertions, Overlay TypeScript, the two-test RightDock desktop visual flow, five Menubar/layout browser paths, the Review/Diff navigation path, and both File Explorer browser paths. The File Explorer fixture now distinguishes a closed stable trigger from an open tab and uses the canonical Escape dismissal instead of treating its excluded full-body ContextMenu trigger as an outside-click target. Manual review of `.scratch/right-dock-empty-centered.png`, `.scratch/right-dock-light-active-tab-layer.png`, `.scratch/right-dock-requirements-tab-only-title.png`, `.scratch/right-dock-many-tabs-stable.png`, `.scratch/right-dock-mailbox-narrow-dark.png`, and `.scratch/right-dock-explorer-toolbar-only.png` found consistent tab/button density, readable active hierarchy, complete overflow content, and no clipping or close-action overlap.

### 2026-07-17 — Disclosure migration design

- Full-repository search found eight direct native disclosure instances plus the canonical `Section` adapter, which is itself still implemented with `<details>/<summary>`. The direct owners are `RequirementsPanel` (spec body), `IntegrityCard` (review report), `Board` (acceptance check/review evidence groups), `LogViewer` (two mutually exclusive detail branches), `ExpertSquadPanel` (local install and technical detail), and `ProvidersPanel` (advanced provider fields). `Board` is the only production owner of `Section`.
- Replace all nine behavior paths with one canonical `Disclosure` composition. Kobalte 0.13.11 `Collapsible` was evaluated first, but its published declarations incorrectly use type-only exports as values; its public `src/*` wildcard also cannot be resolved by the repository's TypeScript bundler configuration. The canonical adapter therefore uses native `<details>/<summary>`, leaving toggle semantics and keyboard behavior to the browser instead of adding `skipLibCheck`, a private deep import or hand-written ARIA/state logic. The canonical indicator always uses the registered `chevron` icon, eliminating pseudo-element triangles and the Expert Squad `nav-forward` exception.
- Call-site disposition: Requirements keeps only preformatted spec layout; Integrity maps its existing lazy report render to `onOpenChange`; acceptance evidence keeps `defaultOpen` derived from failing rows and list layout; both Log Viewer branches use the same inline recipe; Expert Squad local/technical disclosures retain install/source grids only; Provider advanced retains its controlled field grid; `Section` becomes a domain composition over canonical root/trigger/content and drops its obsolete `HTMLDetailsElement` ref/imperative-open contract, which has no owner.
- `Disclosure` owns reset, shared density, hover, focus-visible, disabled and expanded indicator treatment through closed semantic variants. Feature styles may retain content grid, padding, overflow and bounded dimensions, but native marker removal, cursor, focus ring, trigger background/border, indicator drawing and open-state chrome must be deleted from surface files rather than aliased.
- Verification must prove native `<details>/<summary>` exist only inside canonical `Disclosure`, no feature source implements disclosure semantics, and no retired feature marker/open selectors remain. Real Node Playwright paths must cover keyboard opening and screenshots for the Acceptance/Requirements rail, Settings provider/expert-squad disclosures, and Log detail at desktop width before delivery.

### 2026-07-17 — canonical Disclosure implementation

- Added `components/ui/Disclosure.tsx` as the only native disclosure adapter and `styles/primitives/disclosure.css` as the single owner of marker reset, shared density, hover, keyboard focus, surface chrome and expanded-indicator rotation. Native `<details>/<summary>` remain browser-owned inside that adapter; no feature implements toggle ARIA, keyboard behavior or state transitions.
- Migrated every inventoried owner: Requirements spec, Integrity report, Acceptance evidence groups, both Log Viewer branches, Expert Squad local install and technical details, Provider advanced fields, and the `Section` domain composition. Production grep now finds `<details>` and `<summary>` only inside the canonical adapter, while `Section` no longer exposes the unused imperative `HTMLDetailsElement` ref contract.
- Deleted the parallel marker triangles, feature-owned focus/hover/open chrome and section typography copies from Inspector, Settings, Workspace and cascade styles. Expert Squad screenshot review exposed one surviving `justify-content: space-between` owner rule that pushed the technical title to the far edge after composition; the rule was removed and the corrected trigger was rerendered with primitive-owned alignment.
- Browser fixtures now satisfy the real Mailbox startup and durable SSE (Server-Sent Events, a persistent server-to-browser event stream) contracts instead of accepting 404 or console noise. Real Node browser paths passed for Acceptance/Requirements, Section focus, Provider Advanced, all four Expert Squad scenarios and Log Viewer. They prove Space/Enter toggling, retained trigger focus, visible focus treatment, indicator rotation and expanded content rendering.
- Manually inspected `.scratch/acceptance-panel-button-owner-desktop.png`, `.scratch/section-summary-focus-visible.png`, `.scratch/provider-advanced-disclosure.png`, `.scratch/expert-squad-market-installed-current.png`, the corrected `.scratch/expert-squad-technical-details-current.png`, and `.scratch/log-viewer-disclosure-expanded.png`. Trigger density and chevron direction are consistent, focus is not clipped, content remains readable, the local-install row stays bounded, and no expanded panel adds a second surface border or clips the desktop viewport.
- Verification passed: 92 focused primitive/owner tests with 483 assertions, Overlay TypeScript, four i18n runtime/policy tests, production Vite build (2,482 modules), 21 historical-doc link tests, 56 document-health tests, and the real browser paths listed above. The Provider directory-contract assertion was updated to match the formatter-stable multiline `updateConfig` call while preserving its directory requirement.

### 2026-07-17 — Text Field migration design

- Full production grep found 28 direct native `<input>` call sites, one actual native `<textarea>` inside `AutoGrowTextarea`, and no direct native `<select>`. Five inputs are non-visible transport controls (Composer file/folder pickers, File Explorer upload, Expert Squad archive import and Goal ID); the remaining 23 visible input paths are split between the internal `SearchField`, App Dialog, Browser Preview address, Channels, Network, Server Connection, Skill/MCP forms and Providers. `AutoGrowTextarea` has six visible owners covering Composer, goal/interaction/reply forms and Provider models.
- The current `.field-input` and `.composer-textarea` surface recipes duplicate appearance, border, background, padding, typography, focus and placeholder chrome; Settings adds a third `#configDialog .field-input` recipe with a different 38px height/radius. `SearchField` is a hand-authored input group and the Browser Preview address owns another complete input recipe. This is the direct source of the height/radius/focus drift, not a call-site naming problem.
- Kobalte 0.13.11 TextField was evaluated first, but its published declarations incorrectly use eight type-only exports as values and fail the repository TypeScript checker before application code is evaluated. The canonical adapter therefore uses native label/input/textarea semantics instead of adding `skipLibCheck`, patching installed dependencies or importing private source paths. Visible labeled fields use a wrapping native label; unlabeled search/address controls retain an explicit accessible label. The adapter exposes Root, Label, Input, TextArea, Description and ErrorMessage slots, while the canonical recipe owns the 32px control density shared with medium Buttons, label/field gaps, border/radius/background/type, placeholder, autofill, focus-visible and disabled/invalid states. Multi-line and input-group variants remain closed semantic variants rather than feature selectors.
- Migrate every visible text input to the adapter in the same batch. `SearchField` and `AutoGrowTextarea` become domain/behavior compositions over canonical TextField slots; the Browser Preview form composes an unlabeled canonical Root/Input using its explicit accessible label. Hidden file/ID inputs remain native because they render no UI and exist only as browser transport mechanisms; their visible launch actions already use canonical Buttons.
- Delete `.field-input`, `.composer-textarea`, `.search-field-input` and Browser-address reusable chrome after the last owner moves. Feature CSS may retain width, grid placement, overflow, domain input-group button placement and Composer's multi-line shell geometry, but it may not author field border, background, radius, height, padding, typography, placeholder, disabled, autofill or focus treatment.
- Verification must combine source ownership tests with real Node browser screenshots for General/Network/Providers Settings, App Dialog, Browser Preview address, SearchField and the auto-growing Goal/Composer paths. At least one path must prove native label activation, disabled/invalid data state, keyboard focus visibility, Button/Input 32px density parity and multi-line scroll behavior after the line cap.

### 2026-07-17 — canonical Text Field implementation

- Added `components/ui/TextField.tsx` and `styles/primitives/text-field.css` as the only visible text-entry adapter and chrome recipe. Root/Label/Input/TextArea/Description/ErrorMessage compose native semantics; medium fields use the same 32px density token as medium Buttons, while the closed small/search/multiline/group recipes own their complete geometry, focus, disabled/invalid, autofill, user-agent reset and scrolling behavior.
- Migrated all 23 visible native input owners plus every visible textarea owner. `SearchField` and `AutoGrowTextarea` now compose the primitive; Browser Preview, App Dialog, Goal, Channels, Network, Server Connection, Skill Market and Providers no longer draw local field chrome. The five remaining raw inputs are hidden file/ID browser transport controls, plus native semantic inputs inside the RadioGroup/TextField adapters; none renders a visible hand-authored control.
- Deleted the retired `.field-input`, `.field-label`, `.field-input-group`, `.search-field-input` and `.composer-textarea` recipes and the Browser Preview address-bar chrome. Surface styles retain only feature layout. Select triggers were normalized to the same 32px control density while remaining owned by the existing Kobalte Select path.
- Browser screenshot review found a stale Memory test fixture that placed SearchField's submit action outside its canonical root, causing false wrapping; the fixture now mirrors the production composition. The new Mailbox startup consumer also exposed incomplete browser fixtures. The shared SSE (Server-Sent Events, a persistent server-to-browser event stream) fixture now emits an initial comment and stays open, while Provider, Settings and Agent reply fixtures model `/mailbox` and `/mailbox/events` instead of accepting 404 noise.
- Real Node browser paths passed for Memory SearchField focus/actions, Settings sidebar and Providers field/Button density, Provider search/filter/add-model textarea, Composer keyboard resize, and Agent reply success/error states. TypeScript and the focused primitive/ownership suites pass. Manually inspected `.scratch/memory-search-field-focus.png`, `.scratch/provider-settings-primitive-owner.png`, `.scratch/provider-models-textarea-primitive.png`, `.scratch/settings-network-dark.png`, `.scratch/app-dialog-select-value-single-source.png`, `.scratch/chat-composer-resize-keyboard.png`, and `.scratch/agent-reply-box-operator-target-error.png`: fields/buttons align at canonical density, focus treatment is visible, labels/radii match, multiline content scrolls without duplicate chrome, and no desktop surface clips.
- `interaction-card-textarea-browser.test.ts` completed its UI assertions and generated inline/dialog screenshots in one run but was not counted as passing: strict teardown observed a Mailbox stream timeout; after the fixture repair a later run observed a normal `/mailbox` GET cancellation during page close. The screenshots were visually reviewed, but this path remains explicitly separate from the passing acceptance set until its teardown race is independently removed.

### 2026-07-17 — Icon semantic and density audit

- Repository-wide source grep proves `Icon.tsx` is the only production SVG/package rendering owner: no feature imports `lucide-solid` or emits an inline `<svg>`. The defect is inside the registry contract, not bypassing call sites.
- The Lucide registry currently has 25 duplicated component groups. Exact aliases include `caret-down`/`chevron-down`, `nav-forward`/`chevron`, `terminal-command-prompt`/`terminal`, `work-task`/`tasks`, `work-chat`/`message`, `pin-tilted`/`pin`, `config-archive`/`archive`, and `config-about`/`info-circle`. These create multiple names for one meaning and let callers choose style-flavoured vocabulary instead of a canonical semantic.
- More serious collisions reuse one glyph for unrelated meanings: `Copy` means both copy and window restore; `Square` means maximize and stop; `Play` means active status and executor; `Globe` means web search and network settings; `BrainCircuit` means expert squad and memory; `ScanSearch` means inspect and Visual QA; `Search` means generic search and frontend research; `Workflow` means mission, orchestrator, expert-squad details and generic workflow. The registry therefore cannot currently enforce the user's one-glyph/one-semantic rule.
- Icon geometry is also falsely parameterized. There are 150 numeric `size` call sites spanning 8, 11, 12, 13, 14, 15, 16, 17, 18, 20, 24 and 40, but `Icon` always sets rendered width/height to the single global `--oc-icon-size` token (14px). The numeric prop only reaches the SVG fallback attribute and does not control computed geometry. This simultaneously preserves meaningless call-site variation and hides intended hierarchy.
- Replace style aliases with canonical semantic names and assign distinct mature Lucide glyphs to genuinely distinct concepts. Add a registry regression that rejects duplicate Lucide components, unused aliases, raw SVG/package imports and unregistered dynamic mappings. Then replace numeric sizing with closed semantic tiers (`compact`, `standard`, `medium`, `large`, `display`) owned by an Icon primitive recipe; all feature call sites must select a tier or inherit `standard`, never author arbitrary pixel sizes.
- Visual verification will cover titlebar/window actions, Settings navigation, Work Ledger kinds/actions, Composer/runtime controls, task status/agent avatars and Browser Preview tools at desktop width. Screenshots must prove semantic distinction, consistent same-level geometry and no clipping after the formerly ignored size intent becomes real.

### 2026-07-17 — canonical Icon implementation and final primitive convergence

- Rebuilt `Icon.tsx` as a strict semantic registry. Removed exact aliases and unused registrations, assigned distinct Lucide components to unrelated concepts, and replaced the window-control misuse of `Square`/`Copy` with `Maximize2`/`PanelsTopLeft`. Zoom controls now use `ZoomIn`/`ZoomOut`; Browser Preview no longer renders raw Unicode as a toolbar glyph.
- Added the closed Icon density vocabulary `compact`, `standard`, `medium`, `large`, and `display`, backed by 12/14/16/20/40px design tokens and the single geometry owner `styles/primitives/icon.css`. All 150 numeric feature call sites were migrated; no production caller may request an arbitrary pixel size. Feature CSS no longer owns SVG width, height, or stroke width.
- Strengthened `flat-redesign-icon-coverage.test.ts` to evaluate the registry rather than match a curated string list. It rejects duplicated Lucide component ownership, numeric Icon sizes, direct Lucide imports, feature-authored SVG geometry, and unregistered/dynamic semantic names.
- Deleted the obsolete Work Ledger sidebar action rail and retained one row-action projection. Right Dock tab-strip height now uses the shared panel-header token. The resulting screenshots show one consistent 14px navigation/action tier, compact 12px loading/search metadata, and canonical icon-button geometry without clipping or overlapping controls.
- Browser review exposed a real cascade ownership bug: Markdown's copied state was visually overridden by the shared icon-action selector. The success state now belongs to `button.css`; the duplicate Markdown success chrome was deleted, and the regression asserts the shared `data-copied=true` contract.
- The final full-suite run also exposed stale event/test contracts rather than visual failures. Mailbox events are now explicit no-card tree-writer inputs because the dedicated Mailbox stream owns their UI; performance/message fixtures use the current agent/session/channel identity contract; window, split-launcher, surface-continuity and i18n fixtures now assert the implemented single-source behavior.
- Real Node Playwright paths passed for Composer buttons, reasoning disclosure focus in light/dark, Markdown copy success/focus, conversation scroll-to-bottom, Memory SearchField focus, and titlebar/Work Ledger/Right Dock icon geometry. Manual review covered `.scratch/chat-composer-button-primitives.png`, `.scratch/reasoning-toggle-focus-light.png`, `.scratch/reasoning-toggle-focus-dark.png`, `.scratch/markdown-code-copy-focus.png`, `.scratch/memory-search-field-focus.png`, `.scratch/conversation-scroll-button-visible.png`, `.scratch/work-ledger-mission-actions.png`, `.scratch/work-ledger-running-loading-icon.png`, `.scratch/right-dock-light-active-tab-layer.png`, `.scratch/right-dock-mailbox-compact-list-light.png`, `.scratch/right-dock-mailbox-narrow-dark.png`, `.scratch/right-dock-many-tabs-stable.png`, and `.scratch/composer-ime-complete.png`. The reviewed desktop surfaces share control density, focus language, icon hierarchy, panel rhythm, and light/dark semantics without a feature-authored visible control.
- Final production ownership grep finds raw interactive elements only inside canonical adapters, generated HTML carrying canonical `oc-button` recipe attributes, and hidden file/ID transport inputs. Remaining surface `> svg` selectors control domain color, alignment, visibility, or animation only; no feature owns reusable icon geometry or stroke.
- Final verification passed with explicit zero exits: complete Overlay unit suite, TypeScript, panel i18n revision `9cd81bc8a426490c`, production Vite build, 21 historical-doc link checks, and 56 document-health checks. `git diff --check` is clean and `HEAD` matches the fetched `myhexin/v0.0.7beta` baseline before delivery.

### 2026-07-17 — component, icon, and color-token single-source follow-up

#### Recall

| Item | Detail |
| --- | --- |
| User requirement | “当前项目中的组件，图标，颜色token等需要统一（参考codex）在primitve中修改，禁止出现多版本”。 |
| Acceptance | Overlay reusable controls and icons have one `components/ui/` catalog; Icon exposes one closed semantic registry, density vocabulary, and registry-owned stroke geometry; feature TypeScript/TSX and primitive/surface CSS contain no raw product colors; light/dark desktop screenshots retain the accepted Codex-neutral visual language; focused/full checks and second review pass. |
| User follow-up | The user explicitly requested that this code not be pushed yet. Remote state must remain unchanged. |
| Hard constraints | Preserve light, dark, and VS Code Dark as theme value variants of one palette-token contract; do not introduce aliases, fallback colors, a second icon renderer, a new UI library, a gate, a worktree, mobile/tablet scope, or a refresh/restart of the user's running OpenCorvus/overlay. Browser acceptance uses Node. |
| Sources reread | This convergence record; `specs/current/architecture/12-overlay-card-system.md`; `2026-07-14-overlay-neutral-codex-chrome-repair.md`; `2026-07-16-overlay-five-surface-codex-polish.md`; `components/Icon.tsx`; `components/ui/*`; `utils/icon-{size,html}.tsx`; `styles/{tokens,cascade,primitives,surfaces}`; icon, token, theme, terminal, and architecture regression tests. |
| Whole-repository grep | 54 production source files import the current root-level Icon contract; no feature directly imports Lucide or authors inline SVG; no caller uses public `IconProps.strokeWidth`; raw color literals occur in exactly six production files: the structural/brand token source, three palette theme variants, the Icon brand-mark registry, and one Terminal fallback. Raw visible interactive elements remain only in canonical UI adapters; remaining feature inputs are hidden file/ID transport controls and generated HTML uses canonical button recipe attributes. |
| Independent agent feedback | None. The user did not request sub-agents; current collaboration policy forbids unrequested delegation. |
| Git baseline | Clean `work-v0.0.8beta-yr-0717` at `edc8e9897`, equal to `myhexin/work-v0.0.8beta-yr-0717`; pre-change push and hook passed. |

#### Causal chain

1. **Observable:** the rendered system is largely converged, but Icon still lives beside feature components, icon size lives under generic utilities, and Terminal can silently substitute a hard-coded selection color.
2. **Direct trigger:** 54 owners import `components/Icon.tsx`; `IconProps` still exposes arbitrary `strokeWidth`; `syncTheme` uses `var(--accent-dim) || #6ea8fe55`.
3. **Deep cause:** the earlier migration closed rendered geometry and semantic names but did not finish catalog location and public API ownership. The runtime fallback also leaves a second color value outside the theme-token contract.
4. **Root repair:** move the Icon renderer and its shared type contract into `components/ui/`, make stroke-width entirely registry-owned, consume only `--accent-dim` in Terminal, and extend existing regression tests to prove the single catalog path and raw-color ownership.

#### Exhaustive call-site disposition

| Owner group | Current call sites | Decision |
| --- | --- | --- |
| App entry and utilities | `src/main.tsx`; `src/utils/status-mapping.ts`; `src/utils/tool.ts`; `src/utils/icon-html.tsx`; `src/utils/icon-size.ts` | Import the canonical `components/ui/Icon` or type-only `components/ui/Icon.types`; move, do not re-export or alias, the old paths. |
| Root feature components | `AgentSessionReplyBox`, `App`, `Avatar`, `Board`, `BrowserPreviewPanel`, `CardHeader`, `CardHeaderChrome`, `CardParts`, `ChatBubble`, `ChatComposer`, `ChatHeaderRightToolbarToggle`, `CommandPalette`, `ComposerMentionMenu`, `ConfigDialogHost`, `Conversation`, `ExecutorSelector`, `FileChangesPanel`, `FileChangesView`, `FileEditorPane`, `FileExplorerPanel`, `GoalGroup`, `ImagePreview`, `InlineToolPart`, `InteractionCard`, `MailboxPanel`, `MemoryPanel`, `ProjectLedgerGroup`, `ReasoningPart`, `RightDock`, `ScreenshotBrowserPanel`, `SideActivityToolbar`, `TaskDirBar`, `TaskProgressBar`, `TaskStatusHeader`, `TerminalPanel`, `TodoListPart`, `TracePanel`, `WindowControls`, `WorkLedger`, and `WorkspaceEditorLaunchers` | Replace only the import path; retain semantic icon names and density tiers. `TerminalPanel` additionally deletes its raw fallback color. |
| Nested features | `settings/ArchivePanel`, `settings/ExpertSquadPanel`, `settings/NetworkPanel`, `settings/ProvidersPanel`, `settings/SkillMarketPanel`, and `titlebar/TitlebarNavigation` | Replace only the import path to the one UI catalog. |
| Canonical UI components | `ui/Checkbox`, `ui/Disclosure`, `ui/FileRow`, `ui/SearchField`, and `ui/SelectControl` | Switch from the parent-level Icon dependency to same-catalog `./Icon`; no wrapper or compatibility export. |
| Tests with path contracts | `flat-redesign-icon-coverage.test.ts`, `focused-popup-surface.test.ts`, `overlay-startup-chrome-parity.test.ts`, `screenshot-browser-panel.test.ts`, `window-control-visibility.test.ts`, `conversation-empty-state-source.test.ts`, `terminal-panel.test.ts`, and `flat-redesign-color-literal-coverage.test.ts` | Update the canonical path assertions and add negative assertions for the retired root Icon/type paths, public stroke override, and raw feature colors. |
| Raw color owners | `styles/tokens/design-language.css`; `styles/cascade/{light,dark,vscode-dark}.css`; `components/Icon.tsx`; `components/TerminalPanel.tsx` | Keep token values, theme variants, and intrinsic third-party brand SVG colors; move the brand registry with Icon; delete the Terminal fallback. No primitive or surface CSS color literal is allowed. |

#### Implementation and verification plan

1. Move `components/Icon.tsx` to `components/ui/Icon.tsx` and `utils/icon-size.ts` to `components/ui/Icon.types.ts`; update every inventoried caller and test without a forwarding module.
2. Remove `IconProps.strokeWidth`; keep exceptional stroke widths private to the semantic registry. Remove Terminal's literal fallback and use the mandatory theme token as its only selection-color source.
3. Strengthen the existing icon, color, and Terminal tests. Run focused suites, the full Overlay unit runner, TypeScript, i18n, production Vite build, and documentation health.
4. Start an isolated task-scoped Vite page, use Node Playwright/browser control to capture and personally inspect representative light/dark desktop surfaces, then correct any visual regression and perform a second diff review.
5. Append the verified result here and retain the reviewed change locally; do not push any remote.

#### Verified result

- `Icon` now has one public catalog entry at `components/ui/Icon.tsx`. Its Lucide and intrinsic-brand registries are private sibling modules, and the size vocabulary lives in `Icon.types.ts`. The retired `components/Icon.tsx` and `utils/icon-size.ts` paths do not exist and no compatibility export was added.
- All 54 production callers now import the canonical UI catalog. The public `strokeWidth` escape hatch is gone; exceptional stroke widths remain registry-owned. Architecture tests reject direct private-registry imports, a second SVG/Lucide renderer, numeric icon sizes, and feature-authored stroke geometry.
- Terminal selection styling now consumes mandatory `--accent-dim` with no literal fallback. The work-details surface replaces raw `white` mixing with the palette's `--surface-strong`. TypeScript/TSX raw-color coverage permits only intrinsic third-party brand artwork, while CSS raw values remain confined to the structural token source and the three theme palettes.
- Real visual verification exposed a pre-existing light-theme regression introduced by the settings/squad merge: `--rail-surface` had drifted from the accepted neutral Codex `rgb(247, 247, 247)` to cold-blue `rgb(241, 245, 247)`, even though the browser contract still required a neutral rail. The single light-palette token and its stale unit expectation now agree on `247/247/247`; no feature override or second palette was introduced.
- The complete Overlay unit runner exits zero after correcting its stale left-rail density assertion. Focused icon/color/theme tests, TypeScript, i18n revision `8086d1b8b04d6219`, production Vite build, 21 historical-doc checks, and 56 document-health checks pass.
- Node Playwright passed the Codex light-theme reference, Composer Button/Icon primitive, and message chronology/expanded-tool paths. Manual review covered `.scratch/light-theme-codex-reference.png`, `.scratch/chat-composer-button-primitives.png`, and `.scratch/message-part-chronology-component.png`; an isolated in-app browser preview also verified collapsed and expanded interaction states without touching the user's running Overlay.
- Per the user's follow-up, no remote push is part of this delivery.
