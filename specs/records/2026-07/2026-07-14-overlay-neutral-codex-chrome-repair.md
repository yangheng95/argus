# Overlay Neutral Palette and Unified Control Chrome Repair

## Recall

| Item | Detail |
| --- | --- |
| User requirement (2026-07-14, verbatim intent) | 这一版 UI 问题很大：任务列表对齐崩了；操作按钮应该无边框且间距不对；配色"跟粑粑一样"（拒绝暖米色）；hover 色竟然比底色更亮；输入框下面的控件没有统一设计语言。用户补充："我让模仿 codex 的风格，画虎不成反类犬"，并提供 Codex 参考截图（`C:\Users\chuan\Downloads\screenshots.png`）与 OpenCorvus 现状截图（`屏幕截图 2026-07-14 004810.png`）。 |
| Acceptance | 浅色主题回到中性灰白（无暖色偏移）；所有 hover/选中反馈都是"比所在底色更暗的中性 wash"，绝不更亮；任务列表选中/悬停高亮覆盖整行（不是行内按钮的局部白块）；所有 icon 操作按钮无边框、无 inset 描边、chrome 一致；composer 底部控件（附件、并行度、无人值守、intent、模型、发送）统一为 Codex 式安静 ghost 控件；真实浏览器截图验收 + 二次 review；相关 bun 测试与浏览器测试更新并通过。 |
| Hard constraints | 只改视觉（样式/断言），不改信息架构、功能、文案、交互流；禁止 fallback/双源/gate；不重启用户正在运行的 overlay（rule 39）；Playwright 用 Node 启动（AGENTS.md）；不创建 worktree；保留其他并发进程的脏改动，只按路径 stage 自己的文件；commit subject 以 `dsw-33987` 开头并 push legacy remote（remote `legacy-remote`）。 |
| Sources read | `AGENTS.md`；`2026-07-13-codex-visual-style-alignment.md`；`packages/overlay/src/styles/{tokens/design-language.css, cascade/light.css, primitives/button.css, surfaces/sidebar.css, surfaces/work-ledger.css, surfaces/composer.css}`；`components/{WorkLedger.tsx, ProjectLedgerGroup.tsx, LedgerRowMainButton.tsx, ChatComposer.tsx}`；`test/{theme-palette-intent,design-density-tokens,workspace-composer-density}.test.ts`、`test/browser/light-theme-reference-browser.test.ts`。 |
| Whole-repository grep | `var(--surface-hover)` 64 处（light/dark/vscode-dark 各自定义 + 14 个 surface 文件引用）；`data-chrome="icon-action"` 组件调用 25 处；`color-mix(in srgb, var(--text-strong) 6%, transparent)` 手写 wash 5 处（sidebar-codex-action、search-toggle、work-row-task-disclosure 等）；`--oc-control-bg-hover` 定义于 design-language.css:227。 |
| Independent agent feedback | 未请求；无子 agent。 |

## 根因链（可观察现象 → 直接触发点 → 深层原因）

1. **配色像粑粑**：`cascade/light.css` 在 1205a1202f 把中性材质坡 (`rgb(244,244,244)`/白) 换成暖米色坡 (`rgb(243,240,235)` 等)。Codex 参考实为中性冷灰白。
2. **hover 更亮**：`primitives/button.css:193` 通用 ghost hover 直接用实色 `--surface-hover`。该实色语义是"比 --surface 暗一档的悬停面"，但按钮常坐在更暗的 rail/bg 上，于是悬停反而变亮；米色主题把这个方向性错误放大到肉眼可见。
3. **任务列表"对齐崩了" + 行内白框**：行主按钮 `LedgerRowMainButton`（ghost `oc-button`）命中同一条通用 hover，得到近白实色背景——高亮只包住行内按钮而非整行，右侧操作图标掉在框外；再叠加时间戳/状态点在 hover 时坍缩换位，视觉上就是对齐崩坏。
4. **操作按钮有边框且不一致**：`button.css:67` 给 `data-chrome="icon-action"` 默认加 `inset 0 0 0 1px` 描边；`.project-group .oc-button[data-ui=…]`（特异度 3）打不过原语选择器（特异度 4），描边显形；`work-ledger.css` 的同类覆盖特异度 4 平手靠加载顺序取胜——同一列表两种 chrome。
5. **composer 控件野路子**：`composer.css` 中并行度控件是"描边胶囊套白胶囊步进器"、无人值守是"胶囊按钮内嵌开关"、intent 选择器透明无框、模型选择器又是描边胶囊、发送键带大投影——五种 chrome 并存。

## Call-site decisions

| Source | Decision |
| --- | --- |
| `tokens/design-language.css` | 新增两个单源 wash token：`--hover-wash: color-mix(in srgb, var(--text-strong) 6%, transparent)`、`--selected-wash: color-mix(in srgb, var(--text-strong) 9%, transparent)`。基于 `--text-strong`，三主题方向自动正确（浅色变暗、暗色变亮）。 |
| `cascade/light.css` | 材质坡整体回中性：bg/rail/chrome `rgb(244,244,244)`、surface/panel/dialog/menu 白、surface-hover `rgb(240,240,240)`（严格暗于 surface 与 rail）、surface-inset `rgb(244,244,245)`、inspector `rgb(248,249,250)`、chat-canvas 白、accent-dim 回 7%。 |
| `primitives/button.css` | 通用 ghost hover 与 window-control hover 的背景改 `var(--hover-wash)`；删除 icon-action 默认 inset 描边（:67-70）与 hover 的 accent inset 描边（:198-202，改 wash + text-strong）。 |
| `surfaces/sidebar.css` | 手写 6% wash 全部替换为 `var(--hover-wash)`；`.task-row-mini:hover` 用 `--hover-wash` 且不再翻 border-color；`[data-active="true"]` 用 `--selected-wash`；`ledger-row-main` 在行内 hover 时背景保持透明（整行反馈单源在行上）。 |
| `surfaces/work-ledger.css` | 同上替换 6% wash；操作按钮几何保留（无边框契约已由原语承担）。 |
| `surfaces/composer.css` | run-control/unattended/intent/model 全部去底色去 inset 描边，hover 统一 `--hover-wash`，focus-within 只保留 accent ring；步进器去内嵌白胶囊；发送键去大投影（保留实心圆）。 |
| 其余 12 个引用 `--surface-hover` 的 surface | 保留：token 语义（"比 surface 暗一档的悬停面"）在中性坡下恢复正确；本次不整仓改写，避免视觉面外溢。 |
| `test/theme-palette-intent.test.ts` | 浅色材质表改回中性值表。 |
| `test/workspace-composer-density.test.ts` | 胶囊底色/inset 描边断言改为 transparent/none 断言。 |
| `test/design-density-tokens.test.ts`、`test/browser/command-palette.test.ts`、`test/browser/light-theme-reference-browser.test.ts` | 暖色 rail/canvas 断言改为中性断言（r≈g≈b，spread ≤ 2）。 |
| 新增回归测试 | button 原语：icon-action 无默认 inset 描边、通用 hover 使用 `--hover-wash`；sidebar：行 hover/active 使用 wash token 且 ledger-row-main hover 背景透明；composer：控件无胶囊底与 inset 描边。 |

## Benchmark / 验收方式

- Node 启动 Playwright（禁 bun），隔离 DOM fixture + 真实样式表，绝不触碰用户运行中的 overlay。
- 截图必须覆盖：侧栏项目组 + 子行（含选中行、hover 行、操作图标可见态）、composer 底部控件排布；浅色主题。
- 断言：hover/选中取样亮度必须低于所在底色亮度；材质取样 r≈g≈b；icon-action computed box-shadow 无 inset 描边。
- 视觉不达标必须继续修并重新截图（AGENTS.md 视觉验收 principle）。

## Result

- PASS：新增 `neutral-chrome-wash-browser.test.ts`（rail 中性、选中/hover 为深色 wash、行主按钮 hover 透明、icon-action 与 composer 全部控件无底无描边、发送键无投影），视觉证据 `.scratch/neutral-chrome-wash.png`。
- PASS：`light-theme-reference-browser.test.ts` 改为中性 rail/canvas 断言并重跑，证据 `.scratch/light-theme-codex-reference.png`。
- PASS：`chat-composer-button-primitives.test.ts`（浏览器）按新契约更新（双下拉均无底无 inset；112px composer 壳与 38px 发送键几何取代 130px/42px 旧断言），证据 `.scratch/chat-composer-button-primitives.png`（暗色主题同样统一）。
- PASS：`theme-palette-intent`、`workspace-composer-density`、`button-primitive-chrome`（新增）、`connection-badge-primitive`、`sidebar-surface-continuity`、`work-ledger-consolidation`、`overlay-left-rail-density`、`icon-action-primitive` 等 CSS 契约单测；overlay `tsc --noEmit`；historical-docs-links 20 项。
- 人工二次截图复检：中性灰白材质、整行灰色选中条、行族左右缘对齐、composer 工具条单一 ghost 语言，均符合 Codex 参考。
- 预存红项（不属于本次，均在 HEAD 即红、归属并发进行中的 center-workbench/inspector 与 titlebar 菜单线）：`overlay-architecture-guards` 的 App.tsx 挂载点断言、`flat-redesign-elevation` 的 composer/inspector z-index 字面量、`popup-contrast-matrix-source` 的 BrowserPreviewPanel SelectControl 断言、`command-palette` 的 Run 菜单断言。
- Push：本次提交 `d950bb5188` 已落本地 `v0.0.3beta`；`git push legacy-remote` 仍被 2026-07-13 已记录的同一 pre-push 阻塞拒绝——并发 source-snapshot 重构删除了 `ProjectRuntimePaths.frontendDesignPaths()` 的 `sourcePackage*`/`webpageEvidence*` 字段且约 30 个调用点未迁移（`packages/opencorvus/src/research/webpage-prd-evidence.ts` 等 typecheck 红）。未绕 hook；该迁移完成后随下一次成功 push 一并交付。
- composer.css 工作区中属于 2026-07-13 composer-runtime-control-icons 线的未提交 hunk（run-control-label→icon）在提交时按 hunk 剔除并原样保留在工作区；ChatComposer.tsx / Icon.tsx / i18n 的并发脏改动未触碰。
