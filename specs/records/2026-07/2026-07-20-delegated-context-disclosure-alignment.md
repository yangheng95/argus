# Delegated Context Disclosure Alignment

## Recall

| Item | Detail |
| --- | --- |
| User requirement | 修复 Agent 消息中“调度上下文”折叠项没有和“推理 / 工具”折叠项左对齐的问题。 |
| Acceptance criteria | 桌面端同一 Agent 消息内，折叠状态下 `调度上下文` 与后续 `推理 / 工具` 文本折叠行的按钮左边界一致；三者继续使用现有箭头、文字、hover、focus 和展开语义；展开后的原始调度上下文仍可见且顺序不变；真实隔离页面截图经人工复核。 |
| Hard constraints | 复用现有 Solid `Button` 与 `data-chrome="text-disclosure"` primitive；不新增 renderer、状态源、fallback、gate、兼容选择器、移动端范围或 worktree；Playwright 只由 Node 启动；不得刷新、重启或干预用户正在运行的 OpenCorvus / Overlay；保留工作区里并行的 Agent Rail、Memory 与 rail seam 修改。 |
| Supplied evidence | `C:/Users/10132/AppData/Local/Temp/codex-clipboard-827413ff-4ce5-4a1c-b4bf-9aa180cabe66.png`。截图中 `调度上下文` 的箭头和文字相对后续 `推理 1`、`工具 4` 整体右移。 |
| Sources read | `AGENTS.md`；Browser 技能；`specs/current/architecture/12-overlay-card-system.md`；`2026-07-14-delegated-context-agent-ownership.md`；`2026-07-15-borderless-conversation-and-seamless-project-loading.md`；当前 `CardParts.tsx`、`ReasoningPart.tsx`、`messages.css`、`button.css` 及消息时序/折叠浏览器测试。 |
| Whole-repository grep | `CardParts.tsx` 是 `delegated-context-toggle` 与 `work-details-toggle` 的唯一生产 owner；`ReasoningPart.tsx` 是 `reasoning-toggle` 的唯一生产 owner。推理与工具摘要都声明 `data-chrome="text-disclosure"` 且把 `--oc-button-padding-x` 设为 `0`；调度上下文缺少该 chrome 声明，并在唯一 CSS selector 中独立设置 `8px` 横向 padding、`26px` 高度与重复的透明/hover 颜色变量。`message-card-chronological-turns-browser.test.ts` 是真实中英文调度上下文、展开交互和截图 owner；`message-part-chronology-browser.test.ts`、`chat-bubble-disclosure-button-browser.test.ts` 与 `agent-card-separation-browser.test.ts` 读取工作摘要 marker/label class。现有断言没有比较调度上下文与工作摘要的可见箭头/文字左边界。 |
| Independent agent feedback | None。用户未要求子 Agent，当前协作策略禁止未请求委托；主 Agent 负责二次审查。 |
| Git baseline | 当前分支 `work-v0.0.11beta-yr-0720`；变更前空检查点 `08c3016e6` 已通过 hooks 并推送到 `myhexin/work-v0.0.11beta-yr-0720`。工作区同时存在其他任务的代码和文档修改，必须原样保留且不混入本提交。 |

## Causal chain

1. **可观察现象：** `调度上下文` 的箭头与文字比紧邻的 `推理 / 工具` 折叠行更靠右。
2. **直接触发点：** `.msg-delegated-context > ...delegated-context-toggle` 独立设置 `--oc-button-padding-x: 8px`；工作摘要与推理折叠按钮的横向 padding 为 `0`。
3. **深层原因：** 调度上下文虽然与另外两者同属 transcript text disclosure，却没有投影到既有 `data-chrome="text-disclosure"` primitive，并复制了一套尺寸、颜色与 hover 样式，形成视觉契约分叉。
4. **为什么不能只加负 margin：** 负 margin 会掩盖独立 padding，留下两套命中区域和控件 chrome；正确修复是让同类 disclosure 使用同一个 primitive 契约，并删除重复样式所有权。

## Call-site disposition

| Owner | Decision |
| --- | --- |
| `packages/overlay/src/components/CardParts.tsx` | `DelegatedContextParts` 保持唯一 renderer；给现有 `Button` 声明 `data-chrome="text-disclosure"`，不改交互或消息数据。`ExecutionDisclosureRun` 保持不变，作为对齐基准。 |
| `packages/overlay/src/components/ReasoningPart.tsx` | 保持不变，继续作为共享文本 disclosure 的另一个调用点。 |
| `packages/overlay/src/styles/primitives/button.css` | 保持不变；现有 text-disclosure primitive 已拥有透明 resting/hover/focus chrome。 |
| `packages/overlay/src/styles/surfaces/messages.css` | 删除调度上下文重复的背景、边框、颜色和 hover ownership；让它复用 transcript activity 行高、零横向 padding、间距与字体契约。 |
| `packages/overlay/test/browser/message-card-chronological-turns-browser.test.ts` | 在真实中文 Agent 消息中断言调度上下文和工作摘要按钮左边界一致，并保留折叠、展开、顺序和截图验收。 |
| 静态 disclosure / primitive 测试 | 增加 `CardParts` 使用共享 chrome 且 CSS 不再保留 8px 分叉的源契约断言。 |
| 其他 message、store、schema、route、i18n | 保持不变；它们不拥有 disclosure 横向几何。 |

## Implementation and verification plan

1. 先更新静态和真实浏览器断言，使旧的 8px 偏移不能通过。
2. 将调度上下文按钮投影到共享 text-disclosure chrome，并收敛 `messages.css` 的 transcript 行几何。
3. 运行聚焦单元测试、Overlay TypeScript、i18n 与构建检查。
4. 通过 Node 启动隔离真实 Overlay fixture，检查中英文折叠/展开、键盘语义、按钮几何和任务截图；亲自查看桌面截图，不干预用户运行态。
5. 运行历史链接和文档健康测试，二次审查 diff 与截图，仅提交本任务文件，再按 `dsw-33987` 前缀推送 git-cc。

## Progress

- [x] 检查用户截图、架构/历史记录、当前实现、primitive 与完整调用面。
- [x] 落地测试和生产修复。
- [x] 完成真实浏览器与视觉验收。
- [ ] 完成二次审查、提交和 git-cc 推送。

## Codex review feedback

- 第一轮实现后再次全仓搜索 retired `msg-work-details__marker` / `msg-work-details__label` 时，发现三个真实浏览器测试仍读取旧的工作摘要专用 class。方案已修订：marker 与 label 改为 `msg-transcript-disclosure__*` 单一共享 owner，并逐一更新消息时序、ChatBubble disclosure 与 Agent card 浏览器调用点；没有保留 alias 或兼容 selector。
- 第一轮真实页面启动被严格 hydrate 契约拒绝，因为历史 fixture 的 `view.messages` 缺少当前必需的 `sessionAgentID`。fixture 已按当前完整消息契约补齐 `info.sessionAgentID` 与 view 投影字段，随后同一 Node 页面场景通过；没有放宽生产端校验。
- 第一轮几何断言错误地比较了调度上下文的真实 SVG 左边界与工作摘要的 marker wrapper 左边界，并假定了错误的中文汇总顺序。断言已改为比较两边真实 SVG，保留精确 `0px` padding 与 `text-disclosure` chrome 检查；实际汇总顺序按运行时证据固定为 `工具 1 · 推理 1`。

## Implementation and validation

- `DelegatedContextParts` 继续作为唯一 renderer，并把既有 `Button` 投影到共享 `text-disclosure` chrome。调度上下文与工作摘要现在共同使用 `msg-transcript-disclosure__marker` 和 `msg-transcript-disclosure__label`，因此箭头占位、文字起点与 hover/focus 颜色由同一契约拥有。
- `messages.css` 把 transcript activity 字体、行高与行高尺寸集中到推理、工作摘要、调度上下文三个 owner 的共享 selector；调度上下文删除独立的 8px padding、26px 高度和重复背景/边框/颜色/hover 变量，改为 0 横向 padding 和共享行尺寸。
- 新静态回归先在旧实现上失败，再在修复后通过。Button primitive、ReasoningPart、Overlay TypeScript、i18n 与 `git diff --check` 均通过。
- 核心 Node 浏览器场景 `message-card-chronological-turns-browser.test.ts` 通过，覆盖完整中文/英文 Agent 消息、折叠/展开调度上下文、后续工具/推理摘要、精确按钮/SVG 左边界和截图。受 marker/label 抽象影响的 `message-part-chronology-browser.test.ts` 也通过。
- 更宽的浏览器批次中，`agent-card-separation-browser.test.ts` 在到达本次 marker 读取前被当前基线的卡片/Composer 宽度断言阻断；`chat-bubble-disclosure-button-browser.test.ts` 的主体断言完成后，被当前 fixture 未提供 `artifact-task-evidence` 路由的 404 cleanup 阻断。两者与本次 disclosure 左对齐无因果关系，且涉及工作区中其他正在进行的前端任务，本修复没有改写对应产品或 fixture 语义。
- 历史链接与产品文档单一来源检查通过。文档健康检查仅因 monthly README 同时链接三个尚未 tracked 的并行任务 record 而失败；本记录会随本提交进入索引，另外两个 record 由其并行任务 owner 收敛。

## Visual review

- `.scratch/message-card-chronological-turns-browser/delegated-context-zh.png`：已按原始分辨率检查。`调度上下文` 与 `工具 1 · 推理 1` 的箭头和文字起点完全重合，卡片信息层级和桌面密度保持不变。
- `.scratch/message-card-chronological-turns-browser/delegated-context-collapsed.png`：英文折叠态同样左对齐，没有背景盒或负 margin 补偿。
- `.scratch/message-card-chronological-turns-browser/delegated-context.png`：展开态保留完整 persisted prompt，随后仍按时间顺序显示 Agent 文字与折叠的执行摘要。
