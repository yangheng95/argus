# Chat-Bubble Avatar Redesign

**Date:** 2026-05-12
**Scope:** `packages/overlay/src` — conversation surface only（`<Conversation/>` 渲染的 `cardTreeStore` 流）
**Trigger:** 用户反馈"现在的卡片堆叠感太重，莫名其妙"。目标改成多角色聊天形态：头像 + 毛玻璃气泡。

---

## 决策矩阵（已与用户对齐）

| 问题 | 决定 |
|------|------|
| 改造范围 | 仅 `kind === "message"` 和 `kind === "agent"`。`goal` / `step` / `phase` / `tool` / `integrity` 保持现有 card chrome |
| 气泡对齐 | `user` 靠右；其它（assistant / system / 所有 stage agent）靠左 |
| 嵌套行为 | **拍平** — sub-agent / sub-message 在主 timeline 里独立头像气泡；不再嵌套在 parent agent 气泡内 |

---

## 数据流改动

### 现状
`cardTreeStore` 是「id → CardNode」字典 + `order: string[]`（top-level）。每个 CardNode 通过 `childIDs: string[]` 引用子节点；`<Conversation/>` 遍历 `cardTreeStore.order`，每个 top-level 节点丢给 `<Card>`，`<Card>` 递归渲染 `childIDs` → 形成 tree DOM。

### 改造后
新增 `services/chat-stream.ts`，从同一份 `cardTreeStore` 派生「线性聊天流」选择器 `chatStream(): string[]`：

1. 遍历 `cardTreeStore.order`（保持当前的 top-level 时间排序）。
2. 对每个 top-level 节点：
   - 若 `kind === "agent"` 或 `kind === "message"` → 直接进入流。
   - 若 `kind ∈ {"goal", "step", "phase", "tool", "integrity"}` → 直接进入流（仍以现有 card chrome 渲染）。
3. 在「拍平 emitter」里，对 `kind ∈ {"agent", "message"}` 的节点的整棵子树做 DFS，把所有后代里的 `agent` / `message` 节点按 `time` 升序、相对位置插入到 parent 气泡之后，作为独立 top-level 条目；但保留 parent 内的 `tool` / `boundary` / `text` / `reasoning` parts（这些是 parent 气泡自身的"话语"）。
4. 对 `kind ∈ {"goal", "step", "phase"}` 的节点的子树同理：把里面的 `agent` / `message` 后代抽出来作为独立 top-level 项；剩下的 `tool` / `phase` 仍走容器卡渲染。
5. 抽出后的"独立条目"id 后挂载一个 `chatStreamParent` 标记（仅 UI 用，写在 selector 输出里，不污染 store），让气泡内可显示一个 "↑ from <ParentTitle>" pill —— 用户能看出调用链来源。
6. 排序仍按 `node.time`。

> **为什么不写回 store？** Store 由 `tree-writer.ts` 维护（"writer 是唯一写者"约定）。拍平只是 UI 投影；selector 派生不破坏这个约定。

### Reactivity
`chatStream()` 是 SolidJS createMemo，依赖 `cardTreeStore.order` + 每个 reachable card 的 `childIDs` + `kind` + `time`。Solid 细粒度让单条 child append 只重算 affected branch。`<Conversation/>` 仅取 `chatStream()` 这一层订阅，<Card/> 子树内仍按现有方式订阅 `cardTreeStore.cards[id]` 字段。

### Rewind / prune
`pruneCardsAfterCursor` 维持现状（直接清 store）。selector 自动重算。

---

## 视觉合同

### 气泡几何

```
左侧（assistant / system / agent）：
┌─────────────────────────────────────────────────────┐
│ ╭───╮                                                │
│ │ 📐│  <role-name> · <duration> · <status>  [actions]│ ←--- bubble-head 行（24-26px）
│ ╰───╯  ┌──────────────────────────────────────────┐ │
│        │                                          │ │
│        │  正文 parts（text / reasoning / inline   │ │
│        │  tool / files）                          │ │
│        │                                          │ │
│        └──────────────────────────────────────────┘ │
│        ↑ from <ParentRole>  ·  ⓘ activity stats     │ ←--- bubble-foot 行（可选）
└─────────────────────────────────────────────────────┘

右侧（user）：
┌─────────────────────────────────────────────────────┐
│             ┌─────────────────────────────┐  ╭───╮ │
│             │                             │  │ 👤│ │
│             │  user 输入                   │  ╰───╯ │
│             │                             │        │
│             └─────────────────────────────┘        │
│                                       12:34:56     │
└─────────────────────────────────────────────────────┘
```

- 头像列宽度：`calc(36px * var(--ui-scale))`
- 头像本身：`calc(28px * var(--ui-scale))` 圆形容器 + `calc(16px * var(--ui-scale))` SVG（viewBox 16）
- 头像与气泡间距：`calc(10px * var(--ui-scale))`
- 气泡最大宽度：`min(76%, calc(720px * var(--ui-scale)))`
- 气泡内边距：`calc(11px * var(--ui-scale)) calc(14px * var(--ui-scale))`
- 气泡圆角：`var(--oc-radius-large)`（≈14px），user 气泡右上角强调（`border-top-right-radius: var(--oc-radius-soft)`），左侧气泡左上角强调 —— 仅作为方向暗示，差异不必过大。
- 气泡间垂直间距：`calc(10px * var(--ui-scale))`。**连续同一发言人不合并**（每条仍独立头像）—— 多 agent 流里身份感更强。

### 毛玻璃配方

不依赖现有的 `.card` 背景，从头声明 `.chat-bubble`：

```css
.chat-bubble {
  position: relative;
  background: color-mix(in srgb, var(--surface) 56%, transparent);
  backdrop-filter: blur(calc(14px * var(--ui-scale))) saturate(135%);
  -webkit-backdrop-filter: blur(calc(14px * var(--ui-scale))) saturate(135%);
  border: var(--oc-border-width) solid color-mix(in srgb, var(--text) 8%, transparent);
  /* 内描边高光，强化"玻璃"感 */
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--text-strong) 6%, transparent),
    0 1px 2px color-mix(in srgb, var(--text) 4%, transparent);
}
.chat-bubble[data-role="user"] {
  background: color-mix(in srgb, var(--accent) 16%, color-mix(in srgb, var(--surface) 44%, transparent));
  border-color: color-mix(in srgb, var(--accent) 28%, transparent);
}
.chat-bubble[data-role="system"] {
  background: color-mix(in srgb, var(--warn) 12%, color-mix(in srgb, var(--surface) 50%, transparent));
  border-color: color-mix(in srgb, var(--warn) 24%, transparent);
}
```

**三套主题适配**：所有颜色用 `var(--surface)` / `var(--accent)` / `var(--warn)` / `var(--text)` token；`color-mix` 在 srgb 下完成。light / dark / vscode-dark 三种 surface 各自给气泡不同的玻璃底色，但配方一致。已知约束：参考 `feedback_overlay_typography.md` ——禁止 hex 字面量，禁止滥用 bold。

**Fallback**：若浏览器不支持 `backdrop-filter`（Tauri webview 是 WebKit，必支持），气泡仍可读 —— 半透明 surface + border 仍能区分。

### Avatar SVG

新增 15 个 avatar，**不复用** 当前 `Icon.tsx` 中的功能 icon（那些是 utility chrome：copy / inspect / cancel / rewind / etc，stroke-width 1.4，太"功能味"）。Avatar 需要"形象感"——填充为主、stroke-width 1.6、viewBox 16x16、有人物/物体的轮廓识别度。

| role | 视觉 | 关键元素 |
|------|------|----------|
| user | 人形剪影 | 圆头 + 肩部弧线，filled |
| assistant | 火花/星标 + 对话气泡轮廓 | 4-point spark inside speech bubble |
| system | 齿轮 | 6 齿的 cog |
| orchestrator | 辐射节点 | 中心圆 + 4 条放射臂指向四个外圆 |
| spec | 卷轴 | 上下卷轴 + 中间文档线 |
| requirements | 剪贴板带勾 | 夹板 + 中央 ✓ |
| design-analyst | 放大镜叠十字线 | 圆 + 十字线 + 把手 |
| architect | 圆规 + 三角板 | 三角形 + 圆规腿叠加 |
| planner | 流程节点串联 | 3 节点 + 2 连线 + 一处分支 |
| executor | 实心 ▶ | filled play triangle |
| build | 锤子 | 锤头 + 把手 |
| evaluator | 天平 | 中心轴 + 两侧托盘 |
| delivery | 包裹立方 | 立方体 + 顶部对角线分箱 |
| integrity | 盾牌带勾 | shield + center ✓ |
| goal | 靶心 | 三同心圆 + 中心点 |

实现：在 `Icon.tsx` 现有 `IconName` union 中追加 `avatar-<role>` 名称（15 个），与现有 icon 共享一套渲染管线。**避免**单独建 `Avatar.tsx` 组件—— Icon 已经是单一来源（`flat-redesign-icon-coverage.test.ts` 兜底），分裂会违反 rule 8（双源）和 rule 9（抽象）。

Avatar 渲染容器（`.chat-avatar`）单独建样式，自带圆形背景：`background: color-mix(in srgb, var(--surface-inset) 86%, transparent)` + 1px border。`data-role` 控制 `color`（驱动 currentColor）。Color 来自现有 `--card-stage-*` token —— 每个 role 已经有一套主题适配的色相。

---

## 气泡内部结构

### bubble-head（替代现有 `.card__head`）
- **左**（agent / assistant / system）：role label（i18n via `agentStageLabel`）+ duration chip + status badge spinner
- **右**：actions（copy / trace / agent-cancel / rewind） —— 复用 `CardHeader.tsx` 现有按钮渲染逻辑
- **user**：无 head 行，时间戳渲染在气泡下方（右对齐）。无 actions、无 status —— user 消息没这些维度。

### bubble-body
- 复用 `<CardParts parts={node.parts} depth={...}/>` 渲染 `text` / `reasoning` / `boundary` / `inline tool` / `file` / `interaction-permission` 等
- **agent 气泡内不再渲染 children**——子 agent / 子 message 已被拍平到主流。仅渲染 `parts`。
- **tool parts** 仍按 `CardParts` 现有 `<Card kind="tool"/>` 嵌入 inline —— 这是 agent 的话的一部分，不拍平。

### bubble-foot（可选）
- "↑ from <ParentTitle>" pill：当节点是被拍平上来的子节点时出现，可点击聚焦/折叠 parent。Pill 用 `--text-muted` + 1px border。
- activity stats（counts pill）：仅当本节点其下有 `tool` / `skill` 活动且 expand 状态下显示。复用现有 `collectActivityCounts` —— 但因为拍平后 sub-agent 已经独立，这里 count 仅含 inline tool/skill。
- 时间戳：用 `stamp(time)` 渲染在气泡右下（左侧气泡）或气泡下方右对齐（user 气泡）。

### 折叠
- 折叠仍生效。折叠态下气泡只显示 head 行 + 一行 `collapsedPreview()`（复用现有 util）。
- 折叠按钮：head 行点击 = 折叠/展开（保持现有交互）。
- 状态机：`cardExpanded` store 不变。

---

## 文件改动清单

### 新建
- `packages/overlay/src/services/chat-stream.ts` — `chatStream()` selector，DFS 拍平 agent/message 子树
- `packages/overlay/src/components/ChatBubble.tsx` — 气泡组件（avatar 列 + bubble-head / body / foot + 用户右对齐变体）
- `packages/overlay/src/styles/surfaces/chat-bubble.css` — bubble + avatar + glass 样式
- 测试：
  - `packages/overlay/test/chat-stream.test.ts` — 拍平算法（多层 agent 嵌套、user 消息插入、按 time 排序、parent 标记正确）
  - `packages/overlay/test/chat-bubble.test.ts` — DOM 断言：user 气泡 `data-align="right"`、avatar 存在、role 对应正确 SVG、actions/duration 仅在 agent 气泡出现

### 修改
- `packages/overlay/src/components/Icon.tsx` — 追加 15 个 `avatar-<role>` SVG 路径
- `packages/overlay/src/components/Conversation.tsx` — `For each={cardTreeStore.order}` 替换为 `For each={chatStream()}`；根据 node.kind 路由到 `<ChatBubble/>`（message / agent）或 `<Card/>`（goal / step / phase / tool / integrity）
- `packages/overlay/src/components/Card.tsx`
  - 删除「message 卡里嵌 children」逻辑（kind=message 已经走 ChatBubble，不再进 Card）
  - 删除「agent 卡递归 children」逻辑（kind=agent 已经走 ChatBubble，不再进 Card）
  - 保留 goal/step/phase/tool/integrity 的现有渲染（包括 promoted build phase）
- `packages/overlay/src/components/CardHeader.tsx`
  - 抽出可复用的 actions 工具栏到一个内部 sub-component `<CardHeadActions>`，让 `<ChatBubble/>` 也能装 actions（copy / rewind / trace / agent-cancel）
  - 或者：把 actions 抽到独立 `components/CardHeadActions.tsx`（更符合 rule 9 抽象）
- `packages/overlay/src/styles/surfaces/card.css` — 删除 message / agent 专属的 card 样式分支（按 `[data-kind="message"]` / `[data-kind="agent"]` 的选择器）。其它 kind 不动。
- `packages/overlay/src/utils/card-tree.ts` — `visibleChildIDsForCard` 增加：当 parent kind ∈ `{"goal", "step", "phase", "integrity"}` 时，过滤掉 `kind ∈ {"agent", "message"}` 的子卡（这些已被 chat-stream 拍到主流，否则会重复出现）。agent/message kind 的节点本身不再走 Card.tsx 渲染，无需在那一侧加防御。
- `packages/overlay/src/i18n/zh-CN.json` + `en-US.json` —
  - 新增 `chat.bubble.from`（"↑ from {role}"）
  - 复用现有 `chat.role.*`

### 删除
- 暂无文件删除。原 `card.css` 中 message/agent 分支的 CSS 规则被裁剪即可。

---

## 行为保留清单（必须不回归）

| 行为 | 现路径 | 新路径 |
|------|--------|--------|
| Rewind | CardHeader 的 ↶ 按钮 → POST `/task/:id/rewind` + `pruneCardsAfterCursor` | ChatBubble 的 head actions 复用同一 `onRewind` 入口 |
| Agent cancel | CardHeader 的 ✕ 按钮 → `cancelAgentSession` | 同上，ChatBubble.head.actions |
| Trace 面板 | CardHeader 的 🔍 按钮 → 内部 `<TracePanel/>` | ChatBubble body 顶部展示 TracePanel（同现状） |
| Reply box | Card body 末尾 `<AgentSessionReplyBox/>` | ChatBubble body 末尾 `<AgentSessionReplyBox/>`，仅 `directAgentSessionID` 有值时挂载 |
| Copy | CardHeader copy 按钮 | ChatBubble actions 复用 |
| Status badge / running spinner | CardHeader 左侧 badge | ChatBubble head 内 |
| Duration chip | CardHeader 中部 | ChatBubble head 内 |
| Collapsed preview | CardHeader `card__collapsed-preview` | ChatBubble head 行下面渲染 |
| Token / usage hint | CardHeader actions 区 | ChatBubble actions 区（同样可见） |
| Activity foot stats | Card 底部 `.card__foot` | ChatBubble bubble-foot 区 |
| Tool 卡 inline 渲染 | CardParts → toolToCardNode → 嵌入式 Card | 不变。Inline tool 仍在 ChatBubble body 内（CardParts 复用） |
| Auto-scroll | `setupAutoScroll(el)` on `.chat-scroll` | 不变 |
| Rewind cursor | `pruneCardsAfterCursor` | 不变 —— chatStream selector 自动响应 |

---

## 主题适配

所有色彩走 token，**禁止硬编码 hex**（rule 10 + feedback_overlay_typography）：

| 元素 | 三主题 token 来源 |
|------|-------------------|
| 气泡背景 | `var(--surface)` + alpha |
| 气泡边框 | `color-mix(in srgb, var(--text) 8%, transparent)` |
| user 气泡背景 | `var(--accent)` + `var(--surface)` mix |
| system 气泡背景 | `var(--warn)` + `var(--surface)` mix |
| Avatar 容器底色 | `var(--surface-inset)` |
| Avatar 图标色 | `var(--card-stage-<role>)`（已经主题适配） |
| 文本 | `var(--text)` / `var(--text-soft)` / `var(--text-muted)` |
| Pill 边框 | `color-mix` of `var(--text)` |

`feedback_overlay_typography.md` 强调"颜色 token 必须 theme-adaptive，禁止 hex 字面量当 token 值"。所有 mix 配方在 srgb 下计算，三主题统一来源、值不同。

字重控制（rule "overlay 禁止滥用 bold"）：
- bubble-head 的 role label：`var(--ui-font-weight-medium)`，不加 strong
- 正文：`var(--ui-font-weight-body)`
- duration / pill 数值：`var(--ui-font-weight-strong)` 仅在数值上点缀

---

## 测试覆盖

按 rule 36（任何修改必须配测试）：

1. **拍平算法**（`chat-stream.test.ts`）
   - 多层嵌套：orchestrator → architect → executor → tool；输出顺序 orchestrator → architect → executor（tool 留在 executor body 里）
   - 时间排序：A 在 B 之前 emit 的 sub-message，仍按 time 排序
   - 多任务并行：两个 goal 同时跑，sub-agent 仍按 time 平铺
   - Parent 标记：拍出来的子节点带正确 `chatStreamParent`
2. **DOM 契约**（`chat-bubble.test.ts`）
   - `kind="message" role="user"` → `data-align="right"`，无 head actions / status / duration
   - `kind="agent" stage="architect"` → `data-align="left"`，avatar 渲染 `avatar-architect` 路径，head 含 duration + status spinner
   - 折叠态：仅 head 行 + collapsedPreview；展开态：body 渲染 parts
   - actions 复用：copy / rewind / cancel / trace 仍可点击触发对应 callback
3. **架构守门**（`overlay-architecture-guards.test.ts`）
   - 追加：`packages/overlay/src/styles/surfaces/chat-bubble.css` 中不能出现 `#` 开头的 hex（仅允许 `color-mix` / `var()`）
   - 追加：禁止在 ChatBubble.tsx 中 inline SVG（必须走 Icon.tsx）
4. **集成**：跑 overlay-web-benchmark 一次，视觉上确认气泡形态。**不允许 headless**（rule 25 + feedback_no_headless_benchmark）。

---

## 风险 & 决策点

### R1：拍平丢失"orchestrator 调了 architect"的层级感
**缓解**：bubble-foot 显示 "↑ from Orchestrator" pill。点击可滚动/聚焦 parent 气泡或在 parent 气泡边亮一下。**不**重建嵌套 UI。

### R2：goal/step 容器空壳化
若 goal/step 里只有 agent 子节点（被拍平走了），goal/step 卡可能视觉空了。
**缓解**：goal/step 卡仍承载 `stepPayload`（plan nodes / checks / verdict）+ `goalDescription` —— 它们有自己的内容，不是空壳。如果某个 goal/step 实证没有任何自有内容，selector 可降级为不渲染该容器卡（仅作为锚点），但不在本次范围内 —— 留作 follow-up。

### R3：reply-box 归属
现状：reply-box 挂在「direct-replyable agent session card」末尾。拍平后，sub-agent 已独立 —— reply-box 跟着它走，不进 parent。语义更清晰。
**风险**：用户习惯了某个固定位置回复，可能找不到。
**缓解**：placeholder text 标注 "Reply to <role>"。

### R4：Backdrop-filter 性能
20+ 个并发气泡同时 blur 在弱机器上可能掉帧。
**缓解**：CSS `@supports (backdrop-filter: blur(0))` 已是 baseline；degrade 时改用半透明纯色不 blur 也仍可读。

### R5：折叠态视觉一致性
现在折叠态的 card 仍是个 bordered block，气泡的折叠态是个"小气泡"。视觉差异：折叠后气泡变短，但仍是 glass + avatar。OK。

### R6：tree-writer 不动
**确认**：本改造完全在渲染层，不动 store / writer。即使 tree-writer 改动时（feature_engine_fixes），这套布局也不需要重写。

---

## 实施次序

1. **Step 1**：扩 `Icon.tsx`，增加 15 个 avatar，跑测试覆盖（icon-coverage test 会自动验）。
2. **Step 2**：抽 `<CardHeadActions/>` 组件，让 CardHeader 和将来的 ChatBubble 共享 actions（copy / trace / cancel / rewind / token / usage chips）。
3. **Step 3**：写 `services/chat-stream.ts` + 单测 `chat-stream.test.ts`。
4. **Step 4**：写 `ChatBubble.tsx` + `chat-bubble.css` + 单测 `chat-bubble.test.ts`。
5. **Step 5**：修改 `Conversation.tsx` 切换到 `chatStream()`；修改 `Card.tsx` 删除 message/agent 渲染分支。
6. **Step 6**：清理 `card.css` 中 message/agent 专属规则。
7. **Step 7**：扩 i18n（`chat.bubble.from` 等）。
8. **Step 8**：扩 `overlay-architecture-guards.test.ts`。
9. **Step 9**：跑 overlay-web-benchmark（有界面），视觉验收。截图对比。
10. **Step 10**：commit + push（按 rule 33，绝不 `--no-verify`）。

---

## 开放问题（请 codex review 重点关注）

1. **拍平粒度**：goal/step 容器卡的子 agent 被拍出来作为 top-level，是否需要在父 goal/step 卡里仍渲染一个"折叠的 agent 调用清单"作为索引？（当前方案：不渲染，只靠 `↑ from` pill 反向溯源。）
2. **时间排序冲突**：若 sub-agent 的 `time` 早于 parent agent 的 `time`（理论上不会发生，但 server 时钟可能有偏差），如何处理？当前方案直接按 `time` 排序，sub 会出现在 parent 之前，破坏因果直观。建议加 secondary sort：若 child.time < parent.time，使用 `max(child.time, parent.time + epsilon)`。
3. **reply-box 位置**：拍平后，sub-agent 的 reply-box 在 sub-agent 气泡末尾。考虑到「用户回复 sub-agent」是常见操作，是否需要在 parent agent 气泡里也复制一个 reply-box（双入口）？倾向 **不**，避免双源（rule 8）。
4. **Avatar 形象一致性**：15 个手绘 SVG 是否风格不统一？建议先实现 4-5 个核心（user / assistant / system / orchestrator / executor），跑视觉验收后再补全。
5. **CardHeadActions 抽出粒度**：actions 区有 6 个按钮（copy / trace / cancel / rewind / token-hint / usage-hint），是否需要按 "consumer 类型" 分两套（chat 用 vs 容器卡用）？倾向单一组件 + props 控制可见性。
