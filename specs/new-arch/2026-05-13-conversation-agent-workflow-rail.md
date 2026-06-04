# Conversation Agent Workflow Rail

> 2026-05-13 / 用户要求：把 Workflow 搬到 Conversation 面板左侧，作为非常窄的独立 column，展示 agent 头像和必要细节；监控 agent 运行流；点击头像切换到对应 agent 消息卡片；可拉宽展示每个 agent 的 report；并行 agent 窄态使用头像 stack，宽态按行摊开；点击打开 markdown report 窗口。

> 2026-05-13 修正：左侧竖 rail 在真实界面中过度抢占消息视觉主轴，用户明确要求“改到放到底部”。最终 owner surface 仍是 Conversation，但形态改为 chat-scroll 下方、composer 上方的底部横向 agent strip；默认窄态 42px 高，拖动上边缘增高后展示摘要和 report 操作。

> 2026-05-13 修正：没有 agent workflow lane 时不显示底部 rail。空 rail 不应占用 42px 高度，也不应留下 host 边线；只有存在真实 agent workflow record 时才挂载 rail。

> 2026-05-13 修正：窄态不合并 agent run。不同职责 agent 不能因为时间关系或 role 归一化进入同一个窄态按钮；并行和顺序历史都按真实 run 单独显示，窄态只隐藏文字，不隐藏身份。

> 2026-05-14 修正：用户拉开底部 rail 后，agent 文本必须自动从窄态隐藏切换为宽态展开；rail 不再设置 220px 上限；宽窄切换需要有高度、行卡片和详情显隐动画。

> 2026-05-14 修正：rail icon 不能在 workflow 投影刷新时闪烁。lane / record 渲染必须稳定复用 DOM，不能按每次新建的对象引用重新挂载头像；rail 作用域内禁用 `.chat-avatar` 入场动画，只保留 running 状态 halo。

## 现状证据

- `packages/overlay/src/index.html` 的历史右栏 Workflow tab 已移除；agent workflow 的 owner surface 是 Conversation 底部 rail。
- `packages/overlay/src/components/AgentWorkflowPanel.tsx` 是现有 Workflow 视图，当前 owner surface 是右栏 tab，不属于 Conversation。
- `packages/overlay/src/utils/agent-workflow.ts` 是 agent workflow 投影层，合并 task trace 与 `cardTreeStore`，已经输出 `AgentWorkflowRecord` / `AgentWorkflowStack`，包含 `sessionID`、`cardID`、`status`、`report`、`parentSessionID`、`goalID`、`round`、`attempt` 等字段。
- `packages/overlay/src/components/Conversation.tsx` 是 Conversation 渲染入口，直接读取 `cardTreeStore.order`，用 `renderAsBubble()` 单点路由 `ChatBubble` / `Card`。
- `packages/overlay/src/components/Avatar.tsx` 已经提供 agent role 到 avatar icon 的单一映射，可复用在 workflow rail。
- `packages/overlay/src/utils/markdown.ts` 已有 `renderMarkdown()`，report dialog 应复用 `.md-content`，而不是继续用 `<pre>` 展示 markdown 原文。

## 设计原则

1. Workflow 不再是右栏 tab。agent 运行流属于 Conversation 的导航和上下文层，应放在 Conversation 内部底部，位于 chat-scroll 和 composer 之间。
2. 不新增第二套 agent 状态源。运行流只从 `buildAgentWorkflow()` 读取投影结果；需要新增字段时扩展投影层，不在组件内重新推导。
3. 不合成消息、不制造隐藏卡片。点击 agent 只能定位到真实存在的 `CardNode` DOM；若 agent session 被 phase card 吸收，就定位到承载它的 phase card。
4. report 是 agent run 的交付细节，不塞进窄 rail；窄态只显示可扫描状态，宽态显示摘要，详情进入 markdown dialog。
5. trace 获取异常必须显式呈现错误态。不能把 fetch 失败静默吞成空 workflow，否则用户会误判为没有 agent 运行记录。
6. UI（User Interface，用户界面）实现之前必须先修投影契约。当前 trace 与 card-tree 还不能可靠表达“并行”和“可定位 DOM 节点”，如果直接做 UI 会变成视觉补丁。

## 产品形态

### 布局

Conversation 内部拆为聊天滚动区 + 底部 agent strip：

```text
┌──────────────────────────────────────────────────────────────┐
│ Conversation header                                           │
├──────────────────────────────────────────────────────────────┤
│ chat-scroll                                                   │
│ ChatBubble / Card / Workspace stack                           │
├──────────────────────────────────────────────────────────────┤
│ Agent strip 42px; drag upward for summary/report rows         │
├──────────────────────────────────────────────────────────────┤
│ Composer                                                     │
└──────────────────────────────────────────────────────────────┘
```

实现上不要把 rail 插入 `chat-scroll` 内部，否则会破坏 auto-scroll 与 `chat-scroll > *` 选择器合同。DOM 结构固定为：

```html
<section class="chat" id="chatSection">
  <header class="chat-header">...</header>
  <div class="conversation-body" id="conversationBody">
    <div class="conversation-scroll-shell">
      <div class="chat-goals-strip" id="chatGoalsStrip"></div>
      <div class="chat-scroll session-content" id="chatScroll"></div>
    </div>
  </div>
  <div id="solidConversationAgentRailMount" class="conversation-agent-rail-host"></div>
  <div class="pane-resizer pane-resizer-workspace" id="workspaceResizer" ...></div>
  <div id="solidWorkspaceMount" class="workspace-mount" hidden></div>
  <div id="solidChatComposer"></div>
</section>
```

`Conversation` 继续只渲染消息流并只绑定 `.chat-scroll` 的 `setupAutoScroll()`。`ConversationAgentRail` 是独立 mount，和 `Conversation` 共享 `cardTreeStore` / workflow projection，但不进入消息滚动流。workspace/composer/resizer 仍由 `.chat` surface 管，不被 rail 包裹。

### 窄态 bottom strip

默认高度：`calc(42px * var(--ui-scale))`。

无 agent workflow lane 时不渲染 strip；`solidConversationAgentRailMount` 空挂载点必须隐藏，不能留下空边框或占位高度。

窄态只显示：

- agent avatar
- status ring / running pulse
- active indicator
- error marker

不显示 agent 名称、summary、sessionID、长文本。hover tooltip 可以显示 agent label 与状态，但 tooltip 不能成为唯一信息源；宽态必须可见。

### 宽态 bottom strip

用户拖动 strip 上侧 handle，高度超过 `calc(88px * var(--ui-scale))` 后进入宽态；rail 不设置固定最大高度，用户继续拉开时文本和行高应自然展开。

宽态每个 agent run 一行：

- avatar
- agent label
- status
- duration
- goal/attempt identity
- report summary 自动换行展开，不使用单行省略作为宽态默认表现
- report button

宽态下并行 stack 摊开成多行；同一个 parallel group 保留一个轻量 group heading 或 shared connector，不再头像叠压。

### 并行 agent 表达

需要在投影层新增 parallel grouping，而不是组件里按视觉邻近硬猜。

建议新增：

```ts
interface AgentWorkflowLane {
  id: string
  kind: "single" | "parallel"
  startedAt: number
  lastObservedAt: number
  completedAt?: number
  records: AgentWorkflowRecord[]
}
```

grouping 规则：

- 同 parent session；
- 时间区间存在明确重叠；
- record 数大于 1 时窄态显示 avatar stack；
- 宽态按 `startedAt` 排序摊开。

这里不能使用关键字匹配报告文本，也不能使用“同一 dispatch burst”这类模糊启发。若 trace 没有足够信息，缺证据的 record 不进入 parallel group，显示普通单行。

当前数据不足以直接支持可靠并行：

- `llm_request` trace 当前缺 `taskID` / `parentSessionID`；
- `applyTraceEvent()` 当前把所有 trace event 的 `ts` 写进 `completedAt`，这会把 running record 伪装成已完成区间；
- task trace index 可能因为首个事件缺 `taskID` 漏掉 session。

因此实施顺序必须先修 trace 契约与投影时间语义：

```ts
interface AgentWorkflowRecord {
  startedAt: number
  lastObservedAt: number
  completedAt?: number // 只允许 terminal report / terminal session status 设置
  renderedCardID?: string // 真正可在 DOM 中定位的 card id
  cardID?: string // 原始 session/phase card id，用于调试，不直接给 UI 定位
  traceReport?: AgentWorkflowReport
  displaySummary?: { text: string; source: "trace_report" | "card_output" }
}
```

### 点击定位

`AgentWorkflowRecord.renderedCardID` 是唯一定位锚点。组件不得在找不到 DOM 时再做二次猜测。

点击 avatar / row：

1. 找 `record.renderedCardID`；
2. 用 `CSS.escape(record.renderedCardID)` 构造 selector，查 DOM `[data-card-id="..."]`；
3. `scrollIntoView({ block: "center" })`；
4. 如果目标卡片处于折叠父级内，先通过已有展开 store 展开 owner card，再滚动；
5. 给该卡片设置短暂 focus/highlight；
6. 如果 `renderedCardID` 不存在或 DOM 不存在，显示不可定位的显式错误提示，不静默失败。

`renderedCardID` 必须由 `buildAgentWorkflow()` 投影层负责：

- 普通 agent session：`renderedCardID = card.id`；
- phase-absorbed session：若 phase card 不独立渲染，`renderedCardID` 指向真正渲染的 owner step card；
- promoted build phase：同样由投影层解析到真实 owner card；
- 无法确定 owner：不设置 `renderedCardID`，UI 显示不可定位状态。

不允许为了定位而创建隐藏 message card。

### Report dialog

点击 report button 打开 modal dialog：

- title：agent label + compact session id
- meta：status、time、duration、goal identity
- body：`renderMarkdown(record.report.detail)`
- class：`md-content`

若无 report：

- 显示 “No report recorded” 的明确空态；
- 不从 card text 拼一个伪 report；
- summary 可继续来自投影层 `displaySummary`，但 dialog 只读取 `traceReport.detail`。

必须先修 `AgentWorkflowRecord` 字段拆分：

- `traceReport`：只来自 trace 中的 `agent_report` / `agent_report_retry_final` / `agent_report_failure` / `orchestrator_wake` 等真实报告事件；
- `displaySummary`：宽态 rail 摘要，可来自 `traceReport.summary` 或 card text，必须携带 `source`；
- `record.report` 不再同时承载真实 report 和 `card_output`。

Markdown 安全不能在 `AgentReportDialog` 内单独处理。当前 `renderMarkdown()` 直接调用 `marked.parse()`，调用方用 `innerHTML` 注入；这不是安全边界。必须修中央 markdown renderer：

- 禁止 raw HTML，或统一接入 sanitizer；
- 禁止 `javascript:` 链接；
- 覆盖 `<script>`、`<img onerror>`、`javascript:` href 的测试；
- 所有现有 markdown 调用点共享同一个安全入口。

## 组件拆分

新增：

- `packages/overlay/src/components/ConversationAgentRail.tsx`
  - Conversation 底部 agent strip 主组件。
  - 接收 `container` 或回调，用于定位消息卡片。
  - 读取 agent workflow projection。
- `packages/overlay/src/components/AgentReportDialog.tsx`
  - markdown report dialog。
- `packages/overlay/src/utils/agent-workflow-lanes.ts`
  - 从 `AgentWorkflowProjection` 生成 narrow/wide 都能使用的 lane 模型。
- `packages/overlay/src/utils/agent-workflow-target.ts`
  - 如果不直接放进 `agent-workflow.ts`，这里负责把 session/phase card 映射到真实 rendered card。

修改：

- `packages/overlay/src/components/Conversation.tsx`
  - 不再只返回消息列表；增加 rail + scroll 的 layout shell，或配合 HTML 重构挂载点。
- `packages/overlay/src/components/AgentWorkflowPanel.tsx`
  - 退役右栏 Workflow 入口。可删除组件，或先改为只被新 rail 复用的内部小组件；最终不能保留右栏 tab 和 Conversation rail 双入口。
- `packages/overlay/src/index.html`
  - 移除 `rightPanelWorkflow` 和 `solidAgentWorkflowMount`。
  - 移除 Workflow tab。
  - 新增 `conversationBody` / `solidConversationAgentRailMount`，并保留 `chatScroll` 作为唯一消息滚动容器。
- `packages/overlay/src/main.tsx`
  - 移除 `AgentWorkflowPanel` mount。
  - 移除 `right_panel.workflow` tab 逻辑。
  - 移除右栏 Workflow tab 候选。
- `packages/overlay/src/utils/agent-workflow.ts`
  - 拆 `traceReport` / `displaySummary`。
  - 增加 `lastObservedAt` / `renderedCardID`。
  - `completedAt` 只由 terminal report 或 terminal status 设置。
- `packages/overlay/src/styles/surfaces/conversation.css`
  - owner 新 rail 和 conversation body shell。
- `packages/overlay/src/styles/surfaces/agent-workflow.css`
  - 迁移/改名为 rail 样式，或删除右栏 panel 专属大画布样式。

## Trace 错误处理修正

当前 `packages/overlay/src/services/trace.ts` 中 `fetchTaskTrace()` catch 后返回 `EMPTY_RESULT`。`normaliseResult()` 也会把 malformed response 静默规整成 `{ events: [], enabled: true }`。这会把后端错误伪装成“没有 workflow”，不符合本项目禁 fallback 约束。

设计上需要改成显式结果：

```ts
type TraceFetchResult =
  | { ok: true; events: TraceEvent[]; traceDir: string; enabled: boolean }
  | { ok: false; events: TraceEvent[]; traceDir: string; enabled: boolean; error: string }
```

组件必须显示 `ok: false` 的错误态。Malformed response 也必须进入错误态，不能规整成空数组。

后端 trace 也要同步修：

- `recordLLMRequest()` 必须携带 `taskID`、`parentSessionID`；
- task-level trace 读取不能依赖可能缺 taskID 的首个 index 事件；
- 若继续使用 `_index.jsonl`，必须能补写/更新 taskID；更直接的方案是 task rollup `_task-<taskID>.jsonl` 成为 task trace 的读取入口。

## 交互验收

1. 右栏不再出现 Workflow tab。
2. Conversation 底部出现非常窄的 agent strip。
3. agent running 时 rail 实时更新状态。
4. 点击单 agent avatar 滚动到对应真实消息卡片，并有短暂高亮。
5. 并行和顺序 agent 窄态都按真实 run 单独显示头像，不合并成 avatar stack。
6. 拉宽 rail 后，并行 agent 按行摊开。
7. 拉宽 rail 后每行展示 agent report summary，文本自动换行展开，不继续单行省略。
8. workflow 投影刷新、trace 轮询和宽窄切换时，已有 agent icon 不重新播放入场动画、不闪烁。
9. 点击 report 打开 markdown 渲染 dialog，不是 `<pre>` 原文。
10. trace fetch 失败显示错误态，不显示“空 workflow”。
11. user message 不被 rail 误识别为 agent run。
12. phase-absorbed agent 可定位到真实 phase card。
13. 移动端 bottom strip 不挤爆聊天区；小屏保持 42px 横向 strip 或隐藏到 explicit toggle，但不能丢失状态。
14. `card_output` 只能作为摘要来源，不能进入 report dialog。
15. markdown report 不允许 raw HTML / script / javascript link 执行。

## 测试计划

- `agent-workflow-lanes.test.ts`
  - single lane；
  - overlapping same-parent records 进入 parallel lane；
  - non-overlapping records 不进入 stack；
  - 缺少时间的 record 不被错误 stack。
- `agent-workflow-target.test.ts`
  - 普通 agent session 的 `renderedCardID` 指向自身；
  - 隐藏 build phase 映射到 rendered owner step；
  - 无法确定 owner 时不设置 `renderedCardID`，UI 显示不可定位。
- `agent-workflow-report-source.test.ts`
  - trace report 进入 `traceReport`；
  - card text 只进入 `displaySummary`；
  - `card_output` 不进入 report dialog。
- `conversation-agent-rail.test.ts`
  - 源码守护：rail 只通过 `buildAgentWorkflow()` / lane helper 读取 workflow，不直接扫描 trace 文本。
  - avatar click 使用 `renderedCardID` + `CSS.escape` 定位。
  - collapsed owner 展开后再定位。
  - report dialog 使用 `renderMarkdown` 与 `md-content`。
- `agent-workflow-panel-retirement.test.ts`
  - `index.html` 不含 `rightPanelWorkflow` / `solidAgentWorkflowMount`。
  - `main.tsx` 不 import / mount `AgentWorkflowPanel`。
  - i18n 不再需要 `right_panel.workflow`。
  - `RightPanelTab` 不再包含 `"workflow"`。
  - `frontend-preview.test.ts` 不再把 workflow 当 tab。
- `trace-error.test.ts`
  - trace API 抛错时结果包含 error，组件显示错误态。
  - malformed trace response 进入 error，不被规整为空。
- `trace-task-rollup.test.ts`
  - `llm_request` 带 taskID / parentSessionID。
  - task trace 不因为首个 index 事件缺 taskID 漏 session。
- `markdown-safety.test.ts`
  - `<script>` 被移除或转义；
  - `<img onerror>` 不保留事件属性；
  - `javascript:` href 不可点击执行。
- 视觉验收
  - dark / light / vscode-dark 三主题。
  - 窄态、宽态、并行 stack、report dialog。
  - 点击定位真实卡片。
  - 移动端 rail 形态必须用可见浏览器或截图复核；视觉相关验收不使用 headless-only benchmark。

## 风险与处理

| 风险                                       | 处理                                                            |
| ------------------------------------------ | --------------------------------------------------------------- |
| Workflow 右栏与 Conversation rail 双源并存 | 退役右栏 Workflow tab；只保留 Conversation rail 入口            |
| 组件内重新推导 agent 状态                  | 投影只能来自 `buildAgentWorkflow()` + `agent-workflow-lanes.ts` |
| trace 获取失败被误判为空                   | trace service 改显式错误态                                      |
| phase session 没有独立 agent card          | 投影层提供 `renderedCardID` 指向真实 owner card，不合成消息     |
| 窄 rail 信息过少                           | 窄态只做运行监控和导航；宽态/report dialog 承载详情             |
| markdown report XSS                        | 先修中央 markdown renderer，所有 markdown 调用共享安全入口      |
| `card_output` 被当 report                  | 拆 `traceReport` 与 `displaySummary`                            |
| 并行 stack 错判                            | 先修 trace parent/time 契约；只对明确重叠区间 stack             |

## 实施顺序

1. 修 trace client/server 契约，消除 silent empty result、malformed response 规整、task trace 漏 session。
2. 修中央 markdown renderer 安全入口。
3. 扩展 `agent-workflow` 投影：`lastObservedAt`、terminal-only `completedAt`、`renderedCardID`、`traceReport`、`displaySummary`。
4. 新增 `agent-workflow-lanes.ts`，只基于明确 interval 建 parallel lane。
5. 新增 `AgentReportDialog`，只读取 `traceReport`，使用安全 markdown。
6. 新增 `ConversationAgentRail` 窄态与定位能力。
7. 加宽态布局和 report summary。
8. 固定 Conversation DOM shell，把 rail 接入 Conversation owner surface，但保留 `.chat-scroll` 为唯一消息滚动容器。
9. 移除右栏 Workflow tab / mount / i18n / `RightPanelTab` workflow 类型。
10. CSS token 化与移动端处理。
11. 跑相关单测与可见浏览器视觉验收。
