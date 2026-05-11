# Chat-Bubble Avatar Redesign

**Date:** 2026-05-12
**Scope:** `packages/overlay/src` — conversation surface only
**Trigger:** 用户反馈"现在的卡片堆叠感太重，莫名其妙"。目标改成多角色聊天形态：头像 + 毛玻璃气泡。

## Revision history

- **2026-05-12 v1**：初稿。基于错误假设——以为子 agent 嵌在 parent agent 内部需要拍平。
- **2026-05-12 v2**：folded codex round-1 review 反馈（top-level vs subtree 校正、range matrix、token 补齐、Tauri 校正、行为保留补完）。
- **2026-05-12 v3 (this)**：folded codex round-2 review 反馈：
  - **"agent.childIDs 为空" invariant 是 FALSE**：`rebuildInteractionCards` (tree-writer.ts:1696-1747) 把 `interaction-card:*` (`kind="message"`) 挂为 owning session (`kind="agent"`) 的 children；`integrityCardOwners` (tree-writer.ts:1886-1894) 把 integrity 卡挂为 requirements session 的 children。bubble body 必须真渲染 childIDs。
  - **interaction message 没有 `stage` 字段**（tree-writer.ts:1684-1692），按 `(kind × stage)` 路由会落入 undefined。路由改用 `effectiveRole(node)`（kind + stage + role 三者归一）。
  - **`pruneCardsAfterCursor` 留下悬挂 `childIDs`**：删 cards 但不修复存活 parent 的 `childIDs`；`visibleChildIDsForCard` 抛错。这是 pre-existing 但与本次 bubble 渲染 childIDs 路径正交相关，必须修复 prune（不能 wave away）。
  - **`useCardHeadActions` API 必须widen**：trace 状态需自动调用 `setCardExpanded`；rewind/cancel 依赖父级 callback + sessionID 不只 node。spec 给出明确签名。
  - **avatar count 不一致**：表格 15 / Q4 决议写"13" → 统一为 15（与 AgentRole 全集对齐）。
  - **`Avatar.tsx` 必须 own normalization + container chrome**，否则是 dead abstraction（codex 提醒）。
  - **`renderAsBubble` 需结构性 guard**：架构守门测试 grep 禁止其它源码出现 `kind === "message"` / `kind === "agent"` 判定。

---

## 决策矩阵（已与用户对齐）

| 问题 | 决定 |
|------|------|
| 改造范围 | "消息态" 卡片（详见下方范围矩阵）。`step` / `phase` / `tool` 容器保持现有 card chrome |
| 气泡对齐 | `user` 靠右；其它（assistant / system / 所有 stage agent）靠左 |
| 嵌套行为 | 不存在子-agent 拍平问题 —— 非 goal 子 session 已经是 top-level 平铺；goal 子 session 已被 `phase` 卡吸收 |

---

## 范围矩阵（rule 35：穷举 writer-emitted 形态）

按 writer 实际产生的 `(kind, stage, role)` 三元组路由：

| `node.kind` | 来源 | `stage` | `role` | 渲染 | 备注 |
|-------------|------|---------|--------|------|------|
| `message` | `ensureRequestBubble` (`ctx:user-request`) | undefined | `user` | bubble (右) | 任务初始 request |
| `message` | `upsertInteractionCard` (`interaction-card:*`) | undefined | `user` / `system` / `assistant` | bubble (左/右 按 role) | LLM 问询 / 用户回复对话片段；通常作为 session 卡的 child |
| `agent` | `ensureSessionCard` | one of `assistant / orchestrator / spec / requirements / design-analyst / architect / planner / executor / build / evaluator / delivery / integrity / system` | derived | bubble (左) | 主要 agent stages |
| `agent` | session with `stage="integrity"` | `integrity` | derived | bubble (左) + `<IntegrityBody/>` | structured verdict 嵌入 body |
| `step` | per-goal executor step | `<stepID>` | n/a | **card**（不动） | 承载 goal metadata + plan nodes + verdict |
| `phase` | step 内 phase | `<phaseSessionKind>` | n/a | **card**（不动） | 吸收 session parts |
| `tool` | promoted tool call | toolname | n/a | **card**（不动） | 通过 `CardParts` inline 在 bubble body 内 |
| `integrity` (legacy kind) | (已废弃) | — | — | **card**（不动） | 数据流已不再产生；保留 fallback |

**判定单点：** 新增 `utils/chat-bubble.ts` 导出 `renderAsBubble(node): boolean` 与 `bubbleAlign(node): "left" | "right"`：
```ts
export function renderAsBubble(node: CardNode): boolean {
  return node.kind === "message" || node.kind === "agent";
}
export function bubbleAlign(node: CardNode): "left" | "right" {
  // 仅按 effectiveRole 决定；不再读 stage
  const role = normalizeAgentRole(node.role || node.stage || "");
  return role === "user" ? "right" : "left";
}
```
**架构守门**：`overlay-architecture-guards.test.ts` 加 grep 规则：除了 `utils/chat-bubble.ts` / 测试本身 / store 类型定义文件外，禁止 src/ 其它文件出现裸 `kind === "message"` 或 `kind === "agent"` 判定字符串（防止 duplicate 路由源）。

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
- **agent / message bubble body 真渲染 `childIDs`**：interaction-card / integrity verdict 已经作为 session 的 children 由 writer 挂载（参见 `tree-writer.ts:1870-1894`），bubble 必须承担渲染（详见下节）。
- helper 函数（`collectCardText / collectLatestActivityText / collectActivityCounts`）继续递归 childIDs —— 对气泡也是正确语义（user 复制 agent 全场对话理应含 interaction 问答；折叠态预览 / activity stats 把子对话计入也合理）。**不动 helper**。

### Bubble body 渲染 children
agent / message bubble 在 body 内渲染：
1. `node.parts` 通过 `<CardParts/>`（text / reasoning / inline tool / file / interaction-question part / interaction-permission part / boundary）
2. `node.childIDs` 中每个 child：
   - `kind === "message"` (interaction-card) → 嵌套小气泡（紧凑变体：`.chat-bubble--nested`，去掉头像列、缩窄 padding、保留 role label 单行 + 文本）。Role 用 `normalizeAgentRole(child.role)` 决定左/右倾向（user 答复仍微右倾，system 居中无倾）。
   - `kind === "agent"` (rare：integrity verdict 是 sibling session card 而不是 child，但保留代码路径) → 嵌套小气泡 + `<IntegrityBody/>`（若 `child.integrity` 存在）
   - `kind === "integrity"` legacy kind → `<IntegrityBody/>` 直接渲染
   - 其它 → throw（rule 7 不允许 silent fallback）

> 这样 bubble 与现有 `<Card/>` 渲染 children 的语义对齐，只是子节点的 chrome 不同。所有现有 helper 不需要变更。

### pruneCardsAfterCursor 修复（含在本 spec）
现状 `store/card-tree.ts:261-277` 删 `cards[id]` 但不清理存活 parents 的 `childIDs`，导致 rewind 后 bubble 渲染 children 会触发 `visibleChildIDsForCard` 的 missing-child throw。

**必须在 prune 函数内补救**：删除 cards 后，遍历存活 cards，filter 它们的 `childIDs`，drop 引用已删 ID 的条目。这是 store 不变量修复，与 bubble 改造同 commit。

```ts
// 修订后伪码（位于 store/card-tree.ts pruneCardsAfterCursor 末尾）
const alive = new Set(Object.keys(survivors));
setCardTreeStore(
  "cards",
  produce((cards) => {
    for (const card of Object.values(cards)) {
      if (!card.childIDs) continue;
      const filtered = card.childIDs.filter((id) => alive.has(id));
      if (filtered.length !== card.childIDs.length) card.childIDs = filtered;
    }
  }),
);
```
单测 `store/card-tree-prune.test.ts`：构造 session+interaction 子卡，rewind 到 session 之后、interaction 之前，验证 session.childIDs 不再包含已 pruned interaction ID。

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

### Avatar SVG —— 完整 15 个 AgentRole

复用 `Icon.tsx` 注册中心，新增 `avatar-<role>` 命名空间。**一次性补全** `message.ts` 中 `AgentRole` 定义的全部 15 个 role（codex Q4 反馈：避免 partial rollout 造成双视觉语言）：

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

不新建 `<CardHeadActions/>` 组件。改为 `hooks/use-card-head-actions.ts`：

```ts
interface UseCardHeadActionsInput {
  node: () => CardNode;
  expanded: () => boolean;
  /** 调用方提供的展开 callback；trace toggle 在打开 trace 前会调用它确保 body 可见 */
  setExpanded: (next: boolean) => void;
  /** 可选 — 父级注入的 rewind 端点（Card / ChatBubble 都从同一 task store 拿） */
  onRewind?: (cursorTime: number, anchorID: string, opts: { resetWorktree: boolean }) => Promise<void>;
  /** 可选 — agent-cancel；sessionID 在 hook 内部用 node.id 解析失败时退回参数 */
  onAgentCancel?: (sessionID: string) => Promise<void>;
  agentSessionID?: () => string | undefined;
  /** 可选 — trace 仅 kind="agent" 卡可用 */
  traceSessionID?: () => string | undefined;
}

interface UseCardHeadActionsOutput {
  // 反应式 state
  state: {
    copied: () => boolean;
    rewinding: () => boolean;
    cancelling: () => boolean;
    traceOpen: () => boolean;
  };
  // capabilities — 用于 view 决定按钮显示
  caps: {
    canCopy: () => boolean;
    canRewind: () => boolean;
    canCancel: () => boolean;
    canTrace: () => boolean;
  };
  // 触发器（已绑定 stopPropagation + clipboard / dialog 逻辑）
  onCopy: (e: Event) => void;
  onRewind: (e: Event) => void;
  onAgentCancel: (e: Event) => void;
  onTraceToggle: (e: Event) => void;
  // i18n labels（hook 内调用 t()，view 只读）
  labels: {
    copy: () => string;
    copied: () => string;
    rewind: () => string;
    rewindStep: () => string;
    cancel: () => string;
    trace: () => string;
  };
}
```

行为契约：
- `onTraceToggle`：内部检测 `expanded()`，若 false 先 `setExpanded(true)`（替代现在 `Card.tsx:151-153` 的 auto-expand）。
- `onRewind`：保留现有 `showAppDialog` 弹窗逻辑；`rewinding()` 起止 timer 不变（800ms）。
- `onCopy`：clipboard 写入后 `copied()` true 持续 1200ms。
- 每个调用点（`CardHeader` 一次 / `ChatBubble` 一次）拿到独立的 signal — Solid hook 调用语义保证 per-call 隔离。

`CardHeader.tsx` 和 `ChatBubble.tsx` 各自渲染按钮 markup，但 state / handlers / labels 全部来自 hook。`utils/card-tree.ts` 的 `canCardSurfaceCollapse` 等 DOM 工具留在调用方（与 surface 物理结构强耦合）。

单测 `hooks/use-card-head-actions.test.ts`：mock `setExpanded` / `showAppDialog` / `navigator.clipboard`，验证 trace 自动展开、rewind 弹窗 + reset-worktree 选项透传、copy ack 1200ms timer、cancel pending 状态。

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
  - `test/chat-bubble-children.test.ts` — bubble body 真渲染 childIDs：interaction-card 嵌套小气泡 + integrity child 走 IntegrityBody
  - `test/avatar-coverage.test.ts` — AgentRole 全集映射
  - `test/store-card-tree-prune.test.ts` — prune 后 surviving parent 的 childIDs 不悬挂已删 ID
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

### Bubble children
- `chat-bubble-children.test.ts`：构造 agent session + interaction-card child + integrity-tagged child；验证 bubble body 实际渲染 nested 小气泡 / `<IntegrityBody/>`；验证 `collectCardText` 正确包含 interaction 文本（helper 递归 OK）。

### Prune
- `store-card-tree-prune.test.ts`：session 卡 t=100，interaction child t=200；`pruneCardsAfterCursor(150)` 后 session 仍在但 session.childIDs 不再含已删的 interaction ID（防 visibleChildIDsForCard throw）。

### Hook
- `use-card-head-actions.test.ts`：copy ack 1200ms / rewind 弹窗 + reset-worktree 透传 / cancel 800ms timer / trace 自动 setExpanded(true) 触发隔离单测。

### 视觉
- `overlay-web-benchmark` 一次（rule 25：不允许 headless）；分别截 light / dark / vscode-dark 三主题；人工对比改造前后。

### 架构守门
- `overlay-architecture-guards.test.ts` 追加：
  - `chat-bubble.css` 禁止 hex 字面量
  - `ChatBubble.tsx` 禁止内联 SVG
  - **src/ 内除 `utils/chat-bubble.ts` / `store/card-tree.ts`（类型定义）/ 测试外，禁止出现 `kind === "message"` 或 `kind === "agent"` 字符串**（防 duplicate 路由源 — codex round-2 反馈）

---

## 开放问题（codex round 1 已回答，关闭）

| Q | 决议 | 依据 |
|---|------|------|
| Q1 folded agent index in goal/step | **不加** | 当前层级不暴露可靠的 child-agent 列表，加索引会成为第二来源（rule 8） |
| Q2 time tie-break with parent | **不引入** epsilon；保留 raw `time` 排序 | `parentSessionID` 在 writer 内部不在 CardNode 上；ancestry 不可靠 |
| Q3 reply-box 单一 vs 双入口 | **单一**入口在真实 reply target | 与现有 session/phase 身份合同一致 |
| Q4 avatar 分阶段 | **一次性**全 15 个 `AgentRole` | partial rollout 制造双视觉语言 |
| Q5 CardHeadActions 抽组件 | **不抽组件**；抽 `useCardHeadActions` hook | actions 强耦合 state，组件 prop 表会爆炸 |

---

## 实施次序

1. 补 `--card-stage-system` / `--card-stage-integrity` token + `stageAccent()` 补 case + 单测
2. 修 `pruneCardsAfterCursor` 清理悬挂 `childIDs` + `store-card-tree-prune.test.ts`
3. `Icon.tsx` 追加 15 个 `avatar-*` 注册项；`flat-redesign-icon-coverage.test.ts` 自动验
4. `Avatar.tsx` 薄 facade（own normalization + container chrome）+ `avatar-coverage.test.ts`
5. `useCardHeadActions` hook + 单测
6. `utils/chat-bubble.ts`（`renderAsBubble` + `bubbleAlign`）+ `chat-bubble-routing.test.ts`
7. `ChatBubble.tsx` + `chat-bubble.css` + DOM 契约测试 + bubble-children 测试
8. 改 `Conversation.tsx` 路由 + 删 `Card.tsx` 中 message/agent kind 分支
9. 清 `card.css` 中 message/agent 残留规则
10. `CardHeader.tsx` 切换到 hook
11. 架构守门测试追加（hex / 内联 SVG / kind 字符串）
12. 跑 overlay-web-benchmark（visual，非 headless）三主题人工验收
13. commit + push（rule 33；不带 `--no-verify`）

---

## 风险

| ID | 风险 | 缓解 |
|----|------|------|
| R1 | writer 未来变更 child 挂载策略，bubble 漏渲新 child 类型 | `chat-bubble-children.test.ts` 覆盖现有 interaction / integrity 两种；新 child kind 必须更新 `<ChatBubble/>` 的 switch（else 抛错） |
| R2 | `useCardHeadActions` hook 在两处调用，state 复制双份 | hook 内 state 是 per-call signal；CardHeader 和 ChatBubble 共享同一 node 时各自独立交互态（copy ack 只影响自己按钮），符合预期 |
| R3 | Backdrop-filter 性能 | `@supports` 降级；视觉验收阶段抽样检查滚动帧率 |
| R4 | step 卡仍是"卡片状"，与气泡视觉混搭 | step/phase 本质是 goal 流水容器，视觉上"卡片+段落标题"语义正确，不视为缺陷 |
| R5 | 第一次实施后，可能仍有 src/ 文件残留 `kind === "agent"` 字面量逃过 grep | 架构守门 test 跑通即认为消除；CI 内强制 |
