# Composer budget hover and home cards authority

## Recall

### 用户原始要求

- “hexin的额度应该是显示在hover上，而且下面的例子我已经开成卡片式了，为什么又被还原了”
- 延续本轮此前约束：输入框区域以用户版本为主，不能再由合并结果覆盖用户已经完成的交互和视觉设计。

### 验收指标

1. Composer 模型选择器常态只显示模型名称和下拉图标，不内联显示 Hexin 额度。
2. 仅当当前模型存在 Hexin budget key 时，hover 或键盘 focus 模型选择器会通过现有 Kobalte Tooltip 显示唯一的 `HexinBudgetInline` 额度内容；没有 key 时 tooltip 禁用。
3. 空会话首页的三个示例恢复为用户版本的三列卡片：132px 高、raised surface、边框、阴影、18px 圆角、图标 tone 和 hover/focus 抬升；点击仍只填充现有 composer draft。
4. 源码回归测试锁定 tooltip DOM 所有权和卡片结构；Node 启动的真实 Overlay 浏览器测试验证常态额度不可见、hover 后 tooltip 可见，以及三列卡片的真实几何和 computed style。
5. 必须生成与当前 goal/交付面绑定的截图并亲自复核；若视觉不符，继续修改和复测。

### 硬约束

- 不引入 fallback、兼容双路、gate 或第二个额度来源。
- 使用现有 Kobalte Tooltip、Button 和现有 Hexin budget resource，不手搓新的交互系统。
- 不重启、刷新或干预用户正在运行的 OpenCorvus/Overlay；视觉验证使用隔离测试服务。
- 保留当前工作区所有无关未提交修改；禁止 reset、stash、整仓回退或新增 worktree。
- Playwright 只能由 Node 启动。所有提交以 `dsw-33987` 开头并推送 `legacy-remote`。

### 已读取的落盘资料与历史证据

- `specs/records/2026-07/2026-07-08-projects-panel-and-codex-composer-polish.md`
- `specs/records/2026-07/2026-07-09-composer-height-font-adjustment.md`
- `f111df9f44` 中同时存在模型额度 tooltip 与三列卡片版本；`a4dd6e0534` / `751bbf8d17` 的 revert 链覆盖了这两处。二者来自同一用户版本，故不采用后来扁平行或 inline budget 作为事实来源。

### 全仓 grep 与调用点

| Surface / symbol | 调用点 | 本次处理 |
| --- | --- | --- |
| `HexinBudgetInline` | `ExecutorSelector.tsx` executor chip meta | 保留；它是执行器 chip 的既有额度展示，不属于 composer 模型选择器常态文案 |
| `HexinBudgetInline` | `ExecutorSelector.tsx` composer model selector | 从 trigger copy 移入 Kobalte Tooltip Content，仍复用同一 resource |
| `getHexinBudget` | `services/config.ts` 与 `ExecutorSelector.tsx` resource | 保留唯一请求路径，不新增来源 |
| `.composer-model-selector .executor-budget-inline` | `styles/surfaces/composer.css` | 删除被回退引入的 inline 样式，恢复 tooltip trigger/content 样式 |
| `homeSuggestions` / `.chat-home-suggestion` | `Conversation.tsx`、`conversation.css` | 恢复三种 tone 数据和三列 card CSS；保留现有 Button 及 draft fill 行为 |
| browser assertions | `test/browser/command-palette.test.ts` | 把扁平行几何断言替换为卡片几何/样式断言并输出截图 |
| selector source assertions | `test/executor-selector-dualbar.test.ts` | 从 inline budget 断言改为 tooltip ownership 与无 inline selector 断言 |
| composer browser coverage | `test/browser/executor-selector-redesign.test.ts` | 复用真实 Overlay fixture 覆盖常态无额度、hover tooltip 可见性和 portal ownership；不以 mock contract 冒充视觉验收 |
| plus-menu regression | `test/browser/chat-composer-resize-browser.test.ts` | 验证并行度与无人值守不在底栏，只在加号菜单内，且 composer 主要文字字号统一 |

### 独立 Agent 反馈

- 用户未要求独立 Agent；按当前协作约束不启动子 Agent。主 Agent 负责历史追溯、实现、浏览器视觉验收和二次 review。

## 实施与验证记录

- `bun run test:unit test/executor-selector-dualbar.test.ts test/conversation-empty-state-source.test.ts`：59 + 7 tests passed。
- `bun run typecheck`：通过。
- `bun run build:vite`：通过；仅保留既有 chunk-size warning。
- `node test/browser-runner.mjs test/browser/command-palette.test.ts`：通过；真实 computed style 为三列、132px 高、18px 圆角、1px 边框。
- `node test/browser-runner.mjs test/browser/executor-selector-redesign.test.ts`：通过；常态 trigger 内不存在 budget，hover 后 budget 只存在于 `.composer-model-budget-tooltip` portal。
- `node test/browser-runner.mjs test/browser/chat-composer-resize-browser.test.ts`：通过；底栏无 parallelism/unattended control，加号菜单内二者可见，textarea/intent/model/menu/value 字号一致。
- `bun test packages/opencorvus/test/script/historical-docs-links.test.ts`：19 tests passed，`scratch snapshots do not retain deleted spec trees` 失败；失败项全部来自其他任务现存的 `.scratch/o4` 与 `.scratch/opentest-message-*` 快照。本任务未删除或改写这些外部证据。
- 视觉复核：`packages/overlay/.scratch/overlay-empty-home-composer-1440.png` 显示三张卡片且底栏没有并行度/无人值守 icon；`.scratch/composer-model-hexin-budget-tooltip-full.png` 显示额度只浮在模型按钮上方；`packages/overlay/.scratch/composer-plus-runtime-menu.png` 显示 Parallel/Auto 只在加号菜单内。
- 复核时曾误读根目录下 2026-07-13 的同名旧截图；已按绝对路径和文件时间纠正为本轮 `packages/overlay/.scratch` 产物，旧图不作为证据。
- 工作期间外部 OpenCorvus 流程创建 `0117768a9b` checkpoint，将本次源代码/spec/单元测试与无关 Mirror Watch 改动一起提交；未回退、改写或拆分该外部提交，后续浏览器测试修订保持独立未提交状态直至本任务收敛。
