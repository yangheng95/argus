# Agent Rail Tooltip Title-Only Header

## Recall

| Item | Detail |
| --- | --- |
| User requirement | Agent Rail 悬浮卡片截图红框中的标题区域不要换行，并且不要展示对话状态。 |
| Acceptance criteria | 悬浮或键盘聚焦现有 Agent Rail 短线时，卡片头部只显示完整或单行省略的 Agent 名称；头部不渲染会话状态文本；长 Agent 名称不增加头部行数；用户输入、Agent 输出、右侧定位、短线邻近展开与点击定位保持不变；Node 启动的真实桌面浏览器夹具通过并产出经检查的任务截图。 |
| Hard constraints | 复用现有 `ConversationAgentRail`、规范 `Button` 与 Kobalte `Tooltip`；不新增弹层、状态分支、fallback、gate、兼容选择器、移动端范围或 worktree；不重启、刷新或干预用户正在运行的 OpenCorvus / Overlay；Playwright 只能由 Node 启动。 |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-9721c05b-9e46-4c8f-849f-3ed64005fda8.png`，已按原始分辨率检查。红框内长 `multica-agent-*` 名称与“已完成”共占 240px 紧凑头部；右侧状态列在窄剩余宽度中逐字换行，制造了三行高度。 |
| Sources read | `AGENTS.md`；Browser 技能；`specs/current/architecture/99-principles.md`；2026-07-14 Agent Rail hover input、2026-07-19 compact right tooltip、bounded preview 与 gutter density 记录；当前 `ConversationAgentRail.tsx`、`conversation.css`、源契约测试和真实 hover 浏览器夹具。 |
| Whole-repository grep | `ConversationAgentRail.tsx` 是唯一 `.conversation-agent-rail-tooltip__header` 生产者，且唯一可见状态节点是头部的 `<span>{agentRailStatusLabel(record().status)}</span>`。`conversation.css` 是唯一头部布局、单行省略和 header-status 样式所有者。`conversation-agent-rail.test.ts` 是直接源码/CSS 契约测试；`conversation-agent-rail-hover-context-browser.test.ts` 是真实 hover/focus、几何和截图所有者；scroll 浏览器测试只统计 tooltip 数量。`AGENT_RAIL_STATUS_LABELS`、`agentRailStatusLabel`、状态本地化、`compactLabel`、诊断详情与 `data-status` 仍服务无障碍标签、错误诊断和短线视觉状态，不属于可见卡片头部状态，必须保留。 |
| Independent agent feedback | None. 用户未要求子 Agent，当前协作策略禁止未请求委托。 |
| Git baseline | 当前分支 `work-v0.0.11beta-yr-0720`、本地 `HEAD` 与 `legacy-remote/work-v0.0.11beta-yr-0720` 均为 `9e63b5fe5`；工作区在改动前干净，已 fetch legacy remote。 |

## Causal chain

1. **可观察现象：** 长 Agent 名称后面出现竖排“已完成”，头部被撑到三行。
2. **直接触发点：** 头部用 `display: flex` 和 `justify-content: space-between` 同时渲染 Agent 名称与状态；名称优先占据宽度后，状态 `span` 没有不换行约束，于是中文状态逐字折行。
3. **深层原因：** 紧凑 tooltip 仍继承了旧的“身份 + 状态”双列头部信息架构；这与当前只需用短线颜色/无障碍标签保留状态语义、视觉头部专注 Agent 身份的需求冲突。
4. **为什么不能只给状态加 `white-space: nowrap`：** 那会保留用户明确要求隐藏的对话状态，并进一步压缩长 Agent 名称；真正修复是删除唯一可见状态节点，让标题独占一行并由唯一 CSS 规则省略溢出。

## Call-site disposition

| Owner | Decision |
| --- | --- |
| `packages/overlay/src/components/ConversationAgentRail.tsx` | 删除 tooltip 头部唯一可见状态节点；保留状态标签函数在无障碍名称、诊断详情和短线 `data-status` 中的既有用途。 |
| `packages/overlay/src/styles/surfaces/conversation.css` | 把头部从双列 flex 收敛为单行溢出容器；保留 `strong` 的单行省略，删除已无生产节点的 header `span` 样式选择器。 |
| `packages/overlay/test/conversation-agent-rail.test.ts` | 断言头部只渲染 Agent 名称、没有可见状态节点，并断言单行省略 CSS 契约。 |
| `packages/overlay/test/browser/conversation-agent-rail-hover-context-browser.test.ts` | 在真实长 Agent 名称场景中断言头部只有一个子节点、文本只含 Agent 身份、计算样式不换行且没有垂直溢出；保留输入/输出、右侧几何、focus 和截图验收。 |
| 其他状态、本地化、store、schema、route 与浏览器测试 | 保持不变；它们不生产 tooltip 头部可见状态。 |
| `specs/README.md`、July index 与文档健康测试 | 索引本记录并验证文档单一来源。 |

## Implementation and verification plan

1. 先更新源契约与真实浏览器断言，使旧双列头部不满足新契约。
2. 删除现有可见状态节点并收敛唯一头部 CSS，不改变数据投影、短线状态、定位或 tooltip primitive。
3. 运行聚焦单元测试、Overlay TypeScript 与国际化检查、Node 浏览器夹具、历史链接和文档健康测试。
4. 按原始分辨率检查任务截图；若长名称换行、状态残留或内容几何回归则继续修复和重跑。
5. 二次检查 diff、截图和 Git 状态，使用 `dsw-33987` 前缀提交并推送当前分支到 `legacy-remote`。

## Progress

- [x] 检查用户截图、历史决策、当前实现、测试和完整调用面。
- [x] 更新测试与生产实现。
- [x] 完成真实浏览器和视觉验收。
- [x] 完成二次审查；提交和 legacy remote 收敛由最终交付命令验证。

## Verification evidence

- PASS: `conversation-agent-rail.test.ts` 先以新契约稳定拒绝旧双列头部，生产修改后 `10/10` 通过。
- PASS: Agent Rail、Tooltip primitive、国际化与 Overlay 架构聚焦套件共 `141/141` 通过，Overlay 国际化检查通过。
- PASS: Node 启动的 `conversation-agent-rail-hover-context-browser.test.ts` 完成真实 Vite production build 与 1280×720 hover/focus 场景。运行时证明长 Agent 名称的 header 只有一个子节点，`white-space: nowrap`、`overflow: hidden`、`text-overflow: ellipsis` 生效，标题存在真实水平溢出但没有垂直溢出；输入/输出、右侧 8px 间距、卡片边界和短线邻近几何仍通过。
- Visual review PASS: `.scratch/conversation-agent-rail-hover-context/bounded-input-output-preview.png` 已按原始分辨率检查。`multica-agent-c5f1d1814c144b0e9a4a3eb746d554bf` 保持一行并省略，头部无状态列，输入/输出层级未受影响。
- PASS: Overlay TypeScript 在未改 Browser Preview 代码的复跑中通过。首次并行检查短暂读取到正在被其他工作更新的 Software Development Kit（SDK，软件开发工具包）声明并报告 `captureAvailable` 缺失；同一规范 source/dist 随后均包含该必需字段，未改代码的立即复跑通过，因此没有制造兼容 type intersection。
- PASS: 历史文档链接 `21/21`。文档健康首次 `60/61`，唯一失败准确指出本任务和并发 Memory 任务的新记录尚未进入 Git 索引；最终选择性 staging 后必须复跑。

## Second review

- 可见状态只有一个生产节点，现已直接删除；没有 CSS 隐藏、条件分支、兼容选择器或第二种 tooltip 实现。
- `agentRailStatusLabel` 仍由无障碍名称和 locate 诊断使用，`data-status` 仍驱动短线语义色；用户要求删除的是视觉头部状态，不会牺牲键盘/读屏或错误定位信息。
- 头部只有 Agent identity 一个内容所有者；`strong` 用 block + hidden + ellipsis，父级用 nowrap，长名称的单行行为由运行时几何而非仅源码字符串证明。
- 用户输入、Agent 输出、Kobalte Tooltip、规范 Button、右侧 placement、focus、click-to-locate、邻近短线宽度与 store/schema/API 单一来源均未改变。
- 最终 staged diff 只包含本任务 7 个文件；共享工作区内 Memory、左侧栏和 delegated-context 并发改动未进入本任务索引。
