# Chat-Bubble Avatar Redesign

**Date:** 2026-05-12
**Scope:** `packages/overlay/src` — conversation surface only
**Trigger:** 用户反馈"现在的卡片堆叠感太重，莫名其妙"。目标改成多角色聊天形态：头像 + 毛玻璃气泡。

## Revision history

- **2026-05-12 v1**：初稿。基于错误假设——以为子 agent 嵌在 parent agent 内部需要拍平。
- **2026-05-12 v2 (this)**：folded codex review 反馈：
  - 非 goal sub-agent 早就是 top-level 平铺（`tree-writer.ts:1785` 注释明文）；不存在"拍平 subtree"的工作量
  - 范围不能仅按 `kind` 区分：integrity 渲染为 `kind="agent" stage="integrity"`；interaction 渲染为 `kind="message"`；`goal` kind 根本不存在
  - 三个 helper（`collectCardText / collectLatestActivityText / collectActivityCounts`）若 agent/message 卡停止渲染 children 但仍保留 `childIDs`，会泄漏到隐藏子树
  - `CardHeadActions` 抽组件过早 —— actions 强耦合 state（copy ack / rewind confirm / cancel pending / trace toggle）
  - 单一 `createMemo` 走 DFS 是反向优化，比现有 recursive `<Card>` 订阅差
  - `pruneCardsAfterCursor` 非原子（两次 `setCardTreeStore`），任何"全树扫描" selector 会观察到 transient gap
  - "Tauri 是 WebKit 必支持" 在 Windows 上是错的（WebView2/Chromium）
  - `--card-stage-system` / `--card-stage-integrity` token 不存在，`stageAccent()` 不认这两 role
  - 行为保留表漏掉：`ResizeObserver` 粘附宽度、`dblClick` 折叠、键盘展开、step `goalDescription`、`<IntegrityBody/>`、`errorReason` chip

---

## 决策矩阵（已与用户对齐）

| 问题 | 决定 |
|------|------|
| 改造范围 | "消息态" 卡片（详见下方范围矩阵）。`step` / `phase` / `tool` 容器保持现有 card chrome |
| 气泡对齐 | `user` 靠右；其它（assistant / system / 所有 stage agent）靠左 |
| 嵌套行为 | 不存在子-agent 拍平问题 —— 非 goal 子 session 已经是 top-level 平铺；goal 子 session 已被 `phase` 卡吸收 |

---

## 范围矩阵（rule 35：穷举）

按 `(kind, stage)` 路由到「气泡」或「卡片」：

| `node.kind` | `node.stage` | 渲染 | 备注 |
|-------------|--------------|------|------|
| `message` | `user` | bubble (右) | user 输入 |
| `message` | `system` / `compaction` / `title` / `summary` | bubble (左) | 经 `normalizeAgentRole` 折成 `system` |
| `message` | 其它（interaction-question / -permission as part；boundary） | bubble (左) | interaction parts 仍走 `<CardParts>` inline 在 message bubble body 内 |
| `agent` | `assistant` / `orchestrator` / `spec` / `requirements` / `design-analyst` / `architect` / `planner` / `executor` / `build` / `evaluator` / `delivery` | bubble (左) | 主要 agent stages |
| `agent` | `integrity` | bubble (左) | body 内嵌 `<IntegrityBody/>` 渲染 structured verdict |
| `step` | (任意) | **card**（不动） | 承载 goal metadata + plan nodes + verdict |
| `phase` | (任意) | **card**（不动） | 吸收 session parts；step card 内部 child |
| `tool` | (任意) | **card**（不动） | 通过 `CardParts` inline 在 agent bubble body 内出现 |
| `integrity` (legacy kind) | — | **card**（不动） | 当前数据流已不再产生此 kind；保留 fallback |

**判定单点：** 新增 `utils/chat-bubble.ts` 导出 `renderAsBubble(node): boolean`：
```ts
export function renderAsBubble(node: CardNode): boolean {
  if (node.kind === "message") return true;
  if (node.kind === "agent") return true;  // 含 integrity stage
  return false;
}
```
所有 `<Conversation/>` 和测试通过这个函数判定。**禁止**在 `Card.tsx` / `ChatBubble.tsx` 重复实现条件。

---

## 数据流改动（与 v1 相比大幅简化）

### 现状回顾（v2 重新校准）
- `cardTreeStore.order` 是 top-level 卡列表，按 time 排序，writer 维护
- 非 goal sub-agent session 已直接位于 top-level（`tree-writer.ts:1785` 注释合同：除 goal phase 外，session container 一律 null → top-level）
- goal-scoped sub-agent（planner / build / evaluator session）被 `resolveGoalContainerCardID` 吸收进 step 卡下的 `phase` 子卡；session 不产生独立 agent 卡
- 因此当前 store 里 `kind="agent"` 节点的 `childIDs` 普遍为空（writer 不主动给 agent 卡挂子卡；childIDs 默认 `[]`）

### 改造
- **不引入** chat-stream selector / DFS / parent-pill
- `Conversation.tsx` 仍直接 walk `cardTreeStore.order`
- 对每个 top-level 节点：`renderAsBubble(node) ? <ChatBubble/> : <Card/>`
- 子树渲染逻辑不变（`<Card/>` 仍递归处理 step / phase 的 childIDs）
- **关键不变量**：bubble 不渲染 `childIDs`。验证：所有 agent kind 节点的 childIDs 实证为空（rule 35：穷举 grep `kind:\s*"agent".*childIDs`）；若 writer 未来变更，加 assertion guard
- `pruneCardsAfterCursor` 行为不变；因为没有 selector 全扫，transient gap 不构成 UI 问题

### Helper leak 防护（高风险点）
三个 helper 递归走 `childIDs`：
- `collectCardText(node)` — copy 全文（utils/card-tree.ts:136）
- `collectLatestActivityText(node)` — 折叠态预览（utils/card-tree.ts:310）
- `collectActivityCounts(node)` — foot stats（utils/card-tree.ts:390）

对气泡场景：
- agent/message 节点的 childIDs 默认为空 → 不泄漏
- 但 step / phase 节点（仍走 Card.tsx）可能引用 phase / tool 子卡 → helper 正常工作
- 加 **invariant test**：snapshot 全部 `kind="agent"` 卡的 `childIDs.length === 0`；若未来 writer 给 agent 挂子卡，CI 立即红

> **不**修改 helper 函数本身。它们的语义对 step/phase 仍正确。只用 invariant 锁住"agent kind 没有 children"这个 writer 合同。

---

## 视觉合同

### 气泡几何
```
左侧（assistant / system / agent）：
┌─────────────────────────────────────────────────────┐
│ ╭───╮                                                │
│ │ 📐│  <role-name> · <duration> · <status>  [actions]│
│ ╰───╯  ┌──────────────────────────────────────────┐ │
│        │  正文 parts（text / reasoning / inline   │ │
│        │  tool / files）                          │ │
│        └──────────────────────────────────────────┘ │
│        12:34:56  ·  ⓘ activity stats（如有）        │
└─────────────────────────────────────────────────────┘

右侧（user）：
┌─────────────────────────────────────────────────────┐
│             ┌─────────────────────────────┐  ╭───╮ │
│             │  user 输入                   │  │ 👤│ │
│             └─────────────────────────────┘  ╰───╯ │
│                                       12:34:56     │
└─────────────────────────────────────────────────────┘
```

- 头像列宽度：`calc(36px * var(--ui-scale))`
- 头像圆形容器：`calc(28px * var(--ui-scale))`；图标 `calc(16px * var(--ui-scale))`
- 头像与气泡间距：`calc(10px * var(--ui-scale))`
- 气泡最大宽度：`min(76%, calc(720px * var(--ui-scale)))`
- 气泡内边距：`calc(11px * var(--ui-scale)) calc(14px * var(--ui-scale))`
- 气泡圆角：`var(--oc-radius-large)`
- 气泡间垂直间距：`calc(10px * var(--ui-scale))`
- **同发言人不合并**：保持身份感

### 毛玻璃配方（修订）

**Tauri 跨平台 webview 兼容**：Tauri 在 macOS = WKWebView (WebKit)；Linux = WebKitGTK；**Windows = WebView2 (Chromium)**。三家都支持 `backdrop-filter`（Chromium 76+ / WebKit ≥ 6）。v1 spec 的 "Tauri 是 WebKit 必支持" 论断不准确但结论碰巧成立。

```css
.chat-bubble {
  position: relative;
  background: color-mix(in srgb, var(--surface) 56%, transparent);
  backdrop-filter: blur(calc(14px * var(--ui-scale))) saturate(135%);
  -webkit-backdrop-filter: blur(calc(14px * var(--ui-scale))) saturate(135%);
  border: var(--oc-border-width) solid color-mix(in srgb, var(--text) 8%, transparent);
  box-shadow:
    inset 0 1px 0 color-mix(in srgb, var(--text-strong) 6%, transparent),
    0 1px 2px color-mix(in srgb, var(--text) 4%, transparent);
}
.chat-bubble[data-align="right"] {
  background: color-mix(in srgb, var(--accent) 16%, color-mix(in srgb, var(--surface) 44%, transparent));
  border-color: color-mix(in srgb, var(--accent) 28%, transparent);
}
.chat-bubble[data-stage="system"] {
  background: color-mix(in srgb, var(--warn) 12%, color-mix(in srgb, var(--surface) 50%, transparent));
  border-color: color-mix(in srgb, var(--warn) 24%, transparent);
}
@supports not (backdrop-filter: blur(0)) {
  .chat-bubble { background: var(--surface); }  /* 优雅降级：仍可读 */
}
```

所有颜色 token 来源；禁止 hex 字面量（rule 10 + feedback_overlay_typography）。

### Avatar SVG —— 完整 13 个 role

复用 `Icon.tsx` 注册中心，新增 `avatar-<role>` 命名空间。**一次性补全** `normalizeAgentRole` 返回的全部 role（codex Q4 反馈：避免 partial rollout 造成双视觉语言）：

| AgentRole（from message.ts:47） | avatar 名 | 形象 |
|-----------|-----------|------|
| `user` | `avatar-user` | 人形剪影 |
| `assistant` | `avatar-assistant` | 火花 + 对话气泡 |
| `system` | `avatar-system` | 齿轮 |
| `orchestrator` | `avatar-orchestrator` | 辐射节点 |
| `spec` | `avatar-spec` | 卷轴 |
| `requirements` | `avatar-requirements` | 剪贴板带勾 |
| `design-analyst` | `avatar-design-analyst` | 放大镜叠十字线 |
| `architect` | `avatar-architect` | 圆规 + 三角板 |
| `planner` | `avatar-planner` | 流程节点 |
| `goal` | `avatar-goal` | 靶心 |
| `executor` | `avatar-executor` | 实心 ▶ |
| `build` | `avatar-build` | 锤子 |
| `evaluator` | `avatar-evaluator` | 天平 |
| `delivery` | `avatar-delivery` | 包裹立方 |
| `integrity` | `avatar-integrity` | 盾牌带勾 |

**抽 `Avatar.tsx` 薄 facade**（codex 反馈：spec v1 的"不抽 primitive"过强）：
- 输入 `role: AgentRole`
- 输出：圆形容器 + 对应 `<Icon name="avatar-<role>"/>` + role-stage 着色
- 内部使用 `normalizeAgentRole(stage)` 把 raw stage 映射到 AgentRole
- 不绕过 Icon 注册中心（rule 9 — 仍单一来源）
- 测试：`avatar-coverage.test.ts` 断言 `AgentRole` 全集映射齐全

### Avatar 配色 token 补齐
`--card-stage-system` 和 `--card-stage-integrity` 当前不存在（card.css:66 起的 14 token 清单只覆盖 14 个 role，少了这两个）。`stageAccent()` 在 `utils/card-color.ts:7` 也不认。

**修复路径**：
- `styles/surfaces/card.css` 补 `--card-stage-system: var(--warn);` 和 `--card-stage-integrity: color-mix(in oklch, var(--good) 45%, var(--bad) 55%);`（compliance/security 色感）
- `utils/card-color.ts` `stageAccent()` 函数补这两个 case
- 这两处补齐对现有 card 渲染零回归（之前 fallback 走 `card-stage-info`）

---

## 气泡内部结构

### bubble-head
- **左**（agent / system / assistant）：role label（i18n via `agentStageLabel`）+ duration chip + status badge spinner
- **右**：action chips（copy / trace / agent-cancel / rewind / token-hint / usage-hint）
- **user**：无 head；时间戳渲染在气泡下方

### bubble-body
- 复用 `<CardParts parts={node.parts} depth={...}/>` 渲染 text / reasoning / boundary / inline tool / file / interaction-permission / interaction-question parts
- **不渲染 childIDs**（agent/message 卡 childIDs 实证为空；invariant 测试守护）
- agent 卡含 `node.integrity` 时，body 顶部插入 `<IntegrityBody integrity={node.integrity}/>`
- step 卡的 `goalDescription` 渲染不归 bubble 管（step 走 card chrome）
- `errorReason` chip：与现有 `<CardHeader/>` 一致，渲染在 bubble-head 的 title 行末尾

### bubble-foot（可选）
- activity stats（仅展开 + 有 inline tool/skill 活动）
- 时间戳：`stamp(time)` 

### 折叠态
- 折叠：仅 bubble-head + 一行 `collapsedPreview`
- 触发：bubble-head 单击 = 展开；bubble surface 双击 = 折叠（`Card.tsx:290` 的 dblClick 逻辑搬到 ChatBubble）
- 键盘：bubble-head `role="button" tabindex="0"` + Enter/Space 展开（`CardHeader.tsx:224` 的逻辑搬过来）
- `cardExpanded` store 不变

---

## CardHeader 复用（codex 反馈：不抽组件，抽 handlers）

不新建 `<CardHeadActions/>` 组件。改为：
- 抽 `useCardHeadActions(node)` Solid hook 到 `hooks/use-card-head-actions.ts`，集中 state（copy ack timeout / rewind pending / cancel pending / trace toggle）+ handlers + i18n labels
- `<CardHeader/>` 和 `<ChatBubble/>` 各自调用 hook，渲染自己的 markup
- 这样 view 解耦，state 单一来源
- 测试 `use-card-head-actions.test.ts` 单测 hook：copy 动作触发 clipboard、rewind 弹窗逻辑、cancel 路径

---

## 文件改动

### 新建
- `packages/overlay/src/utils/chat-bubble.ts` — `renderAsBubble(node)` 单点判定
- `packages/overlay/src/components/Avatar.tsx` — 薄 facade over Icon，role→glyph + 圆形容器
- `packages/overlay/src/components/ChatBubble.tsx` — 气泡组件
- `packages/overlay/src/hooks/use-card-head-actions.ts` — 共享 actions state + handlers
- `packages/overlay/src/styles/surfaces/chat-bubble.css` — bubble + avatar + glass
- 测试：
  - `test/chat-bubble-routing.test.ts` — `renderAsBubble` 全 (kind,stage) 矩阵
  - `test/chat-bubble.test.ts` — DOM 契约（user 右对齐、avatar 命中、actions 行为）
  - `test/chat-bubble-invariants.test.ts` — 守护 `kind="agent"` 卡 `childIDs` 为空
  - `test/avatar-coverage.test.ts` — AgentRole 全集映射
  - `test/use-card-head-actions.test.ts` — hook 单测

### 修改
- `packages/overlay/src/components/Icon.tsx` — 追加 15 个 `avatar-*` 注册项
- `packages/overlay/src/components/Conversation.tsx` — 单卡路由：`renderAsBubble(node) ? <ChatBubble/> : <Card/>`
- `packages/overlay/src/components/Card.tsx` — 不再处理 message/agent kind；保留 step/phase/tool/integrity（legacy kind）
- `packages/overlay/src/components/CardHeader.tsx` — 改用 `useCardHeadActions(node)`；删除内联 state（state 现住 hook）；保留 markup
- `packages/overlay/src/styles/surfaces/card.css` — 补 `--card-stage-system` / `--card-stage-integrity` token；删除 message/agent 专属规则
- `packages/overlay/src/utils/card-color.ts` — `stageAccent()` 补 system / integrity case
- `packages/overlay/src/utils/message.ts` — 无变更（已有 `normalizeAgentRole`）
- `packages/overlay/src/i18n/{zh-CN,en-US}.json` — 无新增 key（不再有 "↑ from" pill）

### 删除
- 无文件删除

---

## 行为保留清单（补完）

| 行为 | 现路径 | 新路径 |
|------|--------|--------|
| Rewind | CardHeader → POST `/task/:id/rewind` + `pruneCardsAfterCursor` | ChatBubble actions（复用 hook） |
| Agent cancel | CardHeader → `cancelAgentSession` | 同上 |
| Trace 面板 | CardHeader → 内部 `<TracePanel/>` | ChatBubble body 顶部 |
| Reply box | Card body 末尾 `<AgentSessionReplyBox/>` | ChatBubble body 末尾（仅 `directAgentSessionID` 有值） |
| Copy | CardHeader copy 按钮 | ChatBubble actions（复用 hook） |
| Status badge / spinner | CardHeader 左侧 | ChatBubble head 内 |
| Duration chip | CardHeader 中部 | ChatBubble head 内 |
| Collapsed preview | CardHeader `.card__collapsed-preview` | ChatBubble head 行下方 |
| Token / usage hint | CardHeader actions | ChatBubble actions |
| Activity foot stats | Card `.card__foot` | ChatBubble bubble-foot |
| Tool 卡 inline 渲染 | CardParts toolToCardNode | 不变；inline 仍在 ChatBubble body |
| Auto-scroll | `setupAutoScroll` | 不变 |
| Rewind cursor | `pruneCardsAfterCursor` | 不变 |
| **Sticky inline width** | `ResizeObserver` 在 Card.tsx:53,250 | **ChatBubble 自己实现**（top-level 卡仍需稳定宽度，避免气泡跳动） |
| **dblClick 折叠** | Card.tsx:290 `onDblClick` | ChatBubble surface 同接 |
| **键盘展开** | CardHeader.tsx:224 `onKeyDown` | bubble-head 同接 |
| **errorReason chip** | CardHeader.tsx:280 | bubble-head title 行末 |
| **Integrity body** | Card.tsx:342 `<IntegrityBody/>` 渲染 | ChatBubble body：当 `node.integrity` 存在时插入 IntegrityBody |
| **step `goalDescription`** | Card.tsx:316 | 不归 bubble 管，step 走 Card 不变 |
| **promotedBuildPhase / stepPayload** | Card.tsx:331 `<StepPayloadBody/>` | 不归 bubble 管，step 走 Card 不变 |

---

## 主题适配

| 元素 | token |
|------|-------|
| 气泡背景 | `var(--surface)` + alpha |
| 气泡边框 | `color-mix(var(--text) 8%)` |
| user 气泡背景 | `var(--accent)` + `var(--surface)` mix |
| system 气泡 | `var(--warn)` + `var(--surface)` mix |
| Avatar 容器 | `var(--surface-inset)` |
| Avatar 图标色 | `var(--card-stage-<role>)`（**含新补的 system / integrity**） |
| 文本 | `var(--text)` / `var(--text-soft)` / `var(--text-muted)` |

字重（rule "no bold abuse"）：role label `medium`、正文 `body`、duration 数值 `strong`（仅数值）。

---

## 测试覆盖（rule 36）

### 路由
- `chat-bubble-routing.test.ts`：对每个 `(CardKind, AgentRole)` 组合断言 `renderAsBubble` 是否返回正确值
- 边界：interaction-question / interaction-permission 作为 `kind="message"` 的 part 不影响外层 bubble 判定（part 走 CardParts inline）

### DOM 契约
- `chat-bubble.test.ts`：
  - `kind="message" stage="user"` → `data-align="right"`，无 head actions / status / duration
  - `kind="agent" stage="architect"` → `data-align="left"`，avatar 命中 `avatar-architect`，head 含 duration + status spinner
  - `kind="agent" stage="integrity"` → bubble 内插入 `<IntegrityBody/>`
  - 折叠态：仅 head 行 + collapsedPreview；展开：parts 渲染
  - keyboard / dblClick / role="button" focus parity 与原 Card 一致
  - errorReason chip 仍出现且点击复制

### Helper invariant
- `chat-bubble-invariants.test.ts`：遍历 `cardTreeStore.cards`，断言所有 `kind === "agent"` 卡 `childIDs.length === 0`（基于真实 fixture：单 agent / 多 agent / goal workflow / interaction event 序列）

### Hook
- `use-card-head-actions.test.ts`：copy / rewind / cancel / trace 触发器隔离单测

### 视觉
- `overlay-web-benchmark` 一次（rule 25：不允许 headless）；分别截 light / dark / vscode-dark 三主题；人工对比 v1 卡片状 → v2 气泡

### 架构守门
- `overlay-architecture-guards.test.ts`：禁止 `chat-bubble.css` 出现 hex 字面量；禁止 `ChatBubble.tsx` 内联 SVG

---

## 开放问题（codex round 1 已回答，关闭）

| Q | 决议 | 依据 |
|---|------|------|
| Q1 folded agent index in goal/step | **不加** | 当前层级不暴露可靠的 child-agent 列表，加索引会成为第二来源（rule 8） |
| Q2 time tie-break with parent | **不引入** epsilon；保留 raw `time` 排序 | `parentSessionID` 在 writer 内部不在 CardNode 上；ancestry 不可靠 |
| Q3 reply-box 单一 vs 双入口 | **单一**入口在真实 reply target | 与现有 session/phase 身份合同一致 |
| Q4 avatar 分阶段 | **一次性**全 13 role | partial rollout 制造双视觉语言 |
| Q5 CardHeadActions 抽组件 | **不抽组件**；抽 `useCardHeadActions` hook | actions 强耦合 state，组件 prop 表会爆炸 |

---

## 实施次序

1. 补 `--card-stage-system` / `--card-stage-integrity` token + `stageAccent()` 补 case + 单测
2. `Icon.tsx` 追加 15 个 `avatar-*` 注册项；`flat-redesign-icon-coverage.test.ts` 自动验
3. `Avatar.tsx` 薄 facade + `avatar-coverage.test.ts`
4. `useCardHeadActions` hook + 单测
5. `utils/chat-bubble.ts` + `chat-bubble-routing.test.ts`
6. `ChatBubble.tsx` + `chat-bubble.css` + DOM 契约测试
7. `chat-bubble-invariants.test.ts`（agent childIDs 为空）
8. 改 `Conversation.tsx` 路由 + 删 `Card.tsx` message/agent 分支
9. 清 `card.css` 中 message/agent 残留规则
10. `CardHeader.tsx` 切换到 hook
11. 跑 overlay-web-benchmark（visual，非 headless）三主题人工验收
12. commit + push（rule 33；不带 `--no-verify`）

---

## 风险

| ID | 风险 | 缓解 |
|----|------|------|
| R1 | 若 writer 未来给 agent 卡挂 children，bubble 不渲染 children 会丢内容 | `chat-bubble-invariants.test.ts` 守护 |
| R2 | `useCardHeadActions` hook 在两处调用，state 会复制双份 | hook 内 state 是 per-call signal；CardHeader 和 ChatBubble 共享同一 node 时各自有独立交互态（copy ack 只影响自己的按钮），符合预期 |
| R3 | Backdrop-filter 性能 | `@supports` 降级；视觉验收阶段抽样检查滚动帧率 |
| R4 | step 卡仍是"卡片状"，与气泡视觉混搭 | step/phase 本质是 goal 流水容器，视觉上"卡片+段落标题"语义正确，不视为缺陷 |
| R5 | `pruneCardsAfterCursor` 两次非原子写 | 与本改造无关；selector 不做全扫，transient gap 不影响 bubble 路由 |
